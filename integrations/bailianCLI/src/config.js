import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_BAILIAN_REGION = "cn-beijing";

const LEGACY_BAILIAN_BASE_URLS = new Map([
  ["cn-beijing", "https://dashscope.aliyuncs.com"],
  ["ap-southeast-1", "https://dashscope-intl.aliyuncs.com"],
  ["us-east-1", "https://dashscope-us.aliyuncs.com"],
  ["us-virginia", "https://dashscope-us.aliyuncs.com"]
]);

export function loadEnvFiles(cwd = process.cwd(), fileNames = [".env.local", ".env"]) {
  for (const fileName of fileNames) {
    const filePath = resolve(cwd, fileName);
    if (!existsSync(filePath)) continue;

    const source = readFileSync(filePath, "utf8");
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function buildBailianBaseUrl({ workspaceId, region = DEFAULT_BAILIAN_REGION } = {}) {
  const normalizedRegion = normalizeRegion(region);
  const normalizedWorkspaceId = workspaceId?.trim();
  if (normalizedWorkspaceId) {
    return `https://${normalizedWorkspaceId}.${normalizedRegion}.maas.aliyuncs.com`;
  }

  const legacyBaseUrl = LEGACY_BAILIAN_BASE_URLS.get(normalizedRegion);
  if (legacyBaseUrl) return legacyBaseUrl;

  throw new Error(
    `BAILIAN_WORKSPACE_ID is required for Bailian region ${normalizedRegion}. ` +
      "Set BAILIAN_BASE_URL to override the endpoint explicitly."
  );
}

export function getBailianConfig(env = process.env) {
  const apiKey = env.DASHSCOPE_API_KEY || env.BAILIAN_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing DASHSCOPE_API_KEY. Put it in .env.local or export it before running."
    );
  }

  const region = env.BAILIAN_REGION || env.DASHSCOPE_REGION || DEFAULT_BAILIAN_REGION;
  const workspaceId = env.BAILIAN_WORKSPACE_ID || env.DASHSCOPE_WORKSPACE_ID;
  const baseUrl =
    env.BAILIAN_BASE_URL ||
    env.DASHSCOPE_BASE_URL ||
    buildBailianBaseUrl({ workspaceId, region });

  return {
    apiKey,
    baseUrl,
    region: normalizeRegion(region),
    workspaceId
  };
}

function normalizeRegion(region) {
  if (!region || typeof region !== "string") return DEFAULT_BAILIAN_REGION;
  return region.trim();
}
