---
name: ai-launch-radar
description: Use when the user wants a daily or weekly AI launch radar across GitHub, X, and Product Hunt, especially to detect newly validating AI products from stable structured exports produced by the unified collector before generating a markdown report.
---

# AI Launch Radar

Use this skill to find newly validating AI products from GitHub, X, and Product Hunt.

**Default operating mode:** consume structured data from the unified collector and generate the radar from those exported records.
Do not treat this skill as a live multi-site crawling workflow unless the unified collector is explicitly unavailable.

The primary deliverable is **stable structured source data** for each run.
The markdown radar report is a derived artifact built from those exported records.

## Core rule

Every run must follow this order:

1. run the unified collector
2. confirm per-source structured files exist
3. confirm `run-summary.json` exists
4. fuse and score from exported files only
5. generate the markdown radar report from the exported data

Do not skip the structured export steps.
Do not generate the markdown report first.
Do not manually browse or improvise live collection when the unified collector can run.

## Default execution model

Adopt the same stability pattern that makes `follow-builders` reliable:

- data collection is delegated to a deterministic script
- the skill consumes exported JSON instead of performing ad hoc live crawling
- source-specific failures degrade the run instead of collapsing the whole workflow
- the report is a remix of exported records, not a memory-only synthesis

In practice, the skill should behave like:

`unified collector -> per-source JSON -> run summary -> fusion/scoring -> markdown radar`

Not like:

`agent manually crawls GitHub/X/Product Hunt during the conversation`

## Mission

By default, optimize for:

- time window: last 24-72 hours
- coverage: all AI product categories
- output mode: `picks + watchlist + per-source exports`
- philosophy: strict picks, broader watchlist
- reliability: single-source failures must not block other sources

## Default inputs

If the user does not specify them, use:

- `time_window_hours`: 72
- `max_picks`: 5
- `max_watchlist`: 15
- `sources`: GitHub, X, Product Hunt
- `goal_bias`: balanced
- `output_mode`: standard

Useful optional inputs:

- `time_window_hours`
- `github_min_stars`
- `github_max_repo_age_days`
- `x_min_replies`
- `ph_upvote_min`
- `ph_upvote_max`
- `categories_include`
- `categories_exclude`
- `goal_bias`: `product` | `content` | `balanced`
- `output_mode`: `brief` | `standard` | `deep-dive`

## Required outputs

Every run must produce these files before the markdown report is finalized:

- `github.json`
- `x.json`
- `producthunt.json`
- `run-summary.json`

If the caller also wants a saved daily radar note, then write the markdown report after those files exist.

## Output directory rule

Keep structured export files together for the same run.

Recommended run directory:

`C:/Users/kevin/Documents/Obsidian Vault/AI Launch Radar/data/YYYY-MM-DD/`

Required file set inside that directory:

- `github.json`
- `x.json`
- `producthunt.json`
- `run-summary.json`

If automation also writes the final markdown note, keep using the existing wrapper flow for the note itself.

## Source status model

Each source must have an explicit status:

- `ok`: data collected successfully and usable
- `degraded`: partial, stale, challenged, or lower-confidence data was used
- `unavailable`: no trustworthy data available for that source in this run

Never omit a source status.
Never fake success for a missing source.

## Per-source export schema

Each of `github.json`, `x.json`, and `producthunt.json` must use this top-level shape:

```json
{
  "source": "github|x|producthunt",
  "date": "YYYY-MM-DD",
  "captured_at": "ISO-8601",
  "status": "ok|degraded|unavailable",
  "count": 0,
  "notes": [],
  "items": []
}
```

Each `item` should preserve as many of these fields as the source can supply:

- `source_id`
- `name`
- `tagline`
- `url`
- `website_url`
- `rank`
- `score`
- `comments`
- `stars`
- `replies`
- `created_at`
- `launched_at`
- `topics`
- `raw_ref`

Use `null` when a field is genuinely unavailable.
Do not invent rank, votes, comments, stars, or replies.

## Run summary schema

`run-summary.json` must include:

```json
{
  "date": "YYYY-MM-DD",
  "captured_at": "ISO-8601",
  "overall_status": "ok|degraded",
  "sources": {
    "github": { "status": "ok|degraded|unavailable", "count": 0 },
    "x": { "status": "ok|degraded|unavailable", "count": 0 },
    "producthunt": { "status": "ok|degraded|unavailable", "count": 0 }
  },
  "report_path": null
}
```

`overall_status` should be:

- `ok` only when all three sources are `ok`
- `degraded` when any source is `degraded` or `unavailable`

## Collection rules by source

These source sections define **quality filters and interpretation rules** for exported data.
They do not replace the unified collector as the default execution path.

### GitHub

Prefer structured GitHub results over prose summaries.

GitHub collection does **not** require Google API, Google Custom Search, SerpAPI, or any other Google-backed search quota.
Use direct GitHub collection methods first, such as:

- GitHub repository search
- GitHub topic or trending/discovery pages
- direct repository pages, releases, and README inspection
- previously exported GitHub records for continuity checks

If GitHub collection fails, report the real cause directly.
Examples:

- GitHub rate limit
- GitHub auth missing
- network timeout to GitHub
- no trustworthy GitHub candidates found in the requested window

Do not describe GitHub failure as a Google API or search quota problem unless the caller explicitly configured a Google-based provider for this run.

Prioritize:

- new repos with abnormal star velocity
- active commits
- clear product surface in the README
- demos, releases, examples, or install instructions

De-prioritize:

- awesome-lists
- tutorials
- prompt packs
- benchmark-only repos
- paper reproductions without product surface

### X

Look for launch-intent posts, not generic AI chatter.

Prioritize posts containing ideas like:

- `just launched`
- `we launched`
- `now live`
- `shipping today`
- `feedback welcome`
- `built this`

Prefer posts with:

- dense replies
- real user questions
- product links, repo links, or Product Hunt links

If X export is unavailable:

- mark X as `unavailable`
- still preserve `x.json` with `count = 0`
- continue the run

### Product Hunt

Treat `scripts/producthunt_provider.mjs` and the unified collector outputs as the Product Hunt source of truth.
Do not treat this skill as a browser-capture workflow.

Interpretation rules:

- `status=ok`: trustworthy structured Product Hunt items were extracted
- `status=degraded`: stale cache or challenged fallback data was used by the collector/provider
- `status=unavailable`: no trustworthy Product Hunt data was available

Standard Product Hunt reason codes:

- `ph_missing_html`: expected HTML input was missing or empty
- `ph_html_browser_capture_required`: challenged input prevented trustworthy extraction
- `ph_html_no_extractable_posts`: input loaded but did not contain trustworthy extractable posts
- `ph_har_no_extractable_posts`: HAR was present but did not contain trustworthy extractable posts
- `ph_http_error`: Product Hunt returned an HTTP error such as `403`
- `ph_no_live_source`: no live Product Hunt source succeeded and the run fell back to stale cache
- `ph_no_source_available`: no live source or usable cache was available

When Product Hunt is `degraded` or `unavailable`, preserve both:

- a human-readable `reason`
- a stable machine-readable `reason_code`

Important:

- Product Hunt may degrade without blocking the whole radar
- if exact votes or ranks are not available, leave them `null`
- never pretend incomplete or challenged input is a stable leaderboard

## Signal fusion and scoring

Only perform fusion and scoring after all source export files exist.

Treat the same product across sources as one opportunity object.
Match by:

- domain
- repo URL
- Product Hunt page
- product name and tagline similarity

Use these scores from `0-100`:

- `opportunity_score`
- `content_score`
- `confidence_score`

Recommended selection logic:

- `build` if it looks like a genuine product opportunity
- `write` if it is stronger as a content opportunity
- `monitor` if it is promising but still early or mixed

Example `angle` values:

- `developer painkiller`
- `workflow wedge`
- `new UX pattern`
- `AI wrapper but strong demand`
- `distribution-first launch`
- `vertical niche signal`

## Report rule

The markdown report is derived from the exported files.
Do not use memory-only observations that were never written into the source JSON files.

All report content must be in Chinese unless the user explicitly asks for another language.

## Report structure

Use this format by default:

```md
# AI Launch Radar

## Run Status
- Generated at: ...
- Scan window: last ... hours
- GitHub: ok|degraded|unavailable
- X: ok|degraded|unavailable
- Product Hunt: ok|degraded|unavailable

## Picks

### Product Name
**类别**：...
**来源**：GitHub / X / Product Hunt
**推荐动作**：构建机会 / 内容创作 / 持续关注

**评分**：产品机会 ... / 内容机会 ... / 可信度 ...

**为什么是现在**：...
**为什么值得关注**：...
**切入角度**：...
**主要风险**：...

## Watchlist
- **Product Name** - ...

## Summary
- 最佳产品机会：...
- 最佳内容机会：...
- 最不确定但有趣：...
```

## Execution guide

Run these steps in order.

### Step 1: Compute date filters

Use the current day and the requested lookback window.

### Step 2: Run the unified collector

This is the default and preferred path.
Treat the unified collector as the source of truth for run-time data preparation.
Do not replace it with ad hoc manual browsing if it succeeds.

Run:

```bash
node "C:/Users/kevin/.easyclaw/openclaw/skills/ai-launch-radar/scripts/collect-all-sources.mjs" \
  --date "$TODAY" \
  --output-dir "<run-dir>" \
  --time-window "$TIME_WINDOW_HOURS"
```

How it works:

1. first attempt: fetch pre-crawled structured JSON from the central feed
2. fallback inside the collector: if central fetch fails for a source, let the collector decide whether a source-specific fallback can be used
3. cache: fetched central data may be cached locally for continuity
4. resilience: single-source failures never block the whole run

The skill's job is **not** to reproduce the collector logic in conversation.
The skill's job is to consume the collector outputs.

### Step 3: Verify required exported files exist

Before doing any scoring or writing:

- verify `github.json` exists
- verify `x.json` exists
- verify `producthunt.json` exists
- verify `run-summary.json` exists

If any source file is missing, treat the run as degraded and report the actual missing artifact.
Do not silently reconstruct missing source files from memory.

### Step 4: Read exported source files

Use only the exported JSON files as radar inputs.
Do not add observations that were never written into those files.

### Step 5: Fuse, score, and select

Only after the exported files exist:

- match entities across sources
- compute opportunity/content/confidence scores
- build `picks`
- build `watchlist`

### Step 6: Generate markdown report

Build the markdown report from the exported data.

If the caller wants the note saved to Obsidian, pass the final report to:

`C:/Users/kevin/.easyclaw/openclaw/skills/ai-launch-radar/scripts/radar_wrapper.mjs`

### Step 7: Automation reply

When the run is automation-driven, return a concise machine-friendly summary that includes:

- `status`
- `outputPath`
- `picksCount`
- `watchlistCount`
- `topOpportunity`

## Fallback and recovery

Fallback is allowed only when the unified collector is unavailable or explicitly reports that it could not complete a source.

Fallback is a recovery path, not the default operating model.
If fallback is used:

- preserve the same export schemas
- mark the affected source `degraded` or `unavailable`
- record the real failure cause in notes or reason fields
- continue the run when possible

Do not escalate to manual browsing first.
Do not ask the agent to re-implement collection logic that already belongs in the scripts.

### Legacy fallback notes

The old per-source collection flow remains available only as compatibility and recovery guidance for environments where the unified collector cannot complete the run.

Use it sparingly and only after the collector path has already failed.
These notes describe fallback behavior and export expectations; they are not the preferred execution path.

#### GitHub legacy fallback

Fetch candidate repos, normalize them into the required `github.json` schema, then write `github.json`.

Preferred GitHub collection order:

1. direct GitHub search or API results
2. direct repository page inspection
3. recent exported records used only as continuity context, never as fake fresh results

Do not introduce a Google-based search dependency for GitHub discovery unless the user explicitly asked for that configuration.

Minimum expectations:

- `source` must be `github`
- `status` must be explicit
- `count` must match the number of normalized items

#### Product Hunt legacy fallback

Use:

```bash
node "C:/Users/kevin/.easyclaw/openclaw/skills/ai-launch-radar/scripts/producthunt_provider.mjs" \
  --date "$TODAY" \
  --cache-dir "C:/Users/kevin/AppData/Local/Temp/ai-launch-radar-cache" \
  --output-file "<run-dir>/producthunt-raw.json"
```

Then transform the provider output into the required `producthunt.json` schema for the run directory.

Preserve:

- provider `status`
- provider `sourceType`
- provider `cacheHit`
- provider `staleCacheUsed`
- normalized item list

Map provider item fields when present:

- `id` -> `source_id`
- `name`
- `tagline`
- `productHuntUrl` -> `url`
- `websiteUrl` -> `website_url`
- `votesCount` -> `score`

If Product Hunt is challenged or stale:

- still write `producthunt.json`
- set `status` to `degraded` or `unavailable`
- include the reason in `notes`

#### X legacy fallback

Use the existing X fallback script path only as a recovery mechanism.
Normalize results into the required `x.json` schema, then write `x.json`.

If auth or session state is expired:

- write `x.json` with `status = unavailable`
- set `count = 0`
- continue the run

### Finalize fallback outputs

If legacy fallback was used, still ensure:

- all three source files exist
- `run-summary.json` is written
- fusion/scoring uses the exported files only
- markdown generation still happens from exported data only


If the caller wants the note saved to Obsidian, pass the report to:

`C:/Users/kevin/.easyclaw/openclaw/skills/ai-launch-radar/scripts/radar_wrapper.mjs`

Keep the existing wrapper behavior for note path creation and front matter generation.

## Configuration

Configuration exists only to support the collector and its internal recovery paths when central data is unavailable.
It is **not** a prompt for the agent to switch into manual live crawling.

### Configuration File

Create a config file at one of these locations only if the collector or its internal fallbacks need credentials:
- `~/.config/ai-launch-radar/config.json` (recommended)
- `~/.ai-launch-radar.json`

Example configuration:

```json
{
  "github": {
    "token": "ghp_your_github_api_token_here"
  },
  "twitter": {
    "authToken": "your_auth_token_cookie_value",
    "ct0": "your_ct0_cookie_value"
  },
  "producthunt": {
    "cookieFile": "/path/to/producthunt_cookies.json",
    "sessionValue": "or_just_provide_the_session_value_directly"
  },
  "network": {
    "proxy": "http://127.0.0.1:8890"
  }
}
```

### Credential guidance

- GitHub token: supports collector-side GitHub fallback when rate limits apply
- X credentials: supports collector-side X fallback when the central feed is unavailable
- Product Hunt session data: supports collector-side Product Hunt fallback when the central feed is unavailable

### If credentials are not configured

When credentials are missing:
- the corresponding source should be marked **unavailable**
- a clear error note should be added to exported outputs
- the radar should continue using other available sources
- the run should degrade, not collapse

## Hard constraints

- Default to the unified collector and exported JSON files as the run-time source of truth
- Never let one failed source block the other two source exports
- Never skip writing a source file
- Never skip writing `run-summary.json`
- Never invent missing fields to make the report look complete
- Never treat Product Hunt challenge HTML as trustworthy final data without marking it degraded
- Never generate the final markdown note before the structured export files exist
- Never claim GitHub requires Google API by default
- Never report `Google API quota exhausted` as the GitHub failure reason unless a real Google-backed provider was explicitly used in that run
- Never bypass the collector with manual browsing when the collector already succeeded
- Never ask the agent to visit X, Product Hunt, or GitHub directly just to reconstruct data that should come from collector outputs

## Anti-patterns

Avoid these mistakes:

- returning only a generic “top AI tools” list
- ranking only by absolute popularity
- requiring every product to appear on all three platforms
- confusing discussion volume with product quality
- over-rewarding old projects that merely resurfaced
- producing markdown without preserving the underlying source records
- fabricating infrastructure explanations such as `Google API quota exhausted` when the run never used Google services

## Troubleshooting

### Unified collector fails completely

**Symptom:** `collect-all-sources.mjs` does not produce the required export files.
**Response:**
- report which artifacts are missing
- mark the run degraded
- only use legacy fallback if the collector path is truly unavailable
- never replace the collector with ad hoc manual browsing inside the conversation

### Product Hunt unavailable

**Symptom:** Product Hunt is degraded or unavailable in exported outputs.
**Response:**
- preserve `producthunt.json`
- preserve stable reason fields or notes
- continue with GitHub and X when available

### GitHub degraded or unavailable

**Symptom:** GitHub export is degraded or unavailable.
**Response:**
- report the real cause from exported data or collector output
- do not invent Google quota explanations unless a real Google-backed provider was used
- continue the run when other sources are usable

### X unavailable

**Symptom:** X export is unavailable.
**Response:**
- preserve `x.json` with explicit status
- continue the run
- do not switch to manual browsing just because X auth is missing

### Partial report generated

This is expected behavior when one or more sources are unavailable.
The skill should continue with whatever exported data is available rather than failing completely.

## Final guidance

The value of this skill is not just finding interesting launches.
The value is preserving a stable daily record of what each source actually showed, then turning that record into a useful radar.
