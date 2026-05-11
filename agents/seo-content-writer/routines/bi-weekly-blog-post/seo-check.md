# SEO Check — Keyword Scoring + Auto-Fix (Phase 3)

⛔ **HARD STOP RULE: This phase scores SEO + fixes + either creates [BLOG-EMAIL] (pass) or [BLOG-SEO-IMPROVE] (fail). EXIT after Step 8. Do not send email yourself.**

**BOUNDARY LINE 1:** Load keyword cluster from config.md — do NOT use a hardcoded list.
**BOUNDARY LINE 2:** draft.md is updated IN PLACE when fixes are applied — write back to SharePoint.
**BOUNDARY LINE 3:** Threshold is dynamic — see Step 4. Never hard-block permanently; always create an improve child or pass.
**STATE:** Reads run-state.json + config.md + draft.md. Writes `seo_check` section. Updates draft.md. Creates `[BLOG-EMAIL]` or `[BLOG-SEO-IMPROVE]` child. Closes self.

---

## Step 1 — Load state and keyword cluster

```
run_state_path = extract from issue description
parent_issue_id = extract from issue description

sharepoint_read_file path="{run_state_path}"
→ extract: phases.seo_check, seo_improve_count (default 0 if missing), seo_check.composite_pass (may be missing on first run)

→ IF phases.seo_check == "done" AND seo_check.composite_pass == true:
   post comment "Idempotency: seo_check already passed (composite gate). Creating [BLOG-EMAIL] child and exiting."
   Go directly to Step 8A (EMAIL path).

→ IF phases.seo_check == "done" AND (seo_check.composite_pass == false OR composite_pass field missing):
   Reset phases.seo_check to "pending" in memory — re-score with current rubric.
   Reason: prior run was below gate (or pre-Tier 1.1 scoring); re-evaluate with composite gate.

→ IF phases.seo_check == "done" AND seo_improve_count >= 3 AND seo_check.shipped_below_gate == true:
   Idempotency on max-iterations ship: prior run accepted scores below gate. Go directly to Step 8A.

→ extract: topic, primaryKeyword, runFolder, write.draft_path

sharepoint_read_file path="SEO-Content-Writer/config.md"
→ parse keyword cluster (primary + secondary + long-tail)
→ count total keywords → cluster_size = len(all keywords)

sharepoint_read_file path="{runFolder}/draft.md"
→ store as draft_content
```

---

## Step 2 — Score each keyword

For each keyword in the cluster, score 1–10:

| Score | Meaning |
|-------|---------|
| 9–10  | In H1 + intro (first 150 words) + 3+ body mentions + conclusion |
| 7–8   | In H2/H3 heading + any body mention |
| 6     | In body 2+ times naturally (no heading required) |
| 5     | In body exactly 1 time |
| 3–4   | Present once, buried or awkward |
| 1–2   | Missing, or only in meta/alt text/link anchor |

**Scoring rules:**
- Minimum floor: any keyword present 2+ times in body = score ≥ 6. Non-negotiable.
- Do NOT penalise secondary/long-tail keywords for lacking H2 placement if they appear naturally 2+ times in body. Body density is a real SEO signal.
- Primary keywords (first 5 in cluster) should target 8–10. Secondary target 6–8. Long-tail target 6.

Point calculation (use to determine score band):
- H1 presence: +3
- H2/H3 presence: +2
- Intro (first 150 words): +2
- Conclusion/CTA: +1
- Body count: 1x = +1, 2x = +2, 3x+ = +3 (max +3)

Build scorecard:
```
| Keyword | Score | H1 | H2 | Intro | Body count | Conclusion | Notes |
```

---

## Step 3 — Auto-fix keywords scoring < 6 (with stuffing cap)

**Anti-stuffing cap (mandatory):**
```
wordCount = count words in draft_content
max_forced_mentions = floor(wordCount / 80)
total_forced_mentions = 0
```
This cap prevents Google's keyword-stuffing penalty when the cluster is large. With a 2,000-word post, cap = 25 forced mentions across all keywords.

Sort keywords scoring < 6 ascending by score (worst first). For each:
1. **Stop if `total_forced_mentions >= max_forced_mentions`** — log skipped keyword in scorecard `auto_fixed.skipped[]` with reason `"cap reached"`.
2. Find the most relevant section (H2/H3) in the draft.
3. Add keyword naturally in the opening sentence of that section. Increment `total_forced_mentions`.
4. Add 1 more natural mention later in the same section. Increment `total_forced_mentions`.
5. Update draft_content in memory.
6. Do NOT force into headings if it breaks flow — 2 body mentions = score 6, which is sufficient.

After all fixes, re-score those keywords. Update scorecard. Record final `total_forced_mentions` in run-state.json `seo_check.forced_mentions_count`.

---

## Step 4 — Compute keyword score and dynamic threshold

```
total_possible = cluster_size * 10
overall_score = (sum of all keyword scores / total_possible) * 100

# Tightened dynamic threshold — accounts for large keyword clusters
# IMPORTANT: these are exclusive ranges — use ELSE-IF (not independent IFs)
IF cluster_size <= 12:
  threshold = 75
ELSE IF cluster_size <= 18:
  threshold = 70
ELSE:  # cluster_size > 18
  threshold = 65

# Primary keyword bonus — if primary keyword scores 9+, reduce threshold by 1
primary_score = score of first keyword in primary list
IF primary_score >= 9:
  threshold = threshold - 1
```

```
keyword_pass = (overall_score >= threshold)
```

**Do NOT decide pass/fail here yet.** The composite gate in Step 4d combines keyword, GEO, and content scores. Step 4b runs the content analysis skill to produce the other two scores.

---

## Step 4b — SEO Content Analysis Skill

Load and follow `agents/skills/seo-content-analysis.md` with these inputs:

```
draft_content  = draft_content currently in memory (post auto-fix from Step 3)
topic          = {topic}
primaryKeyword = {primaryKeyword}
seoTitle       = {seoTitle extracted from draft frontmatter — value between --- markers}
seoDescription = {seoDescription extracted from draft frontmatter}
publishedAt    = {publishedAt extracted from draft frontmatter}
```

Execute Part 1, Part 2, and Part 3 of the skill in sequence on the inputs above.

Capture into memory:
```
content_quality_score          = Part 1 result (integer 0–100)
eeat_breakdown                 = { experience: N, expertise: N, authoritativeness: N, trustworthiness: N }
content_quality_flags          = list of AI content marker flags (empty list = clean)
ai_tone_score                  = average LLM-judged AI tone (0–10) across H2 sections — see skill Part 1d
ai_tone_worst_sections         = top 3 sections by AI tone score desc — consumed by seo-improve.md Step 3b-bis
internal_link_opportunities    = list of { anchor_text, target_topic }
geo_score                      = Part 2 result (integer 0–100)
geo_top5                       = top 5 GEO improvements ordered by impact
geo_passages_to_restructure    = list of { current_snippet, suggested_version }
schema_json                    = Part 3 result — BlogPosting JSON-LD string
```

---

## Step 4c — Auto-insert internal links

### Canonical URL shape (IMPORTANT)

Blog posts live at `https://medicodio.ai/resources/blog/<slug>`. The `/blog/<slug>` route is a redirect stub. All derived URLs MUST use `/resources/blog/<slug>`.

### 4c.1 — Build `internal_link_map` and `rich_index` (CSV-first, with fallbacks)

The agent uses three potential sources in priority order:

**Source A — Rich post index (preferred):** `SEO-Content-Writer/data/published-posts.csv`
- Columns: `title`, `url`, `slug`, `primary_keyword`, `categories`, `category_slugs`, `summary`
- Provides rich match data for Step 4c.2 fuzzy resolution
- Always re-read each run (kept fresh by content team)

**Source B — `internal_link_map` YAML block in config.md** — set by prior runs or manually for product URLs

**Source C — `posted_log` in config.md** — fallback to derive blog URLs only (slug → `/resources/blog/<slug>`)

**Procedure:**

```
sharepoint_read_file path="SEO-Content-Writer/config.md"
→ Single read. Parse three sections from this one file content:
  - internal_link_map (YAML block, may be missing)
  - posted_log (list of past published posts)
  - keyword_cluster (already loaded in Step 1)

# 1. Attempt Source A (CSV)
TRY sharepoint_read_file path="SEO-Content-Writer/data/published-posts.csv"
  → parse CSV (skip BOM if present, handle quoted commas)
  → build rich_index[row.slug] = {url, title, primary_keyword, categories, summary}
  → seed internal_link_map[row.slug] = row.url
ON FAILURE (file missing or parse error):
  rich_index = {}  # no rich match data available
  log warning "published-posts.csv missing or unparseable — falling back to config.md sources"

# 2. Merge Source B
FOR each entry in internal_link_map block from config.md:
  internal_link_map[entry.slug] ||= entry.url  # CSV wins, but Source B fills in product URLs etc.

# 3. Fill blog gaps from Source C (posted_log)
FOR each entry in posted_log:
  IF NOT (entry.slug in internal_link_map):
    internal_link_map[entry.slug] = "https://medicodio.ai/resources/blog/" + entry.slug

# 4. If internal_link_map was empty before merge, persist back to config.md
IF original_internal_link_map was empty:
  Write the merged map to config.md as `internal_link_map:` YAML block (append or replace section). Preserve all other config.md content untouched.
  Post comment on parent: "Bootstrapped internal_link_map with {N} entries from {sources used: CSV, posted_log}. Manual additions (product URLs) can be appended to config.md."
```

**Empty case:** If ALL three sources are empty (first blog post ever, no history, no CSV), log `"No internal_link_map source available — first blog post has no internal links to insert. Skipping Step 4c.2."` and proceed to Step 4d without insertion. This is correct behavior for the bootstrap blog post.

### 4c.2 — Match anchor → target URL and insert

**Ordering: sort `internal_link_opportunities` by `anchor_text` length descending** (longest first). This is greedy matching — prevents short anchors from being buried inside longer matched anchors (e.g., process "AI medical coding" before "AI coding" so the longer phrase wins).

For each entry (in descending anchor-length order):

**Resolution chain** — try each in sequence; first match wins. Record which method resolved.

1. **Exact slug match:** slugify `target_topic` (lowercase, alphanumeric + hyphens) → look up in `internal_link_map`. Record method = `"slug_exact"`.
2. **Title keyword match (if `rich_index` non-empty):** for each post in `rich_index`, check if `target_topic` is a substring of `post.title` (case-insensitive) OR if `target_topic` shares ≥ 2 noun tokens with `post.primary_keyword`. Pick best match by token overlap count. Record method = `"title_match"`.
3. **Category match (if `rich_index` non-empty):** find post whose `categories` or `category_slugs` contain at least one token from `target_topic`. Pick best by token overlap. Record method = `"category_match"`.
4. **Summary fuzzy match (if `rich_index` non-empty):** find post whose `summary` contains the longest common substring with `target_topic` (minimum 8 characters of overlap). Record method = `"summary_fuzzy"`.

If none resolve, skip and log to `internal_links_skipped` with reason `"no map entry"`.

**Anchor insertion:**

1. Find the **first** natural occurrence of `anchor_text` in `draft_content`:
   - Must NOT be inside a heading line (lines starting with `#`)
   - Must NOT be already inside an existing markdown link (skip if surrounded by `[...]( )`)
   - Match case-insensitive but preserve the original casing in the link text
2. Replace with `[{matched_text}]({target_url})`.
3. Increment `internal_links_inserted` counter.
4. Append `{ anchor: anchor_text, target_topic, url: target_url, method: <resolution_method> }` to `internal_links_inserted_list`.
5. **Cap at 5 internal links per post** — stop iterating once cap reached. Log remaining opportunities as `internal_links_skipped` with reason `"cap reached"`.

Update `draft_content` in memory.

**Save to run-state.json `seo_check`:**
- `internal_links_inserted`: integer count
- `internal_links_inserted_list`: array of `{ anchor, target_topic, url, method }`
- `internal_links_skipped`: array of `{ anchor, target_topic, reason }`

---

## Step 4d — Composite pass/fail decision

Three independent gates must ALL pass:

```
keyword_pass = (overall_score      >= threshold)        # from Step 4
geo_pass     = (geo_score          >= 65)               # from Step 4b
content_pass = (content_quality_score >= 70)            # from Step 4b

composite_pass = keyword_pass AND geo_pass AND content_pass
```

Identify failing dimensions for the improve child:

```
failing_dimensions = []
IF NOT keyword_pass: failing_dimensions.append({ dim: "keyword", score: overall_score, target: threshold })
IF NOT geo_pass:     failing_dimensions.append({ dim: "geo",     score: geo_score,     target: 65 })
IF NOT content_pass: failing_dimensions.append({ dim: "content", score: content_quality_score, target: 70 })
```

**Decision:**

```
IF composite_pass:
  → Proceed to Step 5 → 6 → 7 → 8A (EMAIL child)

IF NOT composite_pass AND seo_improve_count < 3:
  → Save draft + scorecard + run-state (mark phases.seo_check as "below_threshold", increment seo_improve_count)
  → Create [BLOG-SEO-IMPROVE] child (see Step 8B) — do NOT block the parent
  → PATCH self to done with composite breakdown
  → EXIT. Do not create [BLOG-EMAIL].

IF NOT composite_pass AND seo_improve_count >= 3:
  → Accept the scores. Log "Max improvement iterations reached. Publishing with composite breakdown: keyword={overall_score}, geo={geo_score}, content={content_quality_score}."
  → Proceed to Step 5 → 6 → 7 → 8A (EMAIL child). Do not block.
  → Add a flag in run-state.json `seo_check.shipped_below_gate = true` so audit reports it.
```

---

## Step 5 — Save updated draft.md

```
sharepoint_write_file path="{runFolder}/draft.md" content="{updated draft_content}"
→ IF fails: retry once. If still fails: post blocked on self + parent. STOP.
```

---

## Step 6 — Save seo-check.md scorecard

```
sharepoint_write_file path="{runFolder}/logs/seo-check.md"
content:
---
# SEO Scorecard — {topic}
**Date:** {ISO now}
**Primary keyword:** {primaryKeyword}
**Cluster size:** {cluster_size}
**Threshold used:** {threshold}/100 (dynamic: cluster_size={cluster_size}, primary_score={primary_score})

## Keyword Scores

| Keyword | Score | H1 | H2 | Intro | Body | Conclusion | Notes |
|---------|-------|----|----|-------|------|------------|-------|
{one row per keyword}

**Overall Keyword Score: {overall_score}/100** (threshold {threshold})
**GEO Score: {geo_score}/100** (gate: 65)
**Content Quality Score: {content_quality_score}/100** (gate: 70)
**AI Tone Score: {ai_tone_score}/10** (lower is better, flag if >7)
**Composite Status: {PASS / BELOW THRESHOLD — improve child created / SHIPPED BELOW GATE — max iterations reached}**
**Failing dimensions:** {comma-separated failing_dimensions, or "None"}

## Auto-Fixed Keywords
{list keywords rewritten + what changed}

**Forced mentions:** {forced_mentions_count} / {max_forced_mentions} cap (cluster size {cluster_size}, word count {wordCount})
{if any keywords skipped due to cap, list them}

## Internal Links Inserted
{internal_links_inserted} of {internal_link_opportunities | length} opportunities (cap: 5/post)
{list inserted: anchor → URL}
{list skipped with reason}

## Post word count after fixes: {N}

## Content Quality (E-E-A-T)
**Content Quality Score: {content_quality_score}/100**

| Dimension         | Score  | Key Signals Present | Gaps |
|-------------------|--------|---------------------|------|
| Experience        | {N}/25 | {signals}           | {gaps} |
| Expertise         | {N}/25 | {signals}           | {gaps} |
| Authoritativeness | {N}/25 | {signals}           | {gaps} |
| Trustworthiness   | {N}/25 | {signals}           | {gaps} |

**AI Content Flags:** {content_quality_flags — or "None"}

**Internal Linking Opportunities:**
{internal_link_opportunities list}

## GEO / AI Citation Readiness
**GEO Score: {geo_score}/100**

| Dimension               | Score  | Notes |
|-------------------------|--------|-------|
| Citability              | {N}/25 | {notes} |
| Structural Readability  | {N}/25 | {notes} |
| Authority Signals       | {N}/25 | {notes} |
| Answer-First Formatting | {N}/25 | {notes} |

Top 5 GEO improvements:
{geo_top5}

Passages to restructure:
{geo_passages_to_restructure}

## Schema Markup (BlogPosting JSON-LD)
```json
{schema_json}
```
---
```

---

## Step 7 — Write seo_check section to run-state.json

```
sharepoint_read_file path="{run_state_path}"
→ merge:
{
  "seo_check": {
    "status": "complete" | "below_threshold",
    "completed_at": "{ISO}",
    "overall_score": N,
    "threshold": N,
    "cluster_size": N,
    "keyword_scores": { "{keyword}": N, ... },
    "auto_fixed": [...],
    "forced_mentions_count": N,
    "max_forced_mentions": N,
    "internal_links_inserted": N,
    "internal_links_skipped": [...],
    "composite_pass": true | false,
    "keyword_pass": true | false,
    "geo_pass": true | false,
    "content_pass": true | false,
    "failing_dimensions": [...],
    "shipped_below_gate": true | false,
    "scorecard_path": "{runFolder}/logs/seo-check.md"
  },
  "seoScore": N,
  "seo_improve_count": {incremented count},
  "phases": { "seo_check": "done" },
  "content_quality_score": {content_quality_score},
  "ai_tone_score": {ai_tone_score},
  "eeat_breakdown": {
    "experience": N,
    "expertise": N,
    "authoritativeness": N,
    "trustworthiness": N
  },
  "content_quality_flags": [{content_quality_flags list}],
  "ai_tone_worst_sections": [{ai_tone_worst_sections list}],
  "geo_score": {geo_score},
  "geo_top5": [{geo_top5 list}],
  "geo_passages_to_restructure": [{geo_passages_to_restructure list}],
  "schema_json": "{schema_json}"
}
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
```

---

## Step 8A — PASS: Create [BLOG-EMAIL] child and close

Used when composite_pass is true OR seo_improve_count >= 3.

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
{ "status": "done", "comment": "SEO check PASSED. keyword: {overall_score}/{threshold}, geo: {geo_score}/65, content: {content_quality_score}/70. Fixed {N} keywords. {internal_links_inserted} internal links inserted. [BLOG-EMAIL] created." }
```

⛔ **EXIT NOW.**

---

## Step 8B — BELOW THRESHOLD: Create [BLOG-SEO-IMPROVE] child and close self

Used when composite_pass is false AND seo_improve_count < 3.

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[BLOG-SEO-IMPROVE] {topic} — pass {seo_improve_count + 1}",
  "description": "phase_file: routines/bi-weekly-blog-post/seo-improve.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}\nseo_improve_pass: {seo_improve_count + 1}\nfailing_dimensions: {JSON.stringify(failing_dimensions)}\nkeyword_score: {overall_score}\nkeyword_target: {threshold}\ngeo_score: {geo_score}\ngeo_target: 65\ncontent_score: {content_quality_score}\ncontent_target: 70\nlow_scoring_keywords: {comma-separated list of keywords scoring < threshold/10}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
```

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done", "comment": "Composite gate failed. Scores — keyword: {overall_score}/{threshold}, geo: {geo_score}/65, content: {content_quality_score}/70. Failing: {comma-separated failing_dimensions}. [BLOG-SEO-IMPROVE] pass {seo_improve_count+1} created. Will re-check after improvements." }
```

⛔ **EXIT NOW. Do not block the parent. The improve loop handles it.**
