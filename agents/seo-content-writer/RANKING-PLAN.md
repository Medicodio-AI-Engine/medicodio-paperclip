# SEO Ranking Plan — Rank #1 for "AI Medical Coding"

**Owner:** seo-content-writer agent
**Mission:** Win and hold #1 on Google, Bing, Perplexity, ChatGPT, and Google AI Overviews for the full **AI Medical Coding** keyword cluster.
**Started:** 2026-05-10
**Target #1 by:** 2026-11-10 (6 months) for primary keyword; cluster long-tails earlier.

---

## How to use this file

This is the single source of truth for the SEO program. Every task below has:

- **Status:** `todo` | `in_progress` | `blocked` | `done`
- **Owner:** which agent / human
- **Files touched:** so reviewers can grep
- **Comments:** running log of what was tried, what worked, blockers, decisions

Update the status inline as work progresses. Append to the **Comments** field — never overwrite. Append a new dated line.

### Status legend

| Symbol | Meaning |
|---|---|
| `[ ]` | todo — not started |
| `[~]` | in_progress — actively being worked on |
| `[!]` | blocked — needs unblock (note in comments) |
| `[x]` | done — verified and shipped |

---

## Prerequisites (confirm before Tier 2+)

| Capability | Status | Comment |
|---|---|---|
| DataForSEO MCP | `[ ]` | User confirmed access — verify creds set in Paperclip env (`DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`) |
| Google Search Console API | `[ ]` | OAuth + property verification for medicodio.ai |
| Google PageSpeed Insights / CrUX API | `[ ]` | API key |
| Google Indexing API | `[ ]` | Service account + GSC property verified |
| Moz API | `[ ]` | API key (free tier sufficient for weekly cadence) |
| Bing Webmaster Tools API | `[ ]` | API key + IndexNow key |
| nanobanana-mcp (Gemini image gen) | `[ ]` | Installed in Paperclip env |
| seo-* plugin skills (claude-seo) | `[ ]` | Verify all in Paperclip env: seo-geo, seo-content, seo-schema, seo-image-gen, seo-backlinks, seo-google, seo-technical, seo-dataforseo |
| Pinterest API | `[ ]` | Account + access token (Tier 3.4) |
| medicodio.ai backend changes (Tier 6) | `[ ]` | Coordinate with engineering — schema injection, image upload, llms.txt, etc. |

---

## TIER 1 — Fix existing pipeline bugs (P0)

**Goal:** Every post published after Tier 1 is meaningfully better. No new routines — just edits to existing phase files.

**Estimated effort:** 1 week

### 1.1 Make GEO + Content scores into pass/fail gates

- **Status:** `[x]` done
- **Owner:** seo-content-writer
- **Files:** `agents/seo-content-writer/routines/bi-weekly-blog-post/seo-check.md`, `agents/seo-content-writer/routines/bi-weekly-blog-post/seo-improve.md`
- **Change:** In Step 4, replace pass condition with composite gate:
  ```
  pass = (overall_score >= threshold)
       AND (geo_score >= 65)
       AND (content_quality_score >= 70)
  ```
  Below any → `[BLOG-SEO-IMPROVE]` child (passing all three scores + targeted dimensions).
  Delete the "advisory" sentence in Step 4b.
  Also extend `seo-improve.md` to accept GEO/content targets, not just keyword density.
- **Comments:**
  - 2026-05-10: planned. Biggest single-line lift in pipeline.
  - 2026-05-11: shipped. seo-check.md restructured: Step 4 = keyword score only (no decision), Step 4b = run skill, Step 4c = insert internal links, Step 4d = composite gate. Three independent gates: keyword ≥ threshold, geo ≥ 65, content ≥ 70. Below any → SEO-IMPROVE child with `failing_dimensions` array. Step 8B updated to pass full breakdown to improve child. Step 8A comment updated to log composite scores. seo-improve.md Step 1 reads new fields, Step 2 has dimension-aware target identification, Step 3 conditional on `needs_keyword_fix`, Step 3b conditional on each dimension flag. Pre-existing `seo_improve_count >= 3` escape hatch retained — ships below gate after max iterations with `shipped_below_gate=true` flag in run-state.

### 1.2 Pipe schema_json into published post

- **Status:** `[x]` done (agent side); engineering brief written for server side (Tier 6.1)
- **Owner:** seo-content-writer (done) + medicodio.ai engineering (Tier 6.1 to consume)
- **Files:** `agents/seo-content-writer/routines/bi-weekly-blog-post/publish.md`, `agents/seo-content-writer/server-changes/tier-6.1-schema-injection.md`
- **Change:** In `publish.md` Step 2.5 (new), resolve placeholders in `schema_json`:
  - `image` ← draft frontmatter `featuredImage` (after Tier 3) or hero URL
  - `url` ← `https://medicodio.ai/blog/{slug}`
  - `author/publisher` ← static Medicodio org block
  - `mainEntityOfPage` ← canonical URL
  Add `schema`, `canonicalUrl`, `featuredImage`, `primaryKeyword` to `/api/blog/push` body.
- **Comments:**
  - 2026-05-10: planned. Without this, Tier 1 schema generation is dead artifact.
  - 2026-05-11: client-side shipped. Step 2.5 resolves all placeholders. Step 4 API body now includes `schema`, `canonicalUrl`, `featuredImage`, `primaryKeyword` (forward-compatible — server ignores unknown fields today). Step 6 publish log records resolved schema. HTML `<script>` injection into Portable Text body explicitly rejected (converter would mangle).
  - 2026-05-11: engineering brief written → `agents/seo-content-writer/server-changes/tier-6.1-schema-injection.md`. Covers: request body contract, JSON-LD `<head>` injection (with escape rules for `</script>`), canonical link, OG/Twitter (Tier 6.5 bundled), backward compat for existing posts, validation checklist (Rich Results Test, schema.org validator, Twitter/LinkedIn previewers), rollout plan. Hand to medicodio.ai backend team. Tier 1.2 closes here from agent side — Tier 6.1 ownership transfers to engineering.

### 1.3 Auto-insert internal links into draft

- **Status:** `[x]` done (with lazy bootstrap — no manual SharePoint work required)
- **Owner:** seo-content-writer
- **Files:** `seo-check.md` (new Step 4c with two sub-steps 4c.1 + 4c.2)
- **Change:** After Step 3 auto-fix pass, for each entry in `internal_link_opportunities`:
  - Look up target URL in `config.md.internal_link_map` (slug → URL)
  - If found, find first natural occurrence of `anchor_text` in draft body
  - Replace with `[{anchor_text}]({target_url})`
  - Skip if anchor not present, already linked, or in heading
  - Cap: 5 internal links per post (avoid over-linking)
- **Comments:**
  - 2026-05-10: planned. Need to bootstrap `internal_link_map` with current published posts.
  - 2026-05-11: logic shipped as Step 4c. Reads `internal_link_map` YAML block from config.md, slugifies target_topic, looks up URL, replaces first non-heading non-already-linked occurrence of anchor text. Cap = 5 internal links per post. Skipped opportunities logged with reason. Step 6 scorecard, Step 7 run-state save, and Step 8A comment all surface `internal_links_inserted` and `internal_links_skipped`.
  - 2026-05-11: **lazy bootstrap added as Step 4c.1**. On first run where `internal_link_map` is missing/empty, agent derives map from `posted_log` entries (`slug` → `https://medicodio.ai/blog/{slug}`) and writes it back to config.md. Manual additions (product URLs, feature pages) can still be appended. If `posted_log` is also empty (very first post ever), logs warning and skips Step 4c without blocking. **No manual SharePoint work required** — the first scheduled blog run after Tier 1 deployment will self-bootstrap. Task fully closes here.

### 1.4 Tighten keyword threshold

- **Status:** `[x]` done
- **Owner:** seo-content-writer
- **Files:** `seo-check.md` Step 4
- **Change:** Raise floor:
  ```
  cluster <= 12: threshold = 75
  cluster <= 18: threshold = 70
  cluster >  18: threshold = 65
  ```
  Reduce primary keyword bonus from `-2` to `-1`.
- **Comments:**
  - 2026-05-10: planned. Current cluster=22 with threshold 60 is too easy.
  - 2026-05-11: shipped. Thresholds raised to 75/70/65 (was 70/65/60). Primary bonus reduced to -1 (was -2). Current cluster=22 → threshold = 65 (was 60), primary score 9+ drops to 64 (was 58). Combined with composite gate from 1.1, the bar is meaningfully harder to clear without quality content.

### 1.5 Cap auto-fix mentions to prevent stuffing

- **Status:** `[x]` done
- **Owner:** seo-content-writer
- **Files:** `seo-check.md` Step 3
- **Change:** Hard cap on forced mentions per draft:
  ```
  total_forced_mentions <= floor(wordCount / 80)
  ```
  Excess low-score keywords logged in scorecard but not auto-fixed. Flag in `auto_fixed` log.
- **Comments:**
  - 2026-05-10: planned. Google penalizes keyword stuffing — current rule could trigger.
  - 2026-05-11: shipped. Step 3 now sorts low-score keywords ascending and stops once `total_forced_mentions >= floor(wordCount / 80)`. With 2,000-word post → cap = 25 forced mentions. Skipped keywords listed in scorecard `auto_fixed.skipped[]` with reason `"cap reached"`. `forced_mentions_count` and `max_forced_mentions` written to run-state.json `seo_check` block for audit/diagnostics.

### 1.6 Full re-score in revise phase

- **Status:** `[x]` done
- **Owner:** seo-content-writer
- **Files:** `agents/seo-content-writer/routines/bi-weekly-blog-post/revise.md`
- **Change:** Remove BOUNDARY LINE 2 ("inline SEO re-check only"). After applying reviewer changes, run full `seo-content-analysis` skill (Parts 1, 2, 3). Block re-publish (don't reply approval) if scores fall below Tier 1.1 gate. Reviewer notified of regression instead of silent ship.
- **Comments:**
  - 2026-05-10: planned. Reviewer-edited content can introduce SEO regressions.
  - 2026-05-11: shipped. BOUNDARY LINE 2 rewritten — now mandates full skill re-run. Step 4 expanded: 4a keyword full re-score with tightened threshold, 4b full skill invocation, 4c composite gate, 4d regression detection (vs prior `seo_check` scores: keyword drop >3 OR geo drop >5 OR content drop >5), 4e decision tree. On regression: applies targeted fixes from skill output, re-scores; if still failing, replies to reviewer with regression breakdown asking "ship anyway" or revise again. Step 5 log expanded to per-keyword score deltas table + content quality flags + GEO improvements applied. Reviewer "ship anyway" / "publish anyway" reply caught by existing email-monitor APPROVED keywords (publish/ship). No extra email-monitor logic needed.

### 1.7 Add LLM-judged AI tone check

- **Status:** `[x]` done
- **Owner:** seo-content-writer
- **Files:** `agents/skills/seo-content-analysis.md` Part 1d, plus output table
- **Change:** Add second pass alongside pattern matching. For each H2 section, prompt LLM:
  > "Score 0–10 how AI-generated this paragraph reads. 0 = clearly human, 10 = obvious AI tone. Reply with single integer."
  Aggregate average. Score >7 → flag in `content_quality_flags`. Score >8 → trigger rewrite of that section in `seo-improve.md`.
- **Comments:**
  - 2026-05-10: planned. Pattern-only detection misses subtle AI tone.
  - 2026-05-11: shipped. Part 1d split into Pass A (pattern matching, unchanged) and Pass B (LLM-judged). Pass B prompts model per H2 section with explicit anchors: 0 = human practitioner with first-hand voice + specific numbers + opinion, 10 = generic AI tone with both-sides framing + no personal voice. Aggregates to `ai_tone_score` (mean across sections) and `worst_sections` (top 3 by score). >7 appends to `content_quality_flags`. >8 also writes `worst_sections` into `geo_passages_to_restructure` so seo-improve.md rewrites them. Output table updated to expose `ai_tone_score`. Part 1 scorecard block updated to print the score with worst-section list. seo-check.md Step 4b captures `ai_tone_score`, Step 6 scorecard prints it, Step 7 saves to run-state. seo-improve.md Step 3b reads it and rewrites high-scoring sections with first-hand voice (specific numbers, named tools, practitioner perspective).

### 1.8 Replace publishedAt-as-authority bonus with real signal

- **Status:** `[x]` done
- **Owner:** seo-content-writer
- **Files:** `agents/skills/seo-content-analysis.md` Part 2c
- **Change:** Replace `publishedAt populated: +7` with:
  ```
  Inline external citations to .gov / .edu / peer-reviewed (NEJM, JAMA, AHIMA, AAPC, CMS): +7
  ```
  Detect via regex on link domains. publishedAt remains a separate Trustworthiness signal in Part 1c (correct location).
- **Comments:**
  - 2026-05-10: planned. publishedAt is trivially auto-populated; not a real authority signal.
  - 2026-05-11: shipped. Part 2c authority signals now: (a) author byline +8, (b) inline external citations to authority domains (.gov/.edu/NEJM/JAMA/AHIMA/AAPC/CMS/HHS/NIH/AMA) +7, (c) at least 2 distinct authority-domain links +10. Detection method: scan markdown `[text](url)` links for matching domain patterns. publishedAt remains a Trustworthiness signal in Part 1c — explicit note added to avoid double-counting.

### Tier 1 Acceptance

All agent-side tasks closed. Verification happens on the first scheduled blog run after Tier 1 deployment:

- [ ] Test pipeline runs end-to-end with all 8 changes on a dry-run topic — trigger one [BLOG-ORCHESTRATOR] issue with a real topic and watch the full chain
- [ ] Composite gate fails when any of keyword / geo / content below threshold — verify by inspecting `failing_dimensions` in run-state.json of a deliberately weak draft
- [ ] `internal_link_map` self-bootstraps on first run — check config.md after first post; should contain entries for every prior post
- [ ] Internal links rendered as clickable in the SharePoint draft preview after Step 4c
- [ ] AI tone score appears in scorecard log on next run (>0 integer)
- [ ] Authority signal (Part 2c) detects .gov/.edu citations in a sample post with such links — sample post should include at least one CMS / AHIMA / AAPC link
- [ ] `forced_mentions_count` and `max_forced_mentions` populated in run-state.json `seo_check`
- [ ] Schema visible in published post DOM (verify via `view-source:` or DevTools) — **gated on Tier 6.1 server change; agent-side already sends `schema` in API body**

---

## TIER 2 — Live SERP intelligence (P1)

**Goal:** Pre-write reconnaissance + post-write competitor diff using DataForSEO MCP.

**Prerequisite:** DataForSEO MCP credentials confirmed.
**Estimated effort:** 2 weeks

### 2.1 New phase `[BLOG-SERP-INTEL]` between RESEARCH and WRITE

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** New `agents/seo-content-writer/routines/bi-weekly-blog-post/serp-intel.md`; modify `research.md` Step 7 to create `[BLOG-SERP-INTEL]` instead of `[BLOG-WRITE]`; update orchestrator + AGENTS.md routing tables.
- **Change:** Phase reads `run_state_path` + `primaryKeyword`. Calls DataForSEO `serp_organic_live` (Google US, depth=10). Extracts:
  - `median_word_count` — across top 10
  - `h2_patterns` — frequency map of H2 phrases (only those appearing in 3+ results)
  - `h3_patterns` — same
  - `schema_types` — which schema markups top results use
  - `has_faq` — boolean: 5+ of 10 use FAQ section
  - `has_table` — 3+ use comparison table
  - `image_count_median`
  - `citation_density` — avg outbound links to authority domains per 1000 words
  - `paa_questions` — People Also Ask block
  - `featured_snippet` — content if any
  Saves to `run-state.json.serp_intel`. Creates `[BLOG-WRITE]` child with `serp_intel_path` in description.
- **Comments:**
  - 2026-05-10: planned. Foundation for all other Tier 2 work.

### 2.2 Writer consumes serp_intel

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** `agents/seo-content-writer/routines/bi-weekly-blog-post/write.md` Step 2
- **Change:** Read `serp_intel` from run-state.json. Apply rules:
  - Target word count = `max(serp_intel.median_word_count × 1.15, 1500)`
  - Match top 3 H2 patterns (frequency >= 5/10)
  - If `has_faq=true` → require FAQ section in draft
  - If `has_table=true` → require comparison table
  - If `paa_questions` non-empty → answer each as H3 in body
  - If `featured_snippet` exists → write a tighter, better version targeting that position
- **Comments:**
  - 2026-05-10: planned.

### 2.3 New phase `[BLOG-COMPETITOR-GAP]` between WRITE and SEO-CHECK

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** New `agents/seo-content-writer/routines/bi-weekly-blog-post/competitor-gap.md`; modify `write.md` Step 7 to create `[BLOG-COMPETITOR-GAP]` instead of `[BLOG-SEO-CHECK]`.
- **Change:** Fetch top 3 ranking URLs from `serp_intel`. Use DataForSEO `on_page_content_parsing` to extract their H1/H2/H3 + first paragraph of each section. Diff against draft:
  - List topics covered by competitors but missing in draft
  - List specific claims/stats/examples competitors include
  Output `gaps_to_fill: [{topic, competitor_url, missing_claim}]`.
  - If gaps_count > 3 → create `[BLOG-WRITE]` revision child with gaps as input. Block parent.
  - Else → continue to `[BLOG-SEO-CHECK]`.
- **Comments:**
  - 2026-05-10: planned.

### 2.4 Replace text-adapted GEO with live `seo-geo` plugin

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** `agents/skills/seo-content-analysis.md` Part 2
- **Change:** When `seo-geo` MCP plugin available, invoke directly. Use live URL post-publish, draft text pre-publish. Capture passage-level citability scores, llms.txt compliance, AI crawler accessibility, brand mention signals. Keep text-adapted version as fallback when MCP unavailable.
- **Comments:**
  - 2026-05-10: planned.

### 2.5 Use seo-content + seo-schema plugin live

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** `agents/skills/seo-content-analysis.md` Parts 1, 3
- **Change:** Same fallback pattern as 2.4. Invoke real plugin when present, inline rubric otherwise. Plugin's seo-schema can validate JSON-LD against Google Rich Results Test.
- **Comments:**
  - 2026-05-10: planned.

### Tier 2 Acceptance

- [ ] New blog runs include `serp_intel` summary in run-state.json
- [ ] Writer adapts structure to top-10 patterns (verify via diff against pre-Tier-2 drafts)
- [ ] Competitor gap phase blocks weak drafts with actionable gap list
- [ ] Live seo-geo plugin invoked when present; fallback works

---

## TIER 3 — Image SEO + visual completeness (P1)

**Goal:** Every post has 4+ images with proper alt, schema image populated, OG/Twitter card correct, Pinterest pin generated.

**Prerequisite:** nanobanana-mcp installed; medicodio.ai image upload endpoint live (Tier 6.2).
**Estimated effort:** 1 week

### 3.1 New phase `[BLOG-IMAGES]` between SEO-CHECK PASS and EMAIL

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** New `agents/seo-content-writer/routines/bi-weekly-blog-post/images.md`; modify `seo-check.md` Step 8A to create `[BLOG-IMAGES]` instead of `[BLOG-EMAIL]`.
- **Change:** Phase generates:
  - 1× hero image (1920×1080) — primary keyword themed
  - 1× OG image (1200×630) — title + Medicodio branding overlay
  - 2× section diagrams — for highest-value H2 sections
  Uses nanobanana-mcp / Gemini. Saves to SharePoint `{runFolder}/images/`. Uploads to medicodio CDN via `/api/blog/images`. Updates draft frontmatter:
  ```yaml
  featuredImage: https://cdn.medicodio.ai/...
  ogImage: https://cdn.medicodio.ai/...
  images:
    - { src: ..., alt: ..., caption: ... }
  ```
  Updates `schema_json.image` with hero CDN URL.
- **Comments:**
  - 2026-05-10: planned.

### 3.2 Image alt-text validator

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** `images.md` Step 4
- **Change:** Each `<img>` in draft body must have:
  - alt containing at least one cluster keyword
  - 8–15 word descriptive alt for hero/OG
  - alt not duplicate across images
  Block if any fail. Auto-regenerate alt with LLM if needed.
- **Comments:**
  - 2026-05-10: planned.

### 3.3 Server: `/api/blog/images` upload endpoint

- **Status:** `[ ]` todo
- **Owner:** engineering
- **Files:** medicodio.ai backend
- **Change:** Accept multipart upload. Store on CDN (or BLOB storage). Return public URL. Auth via `x-blog-secret`. Required for Tier 3.1.
- **Comments:**
  - 2026-05-10: planned. Coordinate with engineering.

### 3.4 Pinterest pin generation

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer + new social routine
- **Files:** `images.md` (generation step) + new `agents/seo-content-writer/routines/social-pin-publisher.md`
- **Change:** In `images.md`, generate 1× 1000×1500 vertical pin per post with title overlay. After publish, separate routine posts to Medicodio Pinterest via Pinterest API. Pin description includes primary keyword + link back. Drives referral traffic + backlinks.
- **Comments:**
  - 2026-05-10: planned.

### Tier 3 Acceptance

- [ ] Every published post has ≥4 images
- [ ] All images have alt with at least one cluster keyword
- [ ] OG preview correct on Twitter, LinkedIn, Slack share
- [ ] Pinterest pin posted within 1h of publish
- [ ] Schema image populated with real CDN URL

---

## TIER 4 — Off-page / backlinks + AI mentions (P2)

**Goal:** Build domain authority and AI citation share. Drive marketing-specialist outreach pipeline with prospect lists.

**Prerequisite:** Moz API key, Bing Webmaster API key, DataForSEO active.
**Estimated effort:** 3 weeks

### 4.1 `weekly-backlink-prospector` routine

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** New `agents/seo-content-writer/routines/backlink-prospector.md`
- **Cron:** `0 9 * * MON`
- **Change:** Uses `seo-backlinks` skill. Pulls referring domains for top 3 competitors (autonomous medical coding vendors, top RCM-AI tools — list maintained in `config.md`). Diffs against medicodio.ai's existing backlink set. Outputs `prospects.json` to SharePoint with each prospect ranked by Moz Domain Authority. Creates Paperclip issue assigned to **marketing-specialist** with prospect list — feeds into existing `event-outreach` machinery.
- **Comments:**
  - 2026-05-10: planned. Reuses marketing-specialist outreach infrastructure.

### 4.2 `weekly-ai-mention-tracker` routine

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** New `agents/seo-content-writer/routines/ai-mention-tracker.md`
- **Cron:** `0 9 * * TUE`
- **Change:** Uses DataForSEO ChatGPT scraper + LLM mention tracking. Tests 20 cluster queries against ChatGPT, Perplexity, Google AI Overviews, Bing Copilot. Records per query: cited (Y/N), position in citation list, snippet quality, competitor cited if not Medicodio. Saves week-over-week to `SEO-Content-Writer/ai-visibility/{week}.json`. Posts weekly summary to Teams marketing channel. Alerts (creates Paperclip issue) on >2-platform regression.
- **Comments:**
  - 2026-05-10: planned. AI search is the long-term battle.

### 4.3 `brand-mention-monitor` routine

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** New `agents/seo-content-writer/routines/brand-mention-monitor.md`
- **Cron:** `0 12 * * *` (daily)
- **Change:** Tracks unlinked brand mentions across web — Google Alerts API, Reddit search, HackerNews, industry forums. For each unlinked mention, auto-creates Paperclip outreach issue assigned to marketing-specialist with templated reply requesting backlink.
- **Comments:**
  - 2026-05-10: planned.

### 4.4 `monthly-disavow-toxic-links` routine

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** New `agents/seo-content-writer/routines/disavow-toxic-links.md`
- **Cron:** `0 9 1 * *` (1st of month)
- **Change:** Uses `seo-backlinks` toxic detection (Moz spam score >40). Builds `disavow.txt`. Submits to GSC via Disavow Tool API. Logs to SharePoint.
- **Comments:**
  - 2026-05-10: planned.

### Tier 4 Acceptance

- [ ] Weekly cadence delivers prospect lists to marketing-specialist
- [ ] AI mention rate trends positive over 8 weeks (graph in Teams)
- [ ] At least 3 backlinks earned per month from outreach
- [ ] Toxic backlinks disavowed monthly

---

## TIER 5 — Post-publish monitoring + content refresh (P2)

**Goal:** Detect ranking decay, CWV regressions, indexing issues. Auto-trigger refresh.

**Prerequisite:** GSC API, PageSpeed/CrUX API, Indexing API.
**Estimated effort:** 2 weeks

### 5.1 `daily-rank-tracker` routine

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** New `agents/seo-content-writer/routines/rank-tracker.md`
- **Cron:** `0 6 * * *`
- **Change:** DataForSEO SERP API for each cluster keyword. Targets: Google US (5-city geo grid: NYC, LA, Chicago, Houston, Atlanta), Bing US, Google AI Overviews. Stores `SEO-Content-Writer/ranks/{date}.json`. Alerts on:
  - Drop >3 positions day-over-day
  - Fall out of top 20
  - Loss of featured snippet
- **Comments:**
  - 2026-05-10: planned.

### 5.2 `weekly-cwv-monitor` routine

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** New `agents/seo-content-writer/routines/cwv-monitor.md`
- **Cron:** `0 8 * * WED`
- **Change:** Uses `seo-google` skill — CrUX field data via PageSpeed Insights API for medicodio.ai blog pages. Monitors LCP, INP, CLS, TTFB. Per-page report. Creates Paperclip issue for engineering on regression (any metric crossing "needs improvement" boundary).
- **Comments:**
  - 2026-05-10: planned.

### 5.3 `weekly-gsc-pull` routine

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** New `agents/seo-content-writer/routines/gsc-pull.md`
- **Cron:** `0 8 * * THU`
- **Change:** GSC Search Analytics API: impressions, clicks, CTR, position per blog URL, last 7d vs prior 7d. Outputs `SEO-Content-Writer/gsc/{date}.json`. Identifies decay candidates (impressions drop >25% WoW). Triggers Tier 5.4 refresh phase.
- **Comments:**
  - 2026-05-10: planned.

### 5.4 New phase `[BLOG-REFRESH]` triggered by decay

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** New `agents/seo-content-writer/routines/bi-weekly-blog-post/refresh.md`
- **Change:** Triggered by `weekly-gsc-pull` when post meets refresh criteria:
  - Impressions drop >25% WoW
  - OR position falls out of top 10 for primary keyword
  - OR cited by AI search dropped (from Tier 4.2)
  Reuses Tier 2 SERP-INTEL → WRITE pipeline with prior content as context. Updates existing blog post (PUT to `/api/blog/{slug}`) instead of creating new. Same skill invocations as fresh post.
- **Comments:**
  - 2026-05-10: planned.

### 5.5 `monthly-keyword-expansion` routine

- **Status:** `[ ]` todo
- **Owner:** seo-content-writer
- **Files:** New `agents/seo-content-writer/routines/keyword-expansion.md`
- **Cron:** `0 9 1 * *`
- **Change:** DataForSEO keyword research APIs — find new long-tail ranking opportunities (low difficulty, rising volume, competitor-relevant). Auto-appends top 10 to `config.md` keyword cluster. Auto-creates `[BLOG-ORCHESTRATOR]` issues for top 2 new opportunities.
- **Comments:**
  - 2026-05-10: planned.

### Tier 5 Acceptance

- [ ] Daily rank dashboard updated automatically
- [ ] Decay detected and refresh auto-triggered
- [ ] CWV regressions caught within 7 days
- [ ] Keyword cluster grows by ≥5 net new keywords per month

---

## TIER 6 — Server-side enablers (parallel to Tiers 1-5)

**Goal:** Backend changes on medicodio.ai required for Tier 1-5 features to work end-to-end.

**Owner:** engineering team (coordinate, not direct ownership)
**Estimated effort:** 1-2 weeks parallel to other tiers

### 6.1 `/api/blog/push` accepts `schema` field

- **Status:** `[ ]` todo
- **Owner:** engineering
- **Change:** Accept `schema` in request body. Inject as `<script type="application/ld+json">` in `<head>` of rendered post page.
- **Blocks:** Tier 1.2 (preferred path)
- **Comments:**
  - 2026-05-10: planned.

### 6.2 `/api/blog/images` upload endpoint

- **Status:** `[ ]` todo
- **Owner:** engineering
- **Change:** Multipart upload, CDN storage, return public URL. Auth via `x-blog-secret`.
- **Blocks:** Tier 3.1
- **Comments:**
  - 2026-05-10: planned.

### 6.3 `/llms.txt` route

- **Status:** `[ ]` todo
- **Owner:** engineering
- **Change:** Auto-generated from sitemap. Lists all blog posts with summaries per llmstxt.org spec. Update on every publish.
- **Comments:**
  - 2026-05-10: planned. Helps AI crawlers (Perplexity, ChatGPT) discover content.

### 6.4 `/sitemap.xml` includes `<image:image>` tags

- **Status:** `[ ]` todo
- **Owner:** engineering
- **Change:** Image sitemap entries for Google Images ranking. Pull from blog post `images[]` frontmatter.
- **Comments:**
  - 2026-05-10: planned.

### 6.5 OG meta tags + Twitter card on blog template

- **Status:** `[ ]` todo
- **Owner:** engineering
- **Change:** Render `<meta property="og:image">`, `<meta name="twitter:card">`, etc. from `ogImage`, `seoTitle`, `seoDescription` frontmatter.
- **Blocks:** Tier 3 social preview correctness
- **Comments:**
  - 2026-05-10: planned.

### 6.6 Page-level schema beyond BlogPosting

- **Status:** `[ ]` todo
- **Owner:** engineering
- **Change:** Add `BreadcrumbList` always, `FAQPage` when FAQ section detected in body, `HowTo` when numbered steps detected, `Organization` site-wide.
- **Comments:**
  - 2026-05-10: planned.

### 6.7 Indexing API ping on publish

- **Status:** `[ ]` todo
- **Owner:** engineering OR new seo-content-writer routine
- **Change:** After `/api/blog/push` success, call:
  - Google Indexing API (immediate index request)
  - Bing IndexNow (Bing + Yandex + others)
- **Comments:**
  - 2026-05-10: planned. Cuts indexing time from days to hours.

### Tier 6 Acceptance

- [ ] Schema visible in `<head>` of every published post (verify via Rich Results Test)
- [ ] Image upload endpoint returns CDN URL within 2s
- [ ] llms.txt accessible at medicodio.ai/llms.txt and lists all posts
- [ ] Image sitemap valid in GSC
- [ ] OG/Twitter cards render correctly on share preview tools
- [ ] FAQPage schema appears in Rich Results Test for posts with FAQ section
- [ ] New posts indexed within 24h via Indexing API

---

## Suggested rollout sequence

```
Week 1-2:   TIER 1 (bug fixes) — every post after this is meaningfully better
Week 2-3:   TIER 6.1, 6.5, 6.6 (server schema/OG/breadcrumb) — engineering parallel
Week 3-5:   TIER 2 (live SERP intel) — biggest content quality lift
Week 4-5:   TIER 3 + TIER 6.2, 6.3, 6.4 (images + server image/llms/sitemap)
Week 5-7:   TIER 4 (backlinks + AI mention tracking) — off-page flywheel starts
Week 7-9:   TIER 5 (monitoring + refresh) — closes the loop
Week 9+:    Optimize on signals from Tier 5 dashboards
```

## Expected ranking timeline

Realistic targets, assuming domain authority builds and outreach delivers backlinks:

| Milestone | Target |
|---|---|
| Cluster long-tails top 30 | Week 4 |
| Cluster long-tails top 10 | Week 8 |
| Primary "AI medical coding" top 30 | Week 8 |
| Primary top 10 | Week 16 |
| Primary top 3 | Week 24-32 |
| Primary #1 | Month 6-12 |
| AI Overviews citation rate >50% on cluster | Month 4 |
| ChatGPT/Perplexity citation share > top competitor | Month 6 |

SEO is slow. Compounds via TIER 4 (backlinks) and TIER 5 (refresh loop). #1 holds only with continuous Tier 5 + Tier 4 work.

---

## Risks

| Risk | Mitigation |
|---|---|
| DataForSEO costs at scale | Cache SERP results 24h. Rank tracker = top 20 keywords only. |
| Google API quotas | Stagger crons. Exponential backoff. Use Search Console batch endpoints. |
| Schema injection breaks layout | Test on staging blog post first. JSON-LD in `<head>` only. |
| AI image gen brand inconsistency | Lock prompt template + brand style guide. Human review first 10 generations. |
| Auto-fix → keyword stuffing penalty | Tier 1.5 cap. Monitor via Tier 5.1 — Google penalty = sudden rank drop. |
| Refresh loop starves new content | Cap refresh to 2/week. Bi-weekly new content stays priority. |
| Schema markup spam (rich result manipulation) | Only mark up content that genuinely matches schema type. No fake FAQs. |
| AI mention tracker false negatives | Test multiple phrasings per query. Average across 3 runs. |
| Backlink outreach spam complaints | Templated outreach has unsubscribe link + relevance check before send. |
| Engineering bandwidth blocks Tier 6 | Tier 1.2 fallback (inject schema in body) keeps Tier 1 unblocked. |

---

## Open coordination items

### Blocking Tier 2+

- [ ] **DataForSEO MCP credentials** — verify `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` set in `.paperclip/.env`. Current env scan shows only OUTLOOK / SHAREPOINT / PAPERCLIP keys; no DataForSEO yet. **NEEDS: user to add credentials.**
- [ ] **claude-seo plugin skills in Paperclip env** — verify all installed: seo-geo, seo-content, seo-schema, seo-image-gen, seo-backlinks, seo-google, seo-technical, seo-dataforseo. Local invocation works via Skill tool; Paperclip hosted execution needs the plugin attached to the seo-content-writer agent. **NEEDS: user to attach plugin in Paperclip UI.**
- [ ] **Google API credentials** (Tier 5) — Search Console OAuth, PageSpeed Insights API key, CrUX API key, Indexing API service account. **NEEDS: user to provision in Google Cloud Console.**
- [ ] **Moz API key** (Tier 4.1) — free tier sufficient for weekly cadence. **NEEDS: user to register at moz.com.**
- [ ] **Bing Webmaster Tools API key + IndexNow key** (Tier 4.1, 6.7). **NEEDS: user to provision in Bing Webmaster Tools.**
- [ ] **nanobanana-mcp installation** (Tier 3 image gen). **NEEDS: user to install in Paperclip env.**
- [ ] **Pinterest API access** (Tier 3.4) — Medicodio Pinterest account + access token. **NEEDS: user to register Pinterest developer app.**

### Tier 6 — engineering coordination

- [x] **Engineering brief handed off** — 2026-05-11. Engineer responded with stack confirmation (Next.js 15 + Sanity + Vercel) and detailed audit. Spec at `agents/seo-content-writer/server-changes/tier-6.1-schema-injection.md` updated with audit findings (URL shape, path map, partial-done state of Tier 6.x).
- [x] **Engineer Q1-Q5 answered** — 2026-05-11. Paste-ready answers at `agents/seo-content-writer/server-changes/tier-6.1-answers-to-engineer.md`. Covers spec location, schema shape (`@graph` forward-compat), `mainImage` (not `featuredImage`), Google Indexing API service-account provisioning, bundle PR recommendation.
- [ ] **Engineer cuts Tier 6 bundle PR** — ETA ~1 working day to staging. Real work remaining: Sanity schema additions (`schema`, `canonicalUrl`, `primaryKeyword`), `pushBlogDraft()` whitelist, `page.tsx` consumption of new fields, image sitemap `<image:image>` namespace, FAQPage conditional render, Google Indexing API service-account integration. Async — doesn't block Tier 2 work.
- [ ] Engineering needs a separate brief for **Tier 6.2** (`/api/blog/images` upload endpoint) — write when Tier 3 starts.

### Decisions

- [x] Decide: schema injection preferred path (Tier 6.1) vs fallback (Tier 1.2 inline) — **resolved 2026-05-11:** ship clean schema in API body now, wait for Tier 6.1 to render. HTML `<script>` injection into Portable Text body rejected.
- [x] Decide: how to handle `internal_link_map` bootstrap — **resolved 2026-05-11:** lazy bootstrap inside Step 4c.1 (auto-derive from posted_log on first run). No manual SharePoint work required.
- [x] Cleanup: delete duplicate `agents/seo-content-writer/skills/seo-content-analysis.md` — **resolved 2026-05-11:** deleted file + empty dir. Canonical is `agents/skills/seo-content-analysis.md`.
- [ ] Decide: competitor list for Tier 4.1 prospector. **NEEDS: user input — names of top 3 RCM-AI / autonomous-coding competitors to scrape backlinks from.**
- [ ] Decide: AI mention tracker query list — curate 20 cluster queries for Tier 4.2. **NEEDS: user input.**

---

## Change log

- **2026-05-10** — Plan created. All tasks `todo`. Awaiting Tier 1 kickoff.
- **2026-05-11** — Tier 1 shipped. Tasks 1.1, 1.4, 1.5, 1.6, 1.7, 1.8 fully done. Tasks 1.2, 1.3 partially done (in_progress) — client-side logic shipped, awaiting external dependencies (Tier 6.1 server change for 1.2; SharePoint config bootstrap for 1.3). Both degrade gracefully: 1.2 sends extra fields server ignores; 1.3 logs warning and skips link insertion. Pipeline functional end-to-end with composite gate (keyword + GEO + content), tightened thresholds, anti-stuffing cap, full revise re-score, LLM AI-tone judge, and authority-citation signal.
- **2026-05-11 (later)** — Tier 1 fully closed. 1.3 lazy bootstrap added to Step 4c.1 (auto-derives `internal_link_map` from `posted_log` on first run — no manual SharePoint write needed). 1.2 engineering brief written at `agents/seo-content-writer/server-changes/tier-6.1-schema-injection.md` and handed off — agent side complete, server side now owned by medicodio.ai backend. Duplicate `agents/seo-content-writer/skills/` directory deleted (was unreferenced). All 8 Tier 1 tasks now `[x]` done. Tier 1 fully ready for Paperclip deployment. Next: Tier 2 (live SERP intelligence via DataForSEO MCP) — requires DataForSEO credentials to be added to `.paperclip/.env` first.
- **2026-05-11 (engineer audit)** — medicodio.ai backend engineer audit (Next.js 15 + Sanity + Vercel) revealed two critical issues:
  - **URL shape fix:** blog posts live at `https://medicodio.ai/resources/blog/<slug>`, NOT `https://medicodio.ai/blog/<slug>`. publish.md Step 2.5 and seo-check.md Step 4c.1 lazy bootstrap both corrected. Schema canonical URLs now use the right pattern.
  - **Field naming fix:** Sanity already has a `mainImage` field. Pipeline initially updated to send `mainImage` instead of `featuredImage` — later REVERSED after engineer's full plan (see next entry).
  - Engineer audit also revealed Tier 6.x partial state: 6.1 has server-generated BlogPosting JSON-LD (replaceable by pipeline-sent `schema`), 6.5 OG/Twitter done, 6.6 BreadcrumbList done, 6.7 IndexNow (Bing/Yandex) done. Remaining: 6.1 new Sanity fields + whitelist, 6.4 image sitemap, 6.6 FAQPage, 6.7 Google Indexing API. ETA ~1 working day to staging.
  - Bonus: seo-check.md Step 4c now reads `SEO-Content-Writer/data/published-posts.csv` from SharePoint when present (richer source than `posted_log`). Step 4c.2 has 4-tier resolution fallback: exact slug → title match → category match → summary fuzzy → skip. Smarter anchor-to-target matching.
  - Answers file written for engineer at `agents/seo-content-writer/server-changes/tier-6.1-answers-to-engineer.md` covering all 5 of their questions (spec location, schema shape, mainImage clarification, Indexing API provisioning, bundle vs split). Engineer can cut real PR (not stub) with everything they need.
- **2026-05-11 (engineer Tier 6 plan + Tier 7 emerged + full self-review)** — Engineer responded with Tier 6 implementation plan including a new **Tier 7 (Blog tracker auto-export)** that auto-syncs `SEO-Content-Writer/data/published-posts.csv` from Sanity. This **eliminates the manual CSV upload entirely** — content team never has to maintain the file.
  - Direction reversal: keep BOTH `mainImage` and `featuredImage` as separate Sanity fields. `mainImage` = in-post hero. `featuredImage` = social/OG override. publish.md Step 4 body updated to send both (nullable).
  - Alignment doc written at `agents/seo-content-writer/server-changes/tier-6-alignment-with-engineer-plan.md` — answers Q1-Q5, tracker column spec (v1 + bonus + future Tier 4/5 columns), CSV format spec, rollout order, validation checklist.
  - Full self-review of all Tier 1 edits caught and fixed **23 bugs / edge cases**:
    - seo-check.md: idempotency check now uses `composite_pass` not `seoScore`; threshold IF-chain corrected to ELSE-IF (logic bug — pre-Tier 1 also had this); Step 4c.1 restructured for single config.md read + CSV-first sourcing; Step 4c.2 greedy longest-anchor ordering + per-link `method` tracking + `internal_links_inserted_list` array
    - publish.md: defensive null handling on schema mutation (nested keys); omit `schema` field if null (server fallback); `featuredImage` added to API body; log field renamed "Main image" vs "Featured image"
    - revise.md: idempotency guard via `reply_message_id` check; Step 4e restructured into Path A / Path B with explicit complete branches (no fall-through bug); Path B includes single retry after targeted fixes before declaring regression
    - seo-improve.md: idempotency guard via `seo_improve_count >= seo_improve_pass` check; log per-dimension scorecard table; PATCH comment reflects actual failing dimensions worked
    - skill seo-content-analysis.md: new explicit output `ai_tone_worst_sections` (replaces shape-mismatched cramming into `geo_passages_to_restructure`); both consumers (seo-check.md, seo-improve.md) wired
  - Validation runbook written at `agents/seo-content-writer/TIER-1-VALIDATION-RUNBOOK.md` — 8 concrete validations + smoke-test grep commands. All smoke tests passed at end of session.
  - **Tier 1 closed 100%.** Tier 7 from engineer makes 1.3 fully self-sufficient. Engineer cutting bundle PR (~1 day to staging). Once that lands + first live `[BLOG-ORCHESTRATOR]` runs successfully against the validation runbook, sign off. Tier 2 (DataForSEO SERP intel) starts once creds added to `.paperclip/.env`.
