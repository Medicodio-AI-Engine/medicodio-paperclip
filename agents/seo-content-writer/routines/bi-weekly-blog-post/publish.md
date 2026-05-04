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
