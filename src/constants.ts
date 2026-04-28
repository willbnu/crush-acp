import { join } from "node:path";
import * as acp from "@agentclientprotocol/sdk";

const APPDATA = process.env.APPDATA || process.env.HOME || "";

export const SESSION_DIR = join(APPDATA, ".crush-acp", "sessions");
export const CRUSH_DATA_DIR = join(APPDATA, ".crush-acp", "zed-crush");
export const SESSION_FILE = join(SESSION_DIR, "sessions.json");

export const DEFAULT_MODEL_ID = "zai/glm-5.1";
export const DEFAULT_MODE_ID = "code";

export const CONFIG_MODE = "mode";
export const CONFIG_MODEL = "model";
export const CONFIG_THINKING = "thinking";
export const CONFIG_YOLO = "yolo";

export const AVAILABLE_MODES: acp.SessionMode[] = [
  { id: "code", name: "Code", description: "Full coding mode with file access and terminal" },
  { id: "ask", name: "Ask", description: "Ask questions without making changes" },
  { id: "architect", name: "Architect", description: "Plan and design without implementation" },
  { id: "yolo", name: "Yolo", description: "Auto-accept all permissions (dangerous mode)" },
];

export const VERSION = "0.5.1";
