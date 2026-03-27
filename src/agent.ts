import * as acp from "@agentclientprotocol/sdk";
import { spawn, ChildProcess, execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

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

// Fetch models dynamically from Crush CLI at startup
function fetchAvailableModels(): acp.ModelInfo[] {
  try {
    const output = execSync("crush models", { encoding: "utf-8", timeout: 5000 });
    const lines = output.trim().split("\n").filter(Boolean);
    
    // Filter to zhipu-coding models (primary provider) and limit to reasonable list
    const filteredLines = lines.filter(line => 
      line.startsWith("zhipu-coding/") || 
      line.startsWith("zai/")
    ).slice(0, 20);
    
    return filteredLines.map(line => {
      const modelId = line.trim();
      const name = modelId.split("/").pop() || modelId;
      const isVision = name.includes("v") || name.toLowerCase().includes("vision");
      const isFlash = name.includes("flash") || name.includes("air");
      const isLatest = name.includes("5") || name === "glm-4.7";
      
      let description = `Zhipu ${name}`;
      if (isVision) description += " (Vision)";
      if (isFlash) description += " (Fast)";
      if (isLatest && !isVision && !isFlash) description += " (Latest)";
      
      return {
        modelId,
        name: name.toUpperCase(),
        description,
      };
    });
  } catch (err) {
    console.error("[crush-acp] Failed to fetch models from Crush CLI, using defaults:", err);
    return [
      { modelId: "zhipu-coding/glm-5", name: "GLM-5", description: "Zhipu GLM-5 (Latest)" },
      { modelId: "zhipu-coding/glm-4.7", name: "GLM-4.7", description: "Zhipu GLM-4.7" },
    ];
  }
}

const AVAILABLE_MODELS = fetchAvailableModels();

// Available session modes
const AVAILABLE_MODES: acp.SessionMode[] = [
  { id: "code", name: "Code", description: "Full coding mode with file access and terminal" },
  { id: "ask", name: "Ask", description: "Ask questions without making changes" },
  { id: "architect", name: "Architect", description: "Plan and design without implementation" },
  { id: "yolo", name: "Yolo", description: "Auto-accept all permissions (dangerous mode)" },
];

// Session config option IDs
const CONFIG_MODE = "mode";
const CONFIG_MODEL = "model";
const CONFIG_THINKING = "thinking";
const CONFIG_YOLO = "yolo";

const DEFAULT_MODEL_ID = "zhipu-coding/glm-5";
const DEFAULT_MODE_ID = "code";

/**
 * CrushAgent implements the ACP Agent interface by wrapping the Crush CLI.
 * 
 * This adapter allows Crush to be used from ACP-compatible clients like Zed.
 */
export class CrushAgent implements acp.Agent {
  private connection: acp.AgentSideConnection;
  private sessions: Map<string, CrushSession> = new Map();

  constructor(connection: acp.AgentSideConnection) {
    this.connection = connection;
  }

  async initialize(
    params: acp.InitializeRequest
  ): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: true,
          audio: false,
          embeddedContext: true,
        },
        sessionCapabilities: {
          fork: null,
          list: null,
          resume: null,
        },
      },
      agentInfo: {
        name: "crush-acp",
        title: "Crush",
        version: "0.3.3",
      },
    };
  }

  async authenticate(
    params: acp.AuthenticateRequest
  ): Promise<acp.AuthenticateResponse | void> {
    // Crush handles authentication internally via environment variables
    // or its own configuration. No additional auth needed from ACP side.
    return {};
  }

  async newSession(
    params: acp.NewSessionRequest
  ): Promise<acp.NewSessionResponse> {
    const sessionId = randomUUID();
    const workingDir = params.cwd || process.cwd();

    this.sessions.set(sessionId, {
      id: sessionId,
      workingDir,
      pendingPrompt: null,
      process: null,
      currentModelId: DEFAULT_MODEL_ID,
      currentModeId: DEFAULT_MODE_ID,
      yoloMode: false,
      thinkingMode: false,
      toolCallCounter: 0,
    });

    // Send available commands to the client
    setTimeout(() => this.sendAvailableCommands(sessionId), 100);

    // Build configOptions - mode first, then model, then toggles
    const configOptions: acp.SessionConfigOption[] = [
      {
        id: CONFIG_MODE,
        name: "Mode",
        description: "Session operating mode",
        type: "select",
        currentValue: DEFAULT_MODE_ID,
        category: "mode",
        options: AVAILABLE_MODES.map(mode => ({
          value: mode.id,
          name: mode.name,
          description: mode.description,
        })),
      },
      {
        id: CONFIG_MODEL,
        name: "Model",
        description: "AI model to use",
        type: "select",
        currentValue: DEFAULT_MODEL_ID,
        category: "model",
        options: AVAILABLE_MODELS.map(model => ({
          value: model.modelId,
          name: model.name,
          description: model.description,
        })),
      },
      {
        id: CONFIG_THINKING,
        name: "Thinking",
        description: "Extended thinking mode for reasoning models",
        type: "select",
        currentValue: "off",
        category: "behavior",
        options: [
          { value: "off", name: "Off", description: "Standard responses" },
          { value: "on", name: "On", description: "Extended thinking enabled" },
        ],
      },
      {
        id: CONFIG_YOLO,
        name: "Yolo",
        description: "Auto-accept all permissions",
        type: "select",
        currentValue: "off",
        category: "behavior",
        options: [
          { value: "off", name: "Off", description: "Confirm permissions" },
          { value: "on", name: "On", description: "Auto-accept all" },
        ],
      },
    ];

    return {
      sessionId,
      // Keep old fields for backwards compatibility
      models: {
        availableModels: AVAILABLE_MODELS,
        currentModelId: DEFAULT_MODEL_ID,
      },
      modes: {
        availableModes: AVAILABLE_MODES,
        currentModeId: DEFAULT_MODE_ID,
      },
      // New preferred configOptions
      configOptions,
    };
  }

  async loadSession(
    params: acp.LoadSessionRequest
  ): Promise<acp.LoadSessionResponse> {
    // Session loading not supported - each session is fresh
    throw acp.RequestError.methodNotFound("session/load");
  }

  async setSessionMode(
    params: acp.SetSessionModeRequest
  ): Promise<acp.SetSessionModeResponse | void> {
    const session = this.sessions.get(params.sessionId);
    if (session) {
      session.currentModeId = params.modeId;
      
      // If yolo mode is selected, also enable yoloMode toggle
      if (params.modeId === "yolo") {
        session.yoloMode = true;
        this.notifyConfigUpdate(params.sessionId, session);
      } else if (session.currentModeId === "yolo") {
        // Switching away from yolo mode, disable it
        session.yoloMode = false;
        this.notifyConfigUpdate(params.sessionId, session);
      }
      
      // Notify client of mode change
      this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "current_mode_update",
          currentModeId: params.modeId,
        },
      }).catch(console.error);
    }
    return {};
  }

  async setSessionConfigOption(
    params: acp.SetSessionConfigOptionRequest
  ): Promise<acp.SetSessionConfigOptionResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw acp.RequestError.invalidParams(
        `Session ${params.sessionId} not found`
      );
    }

    // Handle mode change via config option
    if (params.configId === CONFIG_MODE) {
      const newModeId = params.value as string;
      if (AVAILABLE_MODES.some(m => m.id === newModeId)) {
        const oldModeId = session.currentModeId;
        session.currentModeId = newModeId;
        
        // Handle yolo mode sync
        if (newModeId === "yolo") {
          session.yoloMode = true;
        } else if (oldModeId === "yolo") {
          session.yoloMode = false;
        }
        
        // Notify via old API for backwards compatibility
        this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "current_mode_update",
            currentModeId: newModeId,
          },
        }).catch(console.error);
      }
    }
    
    // Handle model change via config option
    if (params.configId === CONFIG_MODEL) {
      const newModelId = params.value as string;
      if (AVAILABLE_MODELS.some(m => m.modelId === newModelId)) {
        session.currentModelId = newModelId;
      }
    }

    // Handle thinking mode toggle
    if (params.configId === CONFIG_THINKING) {
      session.thinkingMode = (params.value as string) === "on";
    }

    // Handle yolo mode toggle
    if (params.configId === CONFIG_YOLO) {
      session.yoloMode = (params.value as string) === "on";
      // Sync with mode selector
      if (session.yoloMode && session.currentModeId !== "yolo") {
        session.currentModeId = "yolo";
      } else if (!session.yoloMode && session.currentModeId === "yolo") {
        session.currentModeId = "code";
      }
    }

    // Return ALL config options with current values
    return {
      configOptions: this.buildConfigOptions(session),
    };
  }

  private buildConfigOptions(session: CrushSession): acp.SessionConfigOption[] {
    return [
      {
        id: CONFIG_MODE,
        name: "Mode",
        description: "Session operating mode",
        type: "select",
        currentValue: session.currentModeId,
        category: "mode",
        options: AVAILABLE_MODES.map(mode => ({
          value: mode.id,
          name: mode.name,
          description: mode.description,
        })),
      },
      {
        id: CONFIG_MODEL,
        name: "Model",
        description: "AI model to use",
        type: "select",
        currentValue: session.currentModelId,
        category: "model",
        options: AVAILABLE_MODELS.map(model => ({
          value: model.modelId,
          name: model.name,
          description: model.description,
        })),
      },
      {
        id: CONFIG_THINKING,
        name: "Thinking",
        description: "Extended thinking mode for reasoning models",
        type: "select",
        currentValue: session.thinkingMode ? "on" : "off",
        category: "behavior",
        options: [
          { value: "off", name: "Off", description: "Standard responses" },
          { value: "on", name: "On", description: "Extended thinking enabled" },
        ],
      },
      {
        id: CONFIG_YOLO,
        name: "Yolo",
        description: "Auto-accept all permissions",
        type: "select",
        currentValue: session.yoloMode ? "on" : "off",
        category: "behavior",
        options: [
          { value: "off", name: "Off", description: "Confirm permissions" },
          { value: "on", name: "On", description: "Auto-accept all" },
        ],
      },
    ];
  }

  private notifyConfigUpdate(sessionId: string, session: CrushSession): void {
    this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "config_option_update",
        configOptions: this.buildConfigOptions(session),
      },
    }).catch(console.error);
  }

  private sendAvailableCommands(sessionId: string): void {
    const commands: acp.AvailableCommand[] = [
      // Session management (matches Crush TUI)
      { name: "new", description: "Start a fresh conversation session" },
      { name: "compact", description: "Summarize session to save context space" },
      { name: "export", description: "Export session transcript to file" },
      { name: "status", description: "Show current session info and settings" },
      // Model & Mode (matches Crush TUI)
      { name: "model", description: "Switch AI model" },
      { name: "mode", description: "Switch mode (code, ask, architect, yolo)" },
      { name: "thinking", description: "Toggle extended thinking mode" },
      { name: "yolo", description: "Toggle auto-accept all permissions" },
      { name: "models", description: "List all available AI models" },
      // Development helpers
      { name: "init", description: "Generate AGENTS.md from codebase analysis" },
      { name: "review", description: "Review git changes or uncommitted code" },
      // Crush CLI info
      { name: "logs", description: "View crush logs" },
      { name: "projects", description: "List project directories" },
      { name: "stats", description: "Show token usage statistics" },
      { name: "dirs", description: "Show crush data and config directories" },
      { name: "help", description: "Show all available commands" },
    ];

    this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: commands,
      },
    }).catch(console.error);
  }

  async unstable_setSessionModel(
    params: acp.SetSessionModelRequest
  ): Promise<acp.SetSessionModelResponse | void> {
    const session = this.sessions.get(params.sessionId);
    if (session) {
      session.currentModelId = params.modelId;
    }
    return {};
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);

    if (!session) {
      throw acp.RequestError.invalidParams(
        `Session ${params.sessionId} not found`
      );
    }

    // Cancel any existing prompt
    session.pendingPrompt?.abort();
    session.pendingPrompt = new AbortController();
    const abortSignal = session.pendingPrompt.signal;

    try {
      // Extract text content from the prompt
      const promptText = this.extractPromptText(params.prompt, session.currentModelId);
      
      // Check for slash commands
      if (promptText.startsWith("/")) {
        await this.handleCommand(session, promptText);
        return { stopReason: "end_turn" };
      }
      
      // Extract any file paths mentioned
      const filePaths = this.extractFilePaths(params.prompt, session.currentModelId);

      await this.runCrush(
        session,
        promptText,
        filePaths,
        abortSignal
      );
    } catch (err) {
      if (abortSignal.aborted) {
        return { stopReason: "cancelled" };
      }
      throw err;
    } finally {
      session.pendingPrompt = null;
    }

    return { stopReason: "end_turn" };
  }

  private async handleCommand(session: CrushSession, commandText: string): Promise<void> {
    const parts = commandText.slice(1).trim().split(/\s+/);
    const command = parts[0]?.toLowerCase() || "";
    const args = parts.slice(1);

    let response = "";

    switch (command) {
      case "new":
        response = "Starting a fresh conversation session.";
        break;
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
      case "export":
        const exportDate = new Date().toISOString().split('T')[0];
        const exportTime = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
        response = `**Session Export**

To export this session, run in your terminal:
\`\`\`bash
crush logs --tail 500 > session-${exportDate}-${exportTime}.md
\`\`\`

Or copy the conversation from Zed's chat history.`;
        break;
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
            this.notifyConfigUpdate(session.id, session);
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
            this.notifyConfigUpdate(session.id, session);
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
        this.notifyConfigUpdate(session.id, session);
        break;
      case "yolo":
        // Toggle yolo mode
        session.yoloMode = !session.yoloMode;
        if (session.yoloMode) {
          session.currentModeId = "yolo";
        } else if (session.currentModeId === "yolo") {
          session.currentModeId = "code";
        }
        response = `Yolo mode: ${session.yoloMode ? "Enabled" : "Disabled"}${session.yoloMode ? " - All permissions auto-accepted" : ""}`;
        this.notifyConfigUpdate(session.id, session);
        break;
      case "models":
        try {
          const output = execSync("crush models", { encoding: "utf-8", timeout: 10000 });
          const lines = output.trim().split("\n").filter(Boolean);
          const modelList = lines.slice(0, 30).join("\n");
          response = `**Available Models** (${lines.length} total):\n\`\`\`\n${modelList}${lines.length > 30 ? "\n..." : ""}\n\`\`\``;
        } catch (err) {
          response = "Failed to fetch models. Make sure crush CLI is available.";
        }
        break;
      case "logs":
        try {
          const tailFlag = args.includes("--tail") ? `--tail ${args[args.indexOf("--tail") + 1] || "50"}` : "--tail 50";
          const output = execSync(`crush logs ${tailFlag}`, { encoding: "utf-8", timeout: 10000 });
          response = `**Crush Logs:**\n\`\`\`\n${output.slice(-3000)}\n\`\`\``;
        } catch (err) {
          response = "Failed to fetch logs. Make sure crush CLI is available.";
        }
        break;
      case "projects":
        try {
          const output = execSync("crush projects", { encoding: "utf-8", timeout: 10000 });
          response = `**Crush Projects:**\n\`\`\`\n${output}\n\`\`\``;
        } catch (err) {
          response = "Failed to fetch projects. Make sure crush CLI is available.";
        }
        break;
      case "stats":
        try {
          const output = execSync("crush stats", { encoding: "utf-8", timeout: 10000 });
          response = `**Crush Statistics:**\n\`\`\`\n${output}\n\`\`\``;
        } catch (err) {
          response = "Failed to fetch stats. Make sure crush CLI is available.";
        }
        break;
      case "dirs":
        try {
          const output = execSync("crush dirs", { encoding: "utf-8", timeout: 10000 });
          response = `**Crush Directories:**\n\`\`\`\n${output}\n\`\`\``;
        } catch (err) {
          response = "Failed to fetch directories. Make sure crush CLI is available.";
        }
        break;
      default:
        response = `Unknown command: /${command}. Type /help for available commands.`;
    }

    // Send response as agent message
    await this.connection.sessionUpdate({
      sessionId: session.id,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: response,
        },
      },
    });
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (session) {
      session.pendingPrompt?.abort();
      if (session.process) {
        session.process.kill("SIGTERM");
        session.process = null;
      }
    }
  }

  /**
   * Extract text content from the ACP prompt structure
   */

  /**
   * Check if a model supports vision/images
   */
  private isVisionModel(modelId: string): boolean {
    const visionKeywords = ["glm-4.5v", "glm-4.6v", "glm-4v", "4.5v", "4.6v", "4v", "vision"];
    const lowerModel = modelId.toLowerCase();
    return visionKeywords.some(keyword => lowerModel.includes(keyword));
  }

  /**
   * Extract text content from the ACP prompt structure
   */
  private extractPromptText(prompt: Array<acp.ContentBlock>, modelId: string): string {
    const supportsVision = this.isVisionModel(modelId);
    
    return prompt
      .map((block) => {
        if (block.type === "text") {
          return block.text;
        }
        if (block.type === "image") {
          // Only include images for vision-capable models
          if (supportsVision) {
            return `[Image: ${block.mimeType}, ${block.data.length} bytes base64]`;
          } else {
            // Skip images for non-vision models - warn user
            console.warn(`[crush-acp] Image skipped: model ${modelId} does not support vision`);
            return "[Image skipped - model does not support images]";
          }
        }
        if (block.type === "resource") {
          // Embedded resource content
          if ("text" in block.resource) {
            return `\n[File: ${block.resource.uri}]\n${block.resource.text}`;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  /**
   * Extract file paths from prompt context (resource links)
   * Filters out image files for non-vision models to prevent errors
   */
  private extractFilePaths(prompt: Array<acp.ContentBlock>, modelId: string): string[] {
    const paths: string[] = [];
    const isVision = this.isVisionModel(modelId);
    const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg"];
    
    for (const block of prompt) {
      if (block.type === "resource_link") {
        // resource_link has a uri property (file:// paths)
        if (block.uri && typeof block.uri === "string") {
          // Convert file:// URI to path
          const path = block.uri.replace(/^file:\/\//, "");
          // Skip image files for non-vision models
          const isImage = imageExtensions.some(ext => path.toLowerCase().endsWith(ext));
          if (isVision || !isImage) {
            paths.push(path);
          }
        }
      }
    }

    return paths;
  }

  /**
   * Run Crush CLI and stream output back to the client
   */
  private async runCrush(
    session: CrushSession,
    prompt: string,
    contextPaths: string[],
    abortSignal: AbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Filter image file references from prompt text for non-vision models
      const isVisionFilter = this.isVisionModel(session.currentModelId);
      const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg"];
      let userPrompt = prompt;
      if (!isVisionFilter) {
        for (const ext of imageExts) {
          const re = new RegExp(`@\S*` + ext.replace(".", "\.") + `(\s|$)`, "gi");
          userPrompt = userPrompt.replace(re, " ");
        }
        userPrompt = userPrompt.replace(/\s+/g, " ").trim();
      }
      // Build the prompt with context files
      let fullPrompt = userPrompt;
      if (contextPaths.length > 0) {
        const contextSection = contextPaths
          .map((p) => `@${p}`)
          .join(" ");
        fullPrompt = `${contextSection}\n\n${userPrompt}`;
      }

      // Build args with model selection
      const args = [
        "run",
        "--quiet",
        "-m", session.currentModelId,
      ];

      // Add mode-specific instructions to prompt
      let modePrompt = "";
      switch (session.currentModeId) {
        case "ask":
          modePrompt = "[Mode: Ask - Answer questions only, do not modify files]\n\n";
          break;
        case "architect":
          modePrompt = "[Mode: Architect - Plan and design, do not implement]\n\n";
          break;
        case "yolo":
          modePrompt = "[Mode: Yolo - Auto-accept all permissions, making changes freely]\n\n";
          break;
        case "code":
        default:
          // Code mode is the default, no prefix needed
          break;
      }

      const finalPrompt = modePrompt + fullPrompt;

      const child = spawn("crush", [...args, finalPrompt], {
        cwd: session.workingDir,
        env: {
          ...process.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      session.process = child;

      let outputBuffer = "";
      let errorBuffer = "";
      let pendingToolCall: { id: string; title: string; startTime: number } | null = null;

      // Pattern matching for tool calls in Crush output
      const toolCallPatterns = [
        { regex: /Running:\s*(.+)/, kind: "execute" as const },
        { regex: /Reading:\s*(.+)/, kind: "read" as const },
        { regex: /Editing:\s*(.+)/, kind: "edit" as const },
        { regex: /Searching:\s*(.+)/, kind: "search" as const },
        { regex: /Writing:\s*(.+)/, kind: "edit" as const },
        { regex: /Using tool:\s*(.+)/, kind: "other" as const },
      ];

      // Pattern for thinking/reasoning content (enclosed in special markers)
      const thinkingPattern = /<(?:think|thinking|reasoning)>([\s\S]*?)<\/(?:think|thinking|reasoning)>/gi;
      
      // Pattern for plan extraction
      const planPattern = /(?:Plan|TODO|Tasks?):\s*\n((?:[-*]\s*.+\n?)+)/i;

      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        outputBuffer += text;
        
        // Extract and send thinking content
        let thinkingMatch;
        while ((thinkingMatch = thinkingPattern.exec(text)) !== null) {
          const thinkingContent = thinkingMatch[1].trim();
          this.connection.sessionUpdate({
            sessionId: session.id,
            update: {
              sessionUpdate: "agent_thought_chunk",
              content: {
                type: "text",
                text: thinkingContent,
              },
            },
          }).catch(console.error);
        }

        // Parse for tool call patterns
        for (const { regex, kind } of toolCallPatterns) {
          const match = text.match(regex);
          if (match) {
            // Complete any pending tool call
            if (pendingToolCall) {
              this.sendToolCallUpdate(session, pendingToolCall.id, "completed", outputBuffer);
              pendingToolCall = null;
            }
            
            // Start new tool call
            const toolCallId = `tool-${++session.toolCallCounter}`;
            const title = match[1].trim();
            pendingToolCall = { id: toolCallId, title, startTime: Date.now() };
            
            this.connection.sessionUpdate({
              sessionId: session.id,
              update: {
                sessionUpdate: "tool_call",
                toolCallId,
                title,
                kind,
                status: "in_progress",
                locations: kind === "read" || kind === "edit" ? [{ path: title }] : undefined,
              },
            }).catch(console.error);
            break;
          }
        }

        // Check for tool completion markers
        if (pendingToolCall && (text.includes("Done") || text.includes("✓") || text.includes("✗"))) {
          this.sendToolCallUpdate(session, pendingToolCall.id, "completed", text);
          pendingToolCall = null;
        }

        // Send text as agent message chunk
        this.connection.sessionUpdate({
          sessionId: session.id,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: text,
            },
          },
        }).catch(console.error);
      });

      child.stderr?.on("data", (data: Buffer) => {
        errorBuffer += data.toString();
        // Log errors but don't send to client as they're usually debug info
        console.error("[crush stderr]", data.toString());
      });

      child.on("close", (code) => {
        session.process = null;
        
        // Complete any pending tool call
        if (pendingToolCall) {
          this.sendToolCallUpdate(session, pendingToolCall.id, code === 0 ? "completed" : "failed", outputBuffer);
          pendingToolCall = null;
        }

        if (abortSignal.aborted) {
          reject(new Error("Cancelled"));
          return;
        }

        if (code === 0) {
          // Send session info update with a generated title
          this.connection.sessionUpdate({
            sessionId: session.id,
            update: {
              sessionUpdate: "session_info_update",
              title: this.generateSessionTitle(prompt),
              updatedAt: new Date().toISOString(),
            },
          }).catch(console.error);
          
          resolve();
        } else {
          // Send error as message if we have output
          if (outputBuffer) {
            this.connection.sessionUpdate({
              sessionId: session.id,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: {
                  type: "text",
                  text: `\n\n[Process exited with code ${code}]`,
                },
              },
            }).catch(console.error);
          }
          resolve(); // Resolve anyway so the conversation can continue
        }
      });

      child.on("error", (err) => {
        session.process = null;
        
        // Complete any pending tool call
        if (pendingToolCall) {
          this.sendToolCallUpdate(session, pendingToolCall.id, "failed", err.message);
          pendingToolCall = null;
        }
        
        if (abortSignal.aborted) {
          reject(new Error("Cancelled"));
          return;
        }

        // Send error message to client
        this.connection.sessionUpdate({
          sessionId: session.id,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `Error running Crush: ${err.message}. Make sure Crush CLI is installed and in your PATH.`,
            },
          },
        }).catch(console.error);
        
        resolve(); // Resolve to allow recovery
      });

      // Handle abort signal
      abortSignal.addEventListener("abort", () => {
        if (pendingToolCall) {
          this.sendToolCallUpdate(session, pendingToolCall.id, "failed", "Cancelled");
          pendingToolCall = null;
        }
        child.kill("SIGTERM");
      });
    });
  }

  /**
   * Send a tool call update notification
   */
  private sendToolCallUpdate(
    session: CrushSession,
    toolCallId: string,
    status: acp.ToolCallStatus,
    output: string
  ): void {
    this.connection.sessionUpdate({
      sessionId: session.id,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status,
        rawOutput: output.slice(0, 1000), // Truncate large outputs
      },
    }).catch(console.error);
  }

  /**
   * Generate a session title from the first prompt
   */
  private generateSessionTitle(prompt: string): string {
    const firstLine = prompt.split("\n")[0];
    if (firstLine.length <= 50) return firstLine;
    return firstLine.slice(0, 47) + "...";
  }
}
