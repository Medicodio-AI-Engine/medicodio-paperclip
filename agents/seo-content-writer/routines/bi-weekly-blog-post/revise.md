# Revise — Apply Changes + Re-Check (Revision Phase)

⛔ **HARD STOP RULE: This phase does ONE thing — apply reviewer changes + reply to email + close self. After Step 8, EXIT IMMEDIATELY. Do NOT publish. Do NOT create [BLOG-PUBLISH]. Email-monitor creates the next child.**

**BOUNDARY LINE 1:** Changes come from the reviewer's email reply — do NOT invent changes.
**BOUNDARY LINE 2:** Run the **full** seo-content-analysis skill after revising — keyword + GEO + content quality. Do NOT create a new [BLOG-SEO-CHECK] child issue (the re-score happens inline here). Block reply if any score regresses below the Step 4d gate (keyword pass, geo ≥ 65, content ≥ 70).
**BOUNDARY LINE 3:** After revising and re-scoring, set status = "awaiting_reply" and exit. Email-monitor creates the next child.
**BOUNDARY LINE 4:** If revisionCount >= maxRevisions: block parent, email karthik.r, EXIT without revising.
**STATE:** Reads run-state.json. Updates draft.md. Re-runs full SEO skill. Writes `revise-{n}` section. Closes self.

---

## Step 1 — Load state and reply (with idempotency guard)

```
run_state_path = extract from issue description
parent_issue_id = extract from issue description
reply_message_id = extract from issue description line: "reply_message_id: ..."

sharepoint_read_file path="{run_state_path}"
→ extract: topic, runFolder, conversationId, revisionCount, maxRevisions,
  approverEmail, seoScore, wordCount, primaryKeyword,
  revise_{revisionCount+1}  (may be missing — that means this is a fresh revise)

# Idempotency guard — handle heartbeat retry after partial completion
n = revisionCount + 1
IF run-state.json has `revise_{n}` block AND `revise_{n}.reply_message_id == reply_message_id`:
  → This reply has already been processed. Crash-recovery scenario.
  → PATCH issue → done, "Idempotency: revision {n} already complete for reply_message_id {reply_message_id}. No-op exit."
  → STOP.

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

## Step 4 — Full SEO re-score (keyword + GEO + content)

Load keyword cluster from config.md (full cluster — primary + secondary + long-tail).

**4a. Keyword scoring (full cluster, same rubric as seo-check.md Step 2):**
Re-score every keyword 1–10. Compute `overall_score = (sum / cluster_size*10) * 100`.
Apply tightened threshold from seo-check.md Step 4 (75/70/65 by cluster size, primary bonus -1 if primary ≥ 9).
Set `keyword_pass = (overall_score >= threshold)`.

**4b. Run full seo-content-analysis skill:**
Load `agents/skills/seo-content-analysis.md`. Inputs:
```
draft_content  = updated draft_content from Step 3
topic          = {topic}
primaryKeyword = {primaryKeyword}
seoTitle       = {seoTitle from frontmatter}
seoDescription = {seoDescription from frontmatter}
publishedAt    = {publishedAt from frontmatter}
```
Capture: `content_quality_score`, `geo_score`, `ai_tone_score`, `eeat_breakdown`, `content_quality_flags`, `internal_link_opportunities`, `geo_top5`, `geo_passages_to_restructure`, `schema_json`.

**4c. Composite gate check:**
```
keyword_pass = (overall_score >= threshold)
geo_pass     = (geo_score >= 65)
content_pass = (content_quality_score >= 70)
composite_pass = keyword_pass AND geo_pass AND content_pass
```

**4d. Regression handling:**
Compare against pre-revision scores stored in `run-state.json.seo_check`:
```
prior_keyword = run-state.json.seo_check.overall_score
prior_geo     = run-state.json.geo_score
prior_content = run-state.json.content_quality_score

regressed = (overall_score < prior_keyword - 3)
         OR (geo_score     < prior_geo     - 5)
         OR (content_quality_score < prior_content - 5)
```

**4e. Decision tree** (each path is complete — Path B does NOT fall through to Step 5-8):

```
─── Path A: composite_pass AND NOT regressed ─────────────────────────────
  → Save new scores to run-state.json revise_{n}.scores block. (prior seo_check stays untouched
    — revise_{n}.scores becomes the new "prior" for comparison on revision n+1.)
  → Continue to Step 5 (log) → Step 6 (reply with updated draft) → Step 7 (state) → Step 8 (close).

─── Path B: NOT composite_pass OR regressed ──────────────────────────────
  1. Apply targeted fixes from skill output:
     - geo_passages_to_restructure (top 3) — restructure 134-167 word answer blocks
     - content_quality_flags — filler removal, vague citations, AI tone rewrite if ai_tone_score > 7
     - Re-insert any keyword that regressed (compare prior vs current keyword_scores)
  2. Re-score after fixes — re-run the skill once more (single retry, not infinite).
  3. Decision after retry:

     ─── Path B.1: retry succeeded (composite_pass AND NOT regressed) ───────
       → Save scores. Continue to Path A flow (Step 5 → 8).

     ─── Path B.2: retry still failing ──────────────────────────────────────
       → Post comment on parent: "Revision {n} introduced regression that couldn't be recovered
         inline. keyword: {prior_keyword} → {overall_score}, geo: {prior_geo} → {geo_score},
         content: {prior_content} → {content_quality_score}. Failing dimensions: {list}.
         Reviewer notified for explicit decision."
       → Reply to reviewer's email explaining the regression (uses regression-specific body, NOT
         the normal "Applied your changes" reply from Step 6):
         ```
         outlook_reply_to_email
           messageId="{reply_message_id}"
           cc="naveen@medicodio.ai"
           body: "<p>Applied your changes, but the revisions introduced an SEO regression I couldn't
                  fully recover from inline:</p>
                  <ul>
                    <li>Keyword score: {prior_keyword}/100 → {overall_score}/100 (gate {threshold})</li>
                    <li>GEO score: {prior_geo}/100 → {geo_score}/100 (gate 65)</li>
                    <li>Content quality: {prior_content}/100 → {content_quality_score}/100 (gate 70)</li>
                  </ul>
                  <p>Reply 'ship anyway' to publish at current scores, or send revised changes.</p>"
         → capture new_message_id from reply
       → Update run-state.json INLINE here (skip Step 7's standard update — this is the
         regression-exit path):
         revisionCount = revisionCount + 1
         status = "awaiting_reply"
         messageId = new_message_id
         lastCheckedAt = now ISO
         revise_{n} = {
           status: "regression_recovery_failed",
           completed_at: ISO,
           reply_message_id: new_message_id,
           changes_requested: [...],
           changes_applied: [...],
           scores: { keyword: overall_score, geo: geo_score, content: content_quality_score, ai_tone: ai_tone_score, eeat_breakdown },
           regression: { from: { keyword: prior_keyword, geo: prior_geo, content: prior_content }, failing_dimensions }
         }
       → Write revise-{n}.md log (Step 5 still runs for documentation, but with regression flag).
       → PATCH self → done, "Revision {n} applied with regression recovery failure. Reviewer notified.
         Email-monitor watches for response."
       → EXIT. Skip Step 6, Step 7, Step 8 normal update.
     ──────────────────────────────────────────────────────────────────────
─────────────────────────────────────────────────────────────────────────
```

**State write (Path A only):** Update run-state.json with new full score set in `revise_{n}.scores` block — keyword `overall_score`, `geo_score`, `content_quality_score`, `ai_tone_score`, `eeat_breakdown`. The prior `seo_check` block is NOT overwritten — only the `revise_{n}.scores` block changes. On revision n+1, prior comparison reads from `revise_{n}.scores` (or `seo_check` if n=1).

**Note on reviewer "ship anyway" reply:** Caught by email-monitor's existing APPROVED keyword list ("publish it", "ship it", "send it"). No extra wiring needed.

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

## Full SEO Re-check
**Keyword score:** {prior_keyword}/100 → {overall_score}/100 (threshold {threshold})
**GEO score:** {prior_geo}/100 → {geo_score}/100 (gate 65)
**Content quality:** {prior_content}/100 → {content_quality_score}/100 (gate 70)
**AI tone:** {ai_tone_score}/10 (lower = better)
**Composite gate:** {PASS / FAIL}
**Regression detected:** {yes/no}

### Per-keyword score deltas
| Keyword | Prior | Now | Delta |
| --- | --- | --- | --- |
{full cluster table — every keyword from config}

### Content quality flags
{content_quality_flags list, or "None"}

### GEO improvements applied (if regression triggered Step 4e fixes)
{list}
---
```

## Step 6 — Reply to email thread with updated draft

```
sharepoint_get_file_info path="{runFolder}/draft.md"
→ get webUrl as draft_url

outlook_reply_to_email
  messageId="{reply_message_id}"
  cc="naveen@medicodio.ai"
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
