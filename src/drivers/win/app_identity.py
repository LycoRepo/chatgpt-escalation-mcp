"""Windows application identity policy, independent of UI/OCR dependencies."""
import ntpath
import os
from dataclasses import dataclass


def normalize_executable(path):
    if not isinstance(path, str) or not ntpath.isabs(path) or not ntpath.splitdrive(path)[0]:
        return None
    if os.name == "nt":
        path = os.path.realpath(path)
    return ntpath.normcase(ntpath.normpath(path))


def is_unified_app(path):
    normalized = normalize_executable(path)
    return bool(normalized and any(part.startswith("openai.codex_") for part in normalized.split("\\")))


@dataclass(frozen=True)
class AppIdentity:
    executable_path: str = ""
    allow_unified_app: bool = False
    restart_requested: bool = False

    def __post_init__(self):
        if self.executable_path and not normalize_executable(self.executable_path):
            raise ValueError("CHATGPT_EXECUTABLE_PATH must be an absolute Windows executable path")
        if self.executable_path and ntpath.basename(self.executable_path).lower() != "chatgpt.exe":
            raise ValueError("CHATGPT_EXECUTABLE_PATH must identify ChatGPT.exe")
        if is_unified_app(self.executable_path) and not self.allow_unified_app:
            raise ValueError("Unified ChatGPT/Codex requires explicit CHATGPT_ALLOW_UNIFIED_APP=1; UI compatibility is unverified")

    @classmethod
    def from_environment(cls):
        return cls(
            executable_path=os.environ.get("CHATGPT_EXECUTABLE_PATH", ""),
            allow_unified_app=os.environ.get("CHATGPT_ALLOW_UNIFIED_APP") == "1",
            restart_requested=os.environ.get("CHATGPT_RESTART_TARGET") == "1",
        )

    @property
    def can_restart(self):
        # Restarting the unified app would interrupt unrelated Codex tasks.
        return bool(self.executable_path and self.restart_requested and not is_unified_app(self.executable_path))

    def matches_executable(self, candidate):
        normalized = normalize_executable(candidate)
        if not normalized or ntpath.basename(normalized) != "chatgpt.exe":
            return False
        if self.executable_path:
            return normalized == normalize_executable(self.executable_path)
        # Legacy auto-discovery is bounded to the protected Windows Store root.
        store_root = normalize_executable(ntpath.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "WindowsApps"))
        prefix = store_root.rstrip("\\") + "\\"
        if not normalized.startswith(prefix):
            return False
        package = normalized[len(prefix):].split("\\", 1)[0]
        return package.startswith(("openai.chatgpt-desktop_", "openai.chatgpt_"))

    def matches_process(self, process):
        try:
            return self.matches_executable(process.exe())
        except Exception:
            # Access-denied, vanished and unreadable processes are never targets.
            return False
