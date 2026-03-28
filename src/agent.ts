import * as acp from "@agentclientprotocol/sdk";
import { spawn, ChildProcess, execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";

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

// Session storage for persistence
// Use Windows AppData path for session storage (more reliable on Windows)
const APPDATA = process.env.APPDATA || process.env.HOME || "";
const SESSION_DIR = join(APPDATA, ".crush-acp", "sessions");

// Isolated crush data directory for Zed (separate from TUI crush)
const CRUSH_DATA_DIR = join(APPDATA, ".crush-acp", "zed-crush");
const SESSION_FILE = join(SESSION_DIR, "sessions.json");

interface SavedSession {
  id: string;
  workingDir: string;
  currentModelId: string;
  currentModeId: string;
  yoloMode: boolean;
  thinkingMode: boolean;
  updatedAt: string;
  crushSessionId?: string; // crush's internal session ID for --session continuation
}

function ensureSessionDir(): void {
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
  }
}

/**
 * Extract the most recent crush session ID from the raw SQLite DB.
 * Reads the DB file and finds UUIDs — returns the last one (most recently written).
 */
function extractLatestCrushSessionId(): string | undefined {
  try {
    const dbPath = join(CRUSH_DATA_DIR, "crush.db");
    if (!existsSync(dbPath)) return undefined;
    const buf = readFileSync(dbPath);
    const text = buf.toString("utf-8");
    const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
    if (!uuids || uuids.length === 0) return undefined;
    // Return the last UUID found (most recently written to DB)
    return uuids[uuids.length - 1];
  } catch (e) {
    console.error("[crush-acp] Failed to extract crush session ID:", e);
    return undefined;
  }
}

function loadSavedSessions(): Map<string, SavedSession> {
  const sessions = new Map<string, SavedSession>();
  try {
    ensureSessionDir();
    if (existsSync(SESSION_FILE)) {
      const data = readFileSync(SESSION_FILE, "utf-8");
      const parsed = JSON.parse(data) as SavedSession[];
      for (const session of parsed) {
        sessions.set(session.id, session);
      }
    }
  } catch (err) {
    console.error("[crush-acp] Failed to load sessions:", err);
  }
  return sessions;
}

function saveSessions(sessions: Map<string, SavedSession>): void {
  try {
    ensureSessionDir();
    const data = JSON.stringify(Array.from(sessions.values()), null, 2);
    writeFileSync(SESSION_FILE, data, "utf-8");
  } catch (err) {
    console.error("[crush-acp] Failed to save sessions:", err);
  }
}

function sessionToInfo(session: SavedSession): acp.SessionInfo {
  return {
    sessionId: session.id,
    cwd: session.workingDir,
    title: "Session " + session.id.slice(0, 8),
    updatedAt: session.updatedAt,
  };
}


/**
 * Read crush.json and return set of provider names that have API keys configured.
 * Only these providers' models will be shown in Zed.
 */
function getProvidersWithKeys(): Set<string> {
  const configured = new Set<string>();
  try {
    // Find crush.json config path
    const crushConfigPaths = [
      join(process.env.APPDATA || process.env.HOME || "", "crush", "crush.json"),
      join(process.env.LOCALAPPDATA || "", "crush", "crush.json"),
      join(process.env.HOME || "", ".config", "crush", "crush.json"),
    ];
    
    let configPath = "";
    for (const p of crushConfigPaths) {
      if (existsSync(p)) {
        configPath = p;
        break;
      }
    }
    
    if (!configPath) {
      // On Windows, also try AppData/Local/crush
      const winPath = join(process.env.LOCALAPPDATA || "", "crush", "crush.json");
      if (existsSync(winPath)) configPath = winPath;
    }
    
    if (configPath) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.providers) {
        for (const [name, provider] of Object.entries(config.providers as Record<string, any>)) {
          // Provider has an API key if it has api_key field
          if (provider && provider.api_key) {
            configured.add(name);
          }
        }
      }
    }
  } catch (err) {
    console.error("[crush-acp] Failed to read crush config for provider filtering:", err);
  }
  
  console.error("[crush-acp] Configured providers:", Array.from(configured).join(", "));
  return configured;
}

function fetchAvailableModels(): acp.ModelInfo[] {
  try {
    const output = execSync("crush models", { encoding: "utf-8", timeout: 10000 });
    const lines = output.trim().split("\n").filter(Boolean);
    
    // Only show models from providers that have API keys configured
    const configuredProviders = getProvidersWithKeys();
    
    return lines
      .map(line => line.trim())
      .filter(modelId => {
        const parts = modelId.split("/");
        const provider = parts.length > 1 ? parts[0] : "unknown";
        return configuredProviders.has(provider);
      })
      .map(modelId => {
      const parts = modelId.split("/");
      const provider = parts.length > 1 ? parts[0] : "unknown";
      const modelName = parts.length > 1 ? parts.slice(1).join("/") : modelId;
      
      const isVision = modelName.toLowerCase().includes("v") && !modelName.toLowerCase().includes("vision");
      const isFlash = modelName.includes("flash") || modelName.includes("air") || modelName.includes("lite") || modelName.includes("mini") || modelName.includes("nano");
      const isThinking = modelId.includes(":thinking") || modelId.includes(":THINKING");
      
      // Tag free models from OpenCode
      const isFree = provider === "opencode-go" || provider === "opencode-go-minimax";
      
      let description = `${provider}/${modelName}`;
      if (isVision) description += " 👁️ Vision";
      if (isFlash) description += " ⚡ Fast";
      if (isThinking) description += " 🧠 Thinking";
      if (isFree) description += " 🆓 Free";
      
      return {
        modelId,
        name: `${provider}/${modelName}`,
        description,
      };
    });
  } catch (err) {
    console.error("[crush-acp] Failed to fetch models from Crush CLI, using defaults:", err);
    return [
      { modelId: "zai/glm-5.1", name: "zai/glm-5.1", description: "GLM-5.1" },
      { modelId: "opencode-go/glm-5", name: "opencode-go/glm-5", description: "GLM-5 🆓 Free" },
      { modelId: "opencode-go/kimi-k2.5", name: "opencode-go/kimi-k2.5", description: "Kimi K2.5 🆓 Free" },
      { modelId: "opencode-go-minimax/minimax-m2.5", name: "opencode-go-minimax/minimax-m2.5", description: "MiniMax M2.5 🆓 Free" },
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

const DEFAULT_MODEL_ID = "zai/glm-5.1";
const DEFAULT_MODE_ID = "code";

/**
 * CrushAgent implements the ACP Agent interface by wrapping the Crush CLI.
 * 
 * This adapter allows Crush to be used from ACP-compatible clients like Zed.
 */
export class CrushAgent implements acp.Agent {
  private connection: acp.AgentSideConnection;
  private sessions: Map<string, CrushSession> = new Map();
  private savedSessions: Map<string, SavedSession> = new Map();

  constructor(connection: acp.AgentSideConnection) {
    this.connection = connection;
    this.savedSessions = loadSavedSessions();
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
          fork: {},
          list: {},
          resume: {},
        },
      },
      agentInfo: {
        name: "crush-acp",
        title: "Crush",
        version: "0.4.4",
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
    // Save session config to disk for persistence
    const newSession = this.sessions.get(sessionId)!;
    const savedSession: SavedSession = {
      id: sessionId,
      workingDir: newSession.workingDir,
      currentModelId: newSession.currentModelId,
      currentModeId: newSession.currentModeId,
      yoloMode: newSession.yoloMode,
      thinkingMode: newSession.thinkingMode,
      updatedAt: new Date().toISOString(),
    };
    this.savedSessions.set(sessionId, savedSession);
    saveSessions(this.savedSessions);
    console.error("[crush-acp] Session saved, total:", this.savedSessions.size);

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
        description: "Enable extended thinking for better reasoning on complex tasks",
        type: "select",
        currentValue: "disabled",
        category: "behavior",
        options: [
          { value: "disabled", name: "Thinking: Off" },
          { value: "enabled", name: "Thinking: On" },
        ],
      },
      {
        id: CONFIG_YOLO,
        name: "Yolo",
        description: "Auto-accept all tool permissions without confirmation",
        type: "select",
        currentValue: "disabled",
        category: "behavior",
        options: [
          { value: "disabled", name: "Yolo: Off" },
          { value: "enabled", name: "Yolo: On" },
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

  async listSessions(
    _params: acp.ListSessionsRequest
  ): Promise<acp.ListSessionsResponse> {
    console.error("[crush-acp] listSessions called, saved sessions:", this.savedSessions.size);
    const sessions: acp.SessionInfo[] = Array.from(this.savedSessions.values()).map(sessionToInfo);
    console.error("[crush-acp] returning sessions:", sessions.length);
    for (const s of sessions) {
      console.error("[crush-acp]   session:", s.sessionId, s.title, s.cwd);
    }
    return { sessions };
  }

  async unstable_resumeSession(
    params: acp.ResumeSessionRequest
  ): Promise<acp.ResumeSessionResponse> {
    const savedSession = this.savedSessions.get(params.sessionId);
    if (!savedSession) {
      throw new Error("Session " + params.sessionId + " not found");
    }
    console.error("[crush-acp] Resuming session:", params.sessionId, "crush session:", savedSession.crushSessionId);
    this.sessions.set(params.sessionId, {
      id: params.sessionId,
      workingDir: savedSession.workingDir,
      pendingPrompt: null,
      process: null,
      currentModelId: savedSession.currentModelId,
      currentModeId: savedSession.currentModeId,
      yoloMode: savedSession.yoloMode,
      thinkingMode: savedSession.thinkingMode,
      toolCallCounter: 0,
    });
    const session = this.sessions.get(params.sessionId)!;
    setTimeout(() => this.sendAvailableCommands(params.sessionId), 100);
    return {
      configOptions: this.buildConfigOptions(session),
      models: {
        availableModels: AVAILABLE_MODELS,
        currentModelId: savedSession.currentModelId,
      },
      modes: {
        availableModes: AVAILABLE_MODES,
        currentModeId: savedSession.currentModeId,
      },
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
      session.thinkingMode = (params.value as string) === "enabled";
    }

    // Handle yolo mode toggle
    if (params.configId === CONFIG_YOLO) {
      session.yoloMode = (params.value as string) === "enabled";
      // Sync with mode selector
      if (session.yoloMode && session.currentModeId !== "yolo") {
        session.currentModeId = "yolo";
      } else if (!session.yoloMode && session.currentModeId === "yolo") {
        session.currentModeId = "code";
      }
    }

    // Save session config to disk whenever it changes
    this.saveSessionToDisk(session);

    // Return ALL config options with current values
    return {
      configOptions: this.buildConfigOptions(session),
    };
  }

  private saveSessionToDisk(session: CrushSession): void {
    // Save session config to disk for persistence
    const savedSession: SavedSession = {
      id: session.id,
      workingDir: session.workingDir,
      currentModelId: session.currentModelId,
      currentModeId: session.currentModeId,
      yoloMode: session.yoloMode,
      thinkingMode: session.thinkingMode,
      updatedAt: new Date().toISOString(),
    };
    this.savedSessions.set(session.id, savedSession);
    saveSessions(this.savedSessions);
    console.error("[crush-acp] Session saved to disk:", session.id);
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
        description: "Enable extended thinking for better reasoning on complex tasks",
        type: "select",
        currentValue: session.thinkingMode ? "enabled" : "disabled",
        category: "behavior",
        options: [
          { value: "disabled", name: "Thinking: Off" },
          { value: "enabled", name: "Thinking: On" },
        ],
      },
      {
        id: CONFIG_YOLO,
        name: "Yolo",
        description: "Auto-accept all tool permissions without confirmation",
        type: "select",
        currentValue: session.yoloMode ? "enabled" : "disabled",
        category: "behavior",
        options: [
          { value: "disabled", name: "Yolo: Off" },
          { value: "enabled", name: "Yolo: On" },
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
      { name: "sessions", description: "List all saved sessions" },
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
      // AUTO-ROUTING: If prompt has images but model doesn't support vision, auto-switch
      let effectiveModelId = session.currentModelId;
      if (this.hasImages(params.prompt) && !this.isVisionModel(session.currentModelId)) {
        const bestVisionModel = this.findBestVisionModel();
        if (bestVisionModel) {
          effectiveModelId = bestVisionModel;
          console.warn(`[crush-acp] Image detected but model ${session.currentModelId} does not support vision. Auto-routing to ${bestVisionModel}`);
          // Notify Zed to update the model dropdown
          this.notifyConfigUpdate(session.id, { ...session, currentModelId: effectiveModelId });
        }
      }
      
      // Extract text content from the prompt
      const promptText = this.extractPromptText(params.prompt, effectiveModelId);
      if (promptText.startsWith("/")) {
        await this.handleCommand(session, promptText);
        return { stopReason: "end_turn" };
      }
      
      // Extract any file paths mentioned
      const filePaths = this.extractFilePaths(params.prompt, effectiveModelId);

      await this.runCrush(
        session,
        promptText,
        filePaths,
        abortSignal,
        effectiveModelId
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
      case "session":
        response = "To start a new session, use the + button in Zed's agent panel or close this tab and open a new chat.";
        break;
      case "sessions": {
        const allSessions = Array.from(this.savedSessions.values());
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
    const visionKeywords = [
      "vision", "gpt-4o", "gpt-4-turbo", "gpt-4g", "o1", "o3", "o4",
      "claude-3.5", "claude-4", "gemini", "pixtral", "qwen-vl",
      "glm-4v", "glm-4.5v", "glm-4.6v", "4.5v", "4.6v", "4v",
    ];
    const lowerModel = modelId.toLowerCase();
    return visionKeywords.some(keyword => lowerModel.includes(keyword));
  }

  /**
   * Check if prompt contains image content
   */
  private hasImages(prompt: Array<acp.ContentBlock>): boolean {
    return prompt.some(block => block.type === "image");
  }

  /**
   * Find the best available vision model from the model list
   * Prefers models in order: GLM-4.6V > GLM-4.5V > GPT-4o > Claude > Gemini > others
   */
  private findBestVisionModel(): string | null {
    const visionPriority = [
      "glm-4.6v",    // Highest priority - latest GLM vision
      "glm-4.5v",
      "glm-4v",
      "gpt-4o",      // OpenAI vision
      "claude-3.5",  // Anthropic vision
      "claude-4",
      "gemini",      // Google vision
      "pixtral",
      "qwen-vl",
    ];

    for (const keyword of visionPriority) {
      const found = AVAILABLE_MODELS.find(m => 
        m.modelId.toLowerCase().includes(keyword)
      );
      if (found) {
        return found.modelId;
      }
    }

    // Fallback: return first available vision model
    const anyVision = AVAILABLE_MODELS.find(m => this.isVisionModel(m.modelId));
    return anyVision?.modelId || null;
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
    abortSignal: AbortSignal,
    effectiveModelId?: string
  ): Promise<void> {
    const modelId = effectiveModelId || session.currentModelId;
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
        "-m", modelId,
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

      // Debug: log what we're about to spawn
      console.error("[crush-acp] Spawning crush with args:", JSON.stringify(args));
      console.error("[crush-acp] Working dir:", session.workingDir);
      console.error("[crush-acp] Prompt length:", finalPrompt.length);
      console.error("[crush-acp] Data dir:", CRUSH_DATA_DIR);
      
      // Clean up WAL/SHM files only (prevents corruption on Windows)
      // Keep crush.db intact so --session continuation works
      try {
        const walFiles = ["crush.db-wal", "crush.db-shm"];
        for (const f of walFiles) {
          const p = join(CRUSH_DATA_DIR, f);
          if (existsSync(p)) {
            unlinkSync(p);
            console.error("[crush-acp] Cleaned up WAL:", p);
          }
        }
      } catch (e) {
        console.error("[crush-acp] WAL cleanup warning:", e);
      }
      
      // Use isolated data directory for Zed (avoids conflicts with TUI crush)
      // Use --session to continue previous conversation if we have a crush session ID
      const savedSession = this.savedSessions.get(session.id);
      let crushArgs: string[];
      if (savedSession?.crushSessionId) {
        // Continue existing crush session
        crushArgs = ["--data-dir", CRUSH_DATA_DIR, ...args, "--session", savedSession.crushSessionId, finalPrompt];
        console.error("[crush-acp] Continuing crush session:", savedSession.crushSessionId);
      } else {
        // Fresh session
        crushArgs = ["--data-dir", CRUSH_DATA_DIR, ...args, finalPrompt];
        console.error("[crush-acp] Starting fresh crush session");
      }
      const child = spawn("crush", crushArgs, {
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
        console.error("[crush-acp] Process CLOSE - code:", code);
        console.error("[crush-acp] Full output:", outputBuffer);
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
          // Capture crush session ID for continuation
          const crushSid = extractLatestCrushSessionId();
          if (crushSid) {
            const saved = this.savedSessions.get(session.id);
            if (saved) {
              saved.crushSessionId = crushSid;
              this.savedSessions.set(session.id, saved);
              saveSessions(this.savedSessions);
              console.error("[crush-acp] Saved crush session ID:", crushSid);
            }
          }

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
