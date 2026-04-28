import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as acp from "@agentclientprotocol/sdk";
import { SavedSession } from "./types.js";
import { SESSION_DIR, SESSION_FILE, CRUSH_DATA_DIR } from "./constants.js";

export function ensureSessionDir(): void {
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
  }
}

export function loadSavedSessions(): Map<string, SavedSession> {
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

export function saveSessions(sessions: Map<string, SavedSession>): void {
  try {
    ensureSessionDir();
    const data = JSON.stringify(Array.from(sessions.values()), null, 2);
    writeFileSync(SESSION_FILE, data, "utf-8");
  } catch (err) {
    console.error("[crush-acp] Failed to save sessions:", err);
  }
}

export function sessionToInfo(session: SavedSession): acp.SessionInfo {
  return {
    sessionId: session.id,
    cwd: session.workingDir,
    title: "Session " + session.id.slice(0, 8),
    updatedAt: session.updatedAt,
  };
}

export function extractLatestCrushSessionId(): string | undefined {
  try {
    const dbPath = join(CRUSH_DATA_DIR, "crush.db");
    if (!existsSync(dbPath)) return undefined;
    const buf = readFileSync(dbPath);
    const text = buf.toString("utf-8");
    const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
    if (!uuids || uuids.length === 0) return undefined;
    return uuids[uuids.length - 1];
  } catch (e) {
    console.error("[crush-acp] Failed to extract crush session ID:", e);
    return undefined;
  }
}
