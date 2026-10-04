# ChatGPT Escalation MCP Server

Windows executable matching and restart behavior are being hardened for same-named unified ChatGPT/Codex processes. See [application identity configuration and validation](docs/WINDOWS-APP-IDENTITY.md). Unified-app UI compatibility remains unverified.

An MCP (Model Context Protocol) server that enables autonomous coding agents to escalate complex questions to the ChatGPT Desktop app automatically — **ToS-compliant** via native UI automation.

**What this does:** This tool lets autonomous coding agents (Copilot, Claude, Cline, Roo, etc.) escalate hard questions to the *ChatGPT Desktop app* on your computer. It automates ChatGPT the same way a human would — clicking the UI, sending the question, waiting for the response, copying it — then returns the answer to your agent so it can continue working *without you*.

> ### 🖥️ Windows 10/11 Only
> **This tool supports only Windows.** macOS and Linux are not supported and there are no plans to add support.
>
> ### ⚠️ Important Requirements
> - **ChatGPT Desktop app** (Microsoft Store version)
> - Automation controls your ChatGPT window — **don't touch it** during escalations
> - Only **one escalation at a time** (requests are queued)
> - UI changes in ChatGPT may break automation — [open an issue](../../issues) if this happens
>
> ### ✅ ToS Compliant
> This tool only automates your *local* ChatGPT Desktop application. It does **not** automate the web UI, bypass security features, or scrape data.

## Features

- **Two MCP Tools**:
  - `escalate_to_expert` - Send questions to ChatGPT and receive detailed responses
  - `list_projects` - Discover available project IDs from your configuration
- **100% Accurate UI Detection** - Pixel-based detection for sidebar state and response completion
- **OCR-Based Navigation** - PaddleOCR v5 for reliable text extraction and fuzzy matching
- **Async Model Loading** - OCR models preload in background for faster response times
- **Project Organization** - Map multiple projects to different ChatGPT conversations

## How It Works

```
┌─────────────────┐    MCP Protocol    ┌──────────────────┐
│  Coding Agent   │◄──────────────────►│   MCP Server     │
│ (Copilot/Roo)   │                    │  (This Project)  │
└─────────────────┘                    └────────┬─────────┘
                                                │
                                                │ spawn
                                                ▼
                                       ┌──────────────────┐
                                       │  Python Driver   │
                                       │  (Windows)       │
                                       └────────┬─────────┘
                                                │
                                                │ UI Automation
                                                ▼
                                       ┌──────────────────┐
                                       │  ChatGPT Desktop │
                                       │       App        │
                                       └──────────────────┘
```

### Automation Flow

1. **Prepare App** - Reuse the verified running window; restart only when explicitly configured
2. **Open ChatGPT** - Launch the configured executable when no verified window is running
3. **Focus Window** - Bring to foreground
4. **Open Sidebar** - Click hamburger menu (pixel detection for state)
5. **Click Project** - OCR + fuzzy matching to find folder
6. **Click Conversation** - OCR + fuzzy matching to find chat (Ctrl+K fallback if not found)
7. **Focus Input** - Click text input area
8. **Send Prompt** - Paste and submit
9. **Wait for Response** - Pixel-based stop button detection
10. **Copy Response** - Robust button probing to find copy button

**Automatic Retry Logic**: If any step fails, the entire flow restarts (up to 4 attempts total). By default each retry reuses the verified running window; the app itself is restarted only when both `restartTarget: true` and an explicit `executablePath` are configured, and the unified `OpenAI.Codex_*` app is never restarted. Most failures are transient (focus lost, window minimized) and succeed on retry.

## System Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Windows** | 10 or 11 | macOS/Linux not supported |
| **ChatGPT Desktop** | Latest | Microsoft Store version |
| **Node.js** | 18+ | For the MCP server |
| **Python** | 3.10+ | For UI automation driver |
| **GPU** | Not required | CPU-only OCR works fine |

### Python Packages
```
pywinauto        # Windows UI automation
pyperclip        # Clipboard access
paddleocr        # Text recognition
paddlepaddle     # PaddleOCR backend
```

### Why Windows Only?

ChatGPT Desktop exposes fully accessible UI elements on Windows via UI Automation APIs. The pixel-based detection and keyboard/mouse automation work reliably on Windows.

macOS has different automation APIs (Accessibility API) that would require a complete rewrite of the driver. Linux doesn't have a ChatGPT Desktop app.

### Tested Environment

| Component | Version | Status |
|-----------|---------|--------|
| **ChatGPT Desktop** | 1.2025.112 | ✅ Tested |
| **Windows 11** | 24H2 (Build 26100.2605) | ✅ Tested |
| **Last Verified** | December 2, 2025 | |

### Robustness Features

- **Automatic Retries**: Up to 4 attempts per escalation with intelligent failure detection
- **Structured Observability**: Every escalation gets a unique `run_id` for correlation and debugging
- **Error Reason Codes**: 12+ specific error codes (e.g., `focus_failed`, `project_not_found`, `empty_response`)
- **Chaos Tested**: Passes aggressive chaos testing (random focus stealing, window minimization, mouse interference)
- **Smart Fallbacks**: Ctrl+K search if conversation not visible in sidebar

> 💡 **After ChatGPT Updates:** UI automation may break if ChatGPT significantly changes their layout. If you encounter issues after an update, please [open an issue](../../issues) with your ChatGPT version.

## Installation

### Option 1: Install from npm (Recommended)

```powershell
# Install globally
npm install -g chatgpt-escalation-mcp

# Install Python dependencies
pip install pywinauto pyperclip paddleocr paddlepaddle

# Run setup wizard
chatgpt-escalation-mcp init
```

### Option 2: Install from GitHub Release

1. Download the latest release from [GitHub Releases](https://github.com/Dazlarus/chatgpt-escalation-mcp/releases)
2. Extract the ZIP file
3. Run:

```powershell
cd chatgpt-escalation-mcp
npm install
npm run build
pip install pywinauto pyperclip paddleocr paddlepaddle
```

### Option 3: Install from Source

```powershell
# Clone the repository
git clone https://github.com/Dazlarus/chatgpt-escalation-mcp.git
cd chatgpt-escalation-mcp

# Install Node.js dependencies
npm install

# Build the project
npm run build

# Install Python dependencies
pip install pywinauto pyperclip paddleocr paddlepaddle
```

## Quick Start

### Step 1: Install ChatGPT Desktop

```powershell
winget install --id=9NT1R1C2HH7J --source=msstore --accept-package-agreements --accept-source-agreements
```

Or install from the Microsoft Store: search "ChatGPT" by OpenAI.

### Step 2: Create a Conversation in ChatGPT

1. Open ChatGPT Desktop and sign in
2. Create a new **Project** (folder) called `Agent Expert Help`
3. Inside that project, create a new conversation called `Copilot Escalations`
4. Send this initial message to set the context:

```
You are an expert software architect. I'll send you technical questions from my coding agent (GitHub Copilot, Claude, etc.) when it gets stuck. 

For each question:
1. Analyze the problem thoroughly
2. Provide specific, actionable guidance
3. Include code examples when helpful
4. Explain WHY a solution works, not just what to do

The questions will include context about what the agent already tried.
```

### Step 3: Configure the MCP Server

Create the config file at `~/.chatgpt-escalation/config.json`:

```powershell
# Create config directory
New-Item -ItemType Directory -Path "$env:USERPROFILE\.chatgpt-escalation" -Force

# Create config file (edit the path in notepad)
notepad "$env:USERPROFILE\.chatgpt-escalation\config.json"
```

Paste this configuration:

```json
{
  "chatgpt": {
    "platform": "win",
    "responseTimeout": 600000,
    "projects": {
      "default": {
        "folder": "Agent Expert Help",
        "conversation": "Copilot Escalations"
      }
    }
  },
  "logging": {
    "level": "info"
  }
}
```

### Step 4: Add to Your MCP Client

**For VS Code with GitHub Copilot** (`%APPDATA%\Code\User\mcp.json`):
```json
{
  "servers": {
    "chatgpt-escalation": {
      "command": "node",
      "args": ["N://AI Projects//chatgpt-escalation-mcp//dist//src//server.js"]
    }
  }
}
```

**For Claude Desktop** (`%APPDATA%\Claude\claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "chatgpt-escalation": {
      "command": "node",
      "args": ["C://path//to//chatgpt-escalation-mcp//dist//src//server.js"]
    }
  }
}
```

> ⚠️ Use double forward slashes `//` in paths for JSON, or escape backslashes as `\\\\`

### Step 5: Teach Your Agent When to Escalate

Add escalation instructions to your agent. Choose the format that matches your tool:

<details>
<summary><strong>GitHub Copilot</strong> (.github/copilot-instructions.md)</summary>

```markdown
## Expert Escalation Protocol

You have access to the `escalate_to_expert` MCP tool that sends questions to ChatGPT for expert guidance.

### When to Escalate
- You've tried 3+ approaches without success
- The problem requires specialized domain knowledge
- You're unsure if the fundamental approach is correct
- You're hitting consistent failure patterns you can't diagnose

### How to Escalate
Use the `escalate_to_expert` tool with:
- `project`: "default" (or specific project ID)
- `reason`: Why you're stuck (be specific)
- `question`: The technical question
- `attempted`: What you already tried and results
- `artifacts`: Relevant code snippets

### After Escalation
Read the full response before implementing. ChatGPT often provides multiple approaches - pick the most appropriate one for the context.
```

</details>

<details>
<summary><strong>Cline / Roo Code</strong> (.clinerules or .roo/rules)</summary>

```markdown
## Expert Escalation Protocol

You have access to the `escalate_to_expert` MCP tool. Use it when stuck.

### Escalation Triggers
1. **Accuracy plateau** - 3+ attempts with no improvement
2. **Consistent failures** - Same error pattern despite different approaches
3. **Domain gap** - Problem needs specialized knowledge you lack
4. **Architecture uncertainty** - Unsure if approach is fundamentally correct

### Before Escalating
Stop and ask the user: "I've tried [X approaches] but I'm hitting [limitation]. Should I escalate to ChatGPT?"

If yes, call `escalate_to_expert` with:
- `project`: "default"
- `reason`: Brief description of why you're stuck
- `question`: Specific technical question
- `attempted`: Numbered list of what you tried and results
- `artifacts`: Relevant code snippets

### Question Format
Structure your question clearly:
- **Problem:** One sentence description
- **Context:** Technical details, frameworks, constraints
- **What I tried:** Numbered list with results
- **Specific questions:** What you need answered

### After Response
1. Read the FULL response before implementing
2. Identify the recommended approach (there may be multiple)
3. Implement incrementally - test each suggestion
4. If unclear, ask user for clarification before proceeding
```

</details>

<details>
<summary><strong>OpenAI Codex CLI</strong> (AGENTS.md or instructions)</summary>

```markdown
## Expert Escalation via ChatGPT

The `escalate_to_expert` MCP tool lets you ask ChatGPT for help on complex problems.

### When to Use
- Multiple failed attempts on a problem
- Need domain expertise (ML, systems, security, etc.)
- Debugging issues that don't make sense
- Architecture or design decisions

### Tool Usage
```
escalate_to_expert({
  project: "default",
  reason: "Brief explanation of the blocker",
  question: "Specific technical question",
  attempted: "What was tried and what happened",
  artifacts: [{type: "file_snippet", pathOrLabel: "file.py", content: "..."}]
})
```

### Best Practices
- Be specific about what you tried and exact error messages
- Include relevant code snippets in artifacts
- Ask focused questions, not "help me fix this"
- After receiving response, implement suggestions step by step
```

</details>

<details>
<summary><strong>Claude Desktop / Other MCP Clients</strong></summary>

```markdown
## Expert Escalation Protocol

You have access to the `escalate_to_expert` MCP tool that sends questions to ChatGPT.

### When to Escalate
- Tried 3+ approaches without success
- Problem requires specialized domain knowledge
- Unsure if fundamental approach is correct
- Hitting consistent failure patterns

### Tool Parameters
| Parameter | Required | Description |
|-----------|----------|-------------|
| project | Yes | Project ID (usually "default") |
| reason | Yes | Why you're escalating |
| question | Yes | The technical question |
| attempted | No | What you tried and results |
| artifacts | No | Code snippets [{type, pathOrLabel, content}] |

### After Response
Read fully before implementing. Pick the most appropriate suggestion for the context.
```

</details>

#### Example Escalation Call

```json
{
  "project": "default",
  "reason": "Authentication flow failing silently, can't identify root cause",
  "question": "Why would JWT refresh tokens work in development but fail in production with no error messages?",
  "attempted": "1. Checked token expiry (valid), 2. Verified CORS (correct), 3. Tested with Postman (works)",
  "artifacts": [{"type": "file_snippet", "pathOrLabel": "auth.ts", "content": "..."}]
}
```

## Configuration Reference

Config file location: `%USERPROFILE%\.chatgpt-escalation\config.json`

```json
{
  "chatgpt": {
    "platform": "win",
    "responseTimeout": 120000,
    "projects": {
      "my-project": {
        "folder": "My Project Folder",
        "conversation": "Expert Help Chat"
      },
      "simple-project": "Just a Conversation Title"
    }
  },
  "logging": {
    "level": "info"
  }
}
```

### Project Configuration

Projects can be configured two ways:

**Simple** (conversation at root level in ChatGPT sidebar):
```json
"project-id": "Conversation Title"
```

**With Folder** (conversation inside a ChatGPT project folder):
```json
"project-id": {
  "folder": "Project Folder Name",
  "conversation": "Conversation Title"
}
```

### Multiple Projects

You can map different coding projects to different ChatGPT conversations:

```json
"projects": {
  "webapp": {
    "folder": "Web Projects",
    "conversation": "React App Help"
  },
  "api": {
    "folder": "Backend Projects", 
    "conversation": "API Design Help"
  },
  "default": "General Coding Help"
}
```

Then agents can escalate to the right context:
```json
{"project": "webapp", "question": "How to optimize React re-renders?"}
{"project": "api", "question": "Best practices for REST pagination?"}
```

## MCP Tools Reference

#### `escalate_to_expert`

Send a question to ChatGPT via the desktop app.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project` | string | Yes | Project ID from config (use `list_projects` to discover) |
| `reason` | string | Yes | Why you're escalating (helps ChatGPT understand context) |
| `question` | string | Yes | The specific technical question |
| `attempted` | string | No | What you've already tried and the results |
| `projectContext` | string | No | Additional context about the codebase |
| `artifacts` | array | No | Code snippets, logs, or notes (see below) |

**Artifact format:**
```json
{
  "type": "file_snippet" | "log" | "note",
  "pathOrLabel": "src/auth.ts",
  "content": "// the actual code or content"
}
```

#### `list_projects`

Discover available project IDs from your configuration. Call this first if you don't know what projects are available.

**Returns:**
```json
{
  "projects": ["default", "webapp", "api"],
  "count": 3
}
```

## Important Notes

### ChatGPT Conversation Setup

For best results, start each project's ChatGPT conversation with a system prompt that establishes the expert role:

> You are the dedicated expert escalation endpoint for autonomous coding agents working on this project.  
>  
> Your role:  
> - Provide clear, technically correct, implementation-ready guidance.  
> - Assume the agent will immediately act on your instructions.  
> - Avoid asking the agent follow-up questions unless absolutely necessary.  
> - Be concise, direct, and practical.  
>  
> Response Format:  
> 1. Begin with a brief explanation of the issue and the recommended solution.  
> 2. End every response with a strict JSON object in the following format:  
>  
> {  
>   "guidance": "one-sentence summary of what the agent should do next",  
>  "action_plan": ["step 1", "step 2", "step 3"],  
>  "priority": "low | medium | high",  
>  "notes_for_user": "optional message for the human"  
> }  
>  
> Important Rules:  
> - The JSON must be the final content in your message.  
> - Do NOT wrap the JSON in code fences.  
> - Do NOT include any commentary after the JSON.  
> - Do NOT use placeholders or incomplete structures.  
> - Always return syntactically valid JSON.  

### During Use

- **Keep ChatGPT Desktop installed** (it will be opened/closed automatically)
- **Don't interact with ChatGPT** while escalation is in progress
- Automation takes ~30-120 seconds depending on response length
- Works best when you're AFK or focused on other tasks

### Version Compatibility

| ChatGPT Desktop Version | Status | Notes |
|-------------------------|--------|-------|
| 1.2025.112 | ✅ Supported | Last tested Nov 30, 2025 |
| Older versions | ⚠️ Unknown | May work, not tested |
| Future versions | ⚠️ Unknown | May break if UI changes significantly |

If a ChatGPT update breaks automation, [open an issue](../../issues) with your version number.

## What Happens During Escalation

When your agent calls `escalate_to_expert`, the server launches ChatGPT fresh, navigates to the configured conversation, sends the question, waits for completion, copies the response, and returns structured JSON — matching the high‑level flow diagram above. Typical time: **30–120 seconds**.

For implementation details (pixel detection, OCR, copy logic), see `docs/internals-detection.md` and `docs/sidebar-selection.md`.

## Detection Internals

Looking for the low‑level heuristics (sidebar state, response generation, copy button)? They’re documented for contributors in:
- `docs/internals-detection.md`
- `docs/sidebar-selection.md`

## Development

```powershell
# Watch mode
npm run dev

# Build
npm run build
```

## Troubleshooting

### "ChatGPT window not found"
- Make sure ChatGPT Desktop app is installed
- The automation will start it automatically

### "Conversation not found"
- Verify the conversation title in config matches exactly
- Check that the project folder name is correct
- The conversation must exist before first use

### "Response timeout"
- Increase `responseTimeout` in config for longer responses
- Check if ChatGPT is rate-limited or experiencing issues

### OCR not working
```powershell
# Reinstall PaddleOCR
pip install --upgrade paddleocr paddlepaddle
```

### Windows automation issues
```powershell
# Reinstall automation dependencies
pip install --upgrade pywinauto pyperclip pywin32
```

### Logs

Logs are written to stderr and can be captured by your MCP client. Set `logging.level` to `"debug"` in config for verbose output.

### Common Driver Error: NoneType window rect

If you see an error like:

```
TypeError: 'NoneType' object is not subscriptable
```

This typically means the Python driver could not find or access the ChatGPT Desktop window. Try the following:

- Make sure ChatGPT Desktop is open and not minimized
- Set `headless` to `false` in your config if it is `true` (some environments hide the window)
- Move ChatGPT Desktop to your primary monitor and ensure it isn't occluded by other apps
- Confirm the conversation and folder titles match your config exactly
- Run `npm run doctor` to validate the configuration and dependencies
- Re-run the MCP smoke-test: `node tools/mcp_smoke_test.js`

If the issue persists, check the backend logs (stdout/stderr) for more details and open an issue with the log snippet and your ChatGPT Desktop version.

## Verification Checklist

Before your first escalation, confirm:

- [ ] Windows 10 or 11
- [ ] ChatGPT Desktop installed (Microsoft Store version)
- [ ] ChatGPT Desktop opens and you're logged in
- [ ] Created the project folder in ChatGPT (e.g., "Agent Expert Help")
- [ ] Created the conversation inside that folder (e.g., "Copilot Escalations")
- [ ] Conversation title in config matches **exactly** (case-sensitive)
- [ ] Config file exists at `%USERPROFILE%\.chatgpt-escalation\config.json`
- [ ] MCP client configured with correct path to `dist/src/server.js`
- [ ] Node.js 18+ installed (`node --version`)
- [ ] Python 3.10+ installed (`python --version`)
- [ ] Python packages installed (`pip list | findstr pywinauto`)

## FAQ

<details>
<summary><strong>Can I keep working while it runs?</strong></summary>

Yes, but **don't interact with the ChatGPT window**. The automation controls mouse/keyboard input to that specific window. You can use other apps normally.
</details>

<details>
<summary><strong>Can I use this for multiple agents simultaneously?</strong></summary>

No. Only one escalation at a time. If you have multiple agents, they'll queue up and be processed sequentially.
</details>

<details>
<summary><strong>Can this escalate to multiple ChatGPT conversations?</strong></summary>

Yes! Configure multiple projects in your config, each pointing to different folders/conversations. Your agent specifies which project to use.
</details>

<details>
<summary><strong>Will this work on macOS in the future?</strong></summary>

Unlikely. macOS has different automation APIs (Accessibility API) that would require a complete driver rewrite. The Windows-only scope is intentional to keep the project maintainable.
</details>

<details>
<summary><strong>Can I use Ollama or a local LLM instead?</strong></summary>

Not with this tool — it specifically automates the ChatGPT Desktop app. For local LLMs, use a different MCP server that calls Ollama's API directly.
</details>

<details>
<summary><strong>How long does an escalation take?</strong></summary>

Typically 30-120 seconds:
- ~10s to open ChatGPT and navigate
- ~5-90s for ChatGPT to generate response (depends on length)
- ~5s to copy and return
</details>

<details>
<summary><strong>The first run is really slow. Why?</strong></summary>

PaddleOCR downloads its model files (~100MB) on first use. Subsequent runs are much faster, and the model preloads in the background.
</details>

## Uninstall

```powershell
# Remove config directory
Remove-Item -Recurse -Force "$env:USERPROFILE\.chatgpt-escalation"

# Remove from your MCP client config
# (edit your settings.json or claude_desktop_config.json)

# Optionally uninstall Python dependencies
pip uninstall pywinauto pyperclip paddleocr paddlepaddle
```

## Security

This tool **never** automates anything outside the ChatGPT Desktop window. It never reads unrelated windows, captures screens of other apps, or interacts with other applications. All automation is scoped to the ChatGPT process.

## Author

Created by **Darien Hardin** ([@Dazlarus](https://github.com/Dazlarus))

## License

MIT

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Additional Docs

- Protocol probe usage and troubleshooting: `docs/protocol-probe.md`
- Sidebar selection internals and tuning: `docs/sidebar-selection.md`
- Safety guardrails and interruption recovery: `docs/safety-guardrails.md`

## Chaos / Antagonistic Testing

Test safety guardrails by running commands under an antagonist that randomly steals focus, minimizes ChatGPT, moves/clicks the mouse, opens occluding windows, and scrolls.

**Quick commands:**

```pwsh
# Run any command with chaos (60s, medium intensity)
npm run chaos -- <your-command>

# Run protocol probe with aggressive chaos (90s)
npm run chaos:probe

# Run full escalation test under chaos (90s, aggressive)
npm run chaos:escalate
```

**Customize chaos parameters:**

```pwsh
# Gentle chaos for 120 seconds
node tools/with_antagonist.js --duration=120 --intensity=gentle -- npm run probe

# Custom duration and intensity for escalation test
node tools/chaos_escalation_test.js --duration=60 --intensity=medium
```

**Intensities:**
- `gentle`: Fewer disruptions, longer delays between actions
- `medium`: Balanced (default)
- `aggressive`: Heavy focus stealing, frequent minimize/occlude

**What the antagonist does:**
- Random mouse moves and clicks
- Steals focus to Notepad
- Opens Notepad windows on top of ChatGPT
- Minimizes ChatGPT window
- Random scroll events

**Note:** This intentionally disrupts your desktop session. Run on non-critical environments or VMs.

**Chaos escalation test (`npm run chaos:escalate`):**

Runs a full end-to-end test:
1. Starts antagonist (default 90s, aggressive)
2. Connects to MCP server
3. Lists projects
4. Calls `escalate_to_expert` with a test question
5. Validates response
6. Reports pass/fail

This verifies that safety guardrails successfully recover from interruptions during a real escalation flow.

**Current Test Results:**
- ✅ **Gentle**: Passes consistently
- ✅ **Medium**: Passes consistently
- ✅ **Aggressive**: Passes with retry logic (may take 2-4 attempts)

**Seeded Tests**: Use `--seed=12345` for reproducible chaos patterns:
```pwsh
node tools/chaos_escalation_test.js aggressive --duration=120 --seed=99999
```

