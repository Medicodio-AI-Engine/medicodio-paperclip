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
