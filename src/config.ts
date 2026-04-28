import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export function getProvidersWithKeys(): Set<string> {
  const configured = new Set<string>();
  try {
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
      const winPath = join(process.env.LOCALAPPDATA || "", "crush", "crush.json");
      if (existsSync(winPath)) configPath = winPath;
    }

    if (configPath) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.providers) {
        for (const [name, provider] of Object.entries(config.providers as Record<string, any>)) {
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
