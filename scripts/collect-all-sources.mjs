#!/usr/bin/env node
/**
 * Unified collection entry point for AI Launch Radar
 *
 * Flow:
 * 1. Try to fetch pre-crawled data from central feed
 * 2. For any source that fails: fall back to original client-side crawling
 * 3. Output normalized files in the original schema (github.json, x.json, producthunt.json)
 * 4. Single-source failures do not block the entire run
 */

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import config from "./config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// -- Helpers -----------------------------------------------------------------

function parseArgs() {
  const args = {
    date: new Date().toISOString().slice(0, 10),
    outputDir: process.cwd(),
    timeWindowHours: 72,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    switch (arg) {
      case "--date":
        args.date = process.argv[++i];
        break;
      case "--output-dir":
        args.outputDir = process.argv[++i];
        break;
      case "--time-window":
        args.timeWindowHours = Number(process.argv[++i]);
        break;
      default:
        console.warn(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    proc.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on("error", reject);
  });
}

function emptySourceExport(source, date, status = "unavailable") {
  return {
    source,
    date,
    captured_at: new Date().toISOString(),
    status,
    count: 0,
    notes: [],
    items: [],
  };
}

// -- Main collection flow ----------------------------------------------------

async function main() {
  const args = parseArgs();
  const { date, outputDir } = args;

  console.log(`=== AI Launch Radar Collection ===`);
  console.log(`Date: ${date}`);
  console.log(`Output directory: ${outputDir}`);
  console.log(`Trying central pre-crawled data first...\n`);

  // 1. Try to fetch all sources from central feed
  const centralResult = await fetchCentralData(date);

  // 2. For each source: use central if available, otherwise fallback
  const results = {
    github: await collectSource("github", centralResult?.github, date, outputDir),
    x: await collectSource("x", centralResult?.x, date, outputDir),
    producthunt: await collectSource("producthunt", centralResult?.producthunt, date, outputDir),
  };

  // 3. Write all output files (even if empty/unavailable - preserve schema)
  await fs.mkdir(outputDir, { recursive: true });

  const outputFiles = {
    "github.json": results.github,
    "x.json": results.x,
    "producthunt.json": results.producthunt,
  };

  for (const [filename, data] of Object.entries(outputFiles)) {
    const outputPath = path.join(outputDir, filename);
    await fs.writeFile(outputPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(`Wrote ${filename}: ${data.status}, ${data.count} items`);
  }

  // 4. Write run-summary.json
  const overallStatus = Object.values(results).some(r => r.status !== "ok") ? "degraded" : "ok";
  const runSummary = {
    date,
    captured_at: new Date().toISOString(),
    overall_status: overallStatus,
    sources: {
      github: { status: results.github.status, count: results.github.count },
      x: { status: results.x.status, count: results.x.count },
      producthunt: { status: results.producthunt.status, count: results.producthunt.count },
    },
    report_path: null,
  };
  const runSummaryPath = path.join(outputDir, "run-summary.json");
  await fs.writeFile(runSummaryPath, JSON.stringify(runSummary, null, 2) + "\n", "utf8");
  console.log(`Wrote run-summary.json`);

  // 5. Print summary
  console.log(`\n=== Collection Complete ===`);
  for (const [source, result] of Object.entries(results)) {
    console.log(`${source}: ${result.status} (${result.count} items)`);
  }

  const allOk = Object.values(results).every(r => r.status === "ok");
  process.exit(allOk ? 0 : 1);
}

async function fetchCentralData(date) {
  try {
    const scriptPath = path.join(__dirname, "fetch-central-data.js");
    const { code, stdout, stderr } = await runCommand("node", [scriptPath, date]);

    if (code !== 0) {
      console.warn(`Central fetch failed:\n${stderr}`);
      return null;
    }

    try {
      return JSON.parse(stdout);
    } catch (e) {
      console.warn(`Failed to parse central fetch output: ${e.message}`);
      return null;
    }
  } catch (e) {
    console.warn(`Exception during central fetch: ${e.message}`);
    return null;
  }
}

async function collectSource(sourceName, centralData, date, outputDir) {
  // If we got valid data from central, use it directly
  if (centralData && isValidSourceExport(centralData)) {
    console.log(`${sourceName}: using central pre-crawled data (${centralData.count} items)`);
    return {
      ...centralData,
      // Ensure all required fields exist
      source: sourceName,
      date: centralData.date || date,
      captured_at: centralData.captured_at || new Date().toISOString(),
      count: centralData.count ?? centralData.items?.length ?? 0,
    };
  }

  console.log(`${sourceName}: central data not available, falling back to client-side crawl...`);

  // Check config before attempting client-side crawl
  const cfg = await config.loadConfig();
  const status = config.getConfigStatus(cfg);

  // Fallback to original collection methods
  switch (sourceName) {
    case "producthunt":
      return await collectProductHuntFallback(date, outputDir);
    case "github":
      if (!status.github.configured) {
        console.warn(`${sourceName}: GitHub token not configured. Search will hit rate limits.`);
        return {
          ...emptySourceExport(sourceName, date, "unavailable"),
          notes: ["GitHub API token not configured. Configure token to enable client-side search."],
        };
      }
      // GitHub fallback - when implemented, will use the token
      return emptySourceExport(sourceName, date, "unavailable");
    case "x":
      // X fallback - try client-side if credentials are configured
      return await collectXFallback(date, outputDir);
    default:
      return emptySourceExport(sourceName, date, "unavailable");
  }
}

function isValidSourceExport(data) {
  if (!data || typeof data !== "object") return false;
  if (typeof data.source !== "string") return false;
  if (typeof data.status !== "string") return false;
  if (!Array.isArray(data.items)) return false;
  return true;
}

async function collectProductHuntFallback(date, outputDir) {
  // Use the existing producthunt_provider.mjs
  const tempOutput = path.join(outputDir, "producthunt-raw.json");
  const scriptPath = path.join(__dirname, "producthunt_provider.mjs");
  const cookieFile = await config.getProductHuntCookieFile();

  const args = [
    scriptPath,
    "--date", date,
    "--output-file", tempOutput,
  ];
  if (cookieFile) {
    args.push("--cookie-file", cookieFile);
  }

  const { code, stdout, stderr } = await runCommand("node", args);

  // Read and transform the provider output to the expected schema
  try {
    const raw = await fs.readFile(tempOutput, "utf8");
    const providerResult = JSON.parse(raw);

    const items = (providerResult.items || []).map(item => ({
      source_id: item.id,
      name: item.name,
      tagline: item.tagline,
      url: item.productHuntUrl,
      website_url: item.websiteUrl,
      score: item.votesCount,
      rank: null,
      created_at: null,
      launched_at: null,
      topics: [],
      raw_ref: item,
    }));

    return {
      source: "producthunt",
      date,
      captured_at: new Date().toISOString(),
      status: providerResult.status,
      count: items.length,
      notes: providerResult.reason ? [providerResult.reason] : [],
      items,
    };
  } catch (e) {
    console.warn(`producthunt: failed to read provider output: ${e.message}`);
    return emptySourceExport("producthunt", date, "unavailable");
  }
}

async function collectXFallback(date, outputDir) {
  // The existing x_search.py requires cookies and Twitter API
  const scriptPath = path.join(__dirname, "x_search.py");
  const creds = await config.getTwitterCredentials();

  // Check if credentials are configured
  if (!creds.authToken || !creds.ct0) {
    console.warn("X: Twitter credentials not configured. Set X_AUTH_TOKEN and X_CT0 or configure in config file.");
    return {
      ...emptySourceExport("x", date, "unavailable"),
      notes: ["X/Twitter credentials not configured. Configure auth_token and ct0 to enable search."],
    };
  }

  try {
    // Check if Python is available
    const { code: pyCheckCode } = await runCommand("python3", ["--version"]);
    const pythonCmd = pyCheckCode === 0 ? "python3" : "python";

    // Run X search with credentials in environment
    const env = {
      ...process.env,
      X_AUTH_TOKEN: creds.authToken,
      X_CT0: creds.ct0,
    };

    const proxy = await config.getProxy();
    if (proxy) {
      env.HTTPS_PROXY = proxy;
      env.HTTP_PROXY = proxy;
    }

    const tempOutput = path.join(outputDir, "x-raw.json");

    console.log("X: Running client-side search with configured credentials...");

    // Use spawn with custom environment
    return new Promise((resolve) => {
      const proc = spawn(
        pythonCmd,
        [scriptPath, "just launched AI", "20"],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env,
        }
      );

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => (stderr += data.toString()));

      proc.on("close", async (code) => {
        if (code !== 0) {
          console.warn(`X search exited with code ${code}:\n${stderr}`);
          resolve({
            ...emptySourceExport("x", date, "unavailable"),
            notes: [`Client-side search failed: ${stderr.split('\n')[0]}`],
          });
          return;
        }

        try {
          // Parse tweets from stdout (script outputs JSON first)
          const tweetsMatch = stdout.match(/^\[([\s\S]*?)\]\n/);
          const jsonStr = tweetsMatch ? tweetsMatch[0] : stdout;
          const tweets = JSON.parse(jsonStr);

          const items = tweets.map(tweet => ({
            source_id: String(tweet.id),
            name: tweet.username,
            tagline: tweet.text.slice(0, 100) + (tweet.text.length > 100 ? "..." : ""),
            url: tweet.url,
            website_url: null,
            score: tweet.likes + tweet.retweets * 2,
            replies: tweet.replies,
            created_at: tweet.date,
            topics: [],
            raw_ref: tweet,
          }));

          if (items.length === 0) {
            resolve({
              source: "x",
              date,
              captured_at: new Date().toISOString(),
              status: "unavailable",
              count: 0,
              notes: ["No results found from client-side search"],
              items: [],
            });
            return;
          }

          resolve({
            source: "x",
            date,
            captured_at: new Date().toISOString(),
            status: "ok",
            count: items.length,
            notes: [],
            items,
          });
        } catch (e) {
          console.warn(`Failed to parse X search output: ${e.message}`);
          resolve({
            ...emptySourceExport("x", date, "unavailable"),
            notes: [`Failed to parse results: ${e.message}`],
          });
        }
      });

      proc.on("error", (err) => {
        console.warn(`X search error: ${err.message}`);
        resolve({
          ...emptySourceExport("x", date, "unavailable"),
          notes: [`Execution error: ${err.message}`],
        });
      });
    });
  } catch (e) {
    console.warn(`X client-side collection failed: ${e.message}`);
    return {
      ...emptySourceExport("x", date, "unavailable"),
      notes: [`Client-side exception: ${e.message}`],
    };
  }
}

const isDirectRun = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch(err => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}

export default { main };
