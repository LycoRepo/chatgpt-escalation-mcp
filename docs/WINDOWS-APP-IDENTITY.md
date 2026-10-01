# Windows application identity and unified-app compatibility

The newer unified ChatGPT/Codex desktop package can also run as `ChatGPT.exe`. Matching that name alone can terminate Codex tasks or select the wrong window. This change separates executable identity from UI compatibility.

## Behavior

- Preserve running applications by default. No restart occurs without explicit configuration.
- Match processes using their full executable paths, including in availability checks and fallback window selection.
- Without a configured executable, auto-discover only legacy ChatGPT Store package paths in the protected WindowsApps root.
- Require exactly one eligible visible window; ambiguous selection fails closed.
- Revalidate a cached window's owning executable before foreground/viability operations.
- Launch only the configured executable, without a shell or a generic `start ChatGPT` command.
- Never restart a unified `OpenAI.Codex_*` application, even if restart is requested.
- Resolve Python drivers relative to this installed package, independent of the MCP client's working directory.

## Local configuration

Add optional fields to your local `chatgpt` section:

```json
{
  "platform": "win",
  "responseTimeout": 600000,
  "projects": {
    "default": { "conversation": "Hermes Escalation" }
  },
  "executablePath": "C:\\Apps\\ChatGPT.exe",
  "pythonExecutable": "C:\\Python\\python.exe",
  "allowUnifiedApp": false,
  "restartTarget": false
}
```

Replace the example paths with verified installed paths. These settings also have environment equivalents: `CHATGPT_EXECUTABLE_PATH`, `CHATGPT_PYTHON_EXECUTABLE`, `CHATGPT_ALLOW_UNIFIED_APP=1`, and `CHATGPT_RESTART_TARGET=1`. Explicit JSON fields override equivalent environment values.

For the newer unified package, an explicit executable path and `allowUnifiedApp: true` are required to opt into identity matching. This opt-in does **not** certify the current UI's navigation, composer, response-completion or copy controls. Those still require manual acceptance against the exact installed release before enabling unattended escalation. An availability result explicitly reports `ui_compatibility_verified: false`.

Restart defaults have changed from unconditional restart to preserving the running app. A legacy user who intentionally needs the old restart behavior must provide the exact executable and explicitly set `restartTarget: true`.

## Validation

```text
npm ci --ignore-scripts
npm run build
python -m unittest discover -s tests -v
node --test tests/test_windows_config.cjs
```

Python tests exercise the real identity-sensitive flow methods with mock processes/windows and no UI/OCR imports. They verify same-name isolation, restart gating, unique window selection, fallback selection, cached-handle revalidation and explicit launch requirements. Node tests verify caller-cwd isolation and config validation.

No live clicks, focus changes, process termination or message sending are part of these tests. A complete live escalation on the current unified application has not been verified.
