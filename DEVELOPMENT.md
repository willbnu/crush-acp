# Development History & Bug Fix Guide

This document is a deep technical record of every bug encountered, every fix applied, and every architectural decision made while building **crush-acp** from v0.2.0 to v0.4.0. It is intended for any developer (human or AI agent) who needs to understand **why** things are the way they are, or who needs to replicate this work on another platform like Windows.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Bug: Zed Shows "unknown" for Boolean Config Type](#bug-zed-shows-unknown-for-boolean-config-type)
3. [Bug: Two Identical "Enabled" Dropdowns with No Labels](#bug-two-identical-enabled-dropdowns-with-no-labels)
4. [Bug: Model List Only Showed One Provider](#bug-model-list-only-showed-one-provider)
5. [Bug: Images Sent to Non-Vision Models](#bug-images-sent-to-non-vision-models)
6. [Bug: Mode/Yolo Toggle Desync](#bug-modeyolo-toggle-desync)
7. [Bug: Invalid -y Flag on Crush CLI](#bug-invalid--y-flag-on-crush-cli)
8. [Architecture: ACP ConfigOptions vs Legacy Modes/Models](#architecture-acp-configoptions-vs-legacy-modesmodels)
9. [Architecture: Model Fetching Strategy](#architecture-model-fetching-strategy)
10. [Architecture: Slash Command System](#architecture-slash-command-system)
11. [Architecture: Tool Call Pattern Matching](#architecture-tool-call-pattern-matching)
12. [Architecture: Thinking Content Extraction](#architecture-thinking-content-extraction)
13. [Windows Replication Guide](#windows-replication-guide)
14. [Lessons Learned](#lessons-learned)

---

## Architecture Overview

crush-acp is a **JSON-RPC 2.0 over stdio** adapter that bridges two systems:

```
Zed Editor ←→ JSON-RPC/stdio ←→ crush-acp (Node.js) ←→ crush run CLI
```

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point. Creates `AgentSideConnection` from `@agentclientprotocol/sdk` |
| `src/agent.ts` | Main adapter logic. Implements the `Agent` interface from ACP SDK |

### ACP SDK Interfaces Used

The `@agentclientprotocol/sdk` package (v0.17.1) provides:
- `AgentSideConnection` — handles JSON-RPC framing over stdio
- `Agent` interface — methods to implement: `initialize`, `authenticate`, `newSession`, `prompt`, `cancel`, `setSessionConfigOption`, etc.
- Type definitions: `SessionConfigOption`, `ModelInfo`, `SessionMode`, `ContentBlock`, `ToolCallStatus`

### Session State

```typescript
interface CrushSession {
  id: string;
  workingDir: string;
  pendingPrompt: AbortController | null;
  process: ChildProcess | null;
  currentModelId: string;
  currentModeId: string;
  yoloMode: boolean;
  thinkingMode: boolean;
  toolCallCounter: number;
}
```

Each Zed session maps to one `CrushSession`. Each prompt spawns a `crush run` child process.

---

## Bug: Zed Shows "unknown" for Boolean Config Type

### The Problem

We wanted to add Thinking and Yolo toggles as simple on/off switches. The ACP SDK defines `type: "boolean"` as a valid `SessionConfigOption` type, so we used it:

```typescript
{
  id: "thinking",
  name: "Thinking",
  type: "boolean",
  currentValue: false,
  category: "behavior",
}
```

In Zed's agent panel, this rendered as a button showing **"unknown"** — completely unusable.

### Root Cause

Zed's ACP client implementation (as of March 2026) does **not** render `type: "boolean"` config options. It only supports `type: "select"` with an options array. This is a Zed limitation, not an ACP protocol limitation — the protocol defines boolean, but Zed hasn't implemented the UI for it.

### The Fix

Changed from `type: "boolean"` to `type: "select"` with explicit on/off options:

```typescript
{
  id: "thinking",
  name: "Thinking",
  description: "Enable extended thinking for better reasoning on complex tasks",
  type: "select",
  currentValue: "disabled",
  category: "behavior",
  options: [
    { value: "disabled", name: "Thinking: Off" },
    { value: "enabled", name: "Thinking: On" },
  ],
}
```

### Key Takeaway

> **Always use `type: "select"` for config options in ACP, even for boolean toggles.** Zed doesn't render boolean config options. Use `value: "enabled"/"disabled"` with descriptive `name` fields.

---

## Bug: Two Identical "Enabled" Dropdowns with No Labels

### The Problem

After fixing the boolean type issue, Zed's toolbar showed:

```
Yolo ▾  GPT-5.1 ▾  Enabled ▾  Enabled ▾
```

Two dropdowns both showing "Enabled" with no way to tell which was Thinking and which was Yolo.

### Root Cause

Zed displays the **selected option's `name` field** as the button text in the toolbar, NOT the config option's `name` field. Our options were:

```typescript
// Thinking toggle options
{ value: "disabled", name: "Disabled" },
{ value: "enabled", name: "Enabled" },

// Yolo toggle options  
{ value: "disabled", name: "Disabled" },
{ value: "enabled", name: "Enabled" },
```

Both showed "Enabled" when active — completely identical in the toolbar.

### The Fix

Prefix each option name with the toggle's identity:

```typescript
// Thinking toggle options
{ value: "disabled", name: "Thinking: Off" },
{ value: "enabled", name: "Thinking: On" },

// Yolo toggle options
{ value: "disabled", name: "Yolo: Off" },
{ value: "enabled", name: "Yolo: On" },
```

Now the toolbar shows:
```
Thinking: Off ▾  Yolo: Off ▾  Mode ▾  Model ▾
```

### Key Takeaway

> **The `name` field on individual options is what Zed shows in the toolbar button, not the parent config option's `name`.** Always include context in option names since they may be shown without their parent label.

---

## Bug: Model List Only Showed One Provider

### The Problem

The model dropdown originally only showed models from a single provider, even though `crush models` returns 200+ models from 15+ providers.

### Root Cause

The original code filtered the model list:

```typescript
const filteredLines = lines.filter(line => 
  line.startsWith("specific-provider/") 
).slice(0, 20);
```

This was done initially to keep the dropdown manageable during early development.

### The Fix

Removed the filter entirely. All models from `crush models` are now included:

```typescript
function fetchAvailableModels(): acp.ModelInfo[] {
  try {
    const output = execSync("crush models", { encoding: "utf-8", timeout: 10000 });
    const lines = output.trim().split("\n").filter(Boolean);
    
    return lines.map(line => {
      const modelId = line.trim();
      const parts = modelId.split("/");
      const provider = parts.length > 1 ? parts[0] : "unknown";
      const modelName = parts.length > 1 ? parts.slice(1).join("/") : modelId;
      // ... build description with (Vision), (Fast), (Thinking) tags
      return { modelId, name: `${provider}/${modelName}`, description };
    });
  } catch (err) {
    // Fallback to generic models from major providers
    return [
      { modelId: "openai/gpt-5.1", ... },
      { modelId: "anthropic/claude-sonnet-4.5", ... },
      { modelId: "openrouter/google/gemini-2.5-pro", ... },
    ];
  }
}
```

### Key Takeaway

> **Don't hardcode provider filtering.** Use `crush models` as the source of truth. The fallback should use generic models from major providers (OpenAI, Anthropic, Google), not any specific provider.

---

## Bug: Images Sent to Non-Vision Models

### The Problem

When a user attached an image in Zed's chat, it was forwarded to the Crush CLI even when using a non-vision model (e.g., GLM-4.7). This caused Crush to crash or produce errors because the model couldn't process images.

### Root Cause

The `extractPromptText` method passed through all content blocks without checking if the model supported images.

### The Fix

Added `isVisionModel()` check and filter image references at three levels:

1. **Prompt text extraction** — Skip image blocks for non-vision models
2. **File path extraction** — Filter out image file paths (`.png`, `.jpg`, etc.)
3. **Prompt text filtering** — Remove `@file.png` references from the prompt string

```typescript
private isVisionModel(modelId: string): boolean {
  const visionKeywords = ["vision", "gpt-4o", "claude-3.5", "gemini", "pixtral", "qwen-vl", "4.5v", "4.6v"];
  const lowerModel = modelId.toLowerCase();
  return visionKeywords.some(keyword => lowerModel.includes(keyword));
}

private extractPromptText(prompt: Array<acp.ContentBlock>, modelId: string): string {
  const supportsVision = this.isVisionModel(modelId);
  return prompt.map((block) => {
    if (block.type === "image") {
      if (supportsVision) {
        return `[Image: ${block.mimeType}, ${block.data.length} bytes base64]`;
      }
      return "[Image skipped - model does not support images]";
    }
    // ...
  }).filter(Boolean).join("\n");
}
```

### Key Takeaway

> **Always gate image content on model capability.** Non-vision models will error on image input. Check model ID for vision keywords before forwarding image data.

---

## Bug: Mode/Yolo Toggle Desync

### The Problem

Yolo exists in two places: as a **Mode** (Code/Ask/Architect/Yolo) and as a **Toggle** (Yolo: On/Off). Changing one didn't update the other, leading to inconsistent state.

### Root Cause

Two separate state variables (`currentModeId` and `yoloMode`) were not kept in sync when changed from different UI surfaces.

### The Fix

Bidirectional sync logic in `setSessionConfigOption()`:

```typescript
// When Mode dropdown changes to/from Yolo
if (params.configId === CONFIG_MODE) {
  if (newModeId === "yolo") {
    session.yoloMode = true;
  } else if (oldModeId === "yolo") {
    session.yoloMode = false;
  }
}

// When Yolo toggle changes
if (params.configId === CONFIG_YOLO) {
  session.yoloMode = (params.value as string) === "enabled";
  if (session.yoloMode && session.currentModeId !== "yolo") {
    session.currentModeId = "yolo";  // Sync mode to yolo
  } else if (!session.yoloMode && session.currentModeId === "yolo") {
    session.currentModeId = "code";  // Revert to code mode
  }
}
```

Also added `notifyConfigUpdate()` calls so both dropdowns visually update:

```typescript
private notifyConfigUpdate(sessionId: string, session: CrushSession): void {
  this.connection.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: "config_option_update",
      configOptions: this.buildConfigOptions(session),
    },
  }).catch(console.error);
}
```

### Key Takeaway

> **When the same concept appears in multiple config options, always sync both directions and send `config_option_update` notifications so the UI reflects the new state.**

---

## Bug: Invalid -y Flag on Crush CLI

### The Problem

Early code passed `-y` flag to `crush run` thinking it would enable yolo mode:

```typescript
const args = ["run", "-y", "-m", session.currentModelId, prompt];
```

This caused `crush` to fail because it doesn't have a `-y` flag.

### Root Cause

Assumption based on other CLI tools that use `-y` for "yes to all". Crush handles yolo mode differently — through the mode system or the `--yolo` flag on `crush` (not `crush run`).

### The Fix

Removed the `-y` flag. Yolo mode is now communicated as a prefix in the prompt text:

```typescript
case "yolo":
  modePrompt = "[Mode: Yolo - Auto-accept all permissions, making changes freely]\n\n";
  break;
```

### Key Takeaway

> **Don't assume CLI flags exist.** Verify with `crush run --help` or `crush --help` before adding flags.

---

## Architecture: ACP ConfigOptions vs Legacy Modes/Models

### The Problem

ACP has two APIs for model/mode selection:
- **Legacy**: `models` and `modes` fields in `NewSessionResponse` + `unstable_setSessionModel` + `setSessionMode`
- **New**: `configOptions` array + `setSessionConfigOption`

### The Solution

Support **both** APIs for backwards compatibility:

```typescript
return {
  sessionId,
  // Legacy API
  models: {
    availableModels: AVAILABLE_MODELS,
    currentModelId: DEFAULT_MODEL_ID,
  },
  modes: {
    availableModes: AVAILABLE_MODES,
    currentModeId: DEFAULT_MODE_ID,
  },
  // New API (preferred)
  configOptions,
};
```

Implement both `setSessionMode()` (legacy) and `setSessionConfigOption()` (new) with shared sync logic.

### Key Takeaway

> **Implement both old and new ACP APIs.** Different clients may use different API versions. The new `configOptions` API is more flexible (supports custom toggles), but the legacy API is still needed for compatibility.

---

## Architecture: Model Fetching Strategy

### How It Works

Models are fetched **once at startup** using `execSync("crush models")`:

```typescript
const AVAILABLE_MODELS = fetchAvailableModels();
```

This runs synchronously when the adapter starts. The result is cached for the lifetime of the process.

### Why Not Fetch Per-Session?

1. `crush models` takes 1-5 seconds (network call to provider APIs)
2. The model list rarely changes during a session
3. ACP's `newSession` expects models to be available immediately

### Fallback

If `crush models` fails (no CLI, no API key), hardcoded defaults from major providers are used:

```typescript
return [
  { modelId: "openai/gpt-5.1", name: "openai/gpt-5.1", description: "GPT-5.1" },
  { modelId: "anthropic/claude-sonnet-4.5", name: "anthropic/claude-sonnet-4.5", description: "Claude Sonnet 4.5" },
  { modelId: "openrouter/google/gemini-2.5-pro", ... },
];
```

### Key Takeaway

> **Fetch models once at startup, cache for process lifetime.** Have provider-neutral fallbacks. Use 10-second timeout for the `execSync` call.

---

## Architecture: Slash Command System

### How It Works

Slash commands are handled in `handleCommand()` — a `switch` statement that intercepts prompts starting with `/`:

```typescript
if (promptText.startsWith("/")) {
  await this.handleCommand(session, promptText);
  return { stopReason: "end_turn" };
}
```

Commands are registered with Zed via `available_commands_update`:

```typescript
private sendAvailableCommands(sessionId: string): void {
  const commands = [
    { name: "new", description: "Start a fresh conversation session" },
    { name: "thinking", description: "Toggle extended thinking mode" },
    // ...
  ];
  this.connection.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: "available_commands_update",
      availableCommands: commands,
    },
  });
}
```

### Important: Command Changes Need UI Notification

When a slash command changes state (e.g., `/yolo` toggles yolo mode), you MUST call `notifyConfigUpdate()` to update the toolbar dropdowns. Without this, the UI will show stale state.

### Key Takeaway

> **Slash commands that change config state must call `notifyConfigUpdate()`.** The command palette and toolbar are separate UI surfaces that don't auto-sync.

---

## Architecture: Tool Call Pattern Matching

### How It Works

Crush CLI outputs tool usage as plain text (not structured JSON). We parse it with regex patterns:

```typescript
const toolCallPatterns = [
  { regex: /Running:\s*(.+)/, kind: "execute" },
  { regex: /Reading:\s*(.+)/, kind: "read" },
  { regex: /Editing:\s*(.+)/, kind: "edit" },
  { regex: /Searching:\s*(.+)/, kind: "search" },
  { regex: /Writing:\s*(.+)/, kind: "edit" },
  { regex: /Using tool:\s*(.+)/, kind: "other" },
];
```

Each match sends a `tool_call` update to Zed with status `in_progress`, then `completed` when the next pattern matches or the process exits.

### Limitation

This is best-effort pattern matching. If Crush changes its output format, the patterns will need updating. A more robust approach would require Crush to output structured JSON for tool calls.

---

## Architecture: Thinking Content Extraction

### How It Works

Some models (DeepSeek, Qwen, etc.) output thinking/reasoning in `<think/>` tags:

```typescript
const thinkingPattern = /<(?:think|thinking|reasoning)>([\s\S]*?)<\/(?:think|thinking|reasoning)>/gi;
```

Extracted content is sent as `agent_thought_chunk` updates, which Zed renders in a collapsible thinking section.

---

## Windows Replication Guide

### Step-by-step for Windows Agents

1. **Install prerequisites**
   ```powershell
   # Node.js 18+ from nodejs.org
   # Crush CLI
   scoop bucket add charm https://github.com/charmbracelet/scoop-bucket.git
   scoop install crush
   ```

2. **Clone and build crush-acp**
   ```powershell
   git clone https://github.com/willbnu/crush-acp.git
   cd crush-acp
   npm install
   npm run build
   ```

3. **Set API key**
   ```powershell
   $env:ANTHROPIC_API_KEY = "sk-..."
   # or any other provider
   ```

4. **Configure Zed `settings.json`**
   ```json
   {
     "agent_servers": {
       "Crush": {
         "type": "custom",
         "command": "node",
         "args": ["C:/path/to/crush-acp/dist/index.js"],
         "env": {}
       }
     }
   }
   ```
   **Use forward slashes in paths.** Backslashes will cause issues.

5. **Verify `crush models` works**
   ```powershell
   crush models
   ```
   If this fails, the adapter will use hardcoded fallback models.

6. **Restart Zed** after config changes. Zed reads agent server config at startup.

7. **Debug with ACP logs** — In Zed command palette: `dev: open acp logs`

### Windows-Specific Pitfalls

| Issue | Solution |
|-------|----------|
| Path separators | Use `/` not `\` in Zed config JSON |
| `node` not found | Use full path: `C:/Program Files/nodejs/node.exe` |
| `crush` not found | Use full path or ensure it's in system PATH |
| API key not persisted | Add to PowerShell `$PROFILE` or System Environment Variables |
| npm global path | Run `npm root -g` to find it |
| Exec permissions | May need to run terminal as Administrator for `npm install -g` |

---

## Lessons Learned

### ACP/Zed Compatibility

1. **Always use `type: "select"` for config options** — Zed doesn't render boolean
2. **Option names must be self-describing** — They're shown standalone in toolbar buttons
3. **Add `description` fields** — They show as tooltips on hover in Zed
4. **Use `category` to group options** — Categories: `"mode"`, `"model"`, `"behavior"`, etc.
5. **Send `config_option_update` after state changes** — Otherwise Zed's UI shows stale values

### Crush CLI Integration

1. **Don't assume flags exist** — Verify with `--help` before using
2. **Mode is communicated via prompt prefix, not CLI flags** — `crush run` doesn't have mode flags
3. **Images must be gated on model capability** — Non-vision models error on image input
4. **Tool call output is plain text** — Pattern matching is best-effort
5. **`crush models` output format** — One model ID per line: `provider/model-name`

### General ACP Adapter Development

1. **Implement both old and new APIs** — Legacy `modes`/`models` + new `configOptions`
2. **Cache model list at startup** — Don't fetch per-session (too slow)
3. **Handle child process lifecycle carefully** — Abort signals, cleanup on exit
4. **Always resolve() the promise** — Even on errors, so Zed can recover
5. **Use `sessionUpdate` for streaming** — Not return values from `prompt()`

### Documentation

1. **Keep docs provider-neutral** — Don't embed personal API keys or preferred providers
2. **Fallback models should be from major providers** — OpenAI, Anthropic, Google
3. **Document Zed-specific workarounds** — Other adapter developers will hit the same issues
4. **Include platform-specific guides** — Windows, macOS, Linux each have different PATH/key management
