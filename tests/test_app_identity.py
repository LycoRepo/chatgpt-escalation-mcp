import ast
import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

DRIVERS = Path(__file__).resolve().parents[1] / "src" / "drivers" / "win"
sys.path.insert(0, str(DRIVERS))
from app_identity import AppIdentity

LEGACY = r"C:\Program Files\WindowsApps\OpenAI.ChatGPT-Desktop_test\ChatGPT.exe"
UNIFIED = r"C:\Program Files\WindowsApps\OpenAI.Codex_test\app\ChatGPT.exe"


def flow_class():
    """Load the actual identity-sensitive methods without UI/OCR startup side effects."""
    tree = ast.parse((DRIVERS / "robust_flow.py").read_text(encoding="utf-8"))
    source_class = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "RobustChatGPTFlow")
    methods = {"__init__", "step1_kill_chatgpt", "step2_start_chatgpt", "_find_chatgpt_hwnd", "_find_chatgpt_hwnd_fallback", "_is_target_window"}
    source_class.body = [n for n in source_class.body if isinstance(n, ast.FunctionDef) and n.name in methods]
    module = ast.fix_missing_locations(ast.Module(body=[source_class], type_ignores=[]))
    namespace = {"AppIdentity": AppIdentity, "log_debug": lambda *_: None, "time": __import__("time"), "os": os}
    exec(compile(module, str(DRIVERS / "robust_flow.py"), "exec"), namespace)
    return namespace["RobustChatGPTFlow"]


class Process:
    def __init__(self, path, pid=1):
        self.path = path
        self.pid = pid
        self.terminated = False

    def exe(self):
        return self.path

    def terminate(self):
        self.terminated = True


class IdentityTests(unittest.TestCase):
    def test_default_legacy_discovery_does_not_match_codex_or_arbitrary_same_name(self):
        target = AppIdentity()
        self.assertTrue(target.matches_executable(LEGACY))
        self.assertFalse(target.matches_executable(UNIFIED))
        self.assertFalse(target.matches_executable(r"C:\Other\ChatGPT.exe"))
        self.assertFalse(target.matches_executable(r"C:\Other\OpenAI.ChatGPT-Desktop_test\ChatGPT.exe"))

    def test_explicit_path_is_case_insensitive_and_exact(self):
        target = AppIdentity(LEGACY)
        self.assertTrue(target.matches_executable(LEGACY.lower()))
        self.assertFalse(target.matches_executable(LEGACY.replace("_test", "_test-other")))

    def test_invalid_and_relative_paths_fail_closed(self):
        for path in ["ChatGPT.exe", r"C:ChatGPT.exe", r"C:\Apps\Other.exe"]:
            with self.assertRaises(ValueError):
                AppIdentity(path)

    def test_unified_app_requires_opt_in_and_cannot_be_restarted(self):
        with self.assertRaises(ValueError):
            AppIdentity(UNIFIED)
        target = AppIdentity(UNIFIED, allow_unified_app=True, restart_requested=True)
        self.assertTrue(target.matches_executable(UNIFIED))
        self.assertFalse(target.matches_executable(LEGACY))
        self.assertFalse(target.can_restart)

    def test_missing_process_identity_is_not_a_match(self):
        process = types.SimpleNamespace(exe=lambda: (_ for _ in ()).throw(PermissionError()))
        self.assertFalse(AppIdentity(LEGACY).matches_process(process))

    def test_default_restart_gate_never_enumerates_processes(self):
        with patch.dict(os.environ, {}, clear=True):
            flow = flow_class()()
        # No psutil module required: disabled restart returns before enumeration.
        self.assertTrue(flow.step1_kill_chatgpt())

    def test_restart_only_terminates_verified_target(self):
        target = Process(LEGACY)
        unrelated = Process(UNIFIED, 2)
        calls = 0
        def process_iter(*_):
            nonlocal calls
            calls += 1
            return [target, unrelated] if calls == 1 else [unrelated]
        fake = types.SimpleNamespace(process_iter=process_iter, NoSuchProcess=RuntimeError, AccessDenied=PermissionError)
        with patch.dict(os.environ, {}, clear=True):
            flow = flow_class()()
        flow.target = AppIdentity(LEGACY, restart_requested=True)
        with patch.dict(sys.modules, {"psutil": fake}):
            self.assertTrue(flow.step1_kill_chatgpt())
        self.assertTrue(target.terminated)
        self.assertFalse(unrelated.terminated)

    def test_ambiguous_windows_fail_closed_and_ignore_other_apps(self):
        processes = {1: Process(LEGACY), 2: Process(UNIFIED)}
        windows = [101, 102]
        gui = types.SimpleNamespace(
            IsWindow=lambda _: True, IsWindowVisible=lambda _: True,
            GetWindowText=lambda _: "ChatGPT",
            EnumWindows=lambda callback, _: [callback(hwnd, None) for hwnd in windows],
        )
        winproc = types.SimpleNamespace(GetWindowThreadProcessId=lambda hwnd: (0, 1 if hwnd == 101 else 2))
        with patch.dict(os.environ, {}, clear=True):
            flow = flow_class()()
        flow.target = AppIdentity(LEGACY)
        with patch.dict(sys.modules, {"win32gui": gui, "win32process": winproc, "psutil": types.SimpleNamespace(Process=processes.__getitem__)}):
            self.assertEqual(flow._find_chatgpt_hwnd(), 101)
            processes[2] = Process(LEGACY, 2)
            self.assertIsNone(flow._find_chatgpt_hwnd())

    def test_unconfigured_start_never_launches_generic_chatgpt_command(self):
        with patch.dict(os.environ, {}, clear=True):
            flow = flow_class()()
        flow._find_chatgpt_hwnd = lambda: None
        with patch("subprocess.Popen") as launch:
            self.assertFalse(flow.step2_start_chatgpt())
            launch.assert_not_called()

    def test_fallback_rejects_same_named_codex_and_ambiguous_targets(self):
        processes = [Process(LEGACY), Process(UNIFIED, 2)]
        connected = []
        class FakeApplication:
            def __init__(self, **_):
                pass
            def connect(self, process):
                connected.append(process)
                self.pid = process
                return self
            def top_window(self):
                return types.SimpleNamespace(handle=100+self.pid, is_visible=lambda: True)
        with patch.dict(os.environ, {}, clear=True):
            flow = flow_class()()
        flow.target = AppIdentity(LEGACY)
        fake_psutil = types.SimpleNamespace(process_iter=lambda *_: processes)
        with patch.dict(sys.modules, {"pywinauto": types.SimpleNamespace(Application=FakeApplication)}):
            self.assertEqual(flow._find_chatgpt_hwnd_fallback(fake_psutil), 101)
            self.assertEqual(connected, [1])
            processes[1] = Process(LEGACY, 2)
            self.assertIsNone(flow._find_chatgpt_hwnd_fallback(fake_psutil))

    def test_cached_handle_is_revalidated_against_executable_identity(self):
        with patch.dict(os.environ, {}, clear=True):
            flow = flow_class()()
        flow.target = AppIdentity(LEGACY)
        flow.hwnd = 101
        process = Process(UNIFIED)
        with patch.dict(sys.modules, {
            "win32gui": types.SimpleNamespace(IsWindow=lambda _: True),
            "win32process": types.SimpleNamespace(GetWindowThreadProcessId=lambda _: (0, 1)),
            "psutil": types.SimpleNamespace(Process=lambda _: process),
        }):
            self.assertFalse(flow._is_target_window())
            process.path = LEGACY
            self.assertTrue(flow._is_target_window())


if __name__ == "__main__":
    unittest.main()
