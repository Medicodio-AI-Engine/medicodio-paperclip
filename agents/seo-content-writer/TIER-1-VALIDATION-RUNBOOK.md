# Tier 1 Validation Runbook

How to verify Tier 1 actually works end-to-end on the first live blog run. Each acceptance criterion has a concrete check + how to read the output + what "pass" looks like.

**Prerequisites for full validation:**
- Tier 1 changes deployed to Paperclip-hosted seo-content-writer agent (or running locally via Claude Code)
- One `[BLOG-ORCHESTRATOR]` test issue with a real topic
- (Optional, unlocks more checks) Engineer's Tier 6 PR on staging — schema + canonical fields rendered

---

## Validation 1 — Anti-stuffing cap (Task 1.5)

**What to check:** Auto-fix doesn't cram more keyword mentions than the cap allows.

**Where to look:**
1. After the pipeline runs `[BLOG-SEO-CHECK]`, open `run-state.json` for that run:
   ```
   SEO-Content-Writer/agents/seo-blogs/runs/<date>-<slug>/run-state.json
   ```
2. Inspect `seo_check.forced_mentions_count` and `seo_check.max_forced_mentions`.

**Pass:**
- `forced_mentions_count <= max_forced_mentions` (must always hold — that's the cap)
- `max_forced_mentions == floor(wordCount / 80)` where `wordCount` is the post's word count
- If the keyword cluster has >12 low-scoring keywords on a short post, you should see `auto_fixed.skipped[]` with reason `"cap reached"`

**Fail signal:** Cap exceeded → bug; or skipped list empty when it shouldn't be → cap not enforced.

---

## Validation 2 — Tightened threshold + composite gate (Tasks 1.1, 1.4)

**What to check:** Pipeline fails when ANY of keyword/GEO/content below gate, passes only when all three clear.

**Where to look:**
1. `run-state.json.seo_check`:
   - `overall_score`, `threshold`, `keyword_pass`
   - `geo_score`, `geo_pass`
   - `content_quality_score`, `content_pass`
   - `composite_pass`
   - `failing_dimensions` (if `composite_pass == false`)
2. Logs at `runs/<...>/logs/seo-check.md` — should show all three scores + gate status.
3. Parent issue comments — Step 8A or 8B PATCH comment shows composite breakdown.

**Pass — pipeline passes correctly:**
- `composite_pass == true` AND `keyword_pass == true` AND `geo_pass == true` AND `content_pass == true`
- Step 8A creates `[BLOG-EMAIL]` child
- Cluster size 22 → threshold 65; primary keyword scoring 9+ → threshold 64
- Cluster size <= 12 → threshold 75 (not 60 like before)

**Pass — pipeline fails correctly:**
- Deliberately weak draft (no .gov citations, generic tone, sparse keyword density) → composite_pass = false
- `failing_dimensions` array lists exactly which gates failed with score + target
- Step 8B creates `[BLOG-SEO-IMPROVE]` child with `failing_dimensions` in description
- Up to 3 improve passes, then ships with `shipped_below_gate = true` flag

**Fail signal:**
- Pass even when geo_score < 65 → composite gate broken
- Threshold computed as both 75 AND 70 simultaneously for cluster size 10 (means IF chain not ELSE-IF — bug)

---

## Validation 3 — Internal link insertion (Task 1.3)

**What to check:** Links auto-inserted into draft body using fuzzy resolution.

**Where to look:**
1. `run-state.json.seo_check`:
   - `internal_links_inserted` (integer)
   - `internal_links_inserted_list` (array of `{anchor, target_topic, url, method}`)
   - `internal_links_skipped`
2. The actual `draft.md` after seo-check runs — should contain new `[anchor](url)` markdown links that weren't there before
3. Step 4c.1 should write `internal_link_map:` YAML block to `SEO-Content-Writer/config.md` on first run

**Pass:**
- At least one new markdown link in draft body where there was plain text before
- `internal_links_inserted_list` entries have `method` in `{"slug_exact", "title_match", "category_match", "summary_fuzzy"}`
- Cap respected: `internal_links_inserted <= 5`
- If `published-posts.csv` is on SharePoint, resolution methods include richer than just `slug_exact`
- Anchor longer than another anchor processed first (greedy ordering — verify "AI medical coding" linked before "AI coding")

**Fail signal:**
- `internal_links_inserted == 0` AND draft has phrases that match opportunities → resolution broken
- Same anchor linked twice in draft → first-occurrence rule broken
- URL uses `/blog/<slug>` instead of `/resources/blog/<slug>` → URL fix not applied

---

## Validation 4 — Schema generation + send (Task 1.2)

**What to check:** publish phase resolves placeholders + sends schema in API body.

**Where to look:**
1. `runs/<...>/logs/publish.md`:
   - `Canonical URL: https://medicodio.ai/resources/blog/<slug>` (must use `/resources/blog/`, not `/blog/`)
   - `Schema JSON-LD sent: true`
   - Resolved schema JSON block — no `{placeholder}` strings remaining
2. After Tier 6.1 ships on medicodio.ai:
   - `curl https://medicodio.ai/resources/blog/<slug>` → `<script type="application/ld+json">` in `<head>` with full BlogPosting
   - Google Rich Results Test → "BlogPosting detected, eligible for rich results"
   - Schema.org validator → zero errors

**Pass before Tier 6.1:**
- Publish API body in `publish.md` Step 4 includes `schema`, `canonicalUrl`, `mainImage`, `primaryKeyword`, `featuredImage`
- Server returns 200 (ignores unknown fields)
- `runs/<...>/logs/publish.md` shows resolved schema with real URLs

**Pass after Tier 6.1:**
- All the above PLUS the schema is visible in rendered HTML `<head>`

**Fail signal:**
- Schema contains `{placeholder}` literal in published post → Step 2.5 resolution broken
- Canonical URL is `/blog/<slug>` not `/resources/blog/<slug>` → URL fix not applied
- Publish API returns 400 with field validation error → engineer's validator too strict (see alignment doc)

---

## Validation 5 — Full revise re-score (Task 1.6)

**What to check:** Reviewer reply triggers full re-score; regression caught and reported back.

**Setup:**
1. Wait for a revision cycle (or simulate: trigger [BLOG-EMAIL], approver replies with "Change paragraph X to Y" type request)
2. After email-monitor creates [BLOG-REVISE] child, that phase runs
3. Inspect outputs

**Where to look:**
1. `runs/<...>/logs/revise-1.md`:
   - Per-keyword score deltas table (every keyword from config, not just 5 primaries — confirms full re-score)
   - "Keyword score: X → Y", "GEO score: X → Y", "Content quality: X → Y"
   - "Composite gate: PASS/FAIL"
   - "Regression detected: yes/no"
2. `run-state.json.revise_1.scores` — full score set saved (not just primaries)
3. Reviewer's email inbox:
   - If composite_pass + no regression: normal "Applied your changes" reply
   - If regression after retry: regression-explanation reply asking "ship anyway or revise"

**Pass:**
- Full cluster scored (count rows in delta table == cluster_size, e.g., 22)
- Regression branch sends correct distinct email body, not the standard reply
- On regression, status correctly stays `awaiting_reply`, revisionCount incremented

**Fail signal:**
- Only 5 keywords in delta table → still using "Mini SEO Score" abbreviated check (bug — BOUNDARY LINE 2 not removed)
- Regression sends standard "Applied your changes" reply → branching broken
- Both Path A and Path B updates run sequentially → state corruption

---

## Validation 6 — LLM AI tone judge (Task 1.7)

**What to check:** Skill produces per-section AI tone scores; high scores trigger rewrite.

**Where to look:**
1. `run-state.json.seo_check.ai_tone_score` — float 0-10
2. `runs/<...>/logs/seo-check.md` — "AI Tone Score (LLM-judged): X.Y / 10" with worst sections listed
3. `run-state.json.ai_tone_worst_sections` — top 3 sections with `{section_title, section_index, current_snippet, score, justification}`
4. If `ai_tone_score > 7`:
   - `content_quality_flags` includes "AI tone: heavy (X/10) — sections [titles]"
   - Next seo-improve pass rewrites those sections

**Pass:**
- `ai_tone_score` is a float, not zero or null
- `ai_tone_worst_sections` is a non-empty list (possibly length 0 if all sections score <=7, but the field should exist)
- After seo-improve pass on a high-tone draft, the worst section's content noticeably changes (first-hand voice injected, specific numbers added)

**Fail signal:**
- `ai_tone_score` always 0 or null → Pass B not running
- High score doesn't trigger rewrite → seo-improve.md Step 3b-bis not reading the field

---

## Validation 7 — Authority signal (Task 1.8)

**What to check:** Part 2c authority dimension scores based on .gov/.edu/AHIMA/AAPC links.

**Where to look:**
1. Test post 1 (no authority links): authority_signals dimension should score 0-8 (only author byline if present)
2. Test post 2 (one CMS or AHIMA link in body): authority_signals jumps by 7
3. Test post 3 (two+ authority links): authority_signals jumps by full 10
4. `run-state.json.eeat_breakdown.authoritativeness` reflects this
5. Confirm `publishedAt` is NOT contributing to authority (only to trustworthiness)

**Pass:**
- Authority dimension scales with citation count, not just publishedAt presence
- Trustworthiness dimension still gets +10 for publishedAt (Part 1c — unchanged)

**Fail signal:**
- Authority dimension stays at +7 regardless of links → still using old publishedAt rule

---

## Validation 8 — Pipeline runs end-to-end

**What to check:** Full chain from orchestrator through audit completes without manual intervention.

**Trigger:**
```
POST /api/companies/{company_id}/issues
{
  "title": "[BLOG-ORCHESTRATOR] AI Medical Coding for Emergency Departments",
  "description": "topic: AI Medical Coding for Emergency Departments\nbrief: Focus on ED-specific coding challenges + denial reduction angle.\nprimary_keyword: AI medical coding emergency department",
  "assigneeAgentId": "<seo-content-writer-agent-id>",
  "status": "todo"
}
```

**Where to look:**
1. Watch the issue tree grow:
   ```
   [BLOG-ORCHESTRATOR]
     └─ [BLOG-RESEARCH]
          └─ [BLOG-WRITE]
               └─ [BLOG-SEO-CHECK]
                    ├─ pass → [BLOG-EMAIL]
                    └─ fail → [BLOG-SEO-IMPROVE] → [BLOG-SEO-CHECK] (loop)
   ```
2. After [BLOG-EMAIL]: parent → `in_review`. Email arrives at `Jessica.Miller@medicodio.ai` or `McGurk.Amanda@medicodio.ai`.
3. Approver replies "Approved".
4. Within 6h: email-monitor creates [BLOG-PUBLISH].
5. [BLOG-PUBLISH] runs → post lives at `medicodio.ai/resources/blog/<slug>`.
6. [BLOG-AUDIT] closes the orchestrator parent → `done`.

**Pass:**
- All children close one by one
- `run-state.json.publish.publish_response_id` populated
- Final `audit.md` log written with full summary
- Parent issue closed with summary comment
- Post visible at canonical URL

**Fail signal:**
- Pipeline stalls (orchestrator stays in_progress, no child created) → check phase routing
- A phase creates wrong next child (e.g., write skips to email) → BOUNDARY LINE breach
- Schema not in published page → Tier 6.1 server change not deployed

---

## Quick smoke test (without running full pipeline)

If you just want to spot-check the edits without running a 6-hour pipeline:

```bash
# Grep for the canonical URL pattern fix
grep -rn "medicodio.ai/blog/" agents/seo-content-writer/routines/bi-weekly-blog-post/ \
  | grep -v "/resources/blog/" | grep -v "redirect stub" | grep -v "agents/blog/"
# Should return zero results — all blog URLs use /resources/blog/

# Grep for old "advisory" wording (should be gone)
grep -rn "advisory" agents/seo-content-writer/routines/bi-weekly-blog-post/

# Grep for old "Mini SEO" or "primary keywords only" (should be gone)
grep -rn "Mini SEO\|primary keywords only\|abbreviated.*check" agents/seo-content-writer/routines/bi-weekly-blog-post/

# Confirm composite_pass wired through every consumer
grep -rn "composite_pass" agents/seo-content-writer/

# Confirm ai_tone_score wired
grep -rn "ai_tone_score" agents/seo-content-writer/ agents/skills/

# Confirm anti-stuffing cap present
grep -rn "max_forced_mentions" agents/seo-content-writer/routines/bi-weekly-blog-post/seo-check.md

# Confirm rich_index fuzzy match
grep -n "rich_index\|summary_fuzzy\|category_match\|title_match" \
  agents/seo-content-writer/routines/bi-weekly-blog-post/seo-check.md
```

All grep results should match expected patterns.

---

## Sign-off

When all 8 validations pass on a real live run, mark Tier 1 100% closed in `RANKING-PLAN.md` change log with the run date + run folder URL. From that point, Tier 2 build kicks off.
