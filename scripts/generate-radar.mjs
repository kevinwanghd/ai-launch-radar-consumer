#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  mapSourceStatuses,
  renderDailyRadarNote,
  extractReportMetrics,
  summarizeForFeishu,
  buildDailyRadarPath,
} from "./radar_wrapper.mjs";

function parseArgs() {
  const args = {
    inputDir: process.cwd(),
    date: new Date().toISOString().slice(0, 10),
    timeWindowHours: 72,
    write: false,
  };

  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    switch (arg) {
      case "--input-dir":
        args.inputDir = process.argv[++i];
        break;
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

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function inferCategory(item) {
  const text = `${item.name || ""} ${item.tagline || ""} ${(item.topics || []).join(" ")}`.toLowerCase();
  if (text.includes("agent") || text.includes("workflow")) return "agent/workflow";
  if (text.includes("rag") || text.includes("embedding") || text.includes("vector")) return "infra/model-api";
  if (text.includes("sdk") || text.includes("cli") || text.includes("mcp") || text.includes("debug")) return "developer-tool";
  if (text.includes("saas")) return "vertical-saas";
  return "other-ai";
}

function inferAngle(item) {
  const text = `${item.name || ""} ${item.tagline || ""}`.toLowerCase();
  if (text.includes("debug") || text.includes("inspect")) return "developer painkiller";
  if (text.includes("workflow") || text.includes("agent")) return "workflow wedge";
  if (text.includes("mcp") || text.includes("sdk")) return "new UX pattern";
  if (text.includes("rag")) return "vertical niche signal";
  return "AI wrapper but strong demand";
}

function scoreGithubItem(item) {
  const stars = Number(item.stars || item.score || 0);
  const hasWebsite = Boolean(item.website_url);
  const hasTopics = Array.isArray(item.topics) && item.topics.length > 0;
  const opportunity = Math.min(85, 45 + stars * 2 + (hasWebsite ? 8 : 0) + (hasTopics ? 5 : 0));
  const content = Math.min(80, 35 + stars * 2 + (hasTopics ? 8 : 0));
  const confidence = Math.min(90, 55 + (item.url ? 10 : 0) + (item.created_at ? 10 : 0) + (hasTopics ? 5 : 0));
  return {
    opportunity_score: opportunity,
    content_score: content,
    confidence_score: confidence,
  };
}

function chooseAction(scores) {
  if (scores.opportunity_score >= 70) return "构建机会";
  if (scores.content_score >= 65) return "内容创作";
  return "持续关注";
}

function toOpportunity(item, sources) {
  const category = inferCategory(item);
  const angle = inferAngle(item);
  const scores = scoreGithubItem(item);
  const recommendedAction = chooseAction(scores);
  return {
    name: item.name,
    tagline: item.tagline || "",
    url: item.url,
    category,
    angle,
    recommendedAction,
    sources,
    ...scores,
  };
}

function buildOpportunities(githubExport, xExport, producthuntExport) {
  const xAvailable = xExport.status === "ok" ? "X" : null;
  const phAvailable = producthuntExport.status === "ok" ? "Product Hunt" : null;

  return (githubExport.items || []).map((item) => {
    const sources = ["GitHub", xAvailable, phAvailable].filter(Boolean).join(" / ");
    return toOpportunity(item, sources);
  });
}

function splitPicksAndWatchlist(opportunities) {
  const sorted = [...opportunities].sort((a, b) => {
    const aScore = Math.max(a.opportunity_score, a.content_score);
    const bScore = Math.max(b.opportunity_score, b.content_score);
    return bScore - aScore;
  });

  return {
    picks: sorted.slice(0, 5),
    watchlist: sorted.slice(5, 15),
  };
}

function renderPicks(picks) {
  if (picks.length === 0) {
    return "## Picks\n\n暂无满足条件的精选项目。";
  }

  const sections = picks.map((item) => `### ${item.name}\n\n**类别**：${item.category}　**来源**：${item.sources}　**推荐动作**：${item.recommendedAction}\n\n**评分**：产品机会 ${item.opportunity_score} ／ 内容机会 ${item.content_score} ／ 可信度 ${item.confidence_score}\n\n**为什么是现在**：该项目处于最新一轮 GitHub 信号窗口内，并且已形成可识别的产品表面。\n**为什么值得关注**：${item.tagline || "它已经具备明确的问题描述和初始可用性。"}\n**切入角度**：${item.angle}\n**主要风险**：当前仍主要依赖单一主信号源，外部验证信号还不够充分。`);

  return `## Picks\n\n${sections.join("\n\n---\n\n")}`;
}

function renderWatchlist(watchlist) {
  if (watchlist.length === 0) {
    return "## Watchlist\n\n- 暂无额外观察项";
  }

  return `## Watchlist\n${watchlist.map((item) => `- **${item.name}** - ${item.category} - 产品 ${item.opportunity_score} / 内容 ${item.content_score} / 可信度 ${item.confidence_score} - ${item.angle}`).join("\n")}`;
}

function renderSummary(picks, watchlist) {
  const bestProduct = picks[0]?.name ?? "暂无";
  const bestContent = [...picks].sort((a, b) => b.content_score - a.content_score)[0]?.name ?? "暂无";
  const uncertain = watchlist[0]?.name ?? picks[picks.length - 1]?.name ?? "暂无";

  return `## Summary\n- 最佳产品机会：${bestProduct}\n- 最佳内容机会：${bestContent}\n- 最不确定但有趣：${uncertain}`;
}

async function main() {
  const args = parseArgs();
  const githubExport = await readJson(path.join(args.inputDir, "github.json"));
  const xExport = await readJson(path.join(args.inputDir, "x.json"));
  const producthuntExport = await readJson(path.join(args.inputDir, "producthunt.json"));

  if (githubExport.status !== "ok" || !Array.isArray(githubExport.items) || githubExport.items.length === 0) {
    throw new Error("GitHub export must be available and non-empty for MVP radar generation");
  }

  const sourceStatuses = mapSourceStatuses({
    github: githubExport.status,
    x: xExport.status,
    producthunt: producthuntExport.status,
    producthuntReason: producthuntExport.notes?.[0] ?? null,
  });

  const opportunities = buildOpportunities(githubExport, xExport, producthuntExport);
  const { picks, watchlist } = splitPicksAndWatchlist(opportunities);

  const reportBody = [
    renderPicks(picks),
    renderWatchlist(watchlist),
    renderSummary(picks, watchlist),
  ].join("\n\n");

  const generatedAt = new Date().toISOString();
  const noteContent = renderDailyRadarNote({
    date: args.date,
    generatedAt,
    timeWindowHours: args.timeWindowHours,
    sourceStatuses,
    reportBody,
  });

  const { filePath } = buildDailyRadarPath({ date: args.date });
  const metrics = extractReportMetrics(noteContent);
  const summary = summarizeForFeishu({
    status: githubExport.status === "ok" ? "ok" : "degraded",
    filePath,
    ...metrics,
  });

  if (args.write) {
    await fs.mkdir(path.posix.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, noteContent, "utf8");
  }

  process.stdout.write(JSON.stringify({
    status: githubExport.status === "ok" ? "ok" : "degraded",
    filePath,
    noteContent,
    reportBody,
    ...summary,
  }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${String(error?.message ?? error)}\n`);
  process.exit(1);
});
