import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BailianVideoGenerationClient,
  getBailianTaskId,
  getBailianTaskStatus,
  getBailianVideoUrl,
  isBailianTerminalStatus,
  validateBailianTaskPayload
} from "../src/bailian-client.js";
import { buildBailianBaseUrl, getBailianConfig } from "../src/config.js";

const PLACEHOLDER_CREDENTIAL = "test-placeholder";

test("createVideoTask posts payload to Bailian video synthesis endpoint", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({ output: { task_id: "task-test", task_status: "PENDING" } });
  };
  const client = new BailianVideoGenerationClient({
    apiKey: PLACEHOLDER_CREDENTIAL,
    baseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com",
    fetchImpl
  });
  const payload = {
    model: "happyhorse-1.1-t2v",
    input: { prompt: "hello" },
    parameters: { resolution: "720P", ratio: "16:9", duration: 3 }
  };
  const result = await client.createVideoTask(payload);

  assert.equal(
    calls[0].url,
    "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${PLACEHOLDER_CREDENTIAL}`);
  assert.equal(calls[0].init.headers["X-DashScope-Async"], "enable");
  assert.deepEqual(JSON.parse(calls[0].init.body), payload);
  assert.equal(getBailianTaskId(result), "task-test");
});

test("getVideoTask fetches Bailian task by path id", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({
      output: {
        task_id: "task-test",
        task_status: "SUCCEEDED",
        video_url: "https://example.com/video.mp4"
      }
    });
  };
  const client = new BailianVideoGenerationClient({
    apiKey: PLACEHOLDER_CREDENTIAL,
    baseUrl: "https://dashscope.aliyuncs.com",
    fetchImpl
  });
  const result = await client.getVideoTask("task-test");

  assert.equal(calls[0].url, "https://dashscope.aliyuncs.com/api/v1/tasks/task-test");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(getBailianTaskStatus(result), "SUCCEEDED");
  assert.equal(getBailianVideoUrl(result), "https://example.com/video.mp4");
});

test("pollVideoTask stops on Bailian terminal status", async () => {
  const statuses = ["PENDING", "RUNNING", "SUCCEEDED"];
  const updates = [];
  const client = new BailianVideoGenerationClient({
    apiKey: PLACEHOLDER_CREDENTIAL,
    fetchImpl: async () => jsonResponse({
      output: { task_id: "task-test", task_status: statuses.shift() }
    })
  });
  const result = await client.pollVideoTask("task-test", {
    intervalMs: 1,
    timeoutMs: 100,
    onUpdate: (task) => updates.push(getBailianTaskStatus(task))
  });

  assert.equal(getBailianTaskStatus(result), "SUCCEEDED");
  assert.deepEqual(updates, ["PENDING", "RUNNING", "SUCCEEDED"]);
});

test("validateBailianTaskPayload accepts HappyHorse examples", async () => {
  for (const fileName of ["happyhorse-t2v.json", "happyhorse-i2v.json", "happyhorse-r2v.json"]) {
    const source = await readFile(new URL(`../examples/${fileName}`, import.meta.url), "utf8");
    assert.doesNotThrow(() => validateBailianTaskPayload(JSON.parse(source)), fileName);
  }
});

test("validateBailianTaskPayload rejects image-to-video ratio", () => {
  assert.throws(
    () => validateBailianTaskPayload({
      model: "happyhorse-1.1-i2v",
      input: { media: [{ type: "first_frame", url: "https://example.com/image.png" }] },
      parameters: { ratio: "16:9" }
    }),
    /does not support/
  );
});

test("validateBailianTaskPayload limits reference images to nine", () => {
  const media = Array.from({ length: 10 }, (_, index) => ({
    type: "reference_image",
    url: `https://example.com/reference-${index + 1}.png`
  }));
  assert.throws(
    () => validateBailianTaskPayload({
      model: "happyhorse-1.1-r2v",
      input: { prompt: "show the product", media }
    }),
    /1-9 item/
  );
});

test("isBailianTerminalStatus identifies Bailian task terminal states", () => {
  assert.equal(isBailianTerminalStatus("PENDING"), false);
  assert.equal(isBailianTerminalStatus("RUNNING"), false);
  assert.equal(isBailianTerminalStatus("SUCCEEDED"), true);
  assert.equal(isBailianTerminalStatus("FAILED"), true);
  assert.equal(isBailianTerminalStatus("CANCELED"), true);
  assert.equal(isBailianTerminalStatus("UNKNOWN"), true);
});

test("getBailianConfig builds workspace and legacy endpoints", () => {
  assert.equal(
    buildBailianBaseUrl({ workspaceId: "ws-test", region: "cn-beijing" }),
    "https://ws-test.cn-beijing.maas.aliyuncs.com"
  );
  assert.equal(
    getBailianConfig({ DASHSCOPE_API_KEY: PLACEHOLDER_CREDENTIAL }).baseUrl,
    "https://dashscope.aliyuncs.com"
  );
});

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" }
  });
}
