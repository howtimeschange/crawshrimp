import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com";

export function loadEnvFiles(cwd = process.cwd(), fileNames = [".env.local", ".env"]) {
  for (const fileName of fileNames) {
    const filePath = resolve(cwd, fileName);

    if (!existsSync(filePath)) {
      continue;
    }

    const source = readFileSync(filePath, "utf8");
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

export function getArkConfig(env = process.env) {
  const apiKey = env.ARK_API_KEY || env.VOLCENGINE_ARK_API_KEY;

  if (!apiKey) {
    throw new Error("Missing ARK_API_KEY. Put it in .env.local or export it before running.");
  }

  return {
    apiKey,
    baseUrl: env.ARK_BASE_URL || DEFAULT_BASE_URL
  };
}
