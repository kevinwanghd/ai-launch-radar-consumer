#!/usr/bin/env node

// ============================================================================
// AI Launch Radar — Fetch Central Pre-crawled Data
// ============================================================================
// Fetches pre-crawled structured data from a central repository:
// - GitHub trending AI repos (last 72h)
// - X/Twitter AI launch posts
// - Product Hunt daily leaderboard
//
// If central fetch fails, falls back to original client-side crawling.
//
// Outputs JSON with:
// - github: normalized GitHub items matching the export schema
// - x: normalized X items matching the export schema
// - producthunt: normalized Product Hunt items matching the export schema
// - metadata: capture date, source, errors
// ============================================================================

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';

// -- Constants ---------------------------------------------------------------

// Central feed URLs (similar to follow-builders pattern)
const CENTRAL_FEED_BASE = 'https://raw.githubusercontent.com/kevinwanghd/ai-launch-radar-feed/main/data';

const FEED_URLS = {
  github: (date) => `${CENTRAL_FEED_BASE}/${date}/github.json`,
  x: (date) => `${CENTRAL_FEED_BASE}/${date}/x.json`,
  producthunt: (date) => `${CENTRAL_FEED_BASE}/${date}/producthunt.json`,
};

// -- Fetch helpers -----------------------------------------------------------

async function runCurl(url) {
  return new Promise((resolve) => {
    const proc = spawn('curl', ['-s', url], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', (error) => {
      resolve({ code: 1, stdout: '', stderr: error.message });
    });
  });
}

async function fetchJSONViaCurl(url) {
  const { code, stdout, stderr } = await runCurl(url);
  if (code !== 0) {
    return { success: false, error: `curl failed: ${stderr || `exit ${code}`}` };
  }

  try {
    const data = JSON.parse(stdout);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: `curl JSON parse failed: ${err.message}` };
  }
}

async function fetchJSON(url) {
  const curlResult = await fetchJSONViaCurl(url);
  if (curlResult.success) {
    return curlResult;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }
    const data = await res.json();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message || curlResult.error };
  }
}

async function fetchText(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

// -- Schema validation -------------------------------------------------------

function isValidSourceExport(data) {
  // Check that the data matches the expected export schema
  if (!data || typeof data !== 'object') return false;
  if (!['github', 'x', 'producthunt'].includes(data.source)) return false;
  if (typeof data.status !== 'string') return false;
  if (!Array.isArray(data.items)) return false;
  if (typeof data.count !== 'number') data.count = data.items.length;
  return true;
}

// -- Cache handling ----------------------------------------------------------

function getCacheDir() {
  return join(homedir(), '.cache', 'ai-launch-radar');
}

function getCachePath(date, source) {
  const cacheDir = getCacheDir();
  return join(cacheDir, `${date}-${source}.json`);
}

async function readCache(date, source) {
  const cachePath = getCachePath(date, source);
  if (!existsSync(cachePath)) return null;
  try {
    const raw = await readFile(cachePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!isValidSourceExport(data)) return null;
    return data;
  } catch {
    return null;
  }
}

async function writeCache(date, source, data) {
  const cacheDir = getCacheDir();
  const cachePath = getCachePath(date, source);
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // Ignore cache write errors
  }
}

// -- Main --------------------------------------------------------------------

async function main() {
  const errors = [];
  const results = {
    github: null,
    x: null,
    producthunt: null,
    metadata: {
      fetchedAt: new Date().toISOString(),
      usedCentral: {
        github: false,
        x: false,
        producthunt: false,
      },
      usedCache: {
        github: false,
        x: false,
        producthunt: false,
      },
      errors: {},
    },
  };

  // Parse arguments
  const args = process.argv.slice(2);
  const date = args[0] || new Date().toISOString().slice(0, 10);

  // Fetch each source from central in parallel
  const sources = ['github', 'x', 'producthunt'];

  for (const source of sources) {
    // 1. First try: fetch from central pre-crawled feed
    const url = FEED_URLS[source](date);
    const fetchResult = await fetchJSON(url);

    if (fetchResult.success && isValidSourceExport(fetchResult.data)) {
      results[source] = fetchResult.data;
      results.metadata.usedCentral[source] = true;
      await writeCache(date, source, fetchResult.data);
      continue;
    }

    // 2. Second try: read from local cache if available
    const cached = await readCache(date, source);
    if (cached) {
      results[source] = cached;
      results.metadata.usedCache[source] = true;
      const errorMsg = fetchResult.error || 'Invalid data from central feed';
      results.metadata.errors[source] = `Central fetch failed (${errorMsg}), using cached data`;
      continue;
    }

    // 3. Fall through to client-side fallback (null = caller should use original method)
    results[source] = null;
    const errorMsg = fetchResult.error || 'Invalid data from central feed';
    results.metadata.errors[source] = `Central fetch failed (${errorMsg}), no cache available — falling back to client-side crawl`;
    errors.push(`Failed to get ${source}: ${errorMsg}`);
  }

  // Output everything as JSON
  const output = {
    status: errors.length === 0 ? 'ok' : errors.length === 3 ? 'all-failed' : 'partial',
    date,
    github: results.github,
    x: results.x,
    producthunt: results.producthunt,
    metadata: results.metadata,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({
    status: 'error',
    message: err.message,
    github: null,
    x: null,
    producthunt: null,
  }));
  process.exit(1);
});
