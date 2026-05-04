# Email Monitor — Reply Check Routine

**Trigger:** Every 6 hours (`0 */6 * * *`)
**Concurrency:** `skip_if_active`
**Catch-up:** `skip_missed`
**Purpose:** Check inbox for replies to blog approval emails. Create next pipeline sub-issue when reply found.
**DO NOT:** Make changes to the draft. Run SEO checks. Send new emails. Read competitor pages.

---

## Step 1 — Load config and check for active run

```
GET /api/agents/me → agentId, companyId
GET /api/agents/me/inbox-lite → find this routine's execution issue
POST /api/issues/{issueId}/checkout

sharepoint_read_file path="SEO-Content-Writer/config.md"
→ parse activeRunFolder
→ IF activeRunFolder is empty or missing:
   PATCH issue → done, "No active run. Exiting." EXIT.
```

## Step 2 — Load run state

```
sharepoint_read_file path="{activeRunFolder}/run-state.json"
→ IF missing: PATCH issue → done, "run-state.json not found at {path}. Clearing activeRunFolder."
  → sharepoint_write_file config.md with activeRunFolder=""
  EXIT.

→ extract: status, conversationId, messageId, lastCheckedAt,
  revisionCount, maxRevisions, parentIssueId, topic
→ IF status ≠ "awaiting_reply":
   PATCH issue → done, "Run status is '{status}' — not awaiting reply. Exiting." EXIT.
```

## Step 3 — Check inbox for replies

```
outlook_list_messages
  mailbox="{OUTLOOK_MAILBOX}"
  filter: conversationId = "{conversationId}"
  filter: receivedDateTime > "{lastCheckedAt}"
  orderBy: receivedDateTime asc
  top: 10
```

**Always update lastCheckedAt = now ISO**, even if no messages found:
```
sharepoint_read_file path="{activeRunFolder}/run-state.json"
→ update lastCheckedAt = now ISO
sharepoint_write_file path="{activeRunFolder}/run-state.json" content="{updated}"
```

If no messages:
```
PATCH issue → done, "No new replies since {lastCheckedAt}. Next check in 6h." EXIT.
```

## Step 4 — Filter and classify replies

For each message (process in received order):

**Skip if any of:**
- Subject contains: "Out of Office", "Auto-Reply", "Automatic reply", "OOO", "Vacation"
- Body is empty or <20 characters
- Body is only punctuation, emoji, or a single word with no context

**Classify remaining replies:**

APPROVED (any of these exact phrases, case-insensitive):
- "approved", "looks good", "go ahead", "publish it", "send it", "lgtm", "good to go", "yes publish", "publish this", "approved ✓", "yes, publish"

START OVER:
- "start over", "start again", "rewrite it", "restart"

CHANGES REQUESTED:
- Any substantive reply that is not an approval signal

Use the LAST non-skipped reply if multiple replies exist (most recent decision wins).

## Step 5a — If APPROVED

```
POST /api/companies/{companyId}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[BLOG-PUBLISH] {topic}",
  "description": "phase_file: routines/bi-weekly-blog-post/publish.md\nrun_state_path: {activeRunFolder}/run-state.json\nparent_issue_id: {parentIssueId}",
  "assigneeAgentId": "{agentId}",
  "parentId": "{parentIssueId}",
  "status": "todo",
  "priority": "high"
}

sharepoint_read_file path="{activeRunFolder}/run-state.json"
→ update status = "publish_queued"
sharepoint_write_file

PATCH issue → done, "Reply classified as APPROVED. [BLOG-PUBLISH] child created."
```

## Step 5b — If CHANGES REQUESTED

```
reply_message_id = messageId of the reply

POST /api/companies/{companyId}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[BLOG-REVISE] {topic}",
  "description": "phase_file: routines/bi-weekly-blog-post/revise.md\nrun_state_path: {activeRunFolder}/run-state.json\nparent_issue_id: {parentIssueId}\nreply_message_id: {reply_message_id}",
  "assigneeAgentId": "{agentId}",
  "parentId": "{parentIssueId}",
  "status": "todo",
  "priority": "high"
}

sharepoint_read_file path="{activeRunFolder}/run-state.json"
→ update status = "revision_queued"
sharepoint_write_file

PATCH issue → done, "Reply classified as CHANGES. [BLOG-REVISE] child created. Revision {revisionCount+1}."
```

## Step 5c — If START OVER

```
sharepoint_read_file path="{activeRunFolder}/run-state.json"
→ reset: revisionCount = 0, status = "running"
sharepoint_write_file

POST /api/companies/{companyId}/issues
{
  "title": "[BLOG-WRITE] {topic} (restart)",
  "description": "phase_file: routines/bi-weekly-blog-post/write.md\nrun_state_path: {activeRunFolder}/run-state.json\nparent_issue_id: {parentIssueId}\nnote: start_over — research.md already exists, skip to write",
  "assigneeAgentId": "{agentId}",
  "parentId": "{parentIssueId}",
  "status": "todo",
  "priority": "high"
}

PATCH issue → done, "Reply: START OVER. RevisionCount reset to 0. New [BLOG-WRITE] child created."
```

---

## Error Handling

| Situation | Action |
|---|---|
| config.md missing | PATCH done, exit |
| activeRunFolder empty | PATCH done, exit |
| run-state.json missing | PATCH done, clear activeRunFolder, exit |
| Outlook list fails | Post warning, PATCH done — try next 6h cycle |
| Child issue creation fails | Retry once. Post blocked on self if still fails |
