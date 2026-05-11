# SEO Improve — Targeted Keyword Improvement (Phase 3b)

⛔ **HARD STOP RULE: This phase rewrites weak sections to boost SEO score, then creates a new [BLOG-SEO-CHECK] child. EXIT after Step 5. Do not score yourself — the SEO-CHECK child does that.**

**PURPOSE:** Called when [BLOG-SEO-CHECK] scores below threshold (up to 3 times). Each pass targets the weakest keywords and rewrites their sections to push score higher. After rewriting, hands off to a new [BLOG-SEO-CHECK] child which re-scores from scratch.

**STATE:** Reads run-state.json + draft.md. Improves draft. Writes draft back. Creates [BLOG-SEO-CHECK] child. Closes self.

---

## Step 1 — Load context (with idempotency guard)

```
run_state_path = extract from issue description
parent_issue_id = extract from issue description
seo_improve_pass = extract from issue description (integer)
failing_dimensions = parse JSON from "failing_dimensions:" line
keyword_score   = extract from "keyword_score:"   line
keyword_target  = extract from "keyword_target:"  line
geo_score       = extract from "geo_score:"       line (default null if missing for backwards compat)
geo_target      = extract from "geo_target:"      line (default 65)
content_score   = extract from "content_score:"   line
content_target  = extract from "content_target:"  line (default 70)
low_scoring_keywords = extract from issue description (comma-separated)

sharepoint_read_file path="{run_state_path}"
→ extract: topic, primaryKeyword, runFolder, seo_check.keyword_scores, seoScore,
  geo_top5, geo_passages_to_restructure, content_quality_flags,
  seo_improve_count, ai_tone_worst_sections (may be null pre-Tier 1.7 runs)

# Idempotency guard — if a prior heartbeat already completed this improve pass and only the
# child issue creation failed, skip rewrite (avoid double-applying edits).
IF run-state.json.seo_improve_count >= seo_improve_pass:
  → Edits for this pass already applied in a prior heartbeat. Skip Steps 3, 3b, 4. Go directly
    to Step 5 (re-create the [BLOG-SEO-CHECK] child + close self).
  → Post comment: "Idempotency: seo-improve pass {seo_improve_pass} already applied to draft in
    a prior heartbeat. Creating [BLOG-SEO-CHECK] child for re-scoring."

sharepoint_read_file path="{runFolder}/draft.md"
→ store as draft_content

sharepoint_read_file path="SEO-Content-Writer/config.md"
→ parse full keyword cluster for reference
```

---

## Step 2 — Identify improvement targets across dimensions

Determine which dimensions need work by inspecting `failing_dimensions` (or fall back to score comparison if list missing):

```
needs_keyword_fix = "keyword" in failing_dimensions   OR keyword_score < keyword_target
needs_geo_fix     = "geo"     in failing_dimensions   OR (geo_score is not null AND geo_score < geo_target)
needs_content_fix = "content" in failing_dimensions   OR (content_score is not null AND content_score < content_target)
```

For each `needs_*_fix = true`, focus the rewrite on the corresponding section below. If only one dimension fails, do not do unrelated edits — minimal blast radius.

**Keyword targets** (when `needs_keyword_fix`):
1. Sort keywords by score ascending
2. Target the bottom 5 (or all scoring < 6 if fewer than 5)
3. For each target keyword, note:
   - Current score
   - Current mention count in draft
   - Which sections mention it

**Goal per dimension:**
- Keyword: each target keyword score ≥ 6 (2+ body mentions minimum)
- GEO: address top 3 entries in `geo_top5`; restructure passages in `geo_passages_to_restructure`
- Content quality: address every flag in `content_quality_flags` (filler removal, vague-citation fix, AI tone rewrite if `ai_tone_score > 7`)

---

## Step 3 — Keyword-driven rewrite (only if `needs_keyword_fix`)

Skip this step entirely if `needs_keyword_fix = false`. Otherwise, for each target keyword:

1. **Find best section:** Scan draft for the most relevant H2/H3 section for this keyword's topic
2. **Add 2 natural mentions:**
   - Opening sentence of the section: weave keyword in naturally (do not start sentence with keyword if it sounds awkward)
   - Closing sentence or a supporting sentence mid-section
3. **If no good section exists:** Add a new H3 subsection under the most relevant H2, with 2–3 sentences using the keyword naturally
4. **Do NOT:**
   - Stuff keywords artificially ("AI medical coding AI medical coding is…")
   - Create headings that read like keyword lists
   - Repeat the same phrase verbatim more than twice per section
5. **Update draft_content in memory**

After all rewrites, do a final read-through to check flow. Fix any awkward phrasing.

---

## Step 3b — Apply GEO + Content Quality Improvements

**Skill reference:** `agents/skills/seo-content-analysis.md` Parts 1 and 2.

Load from run-state.json (populated by the prior [BLOG-SEO-CHECK] pass):
```
geo_top5                    ← seo_check.geo_top5
geo_passages_to_restructure ← seo_check.geo_passages_to_restructure
content_quality_flags       ← seo_check.content_quality_flags
ai_tone_score               ← seo_check.ai_tone_score (or root ai_tone_score)
```

Apply each block ONLY if its dimension is failing:

**A. GEO passage restructuring (only if `needs_geo_fix`):**
For each entry in `geo_passages_to_restructure`:
1. Locate the passage in `draft_content` using `current_snippet` (first 25 words match)
2. Replace with `suggested_version` for top 3 entries unconditionally — these are the highest-impact fixes
3. For entries 4+, replace only if the section was also touched in Step 3 (limit blast radius for borderline cases)
4. Also apply top 3 entries from `geo_top5` if they describe section-level changes (e.g., "add FAQ", "open H2 with answer-first sentence")

**B. Content quality flag fixes (only if `needs_content_fix`):**
For each flag in `content_quality_flags`:
- Remove filler openers ("In today's world", "It is important to note", etc.) — rewrite the sentence without the filler phrase
- Replace vague citations ("many studies show", "experts agree") with a specific attribution where topic context allows; if not possible, rewrite as a direct claim with a concrete outcome
- Add an answer-first opener to any section that currently buries the answer after context-setting prose

**B-bis. AI tone rewrite (only if `ai_tone_score > 7`):**
Load `ai_tone_worst_sections` from run-state.json (or skill output). For each entry (top 3 max):
1. Locate the section in `draft_content` by `section_title` (H2 heading match) and `current_snippet` (paragraph start match).
2. Rewrite that section's first 200-300 words with first-hand voice. Inject:
   - At least one specific number (denial rate %, ROI months, code count)
   - At least one named tool, vendor, or process (Medicodio platform, NLP, ICD-10-CM, AHIMA standard)
   - Practitioner-perspective phrasing ("we saw", "our clients", "in practice", "from coder workflows we've audited")
3. Preserve keyword presence — if any primary or secondary keyword was in the section, keep it.
4. Do NOT touch sections not in `ai_tone_worst_sections` (limit blast radius).

**C. Keyword regression check (always — even when `needs_keyword_fix = false`):**
After all restructuring, scan `draft_content` for **all primary keywords** (first 5 in cluster). If any restructured section removed a keyword that was there before, re-insert it naturally in that section. Restructuring must never reduce primary keyword presence.

Update `draft_content` in memory with all changes from Step 3 and Step 3b combined.

**Do not re-run the full SEO Content Analysis Skill here.** The [BLOG-SEO-CHECK] child created in Step 5 re-scores everything from scratch using the composite gate (keyword + GEO + content).

---

## Step 4 — Write improved draft back to SharePoint

```
sharepoint_write_file path="{runFolder}/draft.md" content="{improved draft_content}"
→ IF fails: retry once. If still fails: post blocked comment on self + parent_issue_id. STOP.
```

Write a brief improvement log:
```
sharepoint_write_file path="{runFolder}/logs/seo-improve-{seo_improve_pass}.md"
content:
---
# SEO Improve Log — Pass {seo_improve_pass}
**Date:** {ISO now}
**Failing dimensions going in:** {failing_dimensions list}

| Dimension | Score going in | Gate | Action taken |
|---|---|---|---|
| Keyword   | {keyword_score}/{keyword_target} | {keyword_target} | {Step 3 ran / skipped — no keyword fix needed} |
| GEO       | {geo_score}/{geo_target}         | 65               | {Step 3b.A ran / skipped} |
| Content   | {content_score}/{content_target} | 70               | {Step 3b.B ran / skipped} |
| AI Tone   | {ai_tone_score}/10               | <=7              | {worst sections rewritten with first-hand voice / not flagged} |

**Keywords targeted (Step 3):** {list — or "none — keyword dimension passed"}

## Changes made
{for each dimension worked: what section was edited, what was added/changed}

## Word count after improvements: {N}
---
```

---

## Step 5 — Update run-state.json and create new [BLOG-SEO-CHECK] child

```
sharepoint_read_file path="{run_state_path}"
→ merge:
{
  "phases": { "seo_check": "pending" },
  "seo_improve_count": {seo_improve_pass}
}
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
```

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
{ "status": "done", "comment": "SEO improve pass {seo_improve_pass} complete. Dimensions worked: {comma-separated failing_dimensions}. Sections edited: {N}. New [BLOG-SEO-CHECK] child created to re-score with composite gate." }
```

⛔ **EXIT NOW. Do not score. Do not send email. The new [BLOG-SEO-CHECK] child handles scoring.**
