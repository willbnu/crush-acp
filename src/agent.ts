import { randomUUID } from "node:crypto";
import * as acp from "@agentclientprotocol/sdk";
import { CrushSession, SavedSession } from "./types.js";
import {
  CONFIG_MODE, CONFIG_MODEL, CONFIG_THINKING, CONFIG_YOLO,
  DEFAULT_MODEL_ID, DEFAULT_MODE_ID, AVAILABLE_MODES, VERSION,
} from "./constants.js";
import { isVisionModel, findBestVisionModel, AVAILABLE_MODELS } from "./models.js";
import { loadSavedSessions, saveSessions, sessionToInfo } from "./sessions.js";
import { handleCommand } from "./commands.js";
import { runCrush, extractPromptText, extractFilePaths, hasImages } from "./runner.js";

export class CrushAgent implements acp.Agent {
  private connection: acp.AgentSideConnection;
  private sessions: Map<string, CrushSession> = new Map();
  private savedSessions: Map<string, SavedSession> = new Map();

  constructor(connection: acp.AgentSideConnection) {
    this.connection = connection;
    this.savedSessions = loadSavedSessions();
  }

  async initialize(params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image: true, audio: false, embeddedContext: true },
        sessionCapabilities: { fork: {}, list: {}, resume: {} },
      },
      agentInfo: { name: "crush-acp", title: "Crush", version: VERSION },
    };
  }

  async authenticate(params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse | void> {
    return {};
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    const sessionId = randomUUID();
    const workingDir = params.cwd || process.cwd();

    this.sessions.set(sessionId, {
      id: sessionId, workingDir, pendingPrompt: null, process: null,
      currentModelId: DEFAULT_MODEL_ID, currentModeId: DEFAULT_MODE_ID,
      yoloMode: false, thinkingMode: false, toolCallCounter: 0,
    });

    const session = this.sessions.get(sessionId)!;
    this.savedSessions.set(sessionId, {
      id: sessionId, workingDir: session.workingDir,
      currentModelId: session.currentModelId, currentModeId: session.currentModeId,
      yoloMode: false, thinkingMode: false, updatedAt: new Date().toISOString(),
    });
    saveSessions(this.savedSessions);

    setTimeout(() => this.sendAvailableCommands(sessionId), 100);

    return {
      sessionId,
      models: { availableModels: AVAILABLE_MODELS, currentModelId: DEFAULT_MODEL_ID },
      modes: { availableModes: AVAILABLE_MODES, currentModeId: DEFAULT_MODE_ID },
      configOptions: this.buildConfigOptions(session),
    };
  }

  async listSessions(_params: acp.ListSessionsRequest): Promise<acp.ListSessionsResponse> {
    const sessions = Array.from(this.savedSessions.values()).map(sessionToInfo);
    return { sessions };
  }

  async unstable_resumeSession(params: acp.ResumeSessionRequest): Promise<acp.ResumeSessionResponse> {
    const savedSession = this.savedSessions.get(params.sessionId);
    if (!savedSession) throw new Error("Session " + params.sessionId + " not found");

    this.sessions.set(params.sessionId, {
      id: params.sessionId, workingDir: savedSession.workingDir,
      pendingPrompt: null, process: null,
      currentModelId: savedSession.currentModelId, currentModeId: savedSession.currentModeId,
      yoloMode: savedSession.yoloMode, thinkingMode: savedSession.thinkingMode, toolCallCounter: 0,
    });

    setTimeout(() => this.sendAvailableCommands(params.sessionId), 100);

    const session = this.sessions.get(params.sessionId)!;
    return {
      configOptions: this.buildConfigOptions(session),
      models: { availableModels: AVAILABLE_MODELS, currentModelId: savedSession.currentModelId },
      modes: { availableModes: AVAILABLE_MODES, currentModeId: savedSession.currentModeId },
    };
  }

  async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    throw acp.RequestError.methodNotFound("session/load");
  }

  async setSessionMode(params: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse | void> {
    const session = this.sessions.get(params.sessionId);
    if (session) {
      session.currentModeId = params.modeId;
      if (params.modeId === "yolo") {
        session.yoloMode = true;
        this.notifyConfigUpdate(params.sessionId, session);
      } else if (session.currentModeId === "yolo") {
        session.yoloMode = false;
        this.notifyConfigUpdate(params.sessionId, session);
      }
      this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: { sessionUpdate: "current_mode_update", currentModeId: params.modeId },
      }).catch(console.error);
    }
    return {};
  }

  async setSessionConfigOption(params: acp.SetSessionConfigOptionRequest): Promise<acp.SetSessionConfigOptionResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw acp.RequestError.invalidParams(`Session ${params.sessionId} not found`);

    if (params.configId === CONFIG_MODE) {
      const newModeId = params.value as string;
      if (AVAILABLE_MODES.some(m => m.id === newModeId)) {
        const oldModeId = session.currentModeId;
        session.currentModeId = newModeId;
        if (newModeId === "yolo") session.yoloMode = true;
        else if (oldModeId === "yolo") session.yoloMode = false;
        this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: { sessionUpdate: "current_mode_update", currentModeId: newModeId },
        }).catch(console.error);
      }
    }

    if (params.configId === CONFIG_MODEL) {
      const newModelId = params.value as string;
      if (AVAILABLE_MODELS.some(m => m.modelId === newModelId)) session.currentModelId = newModelId;
    }

    if (params.configId === CONFIG_THINKING) session.thinkingMode = (params.value as string) === "enabled";

    if (params.configId === CONFIG_YOLO) {
      session.yoloMode = (params.value as string) === "enabled";
      if (session.yoloMode && session.currentModeId !== "yolo") session.currentModeId = "yolo";
      else if (!session.yoloMode && session.currentModeId === "yolo") session.currentModeId = "code";
    }

    this.saveSessionToDisk(session);
    return { configOptions: this.buildConfigOptions(session) };
  }

  async unstable_setSessionModel(params: acp.SetSessionModelRequest): Promise<acp.SetSessionModelResponse | void> {
    const session = this.sessions.get(params.sessionId);
    if (session) session.currentModelId = params.modelId;
    return {};
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw acp.RequestError.invalidParams(`Session ${params.sessionId} not found`);

    session.pendingPrompt?.abort();
    session.pendingPrompt = new AbortController();
    const abortSignal = session.pendingPrompt.signal;

    try {
      let effectiveModelId = session.currentModelId;
      if (hasImages(params.prompt) && !isVisionModel(session.currentModelId)) {
        const bestVisionModel = findBestVisionModel(AVAILABLE_MODELS);
        if (bestVisionModel) {
          effectiveModelId = bestVisionModel;
          this.notifyConfigUpdate(session.id, { ...session, currentModelId: effectiveModelId });
        }
      }

      const promptText = extractPromptText(params.prompt, effectiveModelId);
      if (promptText.startsWith("/")) {
        await handleCommand({
          session,
          savedSessions: this.savedSessions,
          notifyConfigUpdate: (sid, s) => this.notifyConfigUpdate(sid, s),
          sendUpdate: (sid, text) => this.sendTextUpdate(sid, text),
        }, promptText);
        return { stopReason: "end_turn" };
      }

      const filePaths = extractFilePaths(params.prompt, effectiveModelId);

      await runCrush(
        { session, connection: this.connection, savedSessions: this.savedSessions, saveSessions, generateTitle: this.generateSessionTitle.bind(this), sendToolCallUpdate: this.sendToolCallUpdate.bind(this) },
        promptText, filePaths, abortSignal, effectiveModelId,
      );
    } catch (err) {
      if (abortSignal.aborted) return { stopReason: "cancelled" };
      throw err;
    } finally {
      session.pendingPrompt = null;
    }

    return { stopReason: "end_turn" };
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (session) {
      session.pendingPrompt?.abort();
      if (session.process) { session.process.kill("SIGTERM"); session.process = null; }
    }
  }

  // --- Helpers ---

  private buildConfigOptions(session: CrushSession): acp.SessionConfigOption[] {
    return [
      { id: CONFIG_MODE, name: "Mode", description: "Session operating mode", type: "select", currentValue: session.currentModeId, category: "mode", options: AVAILABLE_MODES.map(m => ({ value: m.id, name: m.name, description: m.description })) },
      { id: CONFIG_MODEL, name: "Model", description: "AI model to use", type: "select", currentValue: session.currentModelId, category: "model", options: AVAILABLE_MODELS.map(m => ({ value: m.modelId, name: m.name, description: m.description })) },
      { id: CONFIG_THINKING, name: "Thinking", description: "Enable extended thinking", type: "select", currentValue: session.thinkingMode ? "enabled" : "disabled", category: "behavior", options: [{ value: "disabled", name: "Thinking: Off" }, { value: "enabled", name: "Thinking: On" }] },
      { id: CONFIG_YOLO, name: "Yolo", description: "Auto-accept all permissions", type: "select", currentValue: session.yoloMode ? "enabled" : "disabled", category: "behavior", options: [{ value: "disabled", name: "Yolo: Off" }, { value: "enabled", name: "Yolo: On" }] },
    ];
  }

  private notifyConfigUpdate(sessionId: string, session: CrushSession): void {
    this.connection.sessionUpdate({ sessionId, update: { sessionUpdate: "config_option_update", configOptions: this.buildConfigOptions(session) } }).catch(console.error);
  }

  private saveSessionToDisk(session: CrushSession): void {
    this.savedSessions.set(session.id, {
      id: session.id, workingDir: session.workingDir,
      currentModelId: session.currentModelId, currentModeId: session.currentModeId,
      yoloMode: session.yoloMode, thinkingMode: session.thinkingMode,
      updatedAt: new Date().toISOString(),
    });
    saveSessions(this.savedSessions);
  }

  private sendToolCallUpdate(sessionId: string, toolCallId: string, status: acp.ToolCallStatus, output: string): void {
    this.connection.sessionUpdate({ sessionId, update: { sessionUpdate: "tool_call_update", toolCallId, status, rawOutput: output.slice(0, 1000) } }).catch(console.error);
  }

  private async sendTextUpdate(sessionId: string, text: string): Promise<void> {
    await this.connection.sessionUpdate({ sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
  }

  private sendAvailableCommands(sessionId: string): void {
    const commands: acp.AvailableCommand[] = [
      { name: "new", description: "Start a fresh conversation session" },
      { name: "sessions", description: "List all saved sessions" },
      { name: "compact", description: "Summarize session to save context space" },
      { name: "export", description: "Export session transcript to file" },
      { name: "status", description: "Show current session info and settings" },
      { name: "model", description: "Switch AI model" },
      { name: "mode", description: "Switch mode (code, ask, architect, yolo)" },
      { name: "thinking", description: "Toggle extended thinking mode" },
      { name: "yolo", description: "Toggle auto-accept all permissions" },
      { name: "models", description: "List all available AI models" },
      { name: "init", description: "Generate AGENTS.md from codebase analysis" },
      { name: "review", description: "Review git changes or uncommitted code" },
      { name: "logs", description: "View crush logs" },
      { name: "projects", description: "List project directories" },
      { name: "stats", description: "Show token usage statistics" },
      { name: "dirs", description: "Show crush data and config directories" },
      { name: "help", description: "Show all available commands" },
    ];
    this.connection.sessionUpdate({ sessionId, update: { sessionUpdate: "available_commands_update", availableCommands: commands } }).catch(console.error);
  }

  private generateSessionTitle(prompt: string): string {
    const firstLine = prompt.split("\n")[0];
    return firstLine.length <= 50 ? firstLine : firstLine.slice(0, 47) + "...";
  }
}
