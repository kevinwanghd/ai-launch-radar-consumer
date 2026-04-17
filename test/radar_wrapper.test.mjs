import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDataExportPaths,
  buildDailyRadarPath,
  cleanupHistoricalDataExports,
  computeOverallStatus,
  extractReportMetrics,
  interpretPhInspectorResult,
  mapSourceStatuses,
  prepareDataExports,
  prepareAutomationArtifacts,
  renderDailyRadarNote,
  summarizeForFeishu,
  validateReportBody,
  writeAutomationArtifacts,
  writeDailyRadarNote,
} from "../scripts/radar_wrapper.mjs";

const SAMPLE_REPORT = `# AI Launch Radar

## Picks
### Alpha Agent
- Category: agent/workflow
- Sources: GitHub, X
- Opportunity Score: 76
- Content Score: 64
- Confidence Score: 71

### Beta Copilot
- Category: developer-tool
- Sources: GitHub
- Opportunity Score: 66
- Content Score: 58
- Confidence Score: 55

## Watchlist
- **Gamma Studio** — other-ai — Opp 52 / Content 57 / Conf 49 — fresh launch chatter
- **Delta Inbox** — agent/workflow — Opp 48 / Content 61 / Conf 45 — early feedback loop

## Summary
- Best product opportunity: Alpha Agent
- Best content opportunity: Beta Copilot
- Most uncertain but interesting: Gamma Studio
`;

test("buildDailyRadarPath outputs directly to base directory with dated filename (no monthly subfolder)", () => {
  assert.deepEqual(buildDailyRadarPath({ date: "2026-03-27" }), {
    dirPath: "C:/Users/kevin/Documents/Obsidian Vault/AI Launch Radar",
    filePath: "C:/Users/kevin/Documents/Obsidian Vault/AI Launch Radar/2026-03-27-AI-Launch-Radar.md",
  });
});

test("buildDataExportPaths creates a per-day data directory and required file paths", () => {
  assert.deepEqual(buildDataExportPaths({ date: "2026-03-27" }), {
    dirPath: "C:/Users/kevin/Documents/Obsidian Vault/AI Launch Radar/data/2026-03-27",
    githubFilePath: "C:/Users/kevin/Documents/Obsidian Vault/AI Launch Radar/data/2026-03-27/github.json",
    xFilePath: "C:/Users/kevin/Documents/Obsidian Vault/AI Launch Radar/data/2026-03-27/x.json",
    producthuntFilePath: "C:/Users/kevin/Documents/Obsidian Vault/AI Launch Radar/data/2026-03-27/producthunt.json",
    runSummaryFilePath: "C:/Users/kevin/Documents/Obsidian Vault/AI Launch Radar/data/2026-03-27/run-summary.json",
  });
});

test("buildDailyRadarPath preserves zero padding and validates date", () => {
  assert.equal(
    buildDailyRadarPath({ date: "2026-01-02" }).filePath,
    "C:/Users/kevin/Documents/Obsidian Vault/AI Launch Radar/2026-01-02-AI-Launch-Radar.md",
  );
  assert.throws(() => buildDailyRadarPath({ date: "2026-13-40" }), /Invalid date/);
});

test("interpretPhInspectorResult maps browser-capture requirement to degraded", () => {
  const result = interpretPhInspectorResult({
    exitCode: 2,
    inspectorJson: {
      needsBrowserCapture: true,
      blockers: [{ type: "cloudflare_challenge" }],
      signals: { homefeedEdgesEmpty: true },
      warnings: ["Apollo SSR present but homefeedItems.edges is empty in captured HTML."],
    },
  });

  assert.equal(result.status, "degraded");
  assert.match(result.reason, /real browser capture/i);
  assert.ok(result.details.some((detail) => detail.includes("cloudflare_challenge")));
});

test("mapSourceStatuses keeps GitHub and X simple and PH unavailable on inspector failure", () => {
  const statuses = mapSourceStatuses({
    github: "ok",
    x: "unavailable",
    phInspection: { exitCode: 1, inspectorJson: { warnings: ["parse error"] } },
  });

  assert.equal(statuses.github.status, "ok");
  assert.equal(statuses.x.status, "unavailable");
  assert.equal(statuses.producthunt.status, "unavailable");
  assert.equal(computeOverallStatus(statuses), "degraded");
});

test("renderDailyRadarNote includes front matter and run status before picks", () => {
  const sourceStatuses = mapSourceStatuses({
    github: "ok",
    x: "ok",
    phInspection: {
      exitCode: 2,
      inspectorJson: {
        needsBrowserCapture: true,
        blockers: [{ type: "cloudflare_challenge" }],
        warnings: ["needs browser capture"],
      },
    },
  });

  const note = renderDailyRadarNote({
    date: "2026-03-27",
    generatedAt: "2026-03-27T04:00:00.000Z",
    timeWindowHours: 72,
    sourceStatuses,
    reportBody: SAMPLE_REPORT,
  });

  assert.match(note, /^---\ndate: 2026-03-27\ntags: \[ai-launch-radar, ai, launch-radar\]\nstatus: active\npath_type: daily-radar\nsources:\n  github: ok\n  x: ok\n  producthunt: degraded\n---/);
  assert.ok(note.indexOf("## Run Status") < note.indexOf("## Picks"));
  assert.match(note, /Product Hunt: degraded/);
  assert.match(note, /needs browser capture/i);
});

test("extractReportMetrics and summarizeForFeishu produce concise automation output", () => {
  const metrics = extractReportMetrics(SAMPLE_REPORT);
  assert.deepEqual(metrics, {
    picksCount: 2,
    watchlistCount: 2,
    topOpportunity: "Alpha Agent",
  });

  const summary = summarizeForFeishu({
    status: "degraded",
    filePath: "C:/tmp/radar.md",
    ...metrics,
  });

  assert.deepEqual(summary, {
    status: "degraded",
    outputPath: "C:/tmp/radar.md",
    picksCount: 2,
    watchlistCount: 2,
    topOpportunity: "Alpha Agent",
  });
});

test("renderDailyRadarNote and metrics handle CRLF markdown input", () => {
  const crlfReport = SAMPLE_REPORT.replace(/\n/g, "\r\n");
  const sourceStatuses = mapSourceStatuses({ github: "ok", x: "ok", producthunt: "ok" });

  const note = renderDailyRadarNote({
    date: "2026-03-27",
    generatedAt: "2026-03-27T04:00:00.000Z",
    timeWindowHours: 72,
    sourceStatuses,
    reportBody: crlfReport,
  });

  const metrics = extractReportMetrics(crlfReport);
  assert.equal((note.match(/^# AI Launch Radar$/gmu) ?? []).length, 1);
  assert.deepEqual(metrics, {
    picksCount: 2,
    watchlistCount: 2,
    topOpportunity: "Alpha Agent",
  });
});

test("validateReportBody rejects fabricated Google quota failures", () => {
  assert.throws(
    () => validateReportBody(`# AI Launch Radar

## Run Status
- GitHub: unavailable

## Summary
1. Google API 配额耗尽导致搜索失败
`),
    /Google API quota exhaustion/i,
  );
});

test("prepareAutomationArtifacts assembles note path, summary, and degraded PH state", async () => {
  const artifacts = await prepareAutomationArtifacts({
    date: "2026-03-27",
    generatedAt: "2026-03-27T04:00:00.000Z",
    reportBody: SAMPLE_REPORT,
    baseDir: "C:/vault/AI Launch Radar",
    githubStatus: "ok",
    xStatus: "ok",
    phInspection: {
      exitCode: 2,
      inspectorJson: {
        needsBrowserCapture: true,
        warnings: ["challenge"],
      },
    },
  });

  assert.equal(artifacts.filePath, "C:/vault/AI Launch Radar/2026-03-27-AI-Launch-Radar.md");
  assert.equal(artifacts.sourceStatuses.github.status, "degraded");
  assert.equal(artifacts.sourceStatuses.x.status, "degraded");
  assert.equal(artifacts.sourceStatuses.producthunt.status, "degraded");
  assert.equal(artifacts.summary.status, "degraded");
  assert.equal(artifacts.summary.picksCount, 2);
  assert.equal(artifacts.dataExports.github.status, "degraded");
  assert.equal(artifacts.dataExports.x.status, "degraded");
  assert.equal(artifacts.dataExports.producthunt.status, "degraded");
  assert.equal(artifacts.runSummary.sources.github.status, "degraded");
  assert.equal(artifacts.runSummary.sources.x.status, "degraded");
  assert.equal(artifacts.runSummary.sources.producthunt.status, "degraded");
  assert.equal(artifacts.runSummary.report_path, "C:/vault/AI Launch Radar/2026-03-27-AI-Launch-Radar.md");
});

test("prepareAutomationArtifacts preserves Product Hunt items from phCollection when no explicit producthuntItems are passed", async () => {
  const artifacts = await prepareAutomationArtifacts({
    date: "2026-03-27",
    generatedAt: "2026-03-27T04:00:00.000Z",
    reportBody: SAMPLE_REPORT,
    baseDir: "C:/vault/AI Launch Radar",
    githubStatus: "ok",
    xStatus: "ok",
    phCollection: {
      status: "degraded",
      sourceType: "cache",
      staleCacheUsed: true,
      reason: "HTML was challenged. Falling back to stale cache.",
      details: ["challenge marker"],
      items: [
        {
          id: "ph-1",
          name: "Alpha Agent",
          tagline: "Launch workflows for AI teams",
          productHuntUrl: "https://www.producthunt.com/posts/alpha-agent",
          websiteUrl: "https://alpha.example",
          votesCount: 123,
        },
      ],
    },
  });

  assert.equal(artifacts.dataExports.producthunt.count, 1);
  assert.equal(artifacts.runSummary.sources.producthunt.count, 1);
});

test("mapSourceStatuses can consume Product Hunt provider output directly", () => {
  const statuses = mapSourceStatuses({
    github: "ok",
    x: "ok",
    phCollection: {
      status: "degraded",
      sourceType: "cache",
      reasonCode: "ph_http_error",
      cacheHit: false,
      staleCacheUsed: true,
      reason: "HTML was challenged. Falling back to stale cache.",
      details: ["challenge marker"],
    },
  });

  assert.equal(statuses.producthunt.status, "degraded");
  assert.match(statuses.producthunt.reason, /stale cache/i);
  assert.ok(statuses.producthunt.details.includes("code=ph_http_error"));
  assert.ok(statuses.producthunt.details.includes("source=cache"));
  assert.ok(statuses.producthunt.details.includes("stale cache"));
});

test("module can be imported in ESM runtime", async () => {
  const module = await import("../scripts/radar_wrapper.mjs");
  assert.equal(typeof module.prepareAutomationArtifacts, "function");
});

test("writeDailyRadarNote writes exact content through injected fs ops", async () => {
  const calls = [];
  const fsOps = {
    async mkdir(dirPath, options) {
      calls.push(["mkdir", dirPath, options]);
    },
    async writeFile(filePath, content, encoding) {
      calls.push(["writeFile", filePath, content, encoding]);
    },
  };

  await writeDailyRadarNote({
    filePath: "C:/vault/AI Launch Radar/2026-03-27-AI-Launch-Radar.md",
    content: "hello",
    fsOps,
  });

  assert.deepEqual(calls, [
    ["mkdir", "C:/vault/AI Launch Radar", { recursive: true }],
    ["writeFile", "C:/vault/AI Launch Radar/2026-03-27-AI-Launch-Radar.md", "hello", "utf8"],
  ]);
});

test("prepareDataExports normalizes source exports and run summary", () => {
  const sourceStatuses = mapSourceStatuses({
    github: "ok",
    x: "unavailable",
    phCollection: {
      status: "degraded",
      sourceType: "cache",
      staleCacheUsed: true,
      reason: "HTML was challenged. Falling back to stale cache.",
      details: ["challenge marker"],
      items: [
        {
          id: "1",
          name: "Agent Dock",
          tagline: "An inbox for AI agents",
          productHuntUrl: "https://www.producthunt.com/posts/agent-dock",
          websiteUrl: "https://agentdock.example",
          votesCount: 321,
        },
      ],
    },
  });

  const exportsBundle = prepareDataExports({
    date: "2026-03-27",
    generatedAt: "2026-03-27T04:00:00.000Z",
    filePath: "C:/vault/AI Launch Radar/2026-03-27-AI-Launch-Radar.md",
    sourceStatuses,
    githubItems: [{ source_id: "repo-1", name: "Repo One", url: "https://github.com/acme/repo-one" }],
    xItems: [],
    phCollection: {
      status: "degraded",
      sourceType: "cache",
      staleCacheUsed: true,
      reason: "HTML was challenged. Falling back to stale cache.",
      details: ["challenge marker"],
      items: [
        {
          id: "1",
          name: "Agent Dock",
          tagline: "An inbox for AI agents",
          productHuntUrl: "https://www.producthunt.com/posts/agent-dock",
          websiteUrl: "https://agentdock.example",
          votesCount: 321,
        },
      ],
    },
  });

  assert.deepEqual(exportsBundle.githubExport, {
    source: "github",
    date: "2026-03-27",
    captured_at: "2026-03-27T04:00:00.000Z",
    status: "ok",
    count: 1,
    notes: [],
    items: [{ source_id: "repo-1", name: "Repo One", url: "https://github.com/acme/repo-one" }],
  });
  assert.equal(exportsBundle.xExport.status, "unavailable");
  assert.equal(exportsBundle.xExport.count, 0);
  assert.equal(exportsBundle.producthuntExport.status, "degraded");
  assert.equal(exportsBundle.producthuntExport.count, 1);
  assert.deepEqual(exportsBundle.producthuntExport.items[0], {
    source_id: "1",
    name: "Agent Dock",
    tagline: "An inbox for AI agents",
    url: "https://www.producthunt.com/posts/agent-dock",
    website_url: "https://agentdock.example",
    score: 321,
  });
  assert.equal(exportsBundle.runSummary.overall_status, "degraded");
  assert.equal(exportsBundle.runSummary.sources.github.count, 1);
  assert.equal(exportsBundle.runSummary.sources.x.count, 0);
  assert.equal(exportsBundle.runSummary.sources.producthunt.count, 1);
  assert.equal(exportsBundle.runSummary.report_path, "C:/vault/AI Launch Radar/2026-03-27-AI-Launch-Radar.md");
});

test("prepareDataExports downgrades empty ok GitHub and X exports", () => {
  const sourceStatuses = mapSourceStatuses({
    github: "ok",
    x: "ok",
    producthunt: "ok",
  });

  const exportsBundle = prepareDataExports({
    date: "2026-03-27",
    generatedAt: "2026-03-27T04:00:00.000Z",
    filePath: "C:/vault/AI Launch Radar/2026-03-27-AI-Launch-Radar.md",
    sourceStatuses,
    githubItems: [],
    xItems: [],
    producthuntItems: [{ id: "ph-1", name: "Alpha" }],
  });

  assert.equal(exportsBundle.githubExport.status, "degraded");
  assert.equal(exportsBundle.xExport.status, "degraded");
  assert.match(exportsBundle.githubExport.notes[0], /No GitHub candidates were exported/i);
  assert.match(exportsBundle.xExport.notes[0], /No X candidates were exported/i);
  assert.equal(exportsBundle.runSummary.sources.github.status, "degraded");
  assert.equal(exportsBundle.runSummary.sources.x.status, "degraded");
});

test("writeAutomationArtifacts writes source exports, run summary, and note", async () => {
  const calls = [];
  const fsOps = {
    async mkdir(dirPath, options) {
      calls.push(["mkdir", dirPath, options]);
    },
    async writeFile(filePath, content, encoding) {
      calls.push(["writeFile", filePath, content, encoding]);
    },
  };

  await writeAutomationArtifacts({
    artifacts: {
      filePath: "C:/vault/AI Launch Radar/2026-03-27-AI-Launch-Radar.md",
      noteContent: "# AI Launch Radar\n",
      dataExportPaths: buildDataExportPaths({ date: "2026-03-27", baseDir: "C:/vault/AI Launch Radar" }),
      dataExports: {
        github: { source: "github", date: "2026-03-27", captured_at: "2026-03-27T04:00:00.000Z", status: "ok", count: 0, notes: [], items: [] },
        x: { source: "x", date: "2026-03-27", captured_at: "2026-03-27T04:00:00.000Z", status: "ok", count: 0, notes: [], items: [] },
        producthunt: { source: "producthunt", date: "2026-03-27", captured_at: "2026-03-27T04:00:00.000Z", status: "degraded", count: 0, notes: ["challenge"], items: [] },
      },
      runSummary: {
        date: "2026-03-27",
        captured_at: "2026-03-27T04:00:00.000Z",
        overall_status: "degraded",
        sources: {
          github: { status: "ok", count: 0 },
          x: { status: "ok", count: 0 },
          producthunt: { status: "degraded", count: 0 },
        },
        report_path: "C:/vault/AI Launch Radar/2026-03-27-AI-Launch-Radar.md",
      },
    },
    writeNote: true,
    fsOps,
  });

  assert.deepEqual(calls, [
    ["mkdir", "C:/vault/AI Launch Radar/data/2026-03-27", { recursive: true }],
    ["writeFile", "C:/vault/AI Launch Radar/data/2026-03-27/github.json", '{\n  "source": "github",\n  "date": "2026-03-27",\n  "captured_at": "2026-03-27T04:00:00.000Z",\n  "status": "ok",\n  "count": 0,\n  "notes": [],\n  "items": []\n}\n', "utf8"],
    ["writeFile", "C:/vault/AI Launch Radar/data/2026-03-27/x.json", '{\n  "source": "x",\n  "date": "2026-03-27",\n  "captured_at": "2026-03-27T04:00:00.000Z",\n  "status": "ok",\n  "count": 0,\n  "notes": [],\n  "items": []\n}\n', "utf8"],
    ["writeFile", "C:/vault/AI Launch Radar/data/2026-03-27/producthunt.json", '{\n  "source": "producthunt",\n  "date": "2026-03-27",\n  "captured_at": "2026-03-27T04:00:00.000Z",\n  "status": "degraded",\n  "count": 0,\n  "notes": [\n    "challenge"\n  ],\n  "items": []\n}\n', "utf8"],
    ["writeFile", "C:/vault/AI Launch Radar/data/2026-03-27/run-summary.json", '{\n  "date": "2026-03-27",\n  "captured_at": "2026-03-27T04:00:00.000Z",\n  "overall_status": "degraded",\n  "sources": {\n    "github": {\n      "status": "ok",\n      "count": 0\n    },\n    "x": {\n      "status": "ok",\n      "count": 0\n    },\n    "producthunt": {\n      "status": "degraded",\n      "count": 0\n    }\n  },\n  "report_path": "C:/vault/AI Launch Radar/2026-03-27-AI-Launch-Radar.md"\n}\n', "utf8"],
    ["mkdir", "C:/vault/AI Launch Radar", { recursive: true }],
    ["writeFile", "C:/vault/AI Launch Radar/2026-03-27-AI-Launch-Radar.md", "# AI Launch Radar\n", "utf8"],
  ]);
});

test("cleanupHistoricalDataExports keeps recent days, trims mid-age details, and removes stale directories", async () => {
  const calls = [];
  const fsOps = {
    async readdir(dirPath, options) {
      assert.equal(dirPath, "C:/vault/AI Launch Radar/data");
      assert.deepEqual(options, { withFileTypes: true });
      return [
        { name: "2026-03-27", isDirectory: () => true },
        { name: "2026-03-24", isDirectory: () => true },
        { name: "2026-03-18", isDirectory: () => true },
        { name: "2026-02-20", isDirectory: () => true },
        { name: "not-a-date", isDirectory: () => true },
        { name: "README.md", isDirectory: () => false },
      ];
    },
    async unlink(filePath) {
      calls.push(["unlink", filePath]);
    },
    async rm(filePath, options) {
      calls.push(["rm", filePath, options]);
    },
  };

  const result = await cleanupHistoricalDataExports({
    baseDir: "C:/vault/AI Launch Radar",
    currentDate: "2026-03-27",
    retainFullDays: 7,
    retainSummaryDays: 30,
    fsOps,
  });

  assert.deepEqual(result, {
    trimmedDates: ["2026-03-18"],
    removedDates: ["2026-02-20"],
  });
  assert.deepEqual(calls, [
    ["unlink", "C:/vault/AI Launch Radar/data/2026-03-18/github.json"],
    ["unlink", "C:/vault/AI Launch Radar/data/2026-03-18/x.json"],
    ["unlink", "C:/vault/AI Launch Radar/data/2026-03-18/producthunt.json"],
    ["rm", "C:/vault/AI Launch Radar/data/2026-02-20", { recursive: true, force: true }],
  ]);
});
