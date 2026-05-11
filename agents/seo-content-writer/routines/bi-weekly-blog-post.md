# Bi-Weekly Blog Post — Orchestrator

**Trigger:** Every 15 days (`0 0 */15 * *`) or manual issue creation.
**Concurrency:** `skip_if_active` — one blog run at a time.
**Catch-up:** `skip_missed`
**Role:** Bootstrap pipeline only. Read issue description, write run-state.json, create [BLOG-RESEARCH] child. EXIT.
**DO NOT:** Execute any phase logic. Do not search, write, or send anything here.

---

## Phase Routing

When assigned an issue whose title starts with one of these prefixes, read the mapped file FIRST:

| Title prefix | Phase file |
|---|---|
| `[BLOG-ORCHESTRATOR]` | `routines/bi-weekly-blog-post.md` (this file) |
| `[BLOG-RESEARCH]` | `routines/bi-weekly-blog-post/research.md` |
| `[BLOG-WRITE]` | `routines/bi-weekly-blog-post/write.md` |
| `[BLOG-SEO-CHECK]` | `routines/bi-weekly-blog-post/seo-check.md` |
| `[BLOG-SEO-IMPROVE]` | `routines/bi-weekly-blog-post/seo-improve.md` |
| `[BLOG-EMAIL]` | `routines/bi-weekly-blog-post/email.md` |
| `[BLOG-REVISE]` | `routines/bi-weekly-blog-post/revise.md` |
| `[BLOG-PUBLISH]` | `routines/bi-weekly-blog-post/publish.md` |
| `[BLOG-AUDIT]` | `routines/bi-weekly-blog-post/audit.md` |

If your current issue title starts with any `[BLOG-*]` prefix other than `[BLOG-ORCHESTRATOR]`: read the mapped phase file immediately. Do not read this file further.

---

## Orchestrator Steps

### Step 1 — Extract topic from issue description

Scan issue description for:
```
topic: {blog topic title}
brief: {any talking points, angle, or keywords to focus on}
primary_keyword: {target keyword — optional, agent can infer}
```

If `topic:` line is missing:
```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
{ "body": "topic: line missing from issue description. Add:\ntopic: Your Blog Title Here\nbrief: Any talking points or angle\n\nBlocked." }
```
Set issue → `blocked`. STOP.

### Step 2 — Load config and check for duplicate

```
sharepoint_read_file path="SEO-Content-Writer/config.md"
→ IF missing: create it with default keyword cluster (see AGENTS.md) + empty posted_log. Continue.

→ Normalize topic to slug for dedup:
  topic_slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

→ parse posted_log — for each entry, compare topic_slug against entry.slug (normalized match, not raw title match)
→ IF duplicate slug found:
   POST comment: "Topic slug '{topic_slug}' matches already-published entry '{entry.topic}' ({entry.published_at}). Skipping to avoid duplicate content."
   PATCH issue → done. STOP.
```

### Step 3 — Derive category and approver email

Scan topic + brief for routing keywords:
- `medical_coding` keywords: medical coding, ICD-10, CPT, coding accuracy, autonomous coding, computer-assisted, HIM, denial reduction
- Default to `services` if no match

Set `approverEmail`:
- `medical_coding` → `Jessica.Miller@medicodio.ai`
- `services` → `McGurk.Amanda@medicodio.ai`

### Step 4 — Build run folder and write run-state.json

```
slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
runDate = today ISO date (YYYY-MM-DD)
runFolder = "SEO-Content-Writer/agents/seo-blogs/runs/{runDate}-{slug}"
runStatePath = "{runFolder}/run-state.json"
```

Write initial run-state.json:
```json
{
  "schema_version": 1,
  "runDate": "{runDate}",
  "slug": "{slug}",
  "topic": "{topic}",
  "contentBrief": "{brief}",
  "primaryKeyword": "{primary_keyword or inferred from topic}",
  "targetPersona": "RCM Director",
  "category": "{medical_coding or services}",
  "approverEmail": "{approverEmail}",
  "status": "running",
  "conversationId": null,
  "messageId": null,
  "lastCheckedAt": null,
  "revisionCount": 0,
  "maxRevisions": 3,
  "seoScore": null,
  "wordCount": null,
  "publishedAt": null,
  "publishResponseId": null,
  "parentIssueId": "{PAPERCLIP_TASK_ID}",
  "runFolder": "{runFolder}",
  "runStatePath": "{runStatePath}",
  "phases": {
    "research": "pending",
    "write": "pending",
    "seo_check": "pending",
    "email": "pending",
    "publish": "pending",
    "audit": "pending"
  }
}
```

```
sharepoint_write_file path="{runStatePath}" content="{JSON}"
→ IF fails: post blocked "Cannot write run-state.json to {runStatePath}. Check SharePoint permissions." STOP.
```

### Step 5 — Write agent-state.json

Write the runtime state to a dedicated file (separate from config.md which holds static keyword cluster):

```
sharepoint_write_file
  path="SEO-Content-Writer/agent-state.json"
  content: { "activeRunFolder": "{runFolder}" }
→ IF fails: post warning, continue (non-blocking — email-monitor uses this to find the run)
```

### Step 6 — Post bootstrap comment

```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "body": "Pipeline bootstrapped.\nTopic: {topic}\nKeyword: {primaryKeyword}\nCategory: {category}\nApprover: {approverEmail}\nRun folder: {runFolder}\n\nCreating [BLOG-RESEARCH] child now."
}
```

### Step 7 — Create [BLOG-RESEARCH] child and EXIT IMMEDIATELY

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[BLOG-RESEARCH] {topic}",
  "description": "phase_file: routines/bi-weekly-blog-post/research.md\nrun_state_path: {runStatePath}\nparent_issue_id: {PAPERCLIP_TASK_ID}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{PAPERCLIP_TASK_ID}",
  "status": "todo",
  "priority": "high"
}
→ IF fails: retry once. If still fails: post blocked "Failed to create [BLOG-RESEARCH] child: {error}". STOP.
```

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "in_progress", "comment": "[BLOG-RESEARCH] child created. Pipeline running. Orchestrator stays in_progress until AUDIT phase." }
```

⛔ **CRITICAL: Status MUST be `in_progress` — NOT `done`. The orchestrator issue stays open as the pipeline parent. Only the AUDIT phase (last phase) closes it. If you set it to `done` here, you have made an error.**

**YOUR JOB IS DONE. EXIT NOW.**

Do not research. Do not write. Do not run SEO checks. Do not send email. Do not call SharePoint for content. The pipeline advances through child issues only. The next action in this pipeline belongs to the [BLOG-RESEARCH] child heartbeat, not this one.

---

## Error Handling

| Situation | Action |
|---|---|
| `topic:` missing from description | Block parent, STOP |
| Topic slug already in posted log | Close as done, STOP |
| run-state.json write fails | Block parent, STOP |
| agent-state.json write fails | Post warning, continue (non-blocking) |
| Child issue creation fails | Retry once. Block parent with error on second failure |
