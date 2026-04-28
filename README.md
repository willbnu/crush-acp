# Crush ACP Adapter

[![npm](https://img.shields.io/npm/v/crush-acp)](https://www.npmjs.com/package/crush-acp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Bring [Crush](https://github.com/charmbracelet/crush) — Charm's terminal-based AI coding agent — to [Zed](https://zed.dev) and any ACP-compatible editor.

## What is this?

`crush-acp` is a bridge that lets you use Crush directly from Zed's Agent Panel. It implements the [Agent Client Protocol (ACP)](https://agentclientprotocol.com), streaming responses in real-time while maintaining full session continuity across conversations.

## Features

| Feature                  | Description                                                               |
| ------------------------ | ------------------------------------------------------------------------- |
| **Session Continuity**   | Conversations persist across messages using crush's native session system |
| **Model Selection**      | Only shows models from providers you have configured — no clutter         |
| **Vision Auto-Routing**  | Automatically switches to a vision model when images are attached         |
| **Session Modes**        | Code, Ask, Architect, and Yolo — switch without restarting                |
| **Thinking Toggle**      | Enable extended reasoning for complex tasks                               |
| **Session Resumption**   | Resume any past session from the Zed sidebar                              |
| **Tool Call Visibility** | Watch Crush's tools in real-time as it works                              |
| **Thinking Content**     | See reasoning output when models use it                                   |

## Requirements

- [Crush CLI](https://github.com/charmbracelet/crush#installation)
- [Zed Editor](https://zed.dev)
- Node.js 18+

## Quick Start

```bash
npm install -g crush-acp
```

Open Zed → `settings.json` → add:

```json
{
  "agent_servers": {
    "Crush": {
      "type": "custom",
      "command": "crush-acp",
      "args": [],
      "env": {
        "ZAI_API_KEY": "your-api-key"
      }
    }
  }
}
```

Restart Zed. Open the Agent Panel (`Ctrl+E`) → select Crush → start chatting.

## Configuration

### API Keys

Set any of these environment variables for the providers you want to use:

| Variable             | Provider                              |
| -------------------- | ------------------------------------- |
| `ZAI_API_KEY`        | Z.AI / Zhipu (GLM-5.1, GLM-4.7, etc.) |
| `ANTHROPIC_API_KEY`  | Anthropic (Claude)                    |
| `OPENAI_API_KEY`     | OpenAI (GPT)                          |
| `GEMINI_API_KEY`     | Google Gemini                         |
| `GROQ_API_KEY`       | Groq                                  |
| `OPENROUTER_API_KEY` | OpenRouter (200+ models)              |
| `CEREBRAS_API_KEY`   | Cerebras                              |

### Provider Filtering

crush-acp reads your `crush.json` and only displays models from providers that have valid API keys configured. If a provider's key is missing or invalid, its models won't appear in the dropdown.

### Zed Settings

| Setting     | Path                                  |
| ----------- | ------------------------------------- |
| Settings    | `Ctrl+Shift+P` → `zed: open settings` |
| Keymap      | `Ctrl+Shift+P` → `zed: open keymap`   |
| Agent Panel | `Ctrl+E`                              |

## Usage

### Toolbar Controls

| Control      | Options                    | Description                               |
| ------------ | -------------------------- | ----------------------------------------- |
| **Mode**     | Code, Ask, Architect, Yolo | Controls Crush's behavior and permissions |
| **Model**    | Dynamic list               | Pick any configured provider's model      |
| **Thinking** | On / Off                   | Enable extended reasoning                 |
| **Yolo**     | On / Off                   | Auto-accept all file changes              |

### Session Modes

| Mode          | When to use                                           |
| ------------- | ----------------------------------------------------- |
| **Code**      | Default. Full file access and terminal — use normally |
| **Ask**       | Read-only. Ask questions without touching files       |
| **Architect** | Planning only. Design systems without implementing    |
| **Yolo**      | Auto-accept everything. Use with caution              |

### Slash Commands

| Command        | Description                       |
| -------------- | --------------------------------- |
| `/new`         | Fresh conversation                |
| `/compact`     | Summarize session to save context |
| `/model <id>`  | Switch model                      |
| `/models`      | List available models             |
| `/mode <mode>` | Switch mode                       |
| `/thinking`    | Toggle thinking                   |
| `/yolo`        | Toggle yolo mode                  |
| `/status`      | Session info                      |
| `/export`      | Export transcript                 |
| `/help`        | All commands                      |

## Supported Providers

crush-acp dynamically loads all models from your configured providers. Run `crush models` to see what's available for your setup.

| Provider                | Models                                                |
| ----------------------- | ----------------------------------------------------- |
| **zai**                 | GLM-5.1, GLM-5, GLM-4.7, GLM-4.6V, GLM-4.5V, and more |
| **zhipu-coding**        | Zhipu coding-specific models                          |
| **opencode-go**         | Free GLM-5, Kimi K2.5                                 |
| **opencode-go-minimax** | Free MiniMax M2.5, M2.7                               |
| **local-qwen**          | Local models via OAI-compatible server                |

## Troubleshooting

**"command not found"**

```bash
npm list -g crush-acp   # verify it's installed
npm install -g crush-acp  # reinstall if needed
```

**No models in dropdown**

```bash
crush models   # run this in your terminal — if it fails, your API key isn't set
```

**"database disk image is malformed"**

```powershell
# On Windows: delete the isolated DB and restart
Remove-Item "$env:APPDATA\.crush-acp\zed-crush\crush.db"
```

**View ACP logs**
`Ctrl+Shift+P` → `dev: open acp logs`

## Development

```bash
git clone https://github.com/willbnu/crush-acp.git
cd crush-acp
npm install
npm run build
```

## How It Works

```
Zed ← JSON-RPC/stdio → crush-acp ← spawn → crush run -m <model> --session <id>
```

crush-acp bridges Zed's ACP interface to Crush's CLI:

1. **Initialization** — advertises capabilities (session list, resume, config options)
2. **Prompt handling** — spawns `crush run` with model, mode, and session context
3. **Output streaming** — parses Crush's stdout for tool calls, thinking content, and responses
4. **Session continuity** — captures crush's internal session ID and reuses it on subsequent prompts

## Links

- [Crush CLI](https://github.com/charmbracelet/crush)
- [ACP Specification](https://agentclientprotocol.com)
- [ACP Registry](https://github.com/agentclientprotocol/registry)
- [Zed Editor](https://zed.dev)
- [Charm](https://charm.sh)

## Support This Project

If crush-acp saves you time, consider supporting its development:

- **[GitHub Sponsors](https://github.com/sponsors/willbnu)** — recurring support
- **[Ko-fi](https://ko-fi.com/willbnu)** — one-time donation

### Pro Features (Coming Soon)

| Feature | Free | Pro |
| ------- | ---- | --- |
| ACP bridge to Zed | Yes | Yes |
| Session persistence | Yes | Yes |
| Model/mode switching | Yes | Yes |
| Vision auto-routing | Yes | Yes |
| Usage analytics dashboard | — | Yes |
| Multi-project session manager | — | Yes |
| Custom prompt templates | — | Yes |
| Priority support | — | Yes |

*Star the repo and sponsor to help fund Pro development.*

## License

[MIT](LICENSE) — This adapter is my own work (William Finger). It is not affiliated with or endorsed by Charmbracelet.

[Crush](https://github.com/charmbracelet/crush) is a separate project by [Charmbracelet](https://charm.sh), licensed under [FSL-1.1-MIT](https://github.com/charmbracelet/crush/raw/main/LICENSE.md). This adapter requires Crush to be installed separately.
