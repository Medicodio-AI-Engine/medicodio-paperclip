# Audit — Final Log + Close (Phase 7)

⛔ **HARD STOP RULE: This phase does ONE thing — write the audit log + close parent + close self. After Step 4, EXIT IMMEDIATELY. Do not create child issues. Do not send emails. This phase closes the parent orchestrator issue — no other phase does this.**

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
