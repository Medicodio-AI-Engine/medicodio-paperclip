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
