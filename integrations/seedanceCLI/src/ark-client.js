import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DEFAULT_BASE_URL } from "./config.js";

const TASKS_PATH = "/api/v3/contents/generations/tasks";
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "expired"]);

export class ArkApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "ArkApiError";
    this.status = status;
    this.body = body;
  }
}

export class ArkContentGenerationClient {
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch } = {}) {
    if (!apiKey) {
      throw new Error("apiKey is required.");
    }

    if (!fetchImpl) {
      throw new Error("fetch is not available. Use Node.js 18+ or pass fetchImpl.");
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetch = fetchImpl;
  }

  async createVideoTask(payload) {
    validateTaskPayload(payload);

    return this.#request(TASKS_PATH, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async getVideoTask(taskId) {
    const id = normalizeTaskId(taskId);
    return this.#request(`${TASKS_PATH}/${encodeURIComponent(id)}`, {
      method: "GET"
    });
  }

  async pollVideoTask(taskId, options = {}) {
    const intervalMs = options.intervalMs ?? 5000;
    const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
    const startedAt = Date.now();
    let lastTask;

    while (Date.now() - startedAt <= timeoutMs) {
      lastTask = await this.getVideoTask(taskId);
      options.onUpdate?.(lastTask);

      if (TERMINAL_STATUSES.has(lastTask.status)) {
        return lastTask;
      }

      await sleep(intervalMs);
    }

    throw new ArkApiError(`Timed out waiting for task ${taskId}.`, { body: lastTask });
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
      throw new ArkApiError(`Ark API request failed with HTTP ${response.status}: ${detail}`, {
        status: response.status,
        body: body ?? rawBody
      });
    }

    return body;
  }
}

export async function downloadFile(url, outputPath, { fetchImpl = globalThis.fetch } = {}) {
  if (!url) {
    throw new Error("download url is required.");
  }

  if (!outputPath) {
    throw new Error("outputPath is required.");
  }

  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new ArkApiError(`Download failed with HTTP ${response.status}.`, {
      status: response.status,
      body: await response.text()
    });
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
}

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

export function validateTaskPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("payload must be an object.");
  }

  if (!payload.model || typeof payload.model !== "string") {
    throw new Error("payload.model must be a non-empty string.");
  }

  if (!Array.isArray(payload.content) || payload.content.length === 0) {
    throw new Error("payload.content must be a non-empty array.");
  }
}

function normalizeTaskId(taskId) {
  if (!taskId || typeof taskId !== "string") {
    throw new Error("taskId must be a non-empty string.");
  }

  return taskId.trim();
}

function parseJsonBody(rawBody) {
  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

function formatErrorBody(body) {
  if (!body) {
    return "empty response body";
  }

  if (typeof body === "string") {
    return body.slice(0, 500);
  }

  return JSON.stringify(body).slice(0, 500);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
