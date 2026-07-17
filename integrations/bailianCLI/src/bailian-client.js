import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DEFAULT_BAILIAN_REGION, buildBailianBaseUrl } from "./config.js";

const VIDEO_SYNTHESIS_PATH = "/services/aigc/video-generation/video-synthesis";
const TASKS_PATH = "/tasks";
const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELED", "UNKNOWN"]);
const RESOLUTIONS = new Set(["720P", "1080P"]);
const RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "5:4", "9:21", "21:9"]);
const KLING_MODES = new Set(["std", "pro"]);
const KLING_ASPECT_RATIOS = new Set(["16:9", "9:16", "1:1"]);
const PIXVERSE_RESOLUTIONS = new Set(["360P", "540P", "720P"]);
const BAILIAN_GATEWAY_MODELS = new Set([
  "kling/kling-v3-video-generation",
  "kling/kling-v3-omni-video-generation",
  "pixverse/pixverse-motioncontrol"
]);

export class BailianApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "BailianApiError";
    this.status = status;
    this.body = body;
  }
}

export class BailianVideoGenerationClient {
  constructor({
    apiKey,
    baseUrl,
    workspaceId,
    region = DEFAULT_BAILIAN_REGION,
    fetchImpl = globalThis.fetch
  } = {}) {
    if (!apiKey) throw new Error("apiKey is required.");
    if (!fetchImpl) {
      throw new Error("fetch is not available. Use Node.js 18+ or pass fetchImpl.");
    }

    this.apiKey = apiKey;
    this.baseUrl = normalizeBailianBaseUrl(
      baseUrl || buildBailianBaseUrl({ workspaceId, region })
    );
    this.fetch = fetchImpl;
  }

  async createVideoTask(payload) {
    validateBailianTaskPayload(payload);
    const headers = { "X-DashScope-Async": "enable" };
    if (payloadContainsBailianOssUrl(payload)) {
      headers["X-DashScope-OssResourceResolve"] = "enable";
    }
    return this.#request(VIDEO_SYNTHESIS_PATH, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  }

  async getVideoTask(taskId) {
    const id = normalizeTaskId(taskId);
    return this.#request(`${TASKS_PATH}/${encodeURIComponent(id)}`, { method: "GET" });
  }

  async pollVideoTask(taskId, options = {}) {
    const intervalMs = options.intervalMs ?? 5000;
    const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
    const startedAt = Date.now();
    let lastTask;

    while (Date.now() - startedAt <= timeoutMs) {
      lastTask = await this.getVideoTask(taskId);
      options.onUpdate?.(lastTask);
      if (isBailianTerminalStatus(getBailianTaskStatus(lastTask))) return lastTask;
      await sleep(intervalMs);
    }

    throw new BailianApiError(`Timed out waiting for task ${taskId}.`, { body: lastTask });
  }

  async #request(path, init) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...init.headers
      }
    });

    const rawBody = await response.text();
    const body = parseJsonBody(rawBody);
    if (!response.ok) {
      const detail = formatErrorBody(body ?? rawBody);
      throw new BailianApiError(`Bailian API request failed with HTTP ${response.status}: ${detail}`, {
        status: response.status,
        body: body ?? rawBody
      });
    }
    if (body?.code) {
      throw new BailianApiError(`Bailian API request failed: ${body.code}: ${body.message ?? ""}`, {
        body
      });
    }
    return body;
  }
}

export async function downloadFile(url, outputPath, { fetchImpl = globalThis.fetch } = {}) {
  if (!url) throw new Error("download url is required.");
  if (!outputPath) throw new Error("outputPath is required.");

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new BailianApiError(`Download failed with HTTP ${response.status}.`, {
      status: response.status,
      body: await response.text()
    });
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
}

export function getBailianTaskId(response) {
  const taskId = response?.output?.task_id;
  if (!taskId || typeof taskId !== "string") {
    throw new Error("Bailian response did not include output.task_id.");
  }
  return taskId;
}

export function getBailianTaskStatus(response) {
  return response?.output?.task_status;
}

export function getBailianVideoUrl(response) {
  return response?.output?.video_url;
}

export function isBailianTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

export function validateBailianTaskPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("payload must be an object.");
  }
  if (!payload.model || typeof payload.model !== "string") {
    throw new Error("payload.model must be a non-empty string.");
  }
  if (!payload.input || typeof payload.input !== "object" || Array.isArray(payload.input)) {
    throw new Error("payload.input must be an object.");
  }

  const mode = getHappyHorseMode(payload.model);
  if (!mode) {
    if (!BAILIAN_GATEWAY_MODELS.has(payload.model)) {
      throw new Error(
        "payload.model must be a supported HappyHorse or Bailian gateway video model."
      );
    }
    if (payload.model === "pixverse/pixverse-motioncontrol") {
      validatePixVersePayload(payload);
      return;
    }
    validateKlingPayload(payload);
    return;
  }

  validateHappyHorseParameters(payload.parameters, mode);
  if (mode === "t2v") {
    validatePrompt(payload.input.prompt, "payload.input.prompt is required for text-to-video.");
    return;
  }
  if (mode === "i2v") {
    validateMedia(payload.input.media, {
      requiredType: "first_frame",
      minItems: 1,
      maxItems: 1,
      label: "image-to-video first frame"
    });
    return;
  }

  validatePrompt(payload.input.prompt, "payload.input.prompt is required for reference-to-video.");
  validateMedia(payload.input.media, {
    requiredType: "reference_image",
    minItems: 1,
    maxItems: 9,
    label: "reference-to-video images"
  });
}

function getHappyHorseMode(model) {
  const match = /^happyhorse-\d+\.\d+-(t2v|i2v|r2v)$/.exec(model);
  return match?.[1];
}

function normalizeBailianBaseUrl(baseUrl) {
  const normalized = String(baseUrl || "").replace(/\/+$/, "");
  return /\/api\/v1$/i.test(normalized) ? normalized : `${normalized}/api/v1`;
}

function validateHappyHorseParameters(parameters, mode) {
  if (parameters === undefined) return;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new Error("payload.parameters must be an object when provided.");
  }
  if (parameters.resolution !== undefined && !RESOLUTIONS.has(parameters.resolution)) {
    throw new Error("payload.parameters.resolution must be 720P or 1080P.");
  }
  if (parameters.duration !== undefined) {
    if (!Number.isInteger(parameters.duration) || parameters.duration < 3 || parameters.duration > 15) {
      throw new Error("payload.parameters.duration must be an integer from 3 to 15.");
    }
  }
  if (parameters.watermark !== undefined && typeof parameters.watermark !== "boolean") {
    throw new Error("payload.parameters.watermark must be a boolean.");
  }
  if (parameters.ratio !== undefined) {
    if (mode === "i2v") {
      throw new Error("HappyHorse image-to-video does not support payload.parameters.ratio.");
    }
    if (!RATIOS.has(parameters.ratio)) {
      throw new Error("payload.parameters.ratio is not supported by HappyHorse.");
    }
  }
}

function validateKlingPayload(payload) {
  if (!hasNonEmptyPrompt(payload.input.prompt) && !Array.isArray(payload.input.media)) {
    throw new Error("payload.input.prompt or payload.input.media is required for Kling video models.");
  }
  if (payload.input.media !== undefined) {
    validateKlingMedia(payload.input.media, payload.model);
  }
  const parameters = payload.parameters;
  if (parameters === undefined) return;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new Error("payload.parameters must be an object when provided.");
  }
  if (parameters.mode !== undefined && !KLING_MODES.has(parameters.mode)) {
    throw new Error("payload.parameters.mode must be std or pro for Kling models.");
  }
  if (parameters.aspect_ratio !== undefined && !KLING_ASPECT_RATIOS.has(parameters.aspect_ratio)) {
    throw new Error("payload.parameters.aspect_ratio must be 16:9, 9:16, or 1:1 for Kling models.");
  }
  if (!Array.isArray(payload.input.media) && parameters.aspect_ratio === undefined) {
    throw new Error("payload.parameters.aspect_ratio is required for Kling text-to-video.");
  }
  if (parameters.duration !== undefined) {
    if (!Number.isInteger(parameters.duration) || parameters.duration < 3 || parameters.duration > 15) {
      throw new Error("payload.parameters.duration must be an integer from 3 to 15 for Kling models.");
    }
  }
  if (parameters.audio !== undefined && typeof parameters.audio !== "boolean") {
    throw new Error("payload.parameters.audio must be a boolean for Kling models.");
  }
  if (parameters.watermark !== undefined && typeof parameters.watermark !== "boolean") {
    throw new Error("payload.parameters.watermark must be a boolean.");
  }
}

function validateKlingMedia(media, model) {
  if (!Array.isArray(media)) {
    throw new Error("payload.input.media must be an array for Kling media input.");
  }
  if (!media.length) {
    throw new Error("payload.input.media cannot be empty for Kling media input.");
  }
  const allowedTypes = model === "kling/kling-v3-video-generation"
    ? new Set(["first_frame", "last_frame"])
    : new Set(["first_frame", "last_frame", "refer", "feature", "base"]);
  let firstFrames = 0;
  let lastFrames = 0;
  let baseVideos = 0;
  let featureVideos = 0;
  for (const [index, item] of media.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`payload.input.media[${index}] must be an object.`);
    }
    if (!allowedTypes.has(item.type)) {
      throw new Error(`payload.input.media[${index}].type is not supported by ${model}.`);
    }
    if (!isProviderMediaUrl(item.url)) {
      throw new Error(`payload.input.media[${index}].url must be an http(s) URL or oss:// URL.`);
    }
    if (item.type === "first_frame") firstFrames += 1;
    if (item.type === "last_frame") lastFrames += 1;
    if (item.type === "base") baseVideos += 1;
    if (item.type === "feature") featureVideos += 1;
  }
  if (lastFrames && firstFrames !== 1) {
    throw new Error("Kling last_frame requires exactly one first_frame.");
  }
  if (firstFrames > 1 || lastFrames > 1 || baseVideos > 1 || featureVideos > 1) {
    throw new Error("Kling first_frame, last_frame, base, and feature media are limited to one each.");
  }
}

function validatePixVersePayload(payload) {
  const media = payload.input.media;
  if (!Array.isArray(media) || media.length !== 2) {
    throw new Error("payload.input.media must include exactly one image_url and one video_url for PixVerse.");
  }
  const imageItems = media.filter((item) => item?.type === "image_url");
  const videoItems = media.filter((item) => item?.type === "video_url");
  if (imageItems.length !== 1 || videoItems.length !== 1) {
    throw new Error("PixVerse requires exactly one image_url and one video_url media item.");
  }
  for (const [index, item] of media.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`payload.input.media[${index}] must be an object.`);
    }
    if (!isProviderMediaUrl(item.url)) {
      throw new Error(`payload.input.media[${index}].url must be an http(s) URL or oss:// URL.`);
    }
  }
  const parameters = payload.parameters;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new Error("payload.parameters must be an object for PixVerse.");
  }
  if (!PIXVERSE_RESOLUTIONS.has(parameters.resolution)) {
    throw new Error("payload.parameters.resolution must be 360P, 540P, or 720P for PixVerse.");
  }
  if (parameters.watermark !== undefined && typeof parameters.watermark !== "boolean") {
    throw new Error("payload.parameters.watermark must be a boolean.");
  }
}

function validatePrompt(prompt, message) {
  if (!prompt || typeof prompt !== "string") throw new Error(message);
}

function hasNonEmptyPrompt(prompt) {
  return typeof prompt === "string" && prompt.trim().length > 0;
}

function isHttpUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isBailianOssUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "oss:" && Boolean(parsed.hostname) && parsed.pathname.length > 1;
  } catch {
    return false;
  }
}

function isProviderMediaUrl(url) {
  return isHttpUrl(url) || isBailianOssUrl(url);
}

function payloadContainsBailianOssUrl(value) {
  if (typeof value === "string") return isBailianOssUrl(value);
  if (Array.isArray(value)) return value.some((item) => payloadContainsBailianOssUrl(item));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => payloadContainsBailianOssUrl(item));
  }
  return false;
}

function validateMedia(media, { requiredType, minItems, maxItems, label }) {
  if (!Array.isArray(media)) {
    throw new Error(`payload.input.media must be an array for ${label}.`);
  }
  if (media.length < minItems || media.length > maxItems) {
    const expected = minItems === maxItems ? minItems : `${minItems}-${maxItems}`;
    throw new Error(`payload.input.media must include ${expected} item(s) for ${label}.`);
  }
  for (const [index, item] of media.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`payload.input.media[${index}] must be an object.`);
    }
    if (item.type !== requiredType) {
      throw new Error(`payload.input.media[${index}].type must be ${requiredType}.`);
    }
    if (!item.url || typeof item.url !== "string") {
      throw new Error(`payload.input.media[${index}].url must be a non-empty string.`);
    }
  }
}

function normalizeTaskId(taskId) {
  if (!taskId || typeof taskId !== "string" || !taskId.trim()) {
    throw new Error("taskId must be a non-empty string.");
  }
  return taskId.trim();
}

function parseJsonBody(rawBody) {
  if (!rawBody) return null;
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

function formatErrorBody(body) {
  if (!body) return "empty response body";
  if (typeof body === "string") return body.slice(0, 500);
  return JSON.stringify(body).slice(0, 500);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
