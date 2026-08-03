import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ArkContentGenerationClient, isTerminalStatus, validateTaskPayload } from "../src/ark-client.js";
import { getArkConfig } from "../src/config.js";

test("createVideoTask posts payload to Ark task endpoint", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({ id: "cgt-test" });
  };

  const client = new ArkContentGenerationClient({
    apiKey: "test-key",
    fetchImpl
  });

  const payload = {
    model: "doubao-seedance-2-0-260128",
    content: [{ type: "text", text: "hello" }]
  };
  const result = await client.createVideoTask(payload);

  assert.deepEqual(result, { id: "cgt-test" });
  assert.equal(calls[0].url, "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), payload);
});

test("getVideoTask fetches task by path id", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({
      id: "cgt-test",
      status: "succeeded",
      content: { video_url: "https://example.com/video.mp4" }
    });
  };

  const client = new ArkContentGenerationClient({
    apiKey: "test-key",
    fetchImpl
  });

  const result = await client.getVideoTask("cgt-test");

  assert.equal(calls[0].url, "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-test");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(result.status, "succeeded");
  assert.equal(result.content.video_url, "https://example.com/video.mp4");
});

test("createVideoTask preserves a Seedance gateway base URL that already includes /api/v3", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({ id: "cgt-gateway" });
  };

  const client = new ArkContentGenerationClient({
    apiKey: "test-key",
    baseUrl: "https://ai-aigw.semir.com/doubao-seedance/api/v3",
    fetchImpl
  });

  await client.createVideoTask({
    model: "doubao-seedance-2-0-260128",
    content: [{ type: "text", text: "a delivery rider crossing a city street" }]
  });

  assert.equal(
    calls[0].url,
    "https://ai-aigw.semir.com/doubao-seedance/api/v3/contents/generations/tasks"
  );
});

test("pollVideoTask stops on terminal status", async () => {
  const statuses = ["queued", "running", "succeeded"];
  const updates = [];
  const fetchImpl = async () => {
    const status = statuses.shift();
    return jsonResponse({ id: "cgt-test", status });
  };

  const client = new ArkContentGenerationClient({
    apiKey: "test-key",
    fetchImpl
  });

  const result = await client.pollVideoTask("cgt-test", {
    intervalMs: 1,
    timeoutMs: 100,
    onUpdate: (task) => updates.push(task.status)
  });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(updates, ["queued", "running", "succeeded"]);
});

test("validateTaskPayload requires model and content", () => {
  assert.throws(() => validateTaskPayload({}), /model/);
  assert.throws(() => validateTaskPayload({ model: "m" }), /content/);
  assert.doesNotThrow(() => validateTaskPayload({ model: "m", content: [{ type: "text", text: "x" }] }));
});

test("isTerminalStatus identifies Ark task terminal states", () => {
  assert.equal(isTerminalStatus("queued"), false);
  assert.equal(isTerminalStatus("running"), false);
  assert.equal(isTerminalStatus("succeeded"), true);
  assert.equal(isTerminalStatus("failed"), true);
  assert.equal(isTerminalStatus("cancelled"), true);
  assert.equal(isTerminalStatus("expired"), true);
});

test("getArkConfig accepts Seedance gateway aliases", () => {
  const config = getArkConfig({
    SEEDANCE_API_KEY: "seedance-key",
    SEEDANCE_BASE_URL: "https://ai-aigw.semir.com/doubao-seedance/api/v3"
  });

  assert.equal(config.apiKey, "seedance-key");
  assert.equal(config.baseUrl, "https://ai-aigw.semir.com/doubao-seedance/api/v3");
});

test("getArkConfig accepts Doubao Seedance aliases", () => {
  const config = getArkConfig({
    DOUBAO_SEEDANCE_API_KEY: "doubao-seedance-key",
    DOUBAO_SEEDANCE_BASE_URL: "https://ai-aigw.semir.com/doubao-seedance/api/v3"
  });

  assert.equal(config.apiKey, "doubao-seedance-key");
  assert.equal(config.baseUrl, "https://ai-aigw.semir.com/doubao-seedance/api/v3");
});

test("example Seedance 2.0 payload matches the task shape", async () => {
  const source = await readFile(new URL("../examples/seedance2-tea.json", import.meta.url), "utf8");
  const payload = JSON.parse(source);

  assert.doesNotThrow(() => validateTaskPayload(payload));
  assert.equal(payload.model, "doubao-seedance-2-0-260128");
  assert.equal(payload.generate_audio, true);
  assert.equal(payload.ratio, "16:9");
  assert.equal(payload.duration, 11);
  assert.equal(payload.watermark, false);
  assert.equal(payload.content.length, 5);
});

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
