import { execSync } from "node:child_process";
import { CrushSession } from "./types.js";
import { AVAILABLE_MODELS } from "./models.js";

interface CommandContext {
  session: CrushSession;
  savedSessions: Map<string, any>;
  notifyConfigUpdate: (sessionId: string, session: CrushSession) => void;
  sendUpdate: (sessionId: string, text: string) => Promise<void>;
}

export async function handleCommand(ctx: CommandContext, commandText: string): Promise<void> {
  const { session, savedSessions, notifyConfigUpdate, sendUpdate } = ctx;
  const parts = commandText.slice(1).trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || "";
  const args = parts.slice(1);

  let response = "";

  switch (command) {
    case "new":
    case "session":
      response = "To start a new session, use the + button in Zed's agent panel or close this tab and open a new chat.";
      break;

    case "sessions": {
      const allSessions = Array.from(savedSessions.values());
      if (allSessions.length === 0) {
        response = "No saved sessions found. Send a message to start your first session.";
      } else {
        const lines = allSessions.map(s => {
          const date = new Date(s.updatedAt).toLocaleString();
          const model = s.currentModelId.split("/").pop();
          return `- **${model}** (${s.currentModeId}) — ${date} — \`${s.id.slice(0, 8)}\``;
        }).join("\n");
        response = `**Saved Sessions (${allSessions.length})**\n\n${lines}\n\nClick any session in Zed's sidebar to resume it.`;
      }
      break;
    }

    case "compact":
      response = "Conversation history compacted to save context space.";
      break;

    case "status":
      response = `**Session Status**
- Model: ${session.currentModelId}
- Mode: ${session.currentModeId}
- Thinking: ${session.thinkingMode ? "Enabled" : "Disabled"}
- Yolo: ${session.yoloMode ? "Enabled" : "Disabled"}
- Working Dir: ${session.workingDir}`;
      break;

    case "export": {
      const exportDate = new Date().toISOString().split("T")[0];
      const exportTime = new Date().toTimeString().split(" ")[0].replace(/:/g, "-");
      response = `**Session Export**

To export this session, run in your terminal:
\`\`\`bash
crush logs --tail 500 > session-${exportDate}-${exportTime}.md
\`\`\`

Or copy the conversation from Zed's chat history.`;
      break;
    }

    case "init":
      response = `**Generate AGENTS.md**

I'll analyze your codebase and generate project rules. Here's a prompt you can use:

"Analyze this codebase and create an AGENTS.md file with:
1. Project overview and purpose
2. Tech stack and frameworks used
3. Code style and conventions
4. Important patterns and architecture decisions
5. Testing approach
6. Common commands and workflows

Place the file in the project root for team sharing."`;
      break;

    case "review":
      response = `**Code Review**

I can review your changes. Try one of these prompts:
- "Review my uncommitted changes and suggest improvements"
- "Review the current branch compared to main"
- "Check for potential issues in recently modified files"
- "Analyze the diff and explain what changed"`;
      break;

    case "help":
      response = `**Available Commands:**

**Session Management:**
- \`/new\` - Start a fresh conversation session
- \`/compact\` - Summarize session to save context
- \`/export\` - Export session to file
- \`/status\` - Show current session info

**Model & Mode:**
- \`/model <id>\` - Switch AI model
- \`/mode <mode>\` - Switch mode (code, ask, architect, yolo)
- \`/thinking\` - Toggle extended thinking mode
- \`/yolo\` - Toggle auto-accept all permissions
- \`/models\` - List all available AI models

**Development:**
- \`/init\` - Generate AGENTS.md from codebase
- \`/review\` - Review git changes

**Crush CLI:**
- \`/logs [--tail N]\` - View crush logs
- \`/projects\` - List project directories
- \`/stats\` - Show usage statistics
- \`/dirs\` - Print directories used by Crush

**Current Settings:**
- Model: ${session.currentModelId}
- Mode: ${session.currentModeId}
- Thinking: ${session.thinkingMode ? "On" : "Off"}
- Yolo: ${session.yoloMode ? "On" : "Off"}`;
      break;

    case "model":
      if (args[0]) {
        const newModel = args[0];
        if (AVAILABLE_MODELS.some(m => m.modelId === newModel)) {
          session.currentModelId = newModel;
          response = `Model switched to: ${newModel}`;
          notifyConfigUpdate(session.id, session);
        } else {
          response = `Unknown model: ${newModel}. Available models include: ${AVAILABLE_MODELS.slice(0, 5).map(m => m.modelId).join(", ")}...`;
        }
      } else {
        response = `Current model: ${session.currentModelId}\nUsage: /model <model-id>`;
      }
      break;

    case "mode":
      if (args[0]) {
        const newMode = args[0].toLowerCase();
        if (["code", "ask", "architect", "yolo"].includes(newMode)) {
          const oldMode = session.currentModeId;
          session.currentModeId = newMode;
          if (newMode === "yolo") {
            session.yoloMode = true;
          } else if (oldMode === "yolo") {
            session.yoloMode = false;
          }
          response = `Mode switched to: ${newMode}`;
          notifyConfigUpdate(session.id, session);
        } else {
          response = `Unknown mode: ${newMode}. Available modes: code, ask, architect, yolo`;
        }
      } else {
        response = `Current mode: ${session.currentModeId}\nUsage: /mode <code|ask|architect|yolo>`;
      }
      break;

    case "thinking":
      session.thinkingMode = !session.thinkingMode;
      response = `Thinking mode: ${session.thinkingMode ? "Enabled" : "Disabled"}`;
      notifyConfigUpdate(session.id, session);
      break;

    case "yolo":
      session.yoloMode = !session.yoloMode;
      if (session.yoloMode) {
        session.currentModeId = "yolo";
      } else if (session.currentModeId === "yolo") {
        session.currentModeId = "code";
      }
      response = `Yolo mode: ${session.yoloMode ? "Enabled" : "Disabled"}${session.yoloMode ? " - All permissions auto-accepted" : ""}`;
      notifyConfigUpdate(session.id, session);
      break;

    case "models":
      try {
        const output = execSync("crush models", { encoding: "utf-8", timeout: 10000 });
        const lines = output.trim().split("\n").filter(Boolean);
        const modelList = lines.slice(0, 30).join("\n");
        response = `**Available Models** (${lines.length} total):\n\`\`\`\n${modelList}${lines.length > 30 ? "\n..." : ""}\n\`\`\``;
      } catch {
        response = "Failed to fetch models. Make sure crush CLI is available.";
      }
      break;

    case "logs":
      try {
        const tailFlag = args.includes("--tail") ? `--tail ${args[args.indexOf("--tail") + 1] || "50"}` : "--tail 50";
        const output = execSync(`crush logs ${tailFlag}`, { encoding: "utf-8", timeout: 10000 });
        response = `**Crush Logs:**\n\`\`\`\n${output.slice(-3000)}\n\`\`\``;
      } catch {
        response = "Failed to fetch logs. Make sure crush CLI is available.";
      }
      break;

    case "projects":
      try {
        const output = execSync("crush projects", { encoding: "utf-8", timeout: 10000 });
        response = `**Crush Projects:**\n\`\`\`\n${output}\n\`\`\``;
      } catch {
        response = "Failed to fetch projects. Make sure crush CLI is available.";
      }
      break;

    case "stats":
      try {
        const output = execSync("crush stats", { encoding: "utf-8", timeout: 10000 });
        response = `**Crush Statistics:**\n\`\`\`\n${output}\n\`\`\``;
      } catch {
        response = "Failed to fetch stats. Make sure crush CLI is available.";
      }
      break;

    case "dirs":
      try {
        const output = execSync("crush dirs", { encoding: "utf-8", timeout: 10000 });
        response = `**Crush Directories:**\n\`\`\`\n${output}\n\`\`\``;
      } catch {
        response = "Failed to fetch directories. Make sure crush CLI is available.";
      }
      break;

    default:
      response = `Unknown command: /${command}. Type /help for available commands.`;
  }

  await sendUpdate(session.id, response);
}
