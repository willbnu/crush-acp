# Crush ACP Adapter

[![npm](https://img.shields.io/npm/v/crush-acp)](https://www.npmjs.com/package/crush-acp)

Use [Crush](https://github.com/charmbracelet/crush) — Charm's AI coding agent — from [Zed](https://zed.dev) and other ACP-compatible editors via the Agent Client Protocol (ACP).

## About

Crush is a terminal-based AI coding assistant with multi-provider model support, built-in tools, MCP server integration, and a skill-based agent system. This adapter brings Crush to Zed's Agent Panel with full session management, mode toggles, and model selection.

## Features

- **Full Crush capabilities** from Zed's Agent Panel
- **Session continuity** — conversations persist across messages via crush's session system
- **Model selection** — all models from your configured providers, tagged for easy identification
- **Session modes** — Code, Ask, Architect, and Yolo
- **Thinking toggle** — enable extended reasoning for complex tasks
- **Yolo toggle** — auto-accept all permissions without confirmation
- **Vision auto-routing** — automatically switches to a vision model when images are detected
- **Tool call visibility** — see what tools Crush is using in real-time
- **Thinking content** — displays reasoning/thinking output when models use it
- **Session resumption** — resume past sessions from the Zed sidebar
- **MCP server support**
- **LSP-enhanced context**

## Requirements

- [Crush CLI](https://github.com/charmbracelet/crush#installation)
- [Zed Editor](https://zed.dev) (with ACP support)
- Node.js 18+

## Installation

```bash
npm install -g crush-acp
```

## Configuration

### 1. Set up your API key

Add your API key to environment variables or to Zed's settings:

```json
{
  "agent_servers": {
    "Crush": {
      "type": "custom",
      "command": "crush-acp",
      "args": [],
      "env": {
        "ZAI_API_KEY": "your-zai-api-key"
      }
    }
  }
}
```

Supported environment variables:

- `ZAI_API_KEY` — Z.AI / Zhipu models
- `ANTHROPIC_API_KEY` — Anthropic (Claude)
- `OPENAI_API_KEY` — OpenAI (GPT)
- `GEMINI_API_KEY` — Google Gemini
- `GROQ_API_KEY` — Groq
- `OPENROUTER_API_KEY` — OpenRouter (200+ models)
- `CEREBRAS_API_KEY` — Cerebras

### 2. Add to Zed settings

Open `settings.json` via the command palette (`Ctrl+Shift+P` → `zed: open settings`) and add:

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

### 3. Restart Zed

The agent will appear in the Agent Panel (`Ctrl+E`).

## Usage

### Toolbar Controls

| Dropdown     | Purpose                                   |
| ------------ | ----------------------------------------- |
| **Mode**     | Code (default), Ask, Architect, or Yolo   |
| **Model**    | All models from your configured providers |
| **Thinking** | Toggle extended thinking on/off           |
| **Yolo**     | Toggle auto-accept all permissions        |

### Session Modes

| Mode          | Description                                    |
| ------------- | ---------------------------------------------- |
| **Code**      | Full coding mode with file access and terminal |
| **Ask**       | Answer questions without making changes        |
| **Architect** | Plan and design without implementation         |
| **Yolo**      | Auto-accept all permissions (use with care)    |

### Slash Commands

| Command        | Description                              |
| -------------- | ---------------------------------------- |
| `/new`         | Start a fresh conversation session       |
| `/compact`     | Summarize session to save context space  |
| `/model <id>`  | Switch to a specific model               |
| `/models`      | List all available models                |
| `/mode <mode>` | Switch mode (code, ask, architect, yolo) |
| `/thinking`    | Toggle extended thinking                 |
| `/yolo`        | Toggle yolo mode                         |
| `/status`      | Show current session info                |
| `/export`      | Export session transcript                |
| `/help`        | Show all available commands              |

### Provider Filtering

crush-acp automatically detects which providers you have API keys for and only shows those models in the dropdown. Providers without keys (or with invalid/empty keys) are filtered out to keep the list clean and relevant.

## Supported Providers

The model list is dynamic — it reflects exactly what providers you have configured in your `crush.json`. Common providers include:

| Provider                | Notes                                        |
| ----------------------- | -------------------------------------------- |
| **zai**                 | Z.AI / Zhipu models (GLM-5.1, GLM-4.7, etc.) |
| **zhipu-coding**        | Zhipu coding models                          |
| **opencode-go**         | Free OpenCode Go models (GLM-5, Kimi K2.5)   |
| **opencode-go-minimax** | Free MiniMax models (M2.5, M2.7)             |
| **local-qwen**          | Local Qwen models via OAI-compatible server  |

Run `crush models` in your terminal to see the full list for your configuration.

## Session Persistence

Sessions are persisted to `AppData/Roaming/.crush-acp/sessions/sessions.json`. Each session maintains:

- Selected model and mode
- Thinking and Yolo settings
- Working directory
- Conversation history via crush's session system

Click any past session in the Zed sidebar to resume it.

## Troubleshooting

### "command not found" errors

Make sure `crush-acp` is installed globally:

```bash
npm list -g crush-acp
```

### No models in the dropdown

Run `crush models` in your terminal. If it fails, your API key is not configured or is invalid.

### crush crashes with "database disk image is malformed"

This is a SQLite WAL corruption issue on Windows. crush-acp isolates its data directory from the TUI crush to prevent conflicts. If it still occurs:

1. Delete `AppData/Roaming/.crush-acp/zed-crush/crush.db`
2. Restart the session

### View ACP logs

In Zed, open the command palette and run `dev: open acp logs` to see the JSON-RPC communication.

## Development

```bash
git clone https://github.com/willbnu/crush-acp.git
cd crush-acp
npm install
npm run build
```

## How It Works

crush-acp implements the [Agent Client Protocol (ACP)](https://agentclientprotocol.com):

- Communicates via JSON-RPC 2.0 over stdio
- Spawns `crush run --data-dir <isolated> --session <id> -m <model>` for each prompt
- Streams output back to the client via `sessionUpdate` notifications
- Parses tool call patterns from Crush output and sends `tool_call` updates
- Extracts thinking/reasoning content wrapped in `<think/>` tags
- Persists session configuration to `sessions.json`

## Links

- [Crush CLI](https://github.com/charmbracelet/crush)
- [ACP Specification](https://agentclientprotocol.com)
- [ACP Registry](https://github.com/agentclientprotocol/registry)
- [Zed Editor](https://zed.dev)
- [Charm](https://charm.sh)

## License

[MIT](LICENSE)
