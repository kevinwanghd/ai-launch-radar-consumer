#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs() {
  const args = {
    date: new Date().toISOString().slice(0, 10),
    timeWindowHours: 72,
    write: false,
  };

  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    switch (arg) {
      case "--date":
        args.date = process.argv[++i];
        break;
      case "--time-window":
        args.timeWindowHours = Number(process.argv[++i]);
        break;
      case "--write":
        args.write = true;
        break;
      default:
        console.warn(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function runNodeScript(scriptPath, args) {
  return new Promise((resolve) => {
    const proc = spawn("node", [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on("error", (error) => {
      resolve({ code: 1, stdout: "", stderr: error.message });
    });
  });
}

async function main() {
  const args = parseArgs();
  const scriptDir = process.cwd();
  const collectScript = path.join(scriptDir, "collect-all-sources.mjs");
  const generateScript = path.join(scriptDir, "generate-radar.mjs");
  const outputDir = path.join(process.env.TEMP || process.env.TMP || "/tmp", `ai-launch-radar-run-${args.date}`);

  await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});

  const collectResult = await runNodeScript(collectScript, [
    "--date", args.date,
    "--output-dir", outputDir,
    "--time-window", String(args.timeWindowHours),
  ]);

  if (collectResult.stdout) {
    process.stderr.write(collectResult.stdout);
  }
  if (collectResult.stderr) {
    process.stderr.write(collectResult.stderr);
  }

  const generateArgs = [
    "--input-dir", outputDir,
    "--date", args.date,
    "--time-window", String(args.timeWindowHours),
  ];
  if (args.write) {
    generateArgs.push("--write");
  }

  const generateResult = await runNodeScript(generateScript, generateArgs);

  if (generateResult.stderr) {
    process.stderr.write(generateResult.stderr);
  }

  if (generateResult.code !== 0) {
    process.exit(generateResult.code);
  }

  process.stdout.write(generateResult.stdout);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${String(error?.message ?? error)}\n`);
  process.exit(1);
});
