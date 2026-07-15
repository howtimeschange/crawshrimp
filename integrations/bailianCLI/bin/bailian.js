#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import {
  BailianVideoGenerationClient,
  downloadFile,
  getBailianTaskId,
  getBailianTaskStatus,
  getBailianVideoUrl
} from "../src/bailian-client.js";
import { getBailianConfig, loadEnvFiles } from "../src/config.js";

const USAGE = `Usage:
  npm run bailian -- submit <payload.json> [--wait] [--download <output.mp4>] [--interval <seconds>] [--timeout <seconds>]
  npm run bailian -- create <payload.json>
  npm run bailian -- get <task-id>
  npm run bailian -- wait <task-id> [--download <output.mp4>] [--interval <seconds>] [--timeout <seconds>]

Environment:
  DASHSCOPE_API_KEY       Alibaba Bailian/DashScope API key
  BAILIAN_WORKSPACE_ID    Optional for workspace maas endpoints
  BAILIAN_REGION          Optional, defaults to cn-beijing
  BAILIAN_BASE_URL        Optional endpoint override
`;

async function main() {
  loadEnvFiles();
  const args = process.argv.slice(2);
  const command = args.shift();
  if (!command || command === "-h" || command === "--help") {
    console.log(USAGE);
    return;
  }

  const config = getBailianConfig();
  const client = new BailianVideoGenerationClient(config);
  if (command === "create" || command === "submit") {
    const payloadPath = args.shift();
    if (!payloadPath) throw new Error(`Missing payload path.\n\n${USAGE}`);
    const options = parseOptions(args);
    const payload = await readJson(resolve(process.cwd(), payloadPath));
    const created = await client.createVideoTask(payload);
    console.log(JSON.stringify(created, null, 2));

    if (command === "submit" && (options.wait || options.download)) {
      const task = await waitForTask(client, getBailianTaskId(created), options);
      console.log(JSON.stringify(task, null, 2));
      await maybeDownload(task, options.download);
    }
    return;
  }

  if (command === "get") {
    const taskId = args.shift();
    if (!taskId) throw new Error(`Missing task id.\n\n${USAGE}`);
    console.log(JSON.stringify(await client.getVideoTask(taskId), null, 2));
    return;
  }

  if (command === "wait") {
    const taskId = args.shift();
    if (!taskId) throw new Error(`Missing task id.\n\n${USAGE}`);
    const options = parseOptions(args);
    const task = await waitForTask(client, taskId, options);
    console.log(JSON.stringify(task, null, 2));
    await maybeDownload(task, options.download);
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${USAGE}`);
}

async function waitForTask(client, taskId, options) {
  return client.pollVideoTask(taskId, {
    intervalMs: secondsToMs(options.interval ?? 5),
    timeoutMs: secondsToMs(options.timeout ?? 30 * 60),
    onUpdate: (task) => {
      const output = task.output ?? {};
      console.error(
        `[${new Date().toISOString()}] ${output.task_id ?? taskId} ${output.task_status ?? "UNKNOWN"} ${output.end_time ?? ""}`
      );
    }
  });
}

async function maybeDownload(task, outputPath) {
  if (!outputPath) return;
  if (getBailianTaskStatus(task) !== "SUCCEEDED" || !getBailianVideoUrl(task)) {
    throw new Error("Task did not succeed or no output.video_url was returned.");
  }
  await downloadFile(getBailianVideoUrl(task), resolve(process.cwd(), outputPath));
  console.error(`Downloaded video to ${outputPath}`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function parseOptions(args) {
  const options = { wait: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--wait") {
      options.wait = true;
      continue;
    }
    if (arg === "--download" || arg === "--interval" || arg === "--timeout") {
      const value = requireValue(args, index, arg);
      if (arg === "--download") options.download = value;
      if (arg === "--interval") options.interval = Number(value);
      if (arg === "--timeout") options.timeout = Number(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
}

function secondsToMs(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("interval and timeout must be positive numbers.");
  }
  return seconds * 1000;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
