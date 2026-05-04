# SEO Blog System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `seo-content-writer` Paperclip agent — a 6-phase orchestrator+sub-issues pipeline that researches, writes, SEO-checks, emails for review, iterates on feedback, and publishes blog posts to medicodio.ai every 15 days.

**Architecture:** Mirrors `agents/marketing-specialist/` exactly — `AGENTS.md` + `mcp.json` + `routines/` with orchestrator `.md` and sibling `bi-weekly-blog-post/` folder for phase files. State flows through `run-state.json` in SharePoint. A separate `email-monitor` cron routine watches inbox replies and creates sub-issues to continue the pipeline.

**Tech Stack:** Markdown instruction files (Paperclip agent config), Node.js (md-to-portable-text helper), SharePoint MCP, Outlook MCP, DuckDuckGo MCP, Fetch MCP, Playwright MCP.

**Spec:** `docs/superpowers/specs/2026-05-04-seo-blog-system-design.md`

**Reference pattern:** `agents/marketing-specialist/routines/event-outreach/` — read every file there before implementing.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `agents/seo-content-writer/mcp.json` | Create | MCP server wiring |
| `agents/seo-content-writer/AGENTS.md` | Rewrite (draft exists) | Agent identity, phase routing table, SharePoint rules, email rules |
| `agents/seo-content-writer/routines/bi-weekly-blog-post.md` | Create | Orchestrator — reads issue description, bootstraps run, creates [BLOG-RESEARCH] |
| `agents/seo-content-writer/routines/email-monitor.md` | Create | 6-hour cron — checks inbox, creates [BLOG-REVISE] or [BLOG-PUBLISH] |
| `agents/seo-content-writer/routines/bi-weekly-blog-post/research.md` | Create | Phase 1: SERP research |
| `agents/seo-content-writer/routines/bi-weekly-blog-post/write.md` | Create | Phase 2: Blog writing |
| `agents/seo-content-writer/routines/bi-weekly-blog-post/seo-check.md` | Create | Phase 3: Keyword scoring + auto-fix |
| `agents/seo-content-writer/routines/bi-weekly-blog-post/email.md` | Create | Phase 4: Approval email send |
| `agents/seo-content-writer/routines/bi-weekly-blog-post/revise.md` | Create | Phase 5: Apply change requests |
| `agents/seo-content-writer/routines/bi-weekly-blog-post/publish.md` | Create | Phase 6: Publish to /api/blog/push |
| `agents/seo-content-writer/routines/bi-weekly-blog-post/audit.md` | Create | Phase 7: Final log + close parent |
| `scripts/md-to-portable-text.js` | Create | Markdown → Sanity Portable Text converter |

---

## Task 1: mcp.json — MCP Server Config

**Goal:** Wire all MCP servers for the seo-content-writer agent, matching marketing-specialist config.

**Files:**
- Create: `agents/seo-content-writer/mcp.json`

**Acceptance Criteria:**
- [ ] Has sharepoint, outlook, duckduckgo, fetch, playwright, teams servers
- [ ] `OUTLOOK_MAILBOX` env var wired (will be set to `karthik.r@medicodio.ai` in Paperclip)
- [ ] Matches marketing-specialist mcp.json structure exactly

**Steps:**

- [ ] **Step 1: Create mcp.json**

```json
{
  "mcpServers": {
    "sharepoint": {
      "command": "node",
      "args": ["./packages/mcp-sharepoint/dist/stdio.js"],
      "env": {
        "SHAREPOINT_TENANT_ID": "${SHAREPOINT_TENANT_ID}",
        "SHAREPOINT_CLIENT_ID": "${SHAREPOINT_CLIENT_ID}",
        "SHAREPOINT_CLIENT_SECRET": "${SHAREPOINT_CLIENT_SECRET}",
        "SHAREPOINT_SITE_URL": "${SHAREPOINT_SITE_URL}"
      }
    },
    "outlook": {
      "command": "node",
      "args": ["./packages/mcp-outlook/dist/stdio.js"],
      "env": {
        "OUTLOOK_TENANT_ID": "${SHAREPOINT_TENANT_ID}",
        "OUTLOOK_CLIENT_ID": "${OUTLOOK_CLIENT_ID}",
        "OUTLOOK_CLIENT_SECRET": "${OUTLOOK_CLIENT_SECRET}",
        "OUTLOOK_MAILBOX": "${OUTLOOK_MAILBOX}"
      }
    },
    "duckduckgo": {
      "command": "npx",
      "args": ["-y", "duckduckgo-mcp-server"]
    },
    "fetch": {
      "command": "npx",
      "args": ["-y", "@tokenizin/mcp-fetch"]
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest", "--browser", "chromium", "--headless"]
    },
    "teams": {
      "command": "node",
      "args": ["./packages/mcp-teams/dist/stdio.js"],
      "env": {
        "TEAMS_TENANT_ID": "${SHAREPOINT_TENANT_ID}",
        "TEAMS_CLIENT_ID": "${OUTLOOK_CLIENT_ID}",
        "TEAMS_CLIENT_SECRET": "${OUTLOOK_CLIENT_SECRET}"
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add agents/seo-content-writer/mcp.json
git commit -m "feat(seo-content-writer): add mcp.json server config"
```

---

## Task 2: AGENTS.md — Agent Identity + Phase Routing

**Goal:** Full agent instruction file covering identity, SharePoint workspace, Paperclip heartbeat protocol, phase routing table, email routing rules, and env vars.

**Files:**
- Rewrite: `agents/seo-content-writer/AGENTS.md` (draft exists — replace entirely)

**Acceptance Criteria:**
- [ ] Phase routing table maps every `[BLOG-*]` prefix to correct file
- [ ] SharePoint workspace section matches the spec folder structure
- [ ] Email routing rules (medical_coding → Jessica, other → Amanda, CC naveen always)
- [ ] Env vars section lists all injected vars
- [ ] Follows marketing-specialist AGENTS.md structure

**Steps:**

- [ ] **Step 1: Rewrite AGENTS.md**

```markdown
# SEO Content Writer Agent

You are the SEO Content Writer at Medicodio AI. Your mission: own the #1 ranking for **"AI Medical Coding"** and its full keyword cluster across Google, Bing, Perplexity, and AI Overviews. You write and publish SEO-optimised blog posts to medicodio.ai every 15 days.

---

## SharePoint Workspace (PRIMARY FILE SYSTEM)

**Site:** `https://medicodio.sharepoint.com/sites/MedicodioMarketing`

All files under `SEO-Content-Writer/`:

```
SEO-Content-Writer/
├── config.md                              ← keyword cluster, posted log, activeRunFolder
└── agents/
    └── seo-blogs/
        └── runs/
            └── {YYYY-MM-DD}-{slug}/
                ├── run-state.json
                ├── draft.md
                ├── portable-text.json
                └── logs/
                    ├── research.md
                    ├── write.md
                    ├── seo-check.md
                    ├── email.md
                    ├── revise-{n}.md
                    ├── publish.md
                    └── audit.md
```

**config.md tracks:**
- Keyword cluster (canonical list — load before every SEO check)
- Posted topics log (check before starting any new run — no duplicates)
- `activeRunFolder` — path to current in-progress run folder. Set by orchestrator, cleared by audit phase. Email monitor reads this to find run-state.json.

### On every new task
1. `sharepoint_list_folder path="SEO-Content-Writer"` — orient yourself
2. `sharepoint_read_file path="SEO-Content-Writer/config.md"` — load cluster + posted log + activeRunFolder

---

## Phase Routing — MANDATORY

When assigned any `[BLOG-*]` issue, read the mapped phase file FIRST before any other action:

| Title prefix | Read this file |
|---|---|
| `[BLOG-ORCHESTRATOR]` | `routines/bi-weekly-blog-post.md` |
| `[BLOG-RESEARCH]` | `routines/bi-weekly-blog-post/research.md` |
| `[BLOG-WRITE]` | `routines/bi-weekly-blog-post/write.md` |
| `[BLOG-SEO-CHECK]` | `routines/bi-weekly-blog-post/seo-check.md` |
| `[BLOG-EMAIL]` | `routines/bi-weekly-blog-post/email.md` |
| `[BLOG-REVISE]` | `routines/bi-weekly-blog-post/revise.md` |
| `[BLOG-PUBLISH]` | `routines/bi-weekly-blog-post/publish.md` |
| `[BLOG-AUDIT]` | `routines/bi-weekly-blog-post/audit.md` |

**If your current issue title starts with any `[BLOG-*]` prefix:** read the mapped file immediately. Follow only that file. Do not combine logic from multiple phase files in one heartbeat.

---

## Paperclip Heartbeat Protocol

**Every run, before any work:**
1. `GET /api/agents/me` — get your agent ID and company ID
2. `GET /api/agents/me/inbox-lite` — find assigned issue
3. `POST /api/issues/{issueId}/checkout` with `{ "agentId": "{your-agent-id}", "expectedStatuses": ["todo", "in_progress", "in_review", "blocked"] }`

**Every run, after all work:**
- `PATCH /api/issues/{issueId}` with appropriate status + comment
- Header: `X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID` on ALL API requests that modify issues

---

## Email Routing Rules

**From:** `karthik.r@medicodio.ai` (OUTLOOK_MAILBOX env var)
**CC always:** `naveen@medicodio.ai` — never omit

| Category | To | Trigger keywords in topic/title |
|----------|----|---------------------------------|
| `medical_coding` | `Jessica.Miller@medicodio.ai` | medical coding, ICD-10, CPT, coding accuracy, autonomous coding, computer-assisted coding, HIM, denial reduction |
| `services` / other | `McGurk.Amanda@medicodio.ai` | RCM, billing, revenue cycle, AI services, general |

Category is determined in the orchestrator from the issue description topic. Re-evaluated in revise phase if topic shifts.

---

## Blog Post Structure (Required)

Every post must follow this exact structure:

```
---
seoTitle:        ← ≤60 chars, contains primary keyword
seoDescription:  ← ≤160 chars, contains primary keyword + value prop
publishedAt:     ← ISO date
---

# [H1 — contains primary keyword]
[Hook: 2-3 sentences. Pain → promise. No fluff.]

## Table of Contents
## [H2: What Is / The Problem]        ~200 words
## [H2: How It Works / The Solution]  ~300 words
## [H2: Key Benefits / Data]          ~250 words (3-5 stats, cited)
## [H2: Real-World Use Case]          ~300 words (health system scenario)
## [H2: How MediCodio AI Does This]   ~200 words (natural product mention)
## [H2: FAQ]                          3-5 questions (targets PAA + featured snippets)
## [H2: Key Takeaways]                5 bullets, scannable, contains primary KW
## Get Started with AI Medical Coding ← CTA → https://medicodio.ai/
```

Minimum 1800 words. Include internal link to https://medicodio.ai/ and 2-3 external authority citations.

---

## Keyword Cluster

Primary: AI medical coding, AI medical billing, automated medical coding, medical coding automation, AI powered medical coding

Secondary: computer-assisted coding, autonomous medical coding, NLP medical coding, machine learning medical coding, AI ICD-10 coding, CPT code automation, AI revenue cycle management

Long-tail: AI medical coding software 2026, how does AI medical coding work, best AI medical coding software, AI medical coding accuracy, AI vs human medical coders, ICD-10 automation artificial intelligence, AI medical coding ROI, HIPAA compliant AI coding, AI coding for emergency department, autonomous coding denial reduction

---

## Publish Endpoint

```
POST https://medicodio.ai/api/blog/push
x-blog-secret: ${BLOG_PUSH_SECRET}
Content-Type: application/json

{ "title": "...", "description": "...", "blogcontent": [...] }
```

Slug auto-derived from title server-side — do not send.

---

## Env Vars (auto-injected by Paperclip)

```
SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET
SHAREPOINT_SITE_URL
OUTLOOK_TENANT_ID, OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET
OUTLOOK_MAILBOX                ← karthik.r@medicodio.ai
BLOG_PUSH_SECRET               ← blog push secret token
TEAMS_MARKETING_TEAM_ID
TEAMS_MARKETING_CHANNEL_ID
PAPERCLIP_AGENT_ID, PAPERCLIP_COMPANY_ID, PAPERCLIP_RUN_ID, PAPERCLIP_TASK_ID
```

---

## Critical Rules

- **Phase routing is mandatory** — never execute phase logic without reading the mapped phase file first.
- **run-state.json is the single source of truth** — read it at the start of every phase, append your section, write it back.
- **Never duplicate topics** — check config.md posted log before starting any run.
- **Checkout before any work** — Paperclip rule, no exceptions.
- **Always CC naveen@medicodio.ai** — no exceptions on email sends.
- **Never hardcode SharePoint URLs** — always use `sharepoint_get_file_info` for `webUrl`.
- **X-Paperclip-Run-Id header on all mutating API calls** — required for audit trail.
```

- [ ] **Step 2: Commit**

```bash
git add agents/seo-content-writer/AGENTS.md
git commit -m "feat(seo-content-writer): add AGENTS.md with phase routing and email rules"
```

---

## Task 3: bi-weekly-blog-post.md — Orchestrator Routine

**Goal:** Orchestrator reads the issue description for topic/brief, bootstraps the SharePoint run folder, writes initial run-state.json, and creates the first `[BLOG-RESEARCH]` child issue.

**Files:**
- Create: `agents/seo-content-writer/routines/bi-weekly-blog-post.md`
- Create dir: `agents/seo-content-writer/routines/bi-weekly-blog-post/`

**Acceptance Criteria:**
- [ ] Topic/brief extracted from issue description (not hardcoded)
- [ ] Duplicate check against config.md posted log
- [ ] run-state.json written with all fields from spec schema
- [ ] config.md `activeRunFolder` updated
- [ ] `[BLOG-RESEARCH]` child created with `phase_file:` + `run_state_path:` + `parent_issue_id:` in description
- [ ] Does NOT execute any phase logic — bootstraps only

**Steps:**

- [ ] **Step 1: Create the orchestrator file**

```markdown
# Bi-Weekly Blog Post — Orchestrator

**Trigger:** Every 15 days (`0 0 */15 * *`) or manual issue creation.
**Concurrency:** `skip_if_active` — one blog run at a time.
**Catch-up:** `skip_missed`
**Role:** Bootstrap pipeline only. Read issue description, write run-state.json, create [BLOG-RESEARCH] child. EXIT.
**DO NOT:** Execute any phase logic. Do not search, write, or send anything here.

---

## Phase Routing

When assigned an issue whose title starts with one of these prefixes, read the mapped file FIRST:

| Title prefix | Phase file |
|---|---|
| `[BLOG-ORCHESTRATOR]` | `routines/bi-weekly-blog-post.md` (this file) |
| `[BLOG-RESEARCH]` | `routines/bi-weekly-blog-post/research.md` |
| `[BLOG-WRITE]` | `routines/bi-weekly-blog-post/write.md` |
| `[BLOG-SEO-CHECK]` | `routines/bi-weekly-blog-post/seo-check.md` |
| `[BLOG-EMAIL]` | `routines/bi-weekly-blog-post/email.md` |
| `[BLOG-REVISE]` | `routines/bi-weekly-blog-post/revise.md` |
| `[BLOG-PUBLISH]` | `routines/bi-weekly-blog-post/publish.md` |
| `[BLOG-AUDIT]` | `routines/bi-weekly-blog-post/audit.md` |

If your current issue title starts with any `[BLOG-*]` prefix other than `[BLOG-ORCHESTRATOR]`: read the mapped phase file immediately. Do not read this file further.

---

## Orchestrator Steps

### Step 1 — Extract topic from issue description

Scan issue description for:
```
topic: {blog topic title}
brief: {any talking points, angle, or keywords to focus on}
primary_keyword: {target keyword — optional, agent can infer}
```

If `topic:` line is missing:
```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
{ "body": "topic: line missing from issue description. Add:\ntopic: Your Blog Title Here\nbrief: Any talking points or angle\n\nBlocked." }
```
Set issue → `blocked`. STOP.

### Step 2 — Load config and check for duplicate

```
sharepoint_read_file path="SEO-Content-Writer/config.md"
→ IF missing: create it with default keyword cluster (see AGENTS.md) + empty posted_log + empty activeRunFolder. Continue.
→ parse posted_log — check if topic already appears
→ IF duplicate found:
   POST comment: "Topic '{topic}' already published on {date}. Skipping to avoid duplicate content."
   PATCH issue → done. STOP.
```

### Step 3 — Derive category and approver email

Scan topic + brief for routing keywords:
- `medical_coding` keywords: medical coding, ICD-10, CPT, coding accuracy, autonomous coding, computer-assisted, HIM, denial reduction
- Default to `services` if no match

Set `approverEmail`:
- `medical_coding` → `Jessica.Miller@medicodio.ai`
- `services` → `McGurk.Amanda@medicodio.ai`

### Step 4 — Build run folder and write run-state.json

```
slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
runDate = today ISO date (YYYY-MM-DD)
runFolder = "SEO-Content-Writer/agents/seo-blogs/runs/{runDate}-{slug}"
runStatePath = "{runFolder}/run-state.json"
```

Write initial run-state.json:
```json
{
  "schema_version": 1,
  "runDate": "{runDate}",
  "slug": "{slug}",
  "topic": "{topic}",
  "contentBrief": "{brief}",
  "primaryKeyword": "{primary_keyword or inferred from topic}",
  "targetPersona": "RCM Director",
  "category": "{medical_coding or services}",
  "approverEmail": "{approverEmail}",
  "status": "running",
  "conversationId": null,
  "messageId": null,
  "lastCheckedAt": null,
  "revisionCount": 0,
  "maxRevisions": 3,
  "seoScore": null,
  "wordCount": null,
  "publishedAt": null,
  "publishResponseId": null,
  "parentIssueId": "{PAPERCLIP_TASK_ID}",
  "runFolder": "{runFolder}",
  "runStatePath": "{runStatePath}",
  "phases": {
    "research": "pending",
    "write": "pending",
    "seo_check": "pending",
    "email": "pending",
    "publish": "pending",
    "audit": "pending"
  }
}
```

```
sharepoint_write_file path="{runStatePath}" content="{JSON}"
→ IF fails: post blocked "Cannot write run-state.json to {runStatePath}. Check SharePoint permissions." STOP.
```

### Step 5 — Update config.md activeRunFolder

```
sharepoint_read_file path="SEO-Content-Writer/config.md"
→ update: activeRunFolder = "{runFolder}"
sharepoint_write_file path="SEO-Content-Writer/config.md" content="{updated}"
```

### Step 6 — Post bootstrap comment

```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "body": "Pipeline bootstrapped.\nTopic: {topic}\nKeyword: {primaryKeyword}\nCategory: {category}\nApprover: {approverEmail}\nRun folder: {runFolder}\n\nCreating [BLOG-RESEARCH] child now."
}
```

### Step 7 — Create [BLOG-RESEARCH] child and exit

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[BLOG-RESEARCH] {topic}",
  "description": "phase_file: routines/bi-weekly-blog-post/research.md\nrun_state_path: {runStatePath}\nparent_issue_id: {PAPERCLIP_TASK_ID}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{PAPERCLIP_TASK_ID}",
  "status": "todo",
  "priority": "high"
}
→ IF fails: retry once. If still fails: post blocked "Failed to create [BLOG-RESEARCH] child: {error}". STOP.
```

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "in_progress", "comment": "[BLOG-RESEARCH] child created. Pipeline running." }
```

**Do not execute any further phase logic.** Exit heartbeat. ✓

---

## Error Handling

| Situation | Action |
|---|---|
| `topic:` missing from description | Block parent, STOP |
| Topic already in posted log | Close as done, STOP |
| run-state.json write fails | Block parent, STOP |
| config.md update fails | Post warning, continue (non-blocking) |
| Child issue creation fails | Retry once. Block parent with error on second failure |
```

- [ ] **Step 2: Create the bi-weekly-blog-post phases subdirectory placeholder**

```bash
mkdir -p agents/seo-content-writer/routines/bi-weekly-blog-post
```

- [ ] **Step 3: Commit**

```bash
git add agents/seo-content-writer/routines/bi-weekly-blog-post.md
git commit -m "feat(seo-content-writer): add orchestrator routine"
```

---

## Task 4: research.md — SERP Research Phase

**Goal:** Research the target keyword SERP, analyse top 10 pages, identify gaps, save findings to run-state.json and research.md log, create [BLOG-WRITE] child.

**Files:**
- Create: `agents/seo-content-writer/routines/bi-weekly-blog-post/research.md`

**Acceptance Criteria:**
- [ ] Reads `run_state_path` from issue description
- [ ] Runs DuckDuckGo for primary KW + 3 related queries
- [ ] Fetches top 3 competitor pages and extracts headings/word counts
- [ ] Saves findings to run-state.json `research` section
- [ ] Writes `{runFolder}/logs/research.md`
- [ ] Creates `[BLOG-WRITE]` child with `phase_file:` + `run_state_path:` + `parent_issue_id:`

**Steps:**

- [ ] **Step 1: Create research.md**

```markdown
# Research — SERP Analysis (Phase 1)

**BOUNDARY LINE 1:** Research only — do NOT write the blog post here.
**BOUNDARY LINE 2:** All run context comes from run-state.json at `run_state_path` in issue description.
**BOUNDARY LINE 3:** Fetch before Playwright — only use Playwright if fetch returns empty content.
**STATE:** Reads initial run-state.json. Writes `research` section. Creates `[BLOG-WRITE]` child.
**DO NOT:** Write draft.md. Send emails. Run SEO check.

---

## Step 1 — Load state

```
run_state_path = extract from issue description line: "run_state_path: ..."
parent_issue_id = extract from issue description line: "parent_issue_id: ..."

sharepoint_read_file path="{run_state_path}"
→ IF missing: post blocked "run-state.json not found at {run_state_path}." STOP.
→ extract: topic, primaryKeyword, contentBrief, runFolder, parentIssueId
```

## Step 2 — SERP research

Run all 4 searches:

```
duckduckgo_search query="{primaryKeyword} 2026"
duckduckgo_search query="{primaryKeyword} guide complete"
duckduckgo_search query="{primaryKeyword} benefits healthcare"
duckduckgo_search query="{topic}" (full topic title)
```

From results, collect top 10 unique URLs. Filter out: medicodio.ai, social media, forums.

## Step 3 — Fetch top competitor pages

For the top 3 URLs from Step 2:

```
fetch url="{url1}"
fetch url="{url2}"
fetch url="{url3}"
→ IF fetch returns empty or <200 chars:
   browser_navigate url="{url}"
   browser_snapshot
```

For each page, extract:
- All H1, H2, H3 headings (topic coverage map)
- Approximate word count
- Any stats or data points cited
- What angle/pain point they address

## Step 4 — Identify content gaps

Compare the 3 competitor pages. Note:
- H2 topics ALL THREE cover → must-include sections
- Topics only 1 covers → opportunity (cover better)
- Topics NONE cover → gap to exploit
- People Also Ask questions (from DuckDuckGo snippets)

## Step 5 — Save research.md log

```
sharepoint_write_file
  path="{runFolder}/logs/research.md"
  content:
---
# Research Log — {topic}
**Date:** {ISO now}
**Primary keyword:** {primaryKeyword}

## SERP Top 10
| # | URL | Domain |
|---|-----|--------|
{top 10 rows}

## Competitor Analysis (Top 3)
### {url1}
- Word count: ~{N}
- H2 topics: {list}
- Key stats: {list}

### {url2}
...

### {url3}
...

## Must-Include Sections (covered by all 3)
{list}

## Content Gaps (not covered or covered poorly)
{list}

## People Also Ask (from SERP snippets)
{list of questions}

## Recommended Angle
{1-2 sentences on differentiation strategy}
---
```

## Step 6 — Write research section to run-state.json

```
sharepoint_read_file path="{run_state_path}"
→ append:
"research": {
  "status": "complete",
  "completed_at": "{ISO}",
  "primary_keyword": "{primaryKeyword}",
  "top_urls": [{url1}, {url2}, {url3}, ...],
  "must_include_sections": [...],
  "content_gaps": [...],
  "paa_questions": [...],
  "recommended_angle": "..."
},
"phases.research": "done"
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
→ IF fails: retry once. If still fails: post blocked on self + parent. STOP.
```

## Step 7 — Create [BLOG-WRITE] child and close

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[BLOG-WRITE] {topic}",
  "description": "phase_file: routines/bi-weekly-blog-post/write.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
→ IF fails: retry once. If still fails: post blocked on self + parent. STOP.
```

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done", "comment": "Research complete. {len(top_urls)} URLs analysed. {len(gaps)} content gaps found. [BLOG-WRITE] created." }
```
```

- [ ] **Step 2: Commit**

```bash
git add agents/seo-content-writer/routines/bi-weekly-blog-post/research.md
git commit -m "feat(seo-content-writer): add research phase"
```

---

## Task 5: write.md — Blog Writing Phase

**Goal:** Write the full 1800–2500 word SEO blog post from research findings, save draft.md, create [BLOG-SEO-CHECK] child.

**Files:**
- Create: `agents/seo-content-writer/routines/bi-weekly-blog-post/write.md`

**Acceptance Criteria:**
- [ ] Reads research findings from run-state.json `research` section
- [ ] Post structure follows spec exactly (H1→H2→H3, TOC, FAQ, CTA)
- [ ] Saves draft.md with frontmatter (seoTitle, seoDescription, publishedAt)
- [ ] Writes write.md log with word count and section breakdown
- [ ] Creates [BLOG-SEO-CHECK] child

**Steps:**

- [ ] **Step 1: Create write.md**

```markdown
# Write — Blog Post Authoring (Phase 2)

**BOUNDARY LINE 1:** Write from run-state.json research findings only — do NOT re-search SERP here.
**BOUNDARY LINE 2:** Draft goes to draft.md in SharePoint run folder — nowhere else.
**BOUNDARY LINE 3:** Minimum 1800 words. Do not close this phase if wordCount < 1800.
**STATE:** Reads `research` section of run-state.json. Writes `write` section. Creates `[BLOG-SEO-CHECK]` child.
**DO NOT:** Run SEO scoring. Send emails. Publish.

---

## Step 1 — Load state

```
run_state_path = extract from issue description
parent_issue_id = extract from issue description

sharepoint_read_file path="{run_state_path}"
→ IF missing: post blocked "run-state.json not found at {run_state_path}." STOP.
→ extract: topic, primaryKeyword, contentBrief, research.must_include_sections,
  research.content_gaps, research.paa_questions, research.recommended_angle,
  runFolder, approverEmail, category
```

## Step 2 — Write the blog post

Write a complete blog post following this EXACT structure:

```markdown
---
seoTitle: {≤60 chars — contains primaryKeyword}
seoDescription: {≤160 chars — contains primaryKeyword + value prop}
publishedAt: {YYYY-MM-DDT00:00:00Z}
---

# {H1 containing primaryKeyword}
{Hook: 2-3 sentences. Pain point → promise. No fluff.}

## Table of Contents
- [What Is...](#what-is)
- [How It Works](#how-it-works)
- [Key Benefits](#key-benefits)
- [Real-World Use Case](#real-world)
- [How MediCodio AI Does This](#medicodio)
- [FAQ](#faq)
- [Key Takeaways](#takeaways)

## What Is {Topic} {H2 — ~200 words}
{Define the problem or concept clearly. Use research.recommended_angle.}

## How {Topic} Works {H2 — ~300 words}
{Explain mechanism. Use numbered steps if applicable. Cover research.must_include_sections.}

## Key Benefits {H2 — ~250 words}
{3-5 bullet points backed by cited stats. Use [Source](url) inline links. Cover research.content_gaps.}

## Real-World Use Case {H2 — ~300 words}
{Concrete scenario at a health system or physician group. Named (fictional) example.}

## How MediCodio AI Does This {H2 — ~200 words}
{Natural product mention. Focus on outcomes not features. Link: https://medicodio.ai/}

## FAQ {H2}
{3-5 questions from research.paa_questions. Answer each in 2-4 sentences.}

## Key Takeaways {H2}
- {Bullet 1 — contains primaryKeyword}
- {Bullet 2}
- {Bullet 3}
- {Bullet 4}
- {Bullet 5}

## Get Started with AI Medical Coding
{50 words. CTA. Link to https://medicodio.ai/}
```

Content rules:
- Include internal link to https://medicodio.ai/ in the MediCodio section
- Include 2-3 external authority links (CMS.gov, AHIMA, MGMA, peer-reviewed sources)
- Include primaryKeyword in: H1, first 100 words, at least one H2, last paragraph
- Target audience: RCM Director / HIM Director / CFO

## Step 3 — Count words and validate

Count words in the post body (exclude frontmatter). If wordCount < 1800: expand the two shortest sections until ≥1800.

## Step 4 — Save draft.md

```
sharepoint_write_file
  path="{runFolder}/draft.md"
  content="{full post with frontmatter}"
→ IF fails: retry once. If still fails: post blocked on self + parent. STOP.
```

## Step 5 — Write write.md log

```
sharepoint_write_file
  path="{runFolder}/logs/write.md"
  content:
---
# Write Log — {topic}
**Date:** {ISO now}
**Word count:** {N}
**Primary keyword:** {primaryKeyword}
**SEO title:** {seoTitle} ({len} chars)
**SEO description:** {seoDescription} ({len} chars)

## Sections Written
| H2 | ~Words |
|----|--------|
{one row per H2}

## Keyword Usage (self-check)
- H1: {yes/no}
- Intro: {yes/no}
- H2 count: {N}
- Body count: {N}
- Conclusion: {yes/no}

## Internal/External Links
- Internal: https://medicodio.ai/ ✓
- External: {url1}, {url2}, {url3}
---
```

## Step 6 — Write write section to run-state.json

```
sharepoint_read_file path="{run_state_path}"
→ append:
"write": {
  "status": "complete",
  "completed_at": "{ISO}",
  "word_count": N,
  "seo_title": "...",
  "seo_description": "...",
  "draft_path": "{runFolder}/draft.md"
},
"wordCount": N,
"phases.write": "done"
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
→ IF fails: retry once. If still fails: post blocked on self + parent. STOP.
```

## Step 7 — Create [BLOG-SEO-CHECK] child and close

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[BLOG-SEO-CHECK] {topic}",
  "description": "phase_file: routines/bi-weekly-blog-post/seo-check.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
```

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done", "comment": "Draft written. Word count: {N}. SEO title: {seoTitle}. [BLOG-SEO-CHECK] created." }
```
```

- [ ] **Step 2: Commit**

```bash
git add agents/seo-content-writer/routines/bi-weekly-blog-post/write.md
git commit -m "feat(seo-content-writer): add write phase"
```

---

## Task 6: seo-check.md — Keyword Scoring Phase

**Goal:** Score every keyword in the cluster against the draft, auto-fix any scoring <5, gate on overall ≥70, save scorecard, create [BLOG-EMAIL] child.

**Files:**
- Create: `agents/seo-content-writer/routines/bi-weekly-blog-post/seo-check.md`

**Acceptance Criteria:**
- [ ] Loads keyword cluster from config.md (not hardcoded)
- [ ] Scores each keyword 1–10 with notes on placement
- [ ] Auto-fixes keywords <5 by rewriting sections in draft.md
- [ ] Rejects overall score <70 (rewrites weakest 2 sections)
- [ ] Saves updated draft.md back to SharePoint
- [ ] Saves seo-check.md scorecard
- [ ] Creates [BLOG-EMAIL] child

**Steps:**

- [ ] **Step 1: Create seo-check.md**

```markdown
# SEO Check — Keyword Scoring + Auto-Fix (Phase 3)

**BOUNDARY LINE 1:** Load keyword cluster from config.md — do NOT use a hardcoded list.
**BOUNDARY LINE 2:** draft.md is updated IN PLACE when fixes are applied — write back to SharePoint.
**BOUNDARY LINE 3:** Do not proceed to [BLOG-EMAIL] if overall score < 70 — rewrite first.
**STATE:** Reads run-state.json + config.md + draft.md. Writes `seo_check` section. Updates draft.md. Creates `[BLOG-EMAIL]` child.
**DO NOT:** Send emails. Research SERP again.

---

## Step 1 — Load state and keyword cluster

```
run_state_path = extract from issue description
parent_issue_id = extract from issue description

sharepoint_read_file path="{run_state_path}"
→ extract: topic, primaryKeyword, runFolder, write.draft_path

sharepoint_read_file path="SEO-Content-Writer/config.md"
→ parse keyword cluster (primary + secondary + long-tail)

sharepoint_read_file path="{runFolder}/draft.md"
→ store as draft_content
```

## Step 2 — Score each keyword

For each keyword in the cluster, score 1–10:

| Score | Meaning |
|-------|---------|
| 9–10  | In H1 + intro + 3+ body + conclusion |
| 7–8   | In H2 + 2+ body |
| 5–6   | In body 1-2x only |
| 3–4   | Once only, not in heading |
| 1–2   | Missing or only in a quote/link |

Check placement:
- Is it in H1? (+3 points)
- Is it in an H2? (+2 points)
- Is it in intro (first 150 words)? (+2 points)
- Is it in conclusion/CTA? (+1 point)
- Body count: each occurrence = +0.5 up to +2

Build scorecard table:
```
| Keyword | Score | H1 | H2 | Intro | Body count | Conclusion | Notes |
```

## Step 3 — Auto-fix keywords scoring < 5

For each keyword scoring < 5:
1. Identify the most relevant H2 section for this keyword
2. Add the keyword naturally to that section's heading or opening sentence
3. Add 1 more mention in the body of that section
4. Update draft_content in memory

After all fixes, re-score those keywords. Update scorecard.

## Step 4 — Compute overall score and gate

```
total_possible = len(keywords) * 10
overall_score = (sum of all keyword scores / total_possible) * 100
```

IF overall_score < 70:
- Identify the 2 lowest-scoring keywords
- Rewrite their entire sections (expand to add more natural mentions)
- Re-score and recompute
- IF still < 70 after one rewrite pass: proceed anyway but note in scorecard "BELOW THRESHOLD — revised once, still {score}"

## Step 5 — Save updated draft.md

```
sharepoint_write_file path="{runFolder}/draft.md" content="{updated draft_content}"
→ IF fails: retry once. If still fails: post blocked on self + parent. STOP.
```

## Step 6 — Save seo-check.md scorecard

```
sharepoint_write_file
  path="{runFolder}/logs/seo-check.md"
  content:
---
# SEO Scorecard — {topic}
**Date:** {ISO now}
**Primary keyword:** {primaryKeyword}

## Keyword Scores

| Keyword | Score | H1 | H2 | Intro | Body | Conclusion | Notes |
|---------|-------|----|----|-------|------|------------|-------|
{one row per keyword}

**Overall SEO Score: {score}/100**
**Status: {PASS / BELOW THRESHOLD}** (threshold: 70/100)

## Auto-Fixed Keywords
{list any keywords that were rewritten + what changed}

## Post word count after fixes: {N}
---
```

## Step 7 — Write seo_check section to run-state.json

```
sharepoint_read_file path="{run_state_path}"
→ append:
"seo_check": {
  "status": "complete",
  "completed_at": "{ISO}",
  "overall_score": N,
  "keyword_scores": { "{keyword}": N, ... },
  "auto_fixed": [...],
  "scorecard_path": "{runFolder}/logs/seo-check.md"
},
"seoScore": N,
"phases.seo_check": "done"
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
```

## Step 8 — Create [BLOG-EMAIL] child and close

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[BLOG-EMAIL] {topic}",
  "description": "phase_file: routines/bi-weekly-blog-post/email.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
```

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done", "comment": "SEO check complete. Score: {overall_score}/100. Fixed {N} keywords. [BLOG-EMAIL] created." }
```
```

- [ ] **Step 2: Commit**

```bash
git add agents/seo-content-writer/routines/bi-weekly-blog-post/seo-check.md
git commit -m "feat(seo-content-writer): add seo-check phase"
```

---

## Task 7: email.md — Approval Email Phase

**Goal:** Send approval email to Jessica or Amanda (CC naveen), store conversationId + messageId in run-state.json, set parent to in_review, then exit (pipeline pauses for email-monitor).

**Files:**
- Create: `agents/seo-content-writer/routines/bi-weekly-blog-post/email.md`

**Acceptance Criteria:**
- [ ] Reads category from run-state.json to determine approver
- [ ] Sends from karthik.r@medicodio.ai, CC naveen@medicodio.ai
- [ ] Email body includes SEO scorecard table + SharePoint draft link
- [ ] Stores conversationId, messageId, lastCheckedAt in run-state.json
- [ ] Sets run-state.json status = "awaiting_reply"
- [ ] Sets parent issue → in_review
- [ ] Closes self as done (no next child — email-monitor takes over)

**Steps:**

- [ ] **Step 1: Create email.md**

```markdown
# Email — Approval Request (Phase 4)

**BOUNDARY LINE 1:** Send ONE email only. Do not send to both approvers.
**BOUNDARY LINE 2:** CC naveen@medicodio.ai on every send — no exceptions.
**BOUNDARY LINE 3:** After sending, exit. Do NOT create a next child issue here. The email-monitor routine creates the next child.
**STATE:** Reads run-state.json + seo-check.md. Writes `email` section. Sets parent → in_review. Closes self.
**DO NOT:** Create [BLOG-REVISE] or [BLOG-PUBLISH] here. That is email-monitor's job.

---

## Step 1 — Load state

```
run_state_path = extract from issue description
parent_issue_id = extract from issue description

sharepoint_read_file path="{run_state_path}"
→ extract: topic, primaryKeyword, category, approverEmail, runFolder, seoScore, wordCount, write.draft_path

sharepoint_read_file path="{runFolder}/logs/seo-check.md"
→ store scorecard_content (for email body)

sharepoint_get_file_info path="{runFolder}/draft.md"
→ store webUrl as draft_share_url
```

## Step 2 — Compose approval email

**Subject:** `[Blog Review] {topic} — SEO Score: {seoScore}/100`

**HTML Body:**
```html
<p>Hi {firstName from approverEmail},</p>

<p>A new blog post is ready for your review before publishing to medicodio.ai.</p>

<table border="1" cellpadding="6" cellspacing="0">
<tr><td><strong>Title</strong></td><td>{topic}</td></tr>
<tr><td><strong>Target Keyword</strong></td><td>{primaryKeyword}</td></tr>
<tr><td><strong>Word Count</strong></td><td>{wordCount}</td></tr>
<tr><td><strong>SEO Score</strong></td><td>{seoScore}/100</td></tr>
<tr><td><strong>Draft</strong></td><td><a href="{draft_share_url}">View in SharePoint</a></td></tr>
</table>

<br>
<h3>SEO Keyword Scorecard</h3>
{scorecard_content — paste the markdown table as HTML table}

<br>
<p><strong>To approve:</strong> Reply with "Approved" or "Looks good"</p>
<p><strong>To request changes:</strong> Reply with your specific changes (e.g. "Change paragraph 2 from X to Y")</p>
<p><strong>To start over:</strong> Reply with "Start over"</p>

<br><br>
<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, Helvetica, sans-serif; color:#333333; line-height:1.5; border-left:3px solid #0a1d56; padding-left:16px;">
  <tr><td>
    <table cellpadding="0" cellspacing="0" border="0">
      <tr><td style="font-family: Arial, Helvetica, sans-serif; font-size:14px; color:#0a1d56; font-weight:700; padding-bottom:2px;">Thanks &amp; Regards,</td></tr>
      <tr><td style="font-family: Arial, Helvetica, sans-serif; font-size:16px; color:#0a1d56; font-weight:700; padding-bottom:4px;">Medicodio</td></tr>
      <tr><td style="font-family: Arial, Helvetica, sans-serif; font-size:12px; color:#666666; padding-bottom:10px; letter-spacing:0.3px; text-transform:uppercase;">AI Powered Medical Coding</td></tr>
      <tr><td style="font-family: Arial, Helvetica, sans-serif; font-size:13px; color:#333333; padding-top:8px; border-top:1px solid #e5e7eb;">
        <a href="https://medicodio.ai/" style="color:#0a1d56; text-decoration:none; font-weight:600;" target="_blank">MediCodio AI</a>
        <span style="color:#c0c5d1; padding:0 6px;">|</span>
        <a href="https://www.linkedin.com/company/medicodioai/" style="color:#0a1d56; text-decoration:none; font-weight:600;" target="_blank">LinkedIn</a>
        <span style="color:#c0c5d1; padding:0 6px;">|</span>
        <a href="mailto:karthik.r@medicodio.ai" style="color:#0a1d56; text-decoration:none; font-weight:600;">karthik.r@medicodio.ai</a>
      </td></tr>
    </table>
  </td></tr>
</table>
```

## Step 3 — Send email

```
outlook_send_email
  mailbox="{OUTLOOK_MAILBOX}"
  to="{approverEmail}"
  cc="naveen@medicodio.ai"
  subject="{subject}"
  body="{HTML body}"
  bodyType="HTML"
→ capture: conversationId, messageId, sentAt
→ IF fails: retry once. If still fails: post blocked on self + parent. STOP.
```

## Step 4 — Save email section to run-state.json

```
sharepoint_read_file path="{run_state_path}"
→ append:
"email": {
  "status": "sent",
  "sent_at": "{ISO}",
  "to": "{approverEmail}",
  "cc": "naveen@medicodio.ai",
  "subject": "{subject}",
  "conversation_id": "{conversationId}",
  "message_id": "{messageId}"
},
"conversationId": "{conversationId}",
"messageId": "{messageId}",
"lastCheckedAt": "{sentAt}",
"status": "awaiting_reply",
"phases.email": "done"
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
```

## Step 5 — Write email.md log

```
sharepoint_write_file
  path="{runFolder}/logs/email.md"
  content:
---
# Email Log — {topic}
**Sent at:** {ISO}
**From:** {OUTLOOK_MAILBOX}
**To:** {approverEmail}
**CC:** naveen@medicodio.ai
**Subject:** {subject}
**conversationId:** {conversationId}
**messageId:** {messageId}
---
```

## Step 6 — Set parent to in_review and close self

```
PATCH /api/issues/{parent_issue_id}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "in_review", "comment": "Approval email sent to {approverEmail}. Waiting for reply." }

PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done", "comment": "Email sent. conversationId: {conversationId}. Email-monitor will check for replies every 6h." }
```

**Pipeline pauses here. Email-monitor routine takes over.** ✓
```

- [ ] **Step 2: Commit**

```bash
git add agents/seo-content-writer/routines/bi-weekly-blog-post/email.md
git commit -m "feat(seo-content-writer): add email phase"
```

---

## Task 8: revise.md — Revision Phase

**Goal:** Read the reviewer's reply, apply requested changes to draft.md, re-run inline SEO check, reply to email thread with updated draft, loop back to awaiting_reply. Handle max-revision safety.

**Files:**
- Create: `agents/seo-content-writer/routines/bi-weekly-blog-post/revise.md`

**Acceptance Criteria:**
- [ ] Reads reply messageId from issue description
- [ ] Fetches full reply body from Outlook
- [ ] Applies changes to draft.md
- [ ] Abbreviated inline SEO re-check (no full child issue)
- [ ] Increments revisionCount — blocks at maxRevisions
- [ ] Replies to same Outlook thread with updated draft link
- [ ] Sets status back to "awaiting_reply"

**Steps:**

- [ ] **Step 1: Create revise.md**

```markdown
# Revise — Apply Changes + Re-Check (Revision Phase)

**BOUNDARY LINE 1:** Changes come from the reviewer's email reply — do NOT invent changes.
**BOUNDARY LINE 2:** Inline SEO re-check only (abbreviated). Do NOT create a new [BLOG-SEO-CHECK] child.
**BOUNDARY LINE 3:** After revising, set status = "awaiting_reply" and exit. Email-monitor creates the next child.
**BOUNDARY LINE 4:** If revisionCount >= maxRevisions: block parent, email karthik.r, EXIT without revising.
**STATE:** Reads run-state.json. Updates draft.md. Writes `revise-{n}` section. Closes self.
**DO NOT:** Publish. Create [BLOG-PUBLISH] here. Send to a different approver.

---

## Step 1 — Load state and reply

```
run_state_path = extract from issue description
parent_issue_id = extract from issue description
reply_message_id = extract from issue description line: "reply_message_id: ..."

sharepoint_read_file path="{run_state_path}"
→ extract: topic, runFolder, conversationId, revisionCount, maxRevisions,
  approverEmail, seoScore, wordCount, primaryKeyword

IF revisionCount >= maxRevisions:
  → read all revise-{n}.md logs from SharePoint (for history)
  → outlook_send_email
     mailbox="{OUTLOOK_MAILBOX}"
     to="karthik.r@medicodio.ai"
     subject="[Blog Blocked] {topic} — max revisions ({maxRevisions}) reached"
     body: "The blog post '{topic}' has gone through {maxRevisions} revision cycles without approval.
            Approver: {approverEmail}
            Revision history attached below.
            {contents of all revise-{n}.md logs}
            Please review directly and approve or discard."
  → PATCH /api/issues/{parent_issue_id} status="blocked"
     comment: "Max revisions ({maxRevisions}) reached. Email sent to karthik.r@medicodio.ai."
  → PATCH self → done. STOP.

outlook_read_email messageId="{reply_message_id}"
→ store as reply_body
```

## Step 2 — Parse change requests

Read reply_body carefully. Extract specific changes requested:
- "Change X to Y" → literal replacement
- "Add a section about Z" → add new section
- "Remove the part about W" → delete section
- "Make it more formal/shorter/etc." → style adjustment

List all changes explicitly before applying any.

## Step 3 — Apply changes to draft.md

```
sharepoint_read_file path="{runFolder}/draft.md"
→ store as draft_content
```

Apply each change from Step 2 to draft_content in memory.

For each change:
- Make the minimum edit needed — do not rewrite entire sections unless requested
- Preserve SEO-critical keywords when restructuring

```
sharepoint_write_file path="{runFolder}/draft.md" content="{updated draft_content}"
→ IF fails: retry once. If still fails: post blocked on self + parent. STOP.
```

## Step 4 — Inline SEO re-check

Load keyword cluster from config.md. Re-score the 5 primary keywords only (abbreviated check):
- AI medical coding
- AI medical billing
- automated medical coding
- medical coding automation
- AI powered medical coding

Compute mini SEO score from these 5 only. If any primary keyword score drops below 5, fix it before continuing.

Update run-state.json seoScore with new estimate.

## Step 5 — Write revise-{n}.md log

```
n = revisionCount + 1
sharepoint_write_file
  path="{runFolder}/logs/revise-{n}.md"
  content:
---
# Revision {n} — {topic}
**Date:** {ISO now}
**Reviewer:** {approverEmail}
**Reply message ID:** {reply_message_id}

## Requested Changes
{list of parsed changes}

## Changes Applied
{what was done for each change}

## SEO Re-check (Primary KW Only)
| Keyword | Score |
{5 primary keywords}
**Mini SEO Score: {score}/50**
---
```

## Step 6 — Reply to email thread with updated draft

```
sharepoint_get_file_info path="{runFolder}/draft.md"
→ get webUrl as draft_url

outlook_reply_to_email
  messageId="{reply_message_id}"
  body: "<p>Thanks for the feedback. I've applied all the requested changes.</p>
         <p><strong>What changed:</strong></p>
         <ul>{list of changes applied}</ul>
         <p><a href='{draft_url}'>View updated draft in SharePoint</a></p>
         <p>Please reply with 'Approved' to publish, or send further feedback.</p>"
  bodyType="HTML"
→ capture new messageId, conversationId (should be same)
```

## Step 7 — Update run-state.json

```
sharepoint_read_file path="{run_state_path}"
→ update:
  revisionCount = revisionCount + 1
  lastCheckedAt = now ISO
  status = "awaiting_reply"
  messageId = new messageId (from reply)
  "revise_{n}": {
    "status": "complete",
    "completed_at": "{ISO}",
    "changes_requested": [...],
    "changes_applied": [...],
    "reply_message_id": "{new messageId}"
  }
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
```

## Step 8 — Close self

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done", "comment": "Revision {n} complete. {N} changes applied. Reply sent. Email-monitor checking for next reply." }
```

**Pipeline pauses. Email-monitor creates next child.** ✓
```

- [ ] **Step 2: Commit**

```bash
git add agents/seo-content-writer/routines/bi-weekly-blog-post/revise.md
git commit -m "feat(seo-content-writer): add revise phase"
```

---

## Task 9: publish.md — Publish Phase

**Goal:** Read approved draft, convert markdown to Portable Text via helper script, POST to /api/blog/push, save publishResponseId, create [BLOG-AUDIT] child.

**Files:**
- Create: `agents/seo-content-writer/routines/bi-weekly-blog-post/publish.md`

**Acceptance Criteria:**
- [ ] Reads draft.md from SharePoint run folder
- [ ] Saves draft locally, runs `node scripts/md-to-portable-text.js`, captures JSON output
- [ ] POSTs to https://medicodio.ai/api/blog/push with correct headers
- [ ] Saves publishResponseId to run-state.json
- [ ] Writes publish.md log
- [ ] Creates [BLOG-AUDIT] child

**Steps:**

- [ ] **Step 1: Create publish.md**

```markdown
# Publish — Post to medicodio.ai (Phase 6)

**BOUNDARY LINE 1:** Only publish after confirmed approval — check run-state.json status is "publish_queued".
**BOUNDARY LINE 2:** Portable Text conversion done via `scripts/md-to-portable-text.js` — do NOT attempt to construct PT blocks manually.
**BOUNDARY LINE 3:** Save publishResponseId from API response — required for audit log.
**STATE:** Reads run-state.json + draft.md. POSTs to /api/blog/push. Writes `publish` section. Creates `[BLOG-AUDIT]` child.
**DO NOT:** Modify draft content here. Send more emails.

---

## Step 1 — Load state and validate

```
run_state_path = extract from issue description
parent_issue_id = extract from issue description

sharepoint_read_file path="{run_state_path}"
→ extract: topic, primaryKeyword, runFolder, seoScore, wordCount, approverEmail, seoCheck.scorecard_path
→ IF status ≠ "publish_queued":
   post blocked "run-state.json status is '{status}', expected 'publish_queued'. Do not publish without approval."
   STOP.
```

## Step 2 — Read draft and extract frontmatter

```
sharepoint_read_file path="{runFolder}/draft.md"
→ store as draft_content
```

Parse frontmatter:
```
seoTitle = value of `seoTitle:` line (≤60 chars — if >60 chars, truncate at last word boundary)
seoDescription = value of `seoDescription:` line (≤160 chars)
```

Strip frontmatter (lines between `---` markers) from draft_content. Keep only the markdown body.

## Step 3 — Convert markdown to Portable Text

Write draft body to a temp file and run the converter:

```bash
# Write markdown body to temp file
echo "{draft_body}" > /tmp/blog-draft.md

# Run converter
node scripts/md-to-portable-text.js /tmp/blog-draft.md
# Output: JSON array of Portable Text blocks
```

Capture stdout as `blogcontent` (JSON array). If the script exits non-zero or outputs invalid JSON: post blocked "md-to-portable-text.js failed: {stderr}". STOP.

## Step 4 — POST to /api/blog/push

```
fetch POST https://medicodio.ai/api/blog/push
Headers:
  x-blog-secret: {BLOG_PUSH_SECRET}
  Content-Type: application/json
Body:
{
  "title": "{seoTitle}",
  "description": "{seoDescription}",
  "blogcontent": {blogcontent array}
}
→ IF response status ≠ 200/201: post blocked "Blog push failed: {status} {body}". STOP.
→ capture response body → publishResponse
→ extract publishResponseId (check response for id, _id, postId, or documentId field)
```

## Step 5 — Save portable-text.json

```
sharepoint_write_file
  path="{runFolder}/portable-text.json"
  content="{JSON.stringify(blogcontent)}"
```

## Step 6 — Write publish.md log

```
sharepoint_write_file
  path="{runFolder}/logs/publish.md"
  content:
---
# Publish Log — {topic}
**Published at:** {ISO now}
**Approver:** {approverEmail}
**API response:** {HTTP status}
**publishResponseId:** {id}
**SEO score at publish:** {seoScore}/100
**Word count:** {wordCount}
**Title:** {seoTitle}
**Description:** {seoDescription}
---
```

## Step 7 — Update run-state.json

```
sharepoint_read_file path="{run_state_path}"
→ update:
  publishedAt = now ISO
  publishResponseId = "{id}"
  status = "published"
  "publish": {
    "status": "complete",
    "completed_at": "{ISO}",
    "publish_response_id": "{id}",
    "api_status": "{HTTP status}"
  },
  "phases.publish": "done"
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
```

## Step 8 — Create [BLOG-AUDIT] child and close

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[BLOG-AUDIT] {topic}",
  "description": "phase_file: routines/bi-weekly-blog-post/audit.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
```

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done", "comment": "Published. Response ID: {publishResponseId}. [BLOG-AUDIT] created." }
```
```

- [ ] **Step 2: Commit**

```bash
git add agents/seo-content-writer/routines/bi-weekly-blog-post/publish.md
git commit -m "feat(seo-content-writer): add publish phase"
```

---

## Task 10: audit.md — Final Audit + Close Parent

**Goal:** Write comprehensive audit.md log, update config.md posted log, clear activeRunFolder, close parent issue.

**Files:**
- Create: `agents/seo-content-writer/routines/bi-weekly-blog-post/audit.md`

**Acceptance Criteria:**
- [ ] Writes audit.md with full run summary (topic, keyword, SEO score, revisions, approver, publish time, publishResponseId)
- [ ] Updates config.md: marks topic as posted with date, clears activeRunFolder
- [ ] Posts final summary comment on parent issue
- [ ] Closes parent issue → done
- [ ] Closes self → done

**Steps:**

- [ ] **Step 1: Create audit.md**

```markdown
# Audit — Final Log + Close (Phase 7)

**BOUNDARY LINE 1:** Last phase. Do NOT create any more child issues.
**BOUNDARY LINE 2:** Source all stats from run-state.json — do NOT re-derive from SharePoint files.
**BOUNDARY LINE 3:** Always close both parent and self as done, even if log writes fail (non-blocking after parent close).
**STATE:** Reads full run-state.json. Writes audit.md. Updates config.md. Closes parent + self.
**DO NOT:** Publish. Send emails. Create child issues.

---

## Step 1 — Load state

```
run_state_path = extract from issue description
parent_issue_id = extract from issue description

sharepoint_read_file path="{run_state_path}"
→ parse full JSON
→ IF status ≠ "published":
   post warning comment "run-state.json status is '{status}', expected 'published'. Proceeding with audit anyway."
```

## Step 2 — Write audit.md

```
sharepoint_write_file
  path="{runFolder}/logs/audit.md"
  content:
---
# Audit Log — {topic}
**Run completed:** {ISO now}
**Parent issue:** {parentIssueId}

## Post Summary
| Field | Value |
|-------|-------|
| Topic | {topic} |
| Primary keyword | {primaryKeyword} |
| Word count | {wordCount} |
| SEO score | {seoScore}/100 |
| Revision cycles | {revisionCount} |
| Approver | {approverEmail} |
| Published at | {publishedAt} |
| Publish response ID | {publishResponseId} |

## Phase Timeline
| Phase | Completed at |
|-------|-------------|
| Research | {research.completed_at} |
| Write | {write.completed_at} |
| SEO Check | {seo_check.completed_at} |
| Email | {email.sent_at} |
| Publish | {publish.completed_at} |

## Keyword Scores at Publish
{seo_check.keyword_scores as table}

## Run Folder
{runFolder}
---
```

## Step 3 — Update config.md

```
sharepoint_read_file path="SEO-Content-Writer/config.md"
→ append to posted_log:
  - topic: {topic}
    slug: {slug}
    published_at: {publishedAt}
    publish_response_id: {publishResponseId}
    seo_score: {seoScore}
→ clear activeRunFolder: set to ""
sharepoint_write_file path="SEO-Content-Writer/config.md" content="{updated}"
→ IF fails: post warning comment but continue — do NOT block on config update failure.
```

## Step 4 — Post final comment on parent and close

```
POST /api/issues/{parent_issue_id}/comments
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "body": "Blog post published.\n\nTopic: {topic}\nKeyword: {primaryKeyword}\nSEO score: {seoScore}/100\nWord count: {wordCount}\nRevision cycles: {revisionCount}\nApprover: {approverEmail}\nPublished: {publishedAt}\nResponse ID: {publishResponseId}\n\nRun folder: {runFolder}"
}

PATCH /api/issues/{parent_issue_id}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done" }

PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done", "comment": "Audit complete. Pipeline closed." }
```

✓ PIPELINE COMPLETE.
```

- [ ] **Step 2: Commit**

```bash
git add agents/seo-content-writer/routines/bi-weekly-blog-post/audit.md
git commit -m "feat(seo-content-writer): add audit phase"
```

---

## Task 11: email-monitor.md — Reply Monitoring Routine

**Goal:** 6-hour cron routine that checks the inbox for replies to approval emails, classifies them, and creates the appropriate next sub-issue ([BLOG-REVISE] or [BLOG-PUBLISH]) under the parent issue.

**Files:**
- Create: `agents/seo-content-writer/routines/email-monitor.md`

**Acceptance Criteria:**
- [ ] Reads activeRunFolder from config.md — exits immediately if empty
- [ ] Checks run-state.json status — exits if not "awaiting_reply"
- [ ] Filters Outlook by conversationId + after lastCheckedAt
- [ ] Skips OOO, auto-replies, ambiguous single-word replies
- [ ] Creates [BLOG-REVISE] with reply_message_id in description on change request
- [ ] Creates [BLOG-PUBLISH] on approval
- [ ] Handles "start over" → creates new [BLOG-WRITE] child, resets revisionCount
- [ ] Always updates lastCheckedAt regardless of reply found

**Steps:**

- [ ] **Step 1: Create email-monitor.md**

```markdown
# Email Monitor — Reply Check Routine

**Trigger:** Every 6 hours (`0 */6 * * *`)
**Concurrency:** `skip_if_active`
**Catch-up:** `skip_missed`
**Purpose:** Check inbox for replies to blog approval emails. Create next pipeline sub-issue when reply found.
**DO NOT:** Make changes to the draft. Run SEO checks. Send new emails. Read competitor pages.

---

## Step 1 — Load config and check for active run

```
GET /api/agents/me → agentId, companyId
GET /api/agents/me/inbox-lite → find this routine's execution issue
POST /api/issues/{issueId}/checkout

sharepoint_read_file path="SEO-Content-Writer/config.md"
→ parse activeRunFolder
→ IF activeRunFolder is empty or missing:
   PATCH issue → done, "No active run. Exiting." EXIT.
```

## Step 2 — Load run state

```
sharepoint_read_file path="{activeRunFolder}/run-state.json"
→ IF missing: PATCH issue → done, "run-state.json not found at {path}. Clearing activeRunFolder."
  → sharepoint_write_file config.md with activeRunFolder=""
  EXIT.

→ extract: status, conversationId, messageId, lastCheckedAt,
  revisionCount, maxRevisions, parentIssueId, topic
→ IF status ≠ "awaiting_reply":
   PATCH issue → done, "Run status is '{status}' — not awaiting reply. Exiting." EXIT.
```

## Step 3 — Check inbox for replies

```
outlook_list_messages
  mailbox="{OUTLOOK_MAILBOX}"
  filter: conversationId = "{conversationId}"
  filter: receivedDateTime > "{lastCheckedAt}"
  orderBy: receivedDateTime asc
  top: 10
```

**Always update lastCheckedAt = now ISO**, even if no messages found:
```
sharepoint_read_file path="{activeRunFolder}/run-state.json"
→ update lastCheckedAt = now ISO
sharepoint_write_file path="{activeRunFolder}/run-state.json" content="{updated}"
```

If no messages:
```
PATCH issue → done, "No new replies since {lastCheckedAt}. Next check in 6h." EXIT.
```

## Step 4 — Filter and classify replies

For each message (process in received order):

**Skip if any of:**
- Subject contains: "Out of Office", "Auto-Reply", "Automatic reply", "OOO", "Vacation"
- Body is empty or <20 characters
- Body is only punctuation, emoji, or a single word with no context

**Classify remaining replies:**

APPROVED (any of these exact phrases, case-insensitive):
- "approved", "looks good", "go ahead", "publish it", "send it", "lgtm", "good to go", "yes publish", "publish this", "approved ✓", "yes, publish"

START OVER:
- "start over", "start again", "rewrite it", "restart"

CHANGES REQUESTED:
- Any substantive reply that is not an approval signal

Use the LAST non-skipped reply if multiple replies exist (most recent decision wins).

## Step 5a — If APPROVED

```
POST /api/companies/{companyId}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[BLOG-PUBLISH] {topic}",
  "description": "phase_file: routines/bi-weekly-blog-post/publish.md\nrun_state_path: {activeRunFolder}/run-state.json\nparent_issue_id: {parentIssueId}",
  "assigneeAgentId": "{agentId}",
  "parentId": "{parentIssueId}",
  "status": "todo",
  "priority": "high"
}

sharepoint_read_file path="{activeRunFolder}/run-state.json"
→ update status = "publish_queued"
sharepoint_write_file

PATCH issue → done, "Reply classified as APPROVED. [BLOG-PUBLISH] child created."
```

## Step 5b — If CHANGES REQUESTED

```
reply_message_id = messageId of the reply

POST /api/companies/{companyId}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[BLOG-REVISE] {topic}",
  "description": "phase_file: routines/bi-weekly-blog-post/revise.md\nrun_state_path: {activeRunFolder}/run-state.json\nparent_issue_id: {parentIssueId}\nreply_message_id: {reply_message_id}",
  "assigneeAgentId": "{agentId}",
  "parentId": "{parentIssueId}",
  "status": "todo",
  "priority": "high"
}

sharepoint_read_file path="{activeRunFolder}/run-state.json"
→ update status = "revision_queued"
sharepoint_write_file

PATCH issue → done, "Reply classified as CHANGES. [BLOG-REVISE] child created. Revision {revisionCount+1}."
```

## Step 5c — If START OVER

```
sharepoint_read_file path="{activeRunFolder}/run-state.json"
→ reset: revisionCount = 0, status = "running"
sharepoint_write_file

POST /api/companies/{companyId}/issues
{
  "title": "[BLOG-WRITE] {topic} (restart)",
  "description": "phase_file: routines/bi-weekly-blog-post/write.md\nrun_state_path: {activeRunFolder}/run-state.json\nparent_issue_id: {parentIssueId}\nnote: start_over — research.md already exists, skip to write",
  "assigneeAgentId": "{agentId}",
  "parentId": "{parentIssueId}",
  "status": "todo",
  "priority": "high"
}

PATCH issue → done, "Reply: START OVER. RevisionCount reset to 0. New [BLOG-WRITE] child created."
```

---

## Error Handling

| Situation | Action |
|---|---|
| config.md missing | PATCH done, exit |
| activeRunFolder empty | PATCH done, exit |
| run-state.json missing | PATCH done, clear activeRunFolder, exit |
| Outlook list fails | Post warning, PATCH done — try next 6h cycle |
| Child issue creation fails | Retry once. Post blocked on self if still fails |
```

- [ ] **Step 2: Commit**

```bash
git add agents/seo-content-writer/routines/email-monitor.md
git commit -m "feat(seo-content-writer): add email-monitor routine"
```

---

## Task 12: scripts/md-to-portable-text.js — Markdown Converter

**Goal:** Node.js CLI script that reads a markdown file and outputs a Sanity Portable Text JSON array to stdout. Matches the n8n converter logic exactly.

**Files:**
- Create: `scripts/md-to-portable-text.js`

**Acceptance Criteria:**
- [ ] Takes file path as `process.argv[2]`
- [ ] Outputs valid JSON array to stdout
- [ ] Handles: H1–H6, unordered lists (nested), ordered lists, blockquotes, paragraphs
- [ ] Handles inline marks: bold, italic, bold+italic, strikethrough, code, links, bare URLs
- [ ] Exit code 0 on success, 1 on error (with message to stderr)
- [ ] `node scripts/md-to-portable-text.js path/to/test.md` produces parseable JSON

**Steps:**

- [ ] **Step 1: Create the script**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const filePath = process.argv[2];
if (!filePath) {
  process.stderr.write('Usage: node md-to-portable-text.js <markdown-file>\n');
  process.exit(1);
}

let markdown;
try {
  markdown = fs.readFileSync(path.resolve(filePath), 'utf8');
} catch (err) {
  process.stderr.write(`Cannot read file: ${err.message}\n`);
  process.exit(1);
}

// Strip frontmatter (--- ... ---)
const fmMatch = markdown.match(/^---\n[\s\S]*?\n---\n/);
const clean = fmMatch ? markdown.slice(fmMatch[0].length) : markdown;

try {
  const blocks = markdownToPortableText(clean);
  process.stdout.write(JSON.stringify(blocks, null, 2) + '\n');
} catch (err) {
  process.stderr.write(`Conversion error: ${err.message}\n`);
  process.exit(1);
}

function markdownToPortableText(markdown) {
  const blocks = [];
  let blockCounter = 0;
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      blockCounter++;
      blocks.push(makeBlock(`b${blockCounter}`, `h${headingMatch[1].length}`, parseInline(headingMatch[2].trim(), `b${blockCounter}`)));
      i++; continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*]\s+(.*)/);
    if (ulMatch) {
      blockCounter++;
      const block = makeBlock(`b${blockCounter}`, 'normal', parseInline(ulMatch[2].trim(), `b${blockCounter}`));
      block.listItem = 'bullet';
      block.level = ulMatch[1].length >= 4 ? 2 : 1;
      blocks.push(block);
      i++; continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+[.)]\s+(.*)/);
    if (olMatch) {
      blockCounter++;
      const block = makeBlock(`b${blockCounter}`, 'normal', parseInline(olMatch[2].trim(), `b${blockCounter}`));
      block.listItem = 'number';
      block.level = olMatch[1].length >= 4 ? 2 : 1;
      blocks.push(block);
      i++; continue;
    }

    // Blockquote
    const quoteMatch = line.match(/^>\s*(.*)/);
    if (quoteMatch) {
      blockCounter++;
      blocks.push(makeBlock(`b${blockCounter}`, 'blockquote', parseInline(quoteMatch[1].trim(), `b${blockCounter}`)));
      i++; continue;
    }

    // Normal paragraph — collect consecutive non-special lines
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^\s*[-*]\s/) &&
      !lines[i].match(/^\s*\d+[.)]\s/) &&
      !lines[i].match(/^>\s/)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blockCounter++;
      blocks.push(makeBlock(`b${blockCounter}`, 'normal', parseInline(paraLines.join(' ').trim(), `b${blockCounter}`)));
    }
  }

  return blocks;
}

function makeBlock(key, style, parsed) {
  return {
    _type: 'block',
    _key: key,
    style: style,
    markDefs: parsed.markDefs,
    children: parsed.children,
  };
}

function parseInline(text, blockKey) {
  const children = [];
  const markDefs = [];
  let childCounter = 0;
  let linkCounter = 0;

  const pattern = /(\[([^\]]+)\]\(([^)]+)\))|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`(.+?)`|(https?:\/\/[^\s,)]+)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const plain = text.substring(lastIndex, match.index);
      if (plain) {
        childCounter++;
        children.push({ _type: 'span', _key: `${blockKey}c${childCounter}`, text: plain, marks: [] });
      }
    }

    childCounter++;
    const ck = `${blockKey}c${childCounter}`;

    if (match[1]) {
      // Markdown link [text](url)
      linkCounter++;
      const lk = `${blockKey}link${linkCounter}`;
      markDefs.push({ _type: 'link', _key: lk, href: match[3], blank: true });
      children.push({ _type: 'span', _key: ck, text: match[2], marks: [lk] });
    } else if (match[4]) {
      children.push({ _type: 'span', _key: ck, text: match[4], marks: ['strong', 'em'] });
    } else if (match[5]) {
      children.push({ _type: 'span', _key: ck, text: match[5], marks: ['strong'] });
    } else if (match[6]) {
      children.push({ _type: 'span', _key: ck, text: match[6], marks: ['em'] });
    } else if (match[7]) {
      children.push({ _type: 'span', _key: ck, text: match[7], marks: ['strike-through'] });
    } else if (match[8]) {
      children.push({ _type: 'span', _key: ck, text: match[8], marks: ['code'] });
    } else if (match[9]) {
      let url = match[9];
      let trailing = '';
      if (/[.;:]$/.test(url)) { trailing = url.slice(-1); url = url.slice(0, -1); }
      linkCounter++;
      const lk = `${blockKey}link${linkCounter}`;
      markDefs.push({ _type: 'link', _key: lk, href: url, blank: true });
      children.push({ _type: 'span', _key: ck, text: url, marks: [lk] });
      if (trailing) {
        childCounter++;
        children.push({ _type: 'span', _key: `${blockKey}c${childCounter}`, text: trailing, marks: [] });
      }
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    childCounter++;
    children.push({ _type: 'span', _key: `${blockKey}c${childCounter}`, text: text.substring(lastIndex), marks: [] });
  }

  if (children.length === 0) {
    children.push({ _type: 'span', _key: `${blockKey}c1`, text: '', marks: [] });
  }

  return { children, markDefs };
}
```

- [ ] **Step 2: Verify the script runs**

```bash
echo "# Hello World\n\nThis is **bold** and *italic*.\n\n- Item 1\n- Item 2" > /tmp/test-md.md
node scripts/md-to-portable-text.js /tmp/test-md.md
```

Expected: valid JSON array starting with `[` containing `_type: "block"` objects with `style: "h1"` for the heading.

```bash
node scripts/md-to-portable-text.js /tmp/test-md.md | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); JSON.parse(d); console.log('VALID JSON');"
```

Expected output: `VALID JSON`

- [ ] **Step 3: Commit**

```bash
git add scripts/md-to-portable-text.js
git commit -m "feat(seo-content-writer): add markdown to portable text converter script"
```

---

## Task 13: Clean Up Draft AGENTS.md + Final Commit

**Goal:** Remove the incomplete draft AGENTS.md written before brainstorming, verify all files are in place, make final commit.

**Files:**
- Verify all 12 files from the file map exist

**Acceptance Criteria:**
- [ ] All 12 agent files present
- [ ] `agents/seo-content-writer/routines/phases/` directory does not exist (renamed to `bi-weekly-blog-post/`)
- [ ] Final git status is clean

**Steps:**

- [ ] **Step 1: Verify all files exist**

```bash
find agents/seo-content-writer -type f | sort
```

Expected output (12 files):
```
agents/seo-content-writer/AGENTS.md
agents/seo-content-writer/mcp.json
agents/seo-content-writer/routines/bi-weekly-blog-post.md
agents/seo-content-writer/routines/bi-weekly-blog-post/audit.md
agents/seo-content-writer/routines/bi-weekly-blog-post/email.md
agents/seo-content-writer/routines/bi-weekly-blog-post/publish.md
agents/seo-content-writer/routines/bi-weekly-blog-post/research.md
agents/seo-content-writer/routines/bi-weekly-blog-post/revise.md
agents/seo-content-writer/routines/bi-weekly-blog-post/seo-check.md
agents/seo-content-writer/routines/bi-weekly-blog-post/write.md
agents/seo-content-writer/routines/email-monitor.md
scripts/md-to-portable-text.js
```

- [ ] **Step 2: Remove old phases/ dir if it exists**

```bash
rm -rf agents/seo-content-writer/routines/phases/
```

- [ ] **Step 3: Final status check**

```bash
git status
```

All files should be committed. Working tree should be clean.
