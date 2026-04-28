import { ChildProcess } from "node:child_process";

export interface CrushSession {
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

export interface SavedSession {
  id: string;
  workingDir: string;
  currentModelId: string;
  currentModeId: string;
  yoloMode: boolean;
  thinkingMode: boolean;
  updatedAt: string;
  crushSessionId?: string;
}
