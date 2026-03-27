# Windows Setup Guide

This guide explains how to set up **crush-acp** with **Zed** on Windows so your AI agent can use Crush from the Zed editor.

## Prerequisites

1. **Node.js 18+** — Install from [nodejs.org](https://nodejs.org)
2. **Zed Editor** — Install from [zed.dev](https://zed.dev) (now available on Windows)
3. **Crush CLI** — Install via Scoop:
   ```powershell
   scoop bucket add charm https://github.com/charmbracelet/scoop-bucket.git
   scoop install crush
   ```
   Or via npm:
   ```powershell
   npm install -g @charmland/crush
   ```

## Installation

### Option 1: Global npm install (Recommended)

```powershell
npm install -g crush-acp
```

### Option 2: Clone and build locally

```powershell
git clone https://github.com/willbnu/crush-acp.git
cd crush-acp
npm install
npm run build
```

## Configure API Key

Crush needs an API key to talk to model providers. Set it as an environment variable:

```powershell
# Set the key for your preferred provider
$env:ANTHROPIC_API_KEY = "sk-..."
# or
$env:OPENAI_API_KEY = "sk-..."
# or
$env:GEMINI_API_KEY = "..."
# or
$env:OPENROUTER_API_KEY = "..."
```

To persist across sessions, set it in System Properties → Environment Variables, or add to your PowerShell profile:

```powershell
# Edit your profile
notepad $PROFILE

# Add your API key, e.g.:
$env:ANTHROPIC_API_KEY = "sk-..."
```

## Configure Zed

1. Open Zed
2. Open the command palette (`Ctrl+Shift+P`) → `zed: open settings`
3. Add Crush as an agent server:

### Using global npm install:

```json
{
  "agent_servers": {
    "Crush": {
      "type": "custom",
      "command": "crush-acp",
      "args": [],
      "env": {}
    }
  }
}
```

### Using npx (no install needed):

```json
{
  "agent_servers": {
    "Crush": {
      "type": "custom",
      "command": "npx",
      "args": ["crush-acp"],
      "env": {}
    }
  }
}
```

### Using local development build:

Replace the path with wherever you cloned crush-acp:

```json
{
  "agent_servers": {
    "Crush": {
      "type": "custom",
      "command": "node",
      "args": ["C:/Users/Admin/Documents/Projects/crush-acp/dist/index.js"],
      "env": {}
    }
  }
}
```

**Important**: Use forward slashes (`/`) not backslashes (`\`) in the path, even on Windows.

### Pass API key through Zed config (alternative)

If you prefer not to set environment variables globally, you can pass them through Zed's config:

```json
{
  "agent_servers": {
    "Crush": {
      "type": "custom",
      "command": "crush-acp",
      "args": [],
      "env": {
        "ANTHROPIC_API_KEY": "sk-...",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

## Keyboard Shortcut (Optional)

Open `keymap.json` from the command palette (`zed: open keymap`) and add:

```json
[
  {
    "bindings": {
      "ctrl-alt-x": [
        "agent::NewExternalAgentThread",
        { "agent": { "custom": { "name": "Crush" } } }
      ]
    }
  }
]
```

## Using Crush in Zed

1. Open the Agent Panel (`Ctrl+E` or View → Agent Panel)
2. Click the `+` button in the top-right
3. Select "Crush" from the list
4. Start chatting!

## Toolbar Controls

The Zed toolbar shows these dropdowns:

| Dropdown | Purpose |
|----------|---------|
| **Mode** | Code, Ask, Architect, or Yolo mode |
| **Model** | All models available via `crush models` |
| **Thinking** | Toggle extended thinking on/off |
| **Yolo** | Toggle auto-accept all permissions |

## Troubleshooting

### "crush-acp" command not found

Make sure it's installed globally:
```powershell
npm list -g crush-acp
```
If not, run `npm install -g crush-acp`.

### "crush" command not found

Install Crush CLI:
```powershell
scoop install crush
# or
npm install -g @charmland/crush
```

### No models appear in the dropdown

Run this manually to verify Crush can list models:
```powershell
crush models
```
If it fails, your API key is likely not configured. Set the appropriate environment variable for your provider.

### Connection errors in Zed

Open the ACP logs in Zed: command palette → `dev: open acp logs`. This shows the JSON-RPC communication between Zed and crush-acp.

### Node.js path issues on Windows

If Zed can't find `node` or `crush-acp`, use the full path:
```json
{
  "command": "C:/Program Files/nodejs/node.exe",
  "args": ["C:/Users/Admin/AppData/Roaming/npm/node_modules/crush-acp/dist/index.js"]
}
```

Find your npm global path:
```powershell
npm root -g
```
