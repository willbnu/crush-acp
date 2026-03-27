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
  toolCallCounter: number;
}

// Fetch models dynamically from Crush CLI at startup
function fetchAvailableModels(): acp.ModelInfo[] {
  try {
    const output = execSync("crush models", { encoding: "utf-8", timeout: 5000 });
    const lines = output.trim().split("\n").filter(Boolean);
    
    return lines.map(line => {
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
];

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
        version: "0.2.0",
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
      toolCallCounter: 0,
    });

    return {
      sessionId,
      models: {
        availableModels: AVAILABLE_MODELS,
        currentModelId: DEFAULT_MODEL_ID,
      },
      modes: {
        availableModes: AVAILABLE_MODES,
        currentModeId: DEFAULT_MODE_ID,
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
      
      // Extract any file paths mentioned
      const filePaths = this.extractFilePaths(params.prompt);

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
    const visionKeywords = ["v", "vision", "4.5", "4.6", "4v", "glm-4"];
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
   */
  private extractFilePaths(prompt: Array<acp.ContentBlock>): string[] {
    const paths: string[] = [];
    
    for (const block of prompt) {
      if (block.type === "resource_link") {
        // resource_link has a uri property (file:// paths)
        if (block.uri && typeof block.uri === "string") {
          // Convert file:// URI to path
          const path = block.uri.replace(/^file:\/\//, "");
          paths.push(path);
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
      // Build the prompt with context files
      let fullPrompt = prompt;
      if (contextPaths.length > 0) {
        const contextSection = contextPaths
          .map((p) => `@${p}`)
          .join(" ");
        fullPrompt = `${contextSection}\n\n${prompt}`;
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
