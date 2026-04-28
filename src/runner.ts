import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import { CrushSession } from "./types.js";
import { CRUSH_DATA_DIR } from "./constants.js";
import { isVisionModel } from "./models.js";
import { extractLatestCrushSessionId } from "./sessions.js";

interface RunnerContext {
  session: CrushSession;
  connection: acp.AgentSideConnection;
  savedSessions: Map<string, any>;
  saveSessions: (sessions: Map<string, any>) => void;
  generateTitle: (prompt: string) => string;
  sendToolCallUpdate: (sessionId: string, toolCallId: string, status: acp.ToolCallStatus, output: string) => void;
}

export function extractPromptText(prompt: Array<acp.ContentBlock>, modelId: string): string {
  const supportsVision = isVisionModel(modelId);

  return prompt
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "image") {
        if (supportsVision) {
          return `[Image: ${block.mimeType}, ${block.data.length} bytes base64]`;
        }
        console.warn(`[crush-acp] Image skipped: model ${modelId} does not support vision`);
        return "[Image skipped - model does not support images]";
      }
      if (block.type === "resource") {
        if ("text" in block.resource) {
          return `\n[File: ${block.resource.uri}]\n${block.resource.text}`;
        }
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function extractFilePaths(prompt: Array<acp.ContentBlock>, modelId: string): string[] {
  const paths: string[] = [];
  const isVision = isVisionModel(modelId);
  const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg"];

  for (const block of prompt) {
    if (block.type === "resource_link") {
      if (block.uri && typeof block.uri === "string") {
        const path = block.uri.replace(/^file:\/\//, "");
        const isImage = imageExtensions.some(ext => path.toLowerCase().endsWith(ext));
        if (isVision || !isImage) {
          paths.push(path);
        }
      }
    }
  }

  return paths;
}

export function hasImages(prompt: Array<acp.ContentBlock>): boolean {
  return prompt.some(block => block.type === "image");
}

function cleanWalFiles(): void {
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
}

function buildModePrompt(modeId: string): string {
  switch (modeId) {
    case "ask": return "[Mode: Ask - Answer questions only, do not modify files]\n\n";
    case "architect": return "[Mode: Architect - Plan and design, do not implement]\n\n";
    case "yolo": return "[Mode: Yolo - Auto-accept all permissions, making changes freely]\n\n";
    default: return "";
  }
}

export async function runCrush(ctx: RunnerContext, prompt: string, contextPaths: string[], abortSignal: AbortSignal, effectiveModelId?: string): Promise<void> {
  const { session, connection, savedSessions, saveSessions, generateTitle, sendToolCallUpdate } = ctx;
  const modelId = effectiveModelId || session.currentModelId;

  return new Promise((resolve, reject) => {
    const isVisionFilter = isVisionModel(session.currentModelId);
    const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg"];
    let userPrompt = prompt;
    if (!isVisionFilter) {
      for (const ext of imageExts) {
        const re = new RegExp(`@\\S*${ext.replace(".", "\\.")}(\s|$)`, "gi");
        userPrompt = userPrompt.replace(re, " ");
      }
      userPrompt = userPrompt.replace(/\s+/g, " ").trim();
    }

    let fullPrompt = userPrompt;
    if (contextPaths.length > 0) {
      const contextSection = contextPaths.map(p => `@${p}`).join(" ");
      fullPrompt = `${contextSection}\n\n${userPrompt}`;
    }

    const args = ["run", "--quiet", "-m", modelId];
    const modePrompt = buildModePrompt(session.currentModeId);
    const finalPrompt = modePrompt + fullPrompt;

    console.error("[crush-acp] Spawning crush with args:", JSON.stringify(args));
    console.error("[crush-acp] Working dir:", session.workingDir);
    console.error("[crush-acp] Prompt length:", finalPrompt.length);
    console.error("[crush-acp] Data dir:", CRUSH_DATA_DIR);

    cleanWalFiles();

    const savedSession = savedSessions.get(session.id);
    let crushArgs: string[];
    if (savedSession?.crushSessionId) {
      crushArgs = ["--data-dir", CRUSH_DATA_DIR, ...args, "--session", savedSession.crushSessionId, finalPrompt];
      console.error("[crush-acp] Continuing crush session:", savedSession.crushSessionId);
    } else {
      crushArgs = ["--data-dir", CRUSH_DATA_DIR, ...args, finalPrompt];
      console.error("[crush-acp] Starting fresh crush session");
    }

    const child = spawn("crush", crushArgs, {
      cwd: session.workingDir,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    session.process = child;

    let outputBuffer = "";
    let pendingToolCall: { id: string; title: string; startTime: number } | null = null;

    const toolCallPatterns = [
      { regex: /Running:\s*(.+)/, kind: "execute" as const },
      { regex: /Reading:\s*(.+)/, kind: "read" as const },
      { regex: /Editing:\s*(.+)/, kind: "edit" as const },
      { regex: /Searching:\s*(.+)/, kind: "search" as const },
      { regex: /Writing:\s*(.+)/, kind: "edit" as const },
      { regex: /Using tool:\s*(.+)/, kind: "other" as const },
    ];

    const thinkingPattern = /<(?:think|thinking|reasoning)>([\s\S]*?)<\/(?:think|thinking|reasoning)>/gi;

    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      outputBuffer += text;

      let thinkingMatch;
      while ((thinkingMatch = thinkingPattern.exec(text)) !== null) {
        connection.sessionUpdate({
          sessionId: session.id,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: thinkingMatch[1].trim() },
          },
        }).catch(console.error);
      }

      for (const { regex, kind } of toolCallPatterns) {
        const match = text.match(regex);
        if (match) {
          if (pendingToolCall) {
            sendToolCallUpdate(session.id, pendingToolCall.id, "completed", outputBuffer);
            pendingToolCall = null;
          }

          const toolCallId = `tool-${++session.toolCallCounter}`;
          const title = match[1].trim();
          pendingToolCall = { id: toolCallId, title, startTime: Date.now() };

          connection.sessionUpdate({
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

      if (pendingToolCall && (text.includes("Done") || text.includes("✓") || text.includes("✗"))) {
        sendToolCallUpdate(session.id, pendingToolCall.id, "completed", text);
        pendingToolCall = null;
      }

      connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      }).catch(console.error);
    });

    child.stderr?.on("data", (data: Buffer) => {
      console.error("[crush stderr]", data.toString());
    });

    child.on("close", (code) => {
      console.error("[crush-acp] Process CLOSE - code:", code);
      session.process = null;

      if (pendingToolCall) {
        sendToolCallUpdate(session.id, pendingToolCall.id, code === 0 ? "completed" : "failed", outputBuffer);
        pendingToolCall = null;
      }

      if (abortSignal.aborted) {
        reject(new Error("Cancelled"));
        return;
      }

      if (code === 0) {
        const crushSid = extractLatestCrushSessionId();
        if (crushSid) {
          const saved = savedSessions.get(session.id);
          if (saved) {
            saved.crushSessionId = crushSid;
            savedSessions.set(session.id, saved);
            saveSessions(savedSessions);
            console.error("[crush-acp] Saved crush session ID:", crushSid);
          }
        }

        connection.sessionUpdate({
          sessionId: session.id,
          update: {
            sessionUpdate: "session_info_update",
            title: generateTitle(prompt),
            updatedAt: new Date().toISOString(),
          },
        }).catch(console.error);

        resolve();
      } else {
        if (outputBuffer) {
          connection.sessionUpdate({
            sessionId: session.id,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: `\n\n[Process exited with code ${code}]` },
            },
          }).catch(console.error);
        }
        resolve();
      }
    });

    child.on("error", (err) => {
      session.process = null;

      if (pendingToolCall) {
        sendToolCallUpdate(session.id, pendingToolCall.id, "failed", err.message);
        pendingToolCall = null;
      }

      if (abortSignal.aborted) {
        reject(new Error("Cancelled"));
        return;
      }

      connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `Error running Crush: ${err.message}. Make sure Crush CLI is installed and in your PATH.` },
        },
      }).catch(console.error);

      resolve();
    });

    abortSignal.addEventListener("abort", () => {
      if (pendingToolCall) {
        sendToolCallUpdate(session.id, pendingToolCall.id, "failed", "Cancelled");
        pendingToolCall = null;
      }
      child.kill("SIGTERM");
    });
  });
}
