import { execSync } from "node:child_process";
import * as acp from "@agentclientprotocol/sdk";
import { getProvidersWithKeys } from "./config.js";

export function fetchAvailableModels(): acp.ModelInfo[] {
  try {
    const output = execSync("crush models", { encoding: "utf-8", timeout: 10000 });
    const lines = output.trim().split("\n").filter(Boolean);

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
        const isFree = provider === "opencode-go" || provider === "opencode-go-minimax";

        let description = `${provider}/${modelName}`;
        if (isVision) description += " 👁️ Vision";
        if (isFlash) description += " ⚡ Fast";
        if (isThinking) description += " 🧠 Thinking";
        if (isFree) description += " 🆓 Free";

        return { modelId, name: `${provider}/${modelName}`, description };
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

export const AVAILABLE_MODELS = fetchAvailableModels();

export function isVisionModel(modelId: string): boolean {
  const visionKeywords = [
    "vision", "gpt-4o", "gpt-4-turbo", "gpt-4g", "o1", "o3", "o4",
    "claude-3.5", "claude-4", "gemini", "pixtral", "qwen-vl",
    "glm-4v", "glm-4.5v", "glm-4.6v", "4.5v", "4.6v", "4v",
  ];
  const lowerModel = modelId.toLowerCase();
  return visionKeywords.some(keyword => lowerModel.includes(keyword));
}

export function findBestVisionModel(availableModels: acp.ModelInfo[]): string | null {
  const visionPriority = [
    "glm-4.6v", "glm-4.5v", "glm-4v",
    "gpt-4o", "claude-3.5", "claude-4",
    "gemini", "pixtral", "qwen-vl",
  ];

  for (const keyword of visionPriority) {
    const found = availableModels.find(m =>
      m.modelId.toLowerCase().includes(keyword)
    );
    if (found) return found.modelId;
  }

  const anyVision = availableModels.find(m => isVisionModel(m.modelId));
  return anyVision?.modelId || null;
}
