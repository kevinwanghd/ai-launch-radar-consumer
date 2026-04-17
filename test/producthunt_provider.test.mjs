import test from "node:test";
import assert from "node:assert/strict";

import {
  PRODUCT_HUNT_REASON_CODES,
  extractProductHuntEntriesFromHar,
  extractProductHuntEntriesFromHtml,
  resolveProductHuntData,
} from "../scripts/producthunt_provider.mjs";

const SAMPLE_HTML = `
<!doctype html>
<html>
  <head><title>Leaderboard</title></head>
  <body>
    <script>
      window.__APOLLO_STATE__ = {
        "Post:1": {
          "__typename": "Post",
          "id": "1",
          "name": "Agent Dock",
          "tagline": "An inbox for AI agents",
          "slug": "agent-dock",
          "votesCount": 321,
          "website": "https://agentdock.example"
        },
        "Post:2": {
          "__typename": "Post",
          "id": "2",
          "name": "Prompt Forge",
          "tagline": "Prompt testing for product teams",
          "slug": "prompt-forge",
          "votesCount": 98
        }
      };
    </script>
  </body>
</html>
`;

const CHALLENGE_HTML = `
<!doctype html>
<html>
  <head><title>Just a moment...</title></head>
  <body>
    <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
    Performing security verification
  </body>
</html>
`;

const SAMPLE_HAR = {
  log: {
    entries: [
      {
        request: { url: "https://www.producthunt.com/frontend/graphql" },
        response: {
          status: 200,
          content: {
            text: JSON.stringify({
              data: {
                posts: {
                  edges: [
                    {
                      node: {
                        __typename: "Post",
                        id: "3",
                        name: "Launch Lens",
                        tagline: "Track fresh launches",
                        slug: "launch-lens",
                        votesCount: 77,
                      },
                    },
                  ],
                },
              },
            }),
          },
        },
      },
    ],
  },
};

test("extractProductHuntEntriesFromHtml returns normalized posts from embedded state", () => {
  const result = extractProductHuntEntriesFromHtml(SAMPLE_HTML, {
    date: "2026-03-27",
    url: "https://www.producthunt.com/leaderboard/daily/2026/3/27",
  });

  assert.equal(result.status, "ok");
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items[0], {
    id: "1",
    name: "Agent Dock",
    tagline: "An inbox for AI agents",
    slug: "agent-dock",
    productHuntUrl: "https://www.producthunt.com/posts/agent-dock",
    websiteUrl: "https://agentdock.example",
    votesCount: 321,
  });
});

test("extractProductHuntEntriesFromHar returns normalized posts from GraphQL payload", () => {
  const result = extractProductHuntEntriesFromHar(SAMPLE_HAR);

  assert.equal(result.status, "ok");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, "Launch Lens");
  assert.equal(result.items[0].slug, "launch-lens");
});

test("extractProductHuntEntriesFromHtml returns a fixed reason code for challenge pages", () => {
  const result = extractProductHuntEntriesFromHtml(CHALLENGE_HTML, {
    date: "2026-03-27",
    url: "https://www.producthunt.com/leaderboard/daily/2026/3/27",
  });

  assert.equal(result.status, "degraded");
  assert.equal(result.reasonCode, PRODUCT_HUNT_REASON_CODES.HTML_BROWSER_CAPTURE_REQUIRED);
});

test("resolveProductHuntData prefers fresh cache without fetching", async () => {
  const cacheRecord = {
    fetchedAt: "2026-03-27T04:00:00.000Z",
    sourceType: "cache",
    items: [
      {
        id: "1",
        name: "Agent Dock",
        tagline: "An inbox for AI agents",
        slug: "agent-dock",
        productHuntUrl: "https://www.producthunt.com/posts/agent-dock",
        websiteUrl: "https://agentdock.example",
        votesCount: 321,
      },
    ],
  };
  const fsOps = {
    async readFile(filePath) {
      assert.match(filePath, /producthunt-2026-03-27\.json$/);
      return JSON.stringify(cacheRecord);
    },
    async mkdir() {
      throw new Error("mkdir should not be called for fresh cache hit");
    },
    async writeFile() {
      throw new Error("writeFile should not be called for fresh cache hit");
    },
  };

  const result = await resolveProductHuntData({
    date: "2026-03-27",
    now: "2026-03-27T04:30:00.000Z",
    cacheTtlMs: 60 * 60 * 1000,
    fetchImpl: async () => {
      throw new Error("fetch should not run on fresh cache hit");
    },
    fsOps,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.cacheHit, true);
  assert.equal(result.sourceType, "cache");
  assert.equal(result.reasonCode, null);
  assert.equal(result.items.length, 1);
});

test("resolveProductHuntData falls back to stale cache when fetched html is challenged", async () => {
  const fsOps = {
    async readFile(filePath) {
      if (/producthunt-2026-03-27\.json$/.test(filePath)) {
        return JSON.stringify({
          fetchedAt: "2026-03-27T01:00:00.000Z",
          sourceType: "network-html",
          items: [
            {
              id: "1",
              name: "Agent Dock",
              tagline: "An inbox for AI agents",
              slug: "agent-dock",
              productHuntUrl: "https://www.producthunt.com/posts/agent-dock",
              websiteUrl: "https://agentdock.example",
              votesCount: 321,
            },
          ],
        });
      }

      if (/ph_cookies\.json$/.test(filePath)) {
        return JSON.stringify([{ name: "_producthunt_session_production", value: "session123" }]);
      }

      throw new Error(`unexpected readFile: ${filePath}`);
    },
    async mkdir() {},
    async writeFile() {},
  };

  const result = await resolveProductHuntData({
    date: "2026-03-27",
    now: "2026-03-27T08:00:00.000Z",
    cacheTtlMs: 60 * 60 * 1000,
    allowStaleCacheOnFailure: true,
    cookieFile: "C:/tmp/ph_cookies.json",
    fetchImpl: async () => ({
      status: 200,
      text: async () => CHALLENGE_HTML,
    }),
    fsOps,
  });

  assert.equal(result.status, "degraded");
  assert.equal(result.staleCacheUsed, true);
  assert.equal(result.reasonCode, PRODUCT_HUNT_REASON_CODES.HTML_BROWSER_CAPTURE_REQUIRED);
  assert.equal(result.items.length, 1);
  assert.match(result.reason, /stale cache/i);
});

test("resolveProductHuntData returns a fixed reason code for HTTP errors without cache", async () => {
  const fsOps = {
    async readFile() {
      return null;
    },
    async mkdir() {},
    async writeFile() {},
  };

  const result = await resolveProductHuntData({
    date: "2026-03-27",
    now: "2026-03-27T08:00:00.000Z",
    cacheTtlMs: 60 * 60 * 1000,
    allowStaleCacheOnFailure: true,
    fetchImpl: async () => ({
      status: 403,
      text: async () => "",
    }),
    fsOps,
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.reasonCode, PRODUCT_HUNT_REASON_CODES.HTTP_ERROR);
  assert.match(result.reason, /HTTP 403/);
});
