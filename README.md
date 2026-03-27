# Crush ACP Adapter

[![npm](https://img.shields.io/npm/v/crush-acp)](https://www.npmjs.com/package/crush-acp)

Use [Crush](https://github.com/charmbracelet/crush) - Charm's AI coding agent - from [ACP-compatible](https://agentclientprotocol.com) clients such as [Zed](https://zed.dev)!

## About

Crush is your terminal coding bestie - a powerful AI assistant that works directly in your terminal with access to your tools, code, and workflows. This adapter brings Crush to editors like Zed via the Agent Client Protocol (ACP).

## Features

- **Full Crush capabilities** from Zed's Agent Panel
- **Model Selection** - Switch between models directly from Zed's UI
- **Session Modes** - Code, Ask, and Architect modes for different workflows
- **Dynamic Model List** - Automatically fetches available models from Crush
- **Tool Call Visibility** - See what tools Crush is using in real-time
- **Thinking Content** - Displays reasoning/thinking when models use it
- **Session Titles** - Auto-generates descriptive titles for sessions
- **Image Support** - Works with vision models (GLM-4.5V, GLM-4.6V)
- **Context Files** - Includes files from Zed's context in prompts
- **LSP-enhanced context**
- **MCP server support**

## Installation

### Prerequisites

1. Install [Crush CLI](https://github.com/charmbracelet/crush#installation):
   ```bash
   # Homebrew
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
      "args": ["C:/Users/Admin/Documents/Projects/crush-acp/dist/index.js"],
      "env": {}
    }
  }
}
```

**Keyboard Shortcut (Optional)**

Add a keyboard shortcut in your `keymap.json`:

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

### Using Crush in Zed

1. Open the Agent Panel in Zed (usually `cmd+e` or via View menu)
2. Click the `+` button in the top-right
3. Select "Crush" from the list
4. Start chatting with Crush!

### Model Selection

Click the model dropdown in Zed's agent panel to switch between available models:
- **GLM-5** - Latest and most capable
- **GLM-4.7** - Balanced performance
- **GLM-4.7-Flash** - Fastest responses
- **GLM-4.5V / GLM-4.6V** - Vision models for image analysis

### Session Modes

Switch modes to change Crush's behavior:
- **Code** - Full coding mode with file access and terminal
- **Ask** - Answer questions without making changes
- **Architect** - Plan and design without implementation

## Development

### Setup

```bash
git clone https://github.com/charmbracelet/crush-acp.git
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

## Improvements in v0.2.0

| Feature | Description |
|---------|-------------|
| Dynamic Model Fetching | Models are fetched from `crush models` at startup |
| Model Selection | Switch models from Zed's UI dropdown |
| Session Modes | Code/Ask/Architect mode switching |
| Tool Call Visibility | Real-time tool call status updates |
| Thinking Content | Displays reasoning when available |
| Session Titles | Auto-generated from first prompt |
| Image Support | Vision model compatibility |
| Better Error Handling | Proper ACP error codes |

## Limitations

- Session persistence: Each session is fresh (no session loading)
- Tool call details: Limited to what Crush outputs in non-interactive mode

Future versions will improve these with tighter integration.

## API Keys

Crush supports multiple providers. Set the appropriate environment variable:

| Variable | Provider |
|----------|----------|
| `ZHIPU_API_KEY` | Zhipu AI (GLM models) |
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT) |
| `GEMINI_API_KEY` | Google Gemini |
| `GROQ_API_KEY` | Groq |
| `OPENROUTER_API_KEY` | OpenRouter |
| `VERCEL_API_KEY` | Vercel AI Gateway |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT](LICENSE)

## Links

- [Crush](https://github.com/charmbracelet/crush) - The main Crush CLI
- [Agent Client Protocol](https://agentclientprotocol.com) - Protocol specification
- [Zed](https://zed.dev) - High-performance editor with ACP support
- [Charm](https://charm.sh) - The team behind Crush
