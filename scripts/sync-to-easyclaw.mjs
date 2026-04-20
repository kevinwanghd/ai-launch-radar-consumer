#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_ROOT = path.resolve(process.cwd(), "..");
const TARGET_ROOT = "C:/Users/kevin/.easyclaw/openclaw/skills/ai-launch-radar";
const SYNC_ITEMS = ["SKILL.md", "evals", "scripts", "test"];

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function copyRecursive(sourcePath, targetPath) {
  const stat = await fs.stat(sourcePath);

  if (stat.isDirectory()) {
    await ensureDir(targetPath);
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      const nextSource = path.join(sourcePath, entry.name);
      const nextTarget = path.join(targetPath, entry.name);
      await copyRecursive(nextSource, nextTarget);
    }
    return;
  }

  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
}

async function main() {
  const copied = [];

  for (const item of SYNC_ITEMS) {
    const sourcePath = path.join(SOURCE_ROOT, item);
    const targetPath = path.join(TARGET_ROOT, item);
    await copyRecursive(sourcePath, targetPath);
    copied.push(item);
  }

  process.stdout.write(JSON.stringify({
    status: "ok",
    sourceRoot: SOURCE_ROOT,
    targetRoot: TARGET_ROOT,
    copied,
  }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${String(error?.message ?? error)}\n`);
  process.exit(1);
});
