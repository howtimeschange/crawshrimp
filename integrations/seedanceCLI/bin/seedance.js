#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { ArkContentGenerationClient, downloadFile } from "../src/ark-client.js";
import { getArkConfig, loadEnvFiles } from "../src/config.js";

const USAGE = `Usage:
  npm run seedance -- submit <payload.json> [--wait] [--download <output.mp4>] [--interval <seconds>] [--timeout <seconds>]
  npm run seedance -- create <payload.json>
  npm run seedance -- get <task-id>
  npm run seedance -- wait <task-id> [--download <output.mp4>] [--interval <seconds>] [--timeout <seconds>]

Environment:
  ARK_API_KEY      Volcengine Ark API key
  ARK_BASE_URL     Optional, defaults to https://ark.cn-beijing.volces.com
`;

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const command = args.shift();

  if (!command || command === "-h" || command === "--help") {
    console.log(USAGE);
    return;
  }

  const config = getArkConfig();
  const client = new ArkContentGenerationClient(config);

  if (command === "create" || command === "submit") {
    const payloadPath = args.shift();
    if (!payloadPath) {
      throw new Error(`Missing payload path.\n\n${USAGE}`);
    }

    const options = parseOptions(args);
    const payload = await readJson(resolve(process.cwd(), payloadPath));
    const created = await client.createVideoTask(payload);

    console.log(JSON.stringify(created, null, 2));

    if (command === "submit" && (options.wait || options.download)) {
      const task = await waitForTask(client, created.id, options);
      console.log(JSON.stringify(task, null, 2));
      await maybeDownload(task, options.download);
    }

    return;
  }

  if (command === "get") {
    const taskId = args.shift();
    if (!taskId) {
      throw new Error(`Missing task id.\n\n${USAGE}`);
    }

    const task = await client.getVideoTask(taskId);
    console.log(JSON.stringify(task, null, 2));
    return;
  }

  if (command === "wait") {
    const taskId = args.shift();
    if (!taskId) {
      throw new Error(`Missing task id.\n\n${USAGE}`);
    }

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
      const updatedAt = task.updated_at ? new Date(task.updated_at * 1000).toISOString() : "";
      console.error(`[${new Date().toISOString()}] ${task.id} ${task.status} ${updatedAt}`);
    }
  });
}

async function maybeDownload(task, outputPath) {
  if (!outputPath) {
    return;
  }

  if (task.status !== "succeeded" || !task.content?.video_url) {
    throw new Error("Task did not succeed or no content.video_url was returned.");
  }

  await downloadFile(task.content.video_url, resolve(process.cwd(), outputPath));
  console.error(`Downloaded video to ${outputPath}`);
}

async function readJson(filePath) {
  const source = await readFile(filePath, "utf8");
  return JSON.parse(source);
}

function parseOptions(args) {
  const options = {
    wait: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--wait") {
      options.wait = true;
      continue;
    }

    if (arg === "--download") {
      options.download = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--interval") {
      options.interval = Number(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--timeout") {
      options.timeout = Number(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }

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
