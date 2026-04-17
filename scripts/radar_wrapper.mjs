#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_OBSIDIAN_BASE_DIR = "C:/Users/kevin/Documents/Obsidian Vault/AI Launch Radar";
const VALID_SOURCE_STATUS = new Set(["ok", "degraded", "unavailable"]);
const VALID_SIMPLE_SOURCE_STATUS = new Set(["ok", "unavailable"]);

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function normalizeDateInput(dateInput) {
  if (typeof dateInput !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    throw new Error("Invalid date: expected YYYY-MM-DD");
  }

  const [year, month, day] = dateInput.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Invalid date: expected a real calendar date");
  }

  return { year, month: pad2(month), day: pad2(day), date: `${year}-${pad2(month)}-${pad2(day)}` };
}

export function buildDailyRadarPath({ baseDir = DEFAULT_OBSIDIAN_BASE_DIR, date }) {
  if (typeof baseDir !== "string" || !baseDir.trim()) {
    throw new Error("Invalid baseDir: expected a non-empty path");
  }

  const normalized = normalizeDateInput(date);
  const fileName = `${normalized.date}-AI-Launch-Radar.md`;
  const dirPath = baseDir;
  const filePath = path.posix.join(dirPath, fileName);
  return { dirPath, filePath };
}

export function buildDataExportPaths({ baseDir = DEFAULT_OBSIDIAN_BASE_DIR, date }) {
  if (typeof baseDir !== "string" || !baseDir.trim()) {
    throw new Error("Invalid baseDir: expected a non-empty path");
  }

  const normalized = normalizeDateInput(date);
  const dirPath = path.posix.join(baseDir, "data", normalized.date);
  return {
    dirPath,
    githubFilePath: path.posix.join(dirPath, "github.json"),
    xFilePath: path.posix.join(dirPath, "x.json"),
    producthuntFilePath: path.posix.join(dirPath, "producthunt.json"),
    runSummaryFilePath: path.posix.join(dirPath, "run-summary.json"),
  };
}

function buildDataRootPath(baseDir = DEFAULT_OBSIDIAN_BASE_DIR) {
  return path.posix.join(baseDir, "data");
}

function diffDaysFromIsoDate(currentDate, candidateDate) {
  const current = normalizeDateInput(currentDate);
  const candidate = normalizeDateInput(candidateDate);
  const currentMs = Date.UTC(Number(current.year), Number(current.month) - 1, Number(current.day));
  const candidateMs = Date.UTC(Number(candidate.year), Number(candidate.month) - 1, Number(candidate.day));
  return Math.floor((currentMs - candidateMs) / (24 * 60 * 60 * 1000));
}

export function interpretPhInspectorResult({ exitCode = 0, inspectorJson = null, skipped = false, reason = null } = {}) {
  if (skipped) {
    return {
      status: "unavailable",
      reason: reason ?? "Product Hunt was skipped.",
      details: [],
    };
  }

  const warnings = Array.isArray(inspectorJson?.warnings) ? inspectorJson.warnings : [];
  const blockers = Array.isArray(inspectorJson?.blockers)
    ? inspectorJson.blockers.map((blocker) => blocker?.type).filter(Boolean)
    : [];
  const edgesEmpty = inspectorJson?.signals?.homefeedEdgesEmpty === true;
  const needsBrowserCapture = inspectorJson?.needsBrowserCapture === true || exitCode === 2 || edgesEmpty;

  if (exitCode === 1) {
    return {
      status: "unavailable",
      reason: reason ?? "Product Hunt inspector failed locally.",
      details: warnings,
    };
  }

  if (needsBrowserCapture) {
    const detailParts = [];
    if (blockers.length > 0) detailParts.push(`blockers=${blockers.join(",")}`);
    if (edgesEmpty) detailParts.push("homefeedItems.edges empty");
    return {
      status: "degraded",
      reason: reason ?? "Product Hunt requires real browser capture.",
      details: [...detailParts, ...warnings],
    };
  }

  return {
    status: "ok",
    reason: null,
    details: warnings,
  };
}

export function interpretPhCollectionResult(phCollection = null) {
  if (!phCollection) return null;

  if (!VALID_SOURCE_STATUS.has(phCollection.status)) {
    throw new Error("Invalid phCollection status: expected ok, degraded, or unavailable");
  }

  const details = [];
  if (typeof phCollection.sourceType === "string" && phCollection.sourceType) details.push(`source=${phCollection.sourceType}`);
  if (typeof phCollection.reasonCode === "string" && phCollection.reasonCode) details.push(`code=${phCollection.reasonCode}`);
  if (phCollection.cacheHit === true) details.push("cache hit");
  if (phCollection.staleCacheUsed === true) details.push("stale cache");
  if (Array.isArray(phCollection.details)) details.push(...phCollection.details.filter(Boolean));

  return {
    status: phCollection.status,
    reason: phCollection.reason ?? null,
    details,
  };
}

function normalizeSimpleSourceStatus(status, sourceName) {
  if (!VALID_SIMPLE_SOURCE_STATUS.has(status)) {
    throw new Error(`Invalid ${sourceName} status: expected ok or unavailable`);
  }
  return status;
}

export function mapSourceStatuses({
  github = "ok",
  x = "ok",
  producthunt = null,
  producthuntReason = null,
  phInspection = null,
  phCollection = null,
} = {}) {
  const githubStatus = normalizeSimpleSourceStatus(github, "github");
  const xStatus = normalizeSimpleSourceStatus(x, "x");

  let productHuntStatus;
  if (phCollection) {
    productHuntStatus = interpretPhCollectionResult(phCollection);
  } else if (phInspection) {
    productHuntStatus = interpretPhInspectorResult(phInspection);
  } else {
    const candidateStatus = producthunt ?? "ok";
    if (!VALID_SOURCE_STATUS.has(candidateStatus)) {
      throw new Error("Invalid producthunt status: expected ok, degraded, or unavailable");
    }
    productHuntStatus = { status: candidateStatus, reason: producthuntReason, details: [] };
  }

  return {
    github: { status: githubStatus, reason: null, details: [] },
    x: { status: xStatus, reason: null, details: [] },
    producthunt: productHuntStatus,
  };
}

export function renderFrontMatter({ date, sourceStatuses }) {
  const normalized = normalizeDateInput(date);
  return [
    "---",
    `date: ${normalized.date}`,
    "tags: [ai-launch-radar, ai, launch-radar]",
    "status: active",
    "path_type: daily-radar",
    "sources:",
    `  github: ${sourceStatuses.github.status}`,
    `  x: ${sourceStatuses.x.status}`,
    `  producthunt: ${sourceStatuses.producthunt.status}`,
    "---",
  ].join("\n");
}

function formatReasonLine(sourceName, sourceStatus) {
  const uniqueDetails = Array.isArray(sourceStatus.details)
    ? [...new Set(sourceStatus.details.filter((detail) => detail && detail !== sourceStatus.reason))]
    : [];
  const detailText = uniqueDetails.length > 0
    ? ` (${uniqueDetails.join("; ")})`
    : "";
  if (sourceStatus.reason) {
    return `- ${sourceName}: ${sourceStatus.status} - ${sourceStatus.reason}${detailText}`;
  }
  return `- ${sourceName}: ${sourceStatus.status}${detailText}`;
}

export function buildRunStatus({ generatedAt, timeWindowHours, sourceStatuses }) {
  if (!generatedAt || Number.isNaN(new Date(generatedAt).getTime())) {
    throw new Error("Invalid generatedAt: expected ISO timestamp or parseable date");
  }

  const dt = new Date(generatedAt);
  const localStr = dt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  const lines = [
    "## Run Status",
    `- Generated at: ${localStr} (Asia/Shanghai)`,
    `- Scan window: last ${timeWindowHours} hours`,
    formatReasonLine("GitHub", sourceStatuses.github),
    formatReasonLine("X", sourceStatuses.x),
    formatReasonLine("Product Hunt", sourceStatuses.producthunt),
  ];

  return lines.join("\n");
}

function normalizeMarkdown(reportBody) {
  return reportBody.replace(/\r\n/g, "\n");
}

const FORBIDDEN_REPORT_PATTERNS = [
  {
    pattern: /Google API 配额耗尽导致搜索失败/iu,
    reason: "Report claims Google API quota exhaustion, but AI Launch Radar does not require Google API by default.",
  },
  {
    pattern: /网络搜索配额超限/iu,
    reason: "Report claims a generic search quota exhaustion without a backing source-specific provider.",
  },
  {
    pattern: /Google API quota exhausted/iu,
    reason: "Report claims Google API quota exhaustion, but AI Launch Radar does not require Google API by default.",
  },
];

function stripLeadingHeading(reportBody) {
  return normalizeMarkdown(reportBody).replace(/^#\s+AI Launch Radar\s*\n+/u, "").trim();
}

export function validateReportBody(reportBody) {
  if (typeof reportBody !== "string" || !reportBody.trim()) {
    throw new Error("Invalid reportBody: expected non-empty markdown");
  }

  for (const rule of FORBIDDEN_REPORT_PATTERNS) {
    if (rule.pattern.test(reportBody)) {
      throw new Error(`Invalid reportBody: ${rule.reason}`);
    }
  }
}

export function renderDailyRadarNote({ date, generatedAt, timeWindowHours = 72, sourceStatuses, reportBody }) {
  validateReportBody(reportBody);

  const frontMatter = renderFrontMatter({ date, sourceStatuses });
  const runStatus = buildRunStatus({ generatedAt, timeWindowHours, sourceStatuses });
  const body = stripLeadingHeading(reportBody);

  return `${frontMatter}\n\n# AI Launch Radar\n\n${runStatus}\n\n${body}\n`;
}

export function extractReportMetrics(reportBody) {
  const body = stripLeadingHeading(reportBody);
  const picksSectionMatch = body.match(/## (?:Picks|精选)\n([\s\S]*?)(\n## |$)/u);
  const watchlistSectionMatch = body.match(/## (?:Watchlist|观察列表)\n([\s\S]*?)(\n## |$)/u);

  const picksBlock = picksSectionMatch?.[1] ?? "";
  const watchlistBlock = watchlistSectionMatch?.[1] ?? "";
  const picks = [...picksBlock.matchAll(/^###\s+(.+)$/gmu)].map((match) => match[1].trim());
  const watchlistCount = [...watchlistBlock.matchAll(/^-\s+\*\*/gmu)].length;

  return {
    picksCount: picks.length,
    watchlistCount,
    topOpportunity: picks[0] ?? null,
  };
}

export function computeOverallStatus(sourceStatuses) {
  const statuses = Object.values(sourceStatuses).map((source) => source.status);
  if (statuses.includes("unavailable")) return "degraded";
  if (statuses.includes("degraded")) return "degraded";
  return "ok";
}

export function summarizeForFeishu({ status, filePath, picksCount, watchlistCount, topOpportunity }) {
  return {
    status,
    outputPath: filePath,
    picksCount,
    watchlistCount,
    topOpportunity,
  };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function downgradeEmptySimpleSource({ source, status, notes, items }) {
  const normalizedItems = normalizeArray(items);
  const normalizedNotes = normalizeArray(notes).filter(Boolean);

  if (status === "ok" && normalizedItems.length === 0) {
    return {
      status: "degraded",
      notes: [
        ...normalizedNotes,
        `No ${source} candidates were exported for this run.`,
      ],
      items: normalizedItems,
    };
  }

  return {
    status,
    notes: normalizedNotes,
    items: normalizedItems,
  };
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null)
  );
}

function normalizeSourceExport({
  source,
  date,
  generatedAt,
  status,
  notes = [],
  items = [],
}) {
  return {
    source,
    date,
    captured_at: generatedAt,
    status,
    count: items.length,
    notes: normalizeArray(notes).filter(Boolean),
    items,
  };
}

function normalizeProductHuntItems(items) {
  return normalizeArray(items).map((item) => compactObject({
    source_id: item?.source_id ?? item?.id ?? null,
    name: item?.name ?? null,
    tagline: item?.tagline ?? null,
    url: item?.url ?? item?.productHuntUrl ?? null,
    website_url: item?.website_url ?? item?.websiteUrl ?? null,
    rank: item?.rank ?? null,
    score: item?.score ?? item?.votesCount ?? null,
    comments: item?.comments ?? item?.commentsCount ?? null,
    topics: item?.topics ?? null,
    raw_ref: item?.raw_ref ?? null,
  }));
}

export function prepareDataExports({
  date,
  generatedAt = new Date().toISOString(),
  filePath = null,
  sourceStatuses,
  githubItems = [],
  xItems = [],
  producthuntItems = null,
  phCollection = null,
} = {}) {
  if (!sourceStatuses) {
    throw new Error("Invalid sourceStatuses: expected mapped source statuses");
  }

  const phItems = producthuntItems ?? phCollection?.items ?? [];
  const githubNormalized = downgradeEmptySimpleSource({
    source: "GitHub",
    status: sourceStatuses.github.status,
    notes: sourceStatuses.github.details,
    items: githubItems,
  });
  const xNormalized = downgradeEmptySimpleSource({
    source: "X",
    status: sourceStatuses.x.status,
    notes: sourceStatuses.x.details,
    items: xItems,
  });
  const githubExport = normalizeSourceExport({
    source: "github",
    date,
    generatedAt,
    status: githubNormalized.status,
    notes: githubNormalized.notes,
    items: githubNormalized.items,
  });
  const xExport = normalizeSourceExport({
    source: "x",
    date,
    generatedAt,
    status: xNormalized.status,
    notes: xNormalized.notes,
    items: xNormalized.items,
  });
  const producthuntNotes = [
    sourceStatuses.producthunt.reason,
    ...(sourceStatuses.producthunt.details ?? []),
  ].filter(Boolean);
  const producthuntExport = normalizeSourceExport({
    source: "producthunt",
    date,
    generatedAt,
    status: sourceStatuses.producthunt.status,
    notes: producthuntNotes,
    items: normalizeProductHuntItems(phItems),
  });

  const runSummary = {
    date,
    captured_at: generatedAt,
    overall_status: computeOverallStatus(sourceStatuses),
    sources: {
      github: { status: githubExport.status, count: githubExport.count },
      x: { status: xExport.status, count: xExport.count },
      producthunt: { status: producthuntExport.status, count: producthuntExport.count },
    },
    report_path: filePath,
  };

  return {
    githubExport,
    xExport,
    producthuntExport,
    runSummary,
  };
}

export async function writeDailyRadarNote({ filePath, content, fsOps = fs }) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("Invalid filePath: expected non-empty path");
  }
  await fsOps.mkdir(path.posix.dirname(filePath), { recursive: true });
  await fsOps.writeFile(filePath, content, "utf8");
}

async function writeJsonFile({ filePath, payload, fsOps = fs }) {
  await fsOps.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function cleanupHistoricalDataExports({
  baseDir = DEFAULT_OBSIDIAN_BASE_DIR,
  currentDate,
  retainFullDays = 7,
  retainSummaryDays = 30,
  fsOps = fs,
} = {}) {
  if (!currentDate) {
    throw new Error("Invalid currentDate: expected YYYY-MM-DD");
  }

  const dataRoot = buildDataRootPath(baseDir);
  let entries = [];
  try {
    entries = await fsOps.readdir(dataRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { trimmedDates: [], removedDates: [] };
    }
    throw error;
  }

  const trimmedDates = [];
  const removedDates = [];

  for (const entry of entries) {
    if (!entry?.isDirectory?.()) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;

    const ageDays = diffDaysFromIsoDate(currentDate, entry.name);
    if (ageDays < 0) continue;

    const dirPath = path.posix.join(dataRoot, entry.name);
    if (ageDays > retainSummaryDays) {
      await fsOps.rm(dirPath, { recursive: true, force: true });
      removedDates.push(entry.name);
      continue;
    }

    if (ageDays > retainFullDays) {
      await fsOps.unlink(path.posix.join(dirPath, "github.json"));
      await fsOps.unlink(path.posix.join(dirPath, "x.json"));
      await fsOps.unlink(path.posix.join(dirPath, "producthunt.json"));
      trimmedDates.push(entry.name);
    }
  }

  return { trimmedDates, removedDates };
}

export async function writeAutomationArtifacts({
  artifacts,
  writeNote = true,
  cleanupPolicy = null,
  fsOps = fs,
} = {}) {
  if (!artifacts?.dataExportPaths || !artifacts?.dataExports || !artifacts?.runSummary) {
    throw new Error("Invalid artifacts: expected data export paths, exports, and run summary");
  }

  await fsOps.mkdir(artifacts.dataExportPaths.dirPath, { recursive: true });
  await writeJsonFile({ filePath: artifacts.dataExportPaths.githubFilePath, payload: artifacts.dataExports.github, fsOps });
  await writeJsonFile({ filePath: artifacts.dataExportPaths.xFilePath, payload: artifacts.dataExports.x, fsOps });
  await writeJsonFile({ filePath: artifacts.dataExportPaths.producthuntFilePath, payload: artifacts.dataExports.producthunt, fsOps });
  await writeJsonFile({ filePath: artifacts.dataExportPaths.runSummaryFilePath, payload: artifacts.runSummary, fsOps });

  if (writeNote) {
    await writeDailyRadarNote({ filePath: artifacts.filePath, content: artifacts.noteContent, fsOps });
  }

  if (cleanupPolicy?.enabled) {
    await cleanupHistoricalDataExports({
      baseDir: cleanupPolicy.baseDir ?? DEFAULT_OBSIDIAN_BASE_DIR,
      currentDate: cleanupPolicy.currentDate,
      retainFullDays: cleanupPolicy.retainFullDays ?? 7,
      retainSummaryDays: cleanupPolicy.retainSummaryDays ?? 30,
      fsOps,
    });
  }
}

export async function prepareAutomationArtifacts({
  date,
  generatedAt = new Date().toISOString(),
  timeWindowHours = 72,
  reportBody,
  baseDir = DEFAULT_OBSIDIAN_BASE_DIR,
  githubStatus = "ok",
  xStatus = "ok",
  producthuntStatus = null,
  producthuntReason = null,
  phInspection = null,
  phCollection = null,
  githubItems = [],
  xItems = [],
  producthuntItems = null,
}) {
  const sourceStatuses = mapSourceStatuses({
    github: githubStatus,
    x: xStatus,
    producthunt: producthuntStatus,
    producthuntReason,
    phInspection,
    phCollection,
  });
  const { filePath } = buildDailyRadarPath({ baseDir, date });
  const dataExportPaths = buildDataExportPaths({ baseDir, date });
  const { githubExport, xExport, producthuntExport, runSummary } = prepareDataExports({
    date,
    generatedAt,
    filePath,
    sourceStatuses,
    githubItems,
    xItems,
    producthuntItems,
    phCollection,
  });
  const effectiveSourceStatuses = {
    github: { ...sourceStatuses.github, status: githubExport.status, details: githubExport.notes ?? [] },
    x: { ...sourceStatuses.x, status: xExport.status, details: xExport.notes ?? [] },
    producthunt: { ...sourceStatuses.producthunt, status: producthuntExport.status, details: producthuntExport.notes ?? [] },
  };
  const noteContent = renderDailyRadarNote({
    date,
    generatedAt,
    timeWindowHours,
    sourceStatuses: effectiveSourceStatuses,
    reportBody,
  });
  const metrics = extractReportMetrics(reportBody);
  const summary = summarizeForFeishu({
    status: computeOverallStatus(effectiveSourceStatuses),
    filePath,
    ...metrics,
  });

  return {
    filePath,
    dataExportPaths,
    dataExports: {
      github: githubExport,
      x: xExport,
      producthunt: producthuntExport,
    },
    runSummary,
    noteContent,
    sourceStatuses: effectiveSourceStatuses,
    summary,
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function parseArgs(argv) {
  const args = {
    write: false,
    date: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    timeWindowHours: 72,
    baseDir: DEFAULT_OBSIDIAN_BASE_DIR,
    githubStatus: "ok",
    xStatus: "ok",
    producthuntStatus: null,
    reportFile: null,
    phInspectorFile: null,
    phCollectionFile: null,
    phInspectorExitCode: 0,
    phSkipped: false,
    phReason: null,
    githubFile: null,
    xFile: null,
    producthuntItemsFile: null,
    cleanupRetention: false,
    retainFullDays: 7,
    retainSummaryDays: 30,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--write":
        args.write = true;
        break;
      case "--date":
        args.date = argv[++i];
        break;
      case "--generated-at":
        args.generatedAt = argv[++i];
        break;
      case "--time-window-hours":
        args.timeWindowHours = Number(argv[++i]);
        break;
      case "--base-dir":
        args.baseDir = argv[++i];
        break;
      case "--github-status":
        args.githubStatus = argv[++i];
        break;
      case "--x-status":
        args.xStatus = argv[++i];
        break;
      case "--producthunt-status":
        args.producthuntStatus = argv[++i];
        break;
      case "--report-file":
        args.reportFile = argv[++i];
        break;
      case "--ph-inspector-file":
        args.phInspectorFile = argv[++i];
        break;
      case "--ph-collection-file":
        args.phCollectionFile = argv[++i];
        break;
      case "--ph-inspector-exit-code":
        args.phInspectorExitCode = Number(argv[++i]);
        break;
      case "--ph-skipped":
        args.phSkipped = true;
        break;
      case "--ph-reason":
        args.phReason = argv[++i];
        break;
      case "--github-file":
        args.githubFile = argv[++i];
        break;
      case "--x-file":
        args.xFile = argv[++i];
        break;
      case "--producthunt-items-file":
        args.producthuntItemsFile = argv[++i];
        break;
      case "--cleanup-retention":
        args.cleanupRetention = true;
        break;
      case "--retain-full-days":
        args.retainFullDays = Number(argv[++i]);
        break;
      case "--retain-summary-days":
        args.retainSummaryDays = Number(argv[++i]);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function loadInspectorInput(args) {
  if (args.phSkipped) {
    return { skipped: true, reason: args.phReason };
  }

  if (!args.phInspectorFile) {
    return null;
  }

  const raw = await fs.readFile(args.phInspectorFile, "utf8");
  return {
    exitCode: args.phInspectorExitCode,
    inspectorJson: JSON.parse(raw),
    reason: args.phReason,
  };
}

async function loadPhCollectionInput(args) {
  if (!args.phCollectionFile) {
    return null;
  }

  const raw = await fs.readFile(args.phCollectionFile, "utf8");
  return JSON.parse(raw);
}

async function loadOptionalItemsFile(filePath) {
  if (!filePath) return null;
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.items)) return parsed.items;
  return [];
}

function renderFeishuResponse(summary, sourceStatuses) {
  const emojiForStatus = (status) => {
    switch (status) {
      case "ok": return "✅";
      case "degraded": return "⚠️";
      case "unavailable": return "❌";
      default: return "";
    }
  };

  const statusEmoji = emojiForStatus(summary.status);
  let response = [
    `${statusEmoji} AI Launch Radar 每日扫描已完成！`,
    "",
    `**状态**：${summary.status}`,
    `**报告路径**：${summary.outputPath.replace(/\//g, '\\')}`,
    `**精选 Picks**：${summary.picksCount} 个`,
    `**观察列表**：${summary.watchlistCount} 个`,
  ];

  if (summary.topOpportunity) {
    response.push(`**最佳产品机会**：${summary.topOpportunity} - ${summary.topOpportunityReason || "值得关注的新兴机会"}`);
  } else {
    response.push(`**最佳产品机会**：无符合条件的精选产品`);
  }

  response.push("");
  response.push("数据源状态：");
  const formatLine = (name, source) => {
    const emoji = emojiForStatus(source.status);
    const uniqueDetails = Array.isArray(source.details)
      ? [...new Set(source.details.filter((detail) => detail && detail !== source.reason))]
      : [];
    let line = `- ${name}: ${emoji} ${source.status}`;
    if (source.reason) {
      line += `（${source.reason}`;
      if (uniqueDetails.length > 0) {
        line += `; ${uniqueDetails.join("; ")}`;
      }
      line += `)`;
    } else if (uniqueDetails.length > 0) {
      line += `（${uniqueDetails.join("; ")}）`;
    }
    return line;
  };
  response.push(formatLine("GitHub", sourceStatuses.github));
  response.push(formatLine("X", sourceStatuses.x));
  response.push(formatLine("Product Hunt", sourceStatuses.producthunt));

  return response.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportBody = args.reportFile ? await fs.readFile(args.reportFile, "utf8") : await readStdin();
  if (!reportBody.trim()) {
    throw new Error("Missing report body. Pass --report-file or pipe markdown via stdin.");
  }

  const phInspection = await loadInspectorInput(args);
  const phCollection = await loadPhCollectionInput(args);
  const githubItems = await loadOptionalItemsFile(args.githubFile);
  const xItems = await loadOptionalItemsFile(args.xFile);
  const producthuntItems = await loadOptionalItemsFile(args.producthuntItemsFile);
  const artifacts = await prepareAutomationArtifacts({
    date: args.date,
    generatedAt: args.generatedAt,
    timeWindowHours: args.timeWindowHours,
    reportBody,
    baseDir: args.baseDir,
    githubStatus: args.githubStatus,
    xStatus: args.xStatus,
    producthuntStatus: args.producthuntStatus,
    producthuntReason: args.phReason,
    phInspection,
    phCollection,
    githubItems,
    xItems,
    producthuntItems,
  });

  if (args.write) {
    await writeAutomationArtifacts({
      artifacts,
      writeNote: true,
      cleanupPolicy: args.cleanupRetention ? {
        enabled: true,
        baseDir: args.baseDir,
        currentDate: args.date,
        retainFullDays: args.retainFullDays,
        retainSummaryDays: args.retainSummaryDays,
      } : null,
    });
  }

  // For cron automation: output formatted natural language for Feishu
  // (keep JSON for backward compatibility only when --json flag is requested)
  const feishuOutput = renderFeishuResponse(artifacts.summary, artifacts.sourceStatuses);
  process.stdout.write(`${feishuOutput}\n`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`ERROR: ${String(error?.message ?? error)}\n`);
    process.exit(1);
  });
}
