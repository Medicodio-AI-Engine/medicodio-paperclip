# Research — SERP Analysis (Phase 1)

⛔ **HARD STOP RULE: This phase does ONE thing — SERP research + create [BLOG-WRITE] child. After Step 7, YOUR JOB IS DONE. EXIT THE HEARTBEAT IMMEDIATELY. Do not write the blog. Do not score SEO. Do not send email. Do not read write.md, seo-check.md, email.md or any other phase file. The next heartbeat handles the next phase.**

**BOUNDARY LINE 1:** Research only — do NOT write the blog post here. Not even a draft. Not even an outline.
**BOUNDARY LINE 2:** All run context comes from run-state.json at `run_state_path` in issue description.
**BOUNDARY LINE 3:** Fetch before Playwright — only use Playwright if fetch returns empty content.
**STATE:** Reads initial run-state.json. Writes `research` section. Creates `[BLOG-WRITE]` child. Closes self.

---

## Step 1 — Load state

```
run_state_path = extract from issue description line: "run_state_path: ..."
parent_issue_id = extract from issue description line: "parent_issue_id: ..."

sharepoint_read_file path="{run_state_path}"
→ IF missing: post blocked "run-state.json not found at {run_state_path}." STOP.
→ extract: topic, primaryKeyword, contentBrief, runFolder, parentIssueId, phases.research

→ IF phases.research == "done":
   post comment "Idempotency: research already completed in a prior run. Creating [BLOG-WRITE] child and exiting."
   Go directly to Step 7.

→ extract remaining fields: topic, primaryKeyword, contentBrief, runFolder, parentIssueId
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

⛔ **YOUR JOB IS DONE. EXIT NOW. Do not write the blog post. Do not open write.md. The [BLOG-WRITE] child issue you just created will handle writing in the next heartbeat.**
