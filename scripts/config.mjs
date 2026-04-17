#!/usr/bin/env node
/**
 * Configuration loader for AI Launch Radar
 * Loads authentication credentials from:
 * 1. Environment variables
 * 2. ~/.config/ai-launch-radar/config.json
 * 3. ~/.ai-launch-radar.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

/**
 * Configuration schema:
 * {
 *   "github": {
 *     "token": "your_github_api_token_here"
 *   },
 *   "twitter": {
 *     "authToken": "your_auth_token_here",
 *     "ct0": "your_ct0_cookie_here",
 *     "cookieFile": "/path/to/cookies.json" (optional)
 *   },
 *   "producthunt": {
 *     "cookieFile": "/path/to/producthunt_cookies.json",
 *     "sessionValue": "your_session_value_here" (alternative to file)
 *   },
 *   "network": {
 *     "proxy": "http://127.0.0.1:8890" (optional)
 *   }
 * }
 */

const CONFIG_PATHS = [
  path.join(homedir(), ".config", "ai-launch-radar", "config.json"),
  path.join(homedir(), ".ai-launch-radar.json"),
];

let cachedConfig = null;

async function loadConfig() {
  if (cachedConfig !== null) {
    return cachedConfig;
  }

  const config = {
    github: {
      token: process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN || null,
    },
    twitter: {
      authToken: process.env.X_AUTH_TOKEN || process.env.TWITTER_AUTH_TOKEN || null,
      ct0: process.env.X_CT0 || process.env.TWITTER_CT0 || null,
      cookieFile: null,
    },
    producthunt: {
      cookieFile: process.env.PRODUCT_HUNT_COOKIE_FILE || null,
      sessionValue: process.env.PRODUCT_HUNT_SESSION || null,
    },
    network: {
      proxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null,
    },
    valid: false,
  };

  // Try to load from config files
  for (const configPath of CONFIG_PATHS) {
    if (!existsSync(configPath)) continue;

    try {
      const raw = await fs.readFile(configPath, "utf8");
      const fileConfig = JSON.parse(raw);

      // Merge file config into defaults
      if (fileConfig.github?.token) {
        config.github.token = fileConfig.github.token;
      }
      if (fileConfig.twitter) {
        if (fileConfig.twitter.authToken) config.twitter.authToken = fileConfig.twitter.authToken;
        if (fileConfig.twitter.ct0) config.twitter.ct0 = fileConfig.twitter.ct0;
        if (fileConfig.twitter.cookieFile) config.twitter.cookieFile = fileConfig.twitter.cookieFile;
      }
      if (fileConfig.producthunt) {
        if (fileConfig.producthunt.cookieFile) config.producthunt.cookieFile = fileConfig.producthunt.cookieFile;
        if (fileConfig.producthunt.sessionValue) config.producthunt.sessionValue = fileConfig.producthunt.sessionValue;
      }
      if (fileConfig.network?.proxy) config.network.proxy = fileConfig.network.proxy;

      console.debug(`Loaded config from: ${configPath}`);
      break;
    } catch (err) {
      console.warn(`Failed to read config from ${configPath}: ${err.message}`);
    }
  }

  config.valid = true;
  cachedConfig = config;
  return config;
}

function getConfigStatus(config) {
  return {
    github: {
      configured: Boolean(config.github.token && config.github.token.trim()),
      hasToken: Boolean(config.github.token && config.github.token.trim()),
    },
    twitter: {
      configured: Boolean(
        (config.twitter.authToken && config.twitter.ct0) || config.twitter.cookieFile
      ),
      hasAuthToken: Boolean(config.twitter.authToken),
      hasCt0: Boolean(config.twitter.ct0),
    },
    producthunt: {
      configured: Boolean(config.producthunt.cookieFile || config.producthunt.sessionValue),
      hasCookieFile: Boolean(config.producthunt.cookieFile),
      hasSessionValue: Boolean(config.producthunt.sessionValue),
    },
  };
}

async function getGithubToken() {
  const config = await loadConfig();
  const token = config.github.token?.trim();
  return token && token.length > 0 ? token : null;
}

async function getTwitterCredentials() {
  const config = await loadConfig();
  return {
    authToken: config.twitter.authToken?.trim() || null,
    ct0: config.twitter.ct0?.trim() || null,
    cookieFile: config.twitter.cookieFile,
  };
}

async function getProductHuntCookieFile() {
  const config = await loadConfig();
  return config.producthunt.cookieFile;
}

async function getProductHuntSessionValue() {
  const config = await loadConfig();
  const value = config.producthunt.sessionValue?.trim();
  return value && value.length > 0 ? value : null;
}

async function getProxy() {
  const config = await loadConfig();
  return config.network.proxy;
}

function printConfigHelp() {
  console.log(`
=== AI Launch Radar Configuration ===

To use client-side crawling (when central pre-crawled data is unavailable),
you need to configure authentication credentials for the APIs:

1. GitHub API Token (solves rate limiting):
   - Create at: https://github.com/settings/tokens
   - No scopes needed for public repository search
   - Set via:
     - Environment variable: GITHUB_TOKEN
     - Or in config file: { "github": { "token": "..." } }

2. X/Twitter Cookies (for searching posts):
   - From your browser cookies after logging into X
   - Need: auth_token and ct0
   - Set via:
     - Environment variables: X_AUTH_TOKEN and X_CT0
     - Or in config file: { "twitter": { "authToken": "...", "ct0": "..." } }

3. Product Hunt Session Cookie (for daily leaderboard):
   - From your browser cookies after logging into Product Hunt
   - Need: _producthunt_session_production
   - Set via:
     - Environment variable: PRODUCT_HUNT_SESSION
     - Or cookie file path in config: { "producthunt": { "cookieFile": "/path/to/cookies.json" } }

Config file locations (checked in order):
  - ~/.config/ai-launch-radar/config.json
  - ~/.ai-launch-radar.json

Example config.json:
{
  "github": {
    "token": "ghp_yourGithubTokenHere"
  },
  "twitter": {
    "authToken "": "your_auth_token_cookie_value",
    "ct0": "your_ct0_cookie_value"
  },
  "producthunt": {
    "cookieFile": "/home/user/ph_cookies.json"
  },
  "network": {
    "proxy": "http://127.0.0.1:8890"
  }
}

If credentials are not configured, the corresponding source will be marked
as "unavailable" but the report will still be generated from other sources.
`);
}

export default {
  loadConfig,
  getConfigStatus,
  getGithubToken,
  getTwitterCredentials,
  getProductHuntCookieFile,
  getProductHuntSessionValue,
  getProxy,
  printConfigHelp,
};
