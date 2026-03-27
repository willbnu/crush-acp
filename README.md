# Crush ACP Adapter

[![npm](https://img.shields.io/npm/v/crush-acp)](https://www.npmjs.com/package/crush-acp)

Use [Crush](https://github.com/charmbracelet/crush) - Charm's AI coding agent - from [ACP-compatible](https://agentclientprotocol.com) clients such as [Zed](https://zed.dev)!

## About

Crush is your terminal coding bestie - a powerful AI assistant that works directly in your terminal with access to your tools, code, and workflows. This adapter brings Crush to editors like Zed via the Agent Client Protocol (ACP).

**Platform guides:** [Windows Setup Guide](WINDOWS.md)

## Features

- **Full Crush capabilities** from Zed's Agent Panel
- **Model Selection** - All models from all providers via `crush models`
- **Session Modes** - Code, Ask, Architect, and Yolo modes
- **Thinking Toggle** - Enable extended reasoning for complex tasks
- **Yolo Toggle** - Auto-accept all permissions without confirmation
- **Dynamic Model List** - Automatically fetches all available models from Crush
- **Tool Call Visibility** - See what tools Crush is using in real-time
- **Thinking Content** - Displays reasoning/thinking when models use it
- **Session Titles** - Auto-generates descriptive titles for sessions
- **Image Support** - Works with vision models
- **Context Files** - Includes files from Zed's context in prompts
- **LSP-enhanced context**
- **MCP server support**

## Installation

### Prerequisites

1. Install [Crush CLI](https://github.com/charmbracelet/crush#installation):
   ```bash
   # Homebrew (macOS/Linux)
   brew install charmbracelet/tap/crush
   
   # Or npm
   npm install -g @charmland/crush
   
   # Windows (Scoop)
   scoop bucket add charm https://github.com/charmbracelet/scoop-bucket.git
   scoop install crush
   ```

2. Configure your API key:
   ```bash
   # For Zhipu (default)
   crush login zhipu
   
   # For Anthropic
   export ANTHROPIC_API_KEY=sk-...
   
   # For OpenAI
   export OPENAI_API_KEY=sk-...
   ```

### Install the Adapter

```bash
npm install -g crush-acp
```

Or run directly with npx:

```bash
npx crush-acp
```

## Usage

### Zed Configuration

Add Crush to your Zed `settings.json`:

1. Open Zed settings: `zed: open settings` from the command palette
2. Add the following to your settings:

**Using global npm install:**

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

**Using npx (no install needed):**

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

**Using local development version:**

```json
{
  "agent_servers": {
    "Crush": {
      "type": "custom",
      "command": "node",
      "args": ["/path/to/crush-acp/dist/index.js"],
      "env": {}
    }
  }
}
```

**Keyboard Shortcut (Optional)**

macOS — add to `keymap.json`:
```json
[
  {
    "bindings": {
      "cmd-alt-x": [
        "agent::NewExternalAgentThread",
        { "agent": { "custom": { "name": "Crush" } } }
      ]
    }
  }
]
```

Windows/Linux — use `ctrl-alt-x` instead of `cmd-alt-x`.

### Using Crush in Zed

1. Open the Agent Panel in Zed (`cmd+e` / `ctrl+e` or via View menu)
2. Click the `+` button in the top-right
3. Select "Crush" from the list
4. Start chatting with Crush!

### Toolbar Controls

The Zed agent panel toolbar shows these dropdowns:

| Dropdown | Purpose |
|----------|---------|
| **Mode** | Code, Ask, Architect, or Yolo mode |
| **Model** | All models from all configured providers |
| **Thinking: On/Off** | Toggle extended thinking for better reasoning |
| **Yolo: On/Off** | Toggle auto-accept all permissions |

### Supported Providers & Models

crush-acp automatically fetches **all models** from all providers configured in Crush via `crush models`. This includes:

| Provider | Example Models |
|----------|---------------|
| **Zhipu AI (zai/)** | GLM-5.1, GLM-5, GLM-5-Turbo, GLM-4.7, GLM-4.7-Flash, GLM-4.6, GLM-4.6V, GLM-4.5, GLM-4.5v, GLM-4.5-Air |
| **Zhipu Coding (zhipu-coding/)** | GLM-5, GLM-4.7, GLM-4.7-Flash, GLM-4.6, GLM-4.6V, GLM-4.5, GLM-4.5v, GLM-4.5-Air |
| **OpenAI (openai/)** | GPT-5.4-Pro, GPT-5.4, GPT-5.3-Codex, GPT-5.2, GPT-5.1, GPT-5, O4-Mini, O3 |
| **Anthropic (openrouter/anthropic/)** | Claude Opus 4.6, Claude Sonnet 4.6, Claude Sonnet 4.5, Claude Haiku 4.5 |
| **Google (openrouter/google/)** | Gemini 3.1-Pro, Gemini 3-Flash, Gemini 2.5-Pro, Gemini 2.5-Flash |
| **DeepSeek (openrouter/deepseek/)** | DeepSeek V3.2, DeepSeek R1-0528, DeepSeek Chat |
| **Mistral (openrouter/mistralai/)** | Mistral Large, Devstral Medium, Codestral, Mistral Medium 3.1 |
| **Meta (openrouter/meta-llama/)** | Llama 4 Maverick, Llama 4 Scout, Llama 3.3 70B |
| **xAI (openrouter/x-ai/)** | Grok 4, Grok 4 Fast, Grok 4.1 Fast, Grok 3 |
| **Qwen (openrouter/qwen/)** | Qwen 3.5-397B, Qwen 3 Coder, Qwen 3 Max, Qwen 3 235B |
| **Cerebras (cerebras/)** | GPT-OSS-120B, Qwen-3-235B, GLM-4.7 |
| **Groq (groq/)** | Kimi-K2, Qwen3-32B |
| **Chutes (chutes/)** | DeepSeek R1, DeepSeek V3.1, Qwen3 models, GLM-4.5 |
| **Others** | Moonshot Kimi, MiniMax, Cohere, Baidu Ernie, Xiaomi MiMo, StepFun, NVIDIA Nemotron, and more |

The full list is dynamic — run `crush models` to see every model available with your current configuration.

### API Keys

Crush supports multiple providers. Set the appropriate environment variable:

| Variable | Provider |
|----------|----------|
| `ZHIPU_API_KEY` | Zhipu AI (GLM models, default) |
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT) |
| `GEMINI_API_KEY` | Google Gemini |
| `GROQ_API_KEY` | Groq |
| `OPENROUTER_API_KEY` | OpenRouter (access to 200+ models) |
| `VERCEL_API_KEY` | Vercel AI Gateway |
| `CEREBRAS_API_KEY` | Cerebras |
| `CHUTES_API_KEY` | Chutes |

### Session Modes

| Mode | Description |
|------|-------------|
| **Code** | Full coding mode with file access and terminal |
| **Ask** | Answer questions without making changes |
| **Architect** | Plan and design without implementation |
| **Yolo** | Auto-accept all permissions (dangerous mode) |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/new` | Start a fresh conversation session |
| `/compact` | Summarize session to save context space |
| `/export` | Export session transcript to file |
| `/status` | Show current session info and settings |
| `/model <id>` | Switch AI model |
| `/models` | List all available AI models |
| `/mode <mode>` | Switch mode (code, ask, architect, yolo) |
| `/thinking` | Toggle extended thinking mode |
| `/yolo` | Toggle auto-accept all permissions |
| `/init` | Generate AGENTS.md from codebase analysis |
| `/review` | Review git changes or uncommitted code |
| `/logs` | View crush logs |
| `/projects` | List project directories |
| `/stats` | Show token usage statistics |
| `/dirs` | Show crush data and config directories |
| `/help` | Show all available commands |

## Development

### Setup

```bash
git clone https://github.com/willbnu/crush-acp.git
cd crush-acp
npm install
```

### Build

```bash
npm run build
```

### Run locally

```bash
npm run start
```

### Debug with Zed

Use the `dev: open acp logs` command in Zed to see the ACP communication between Zed and Crush.

## How It Works

This adapter implements the [Agent Client Protocol (ACP)](https://agentclientprotocol.com) specification:

- Communicates via JSON-RPC 2.0 over stdio
- Spawns `crush run -m <model>` for each prompt
- Streams output back to the client via `session/update` notifications
- Parses Crush output for tool calls and sends `tool_call` updates
- Extracts thinking/reasoning content wrapped in `<think/>` tags
- Supports config options for mode, model, thinking, and yolo toggles

## Limitations

- Session persistence: Each session is fresh (no session loading)
- Tool call details: Limited to what Crush outputs in non-interactive mode

Future versions will improve these with tighter integration.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT](LICENSE)

## Links

- [Crush](https://github.com/charmbracelet/crush) - The main Crush CLI
- [Agent Client Protocol](https://agentclientprotocol.com) - Protocol specification
- [ACP Registry](https://github.com/agentclientprotocol/registry) - Registry of ACP-compatible agents
- [Zed](https://zed.dev) - High-performance editor with ACP support
- [Charm](https://charm.sh) - The team behind Crush
