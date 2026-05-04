# Auditor — Audit Write + Run Log + Close (PHASE 5 + PHASE 8)

**BOUNDARY LINE 1:** Do NOT resend emails. Do NOT run Hunter. Do NOT create more child issues after this phase.
**SOURCE OF TRUTH LINE 2:** run-state.json is the single source of truth. Do not re-derive stats from Excel.
**SAFETY CHECK LINE 3:** If sender.sent_count > 0 but sender.sent_rows[] is empty → HALT (state corrupted).
**STATE:** Reads ALL sections of run-state.json. Writes auditor section + closes parent.
**LAST PHASE:** No next child issue. This phase closes everything.

---

## Step 1 — Load state and safety check

```
sharepoint_read_file path="{run_state_path from issue description}"
→ IF missing: post blocked "run-state.json not found at {path}." STOP.
→ parse full JSON → run_state
```

Safety check:
```
IF run_state.sender.sent_count > 0 AND len(run_state.sender.sent_rows) = 0:
  post blocked:
  "HALT: sent_rows[] is empty but sent_count > 0. State inconsistency — run-state.json may be
  corrupted. Do not write audit columns without verifying which rows were actually sent.
  Check Excel pc_resend_id column manually to reconstruct sent list."
  STOP.
```

## Step 2 — Write remaining audit columns

The sender already wrote all 12 audit columns including: pc_status, pc_email_source, pc_email_used,
pc_sent_at, pc_event, pc_draft_id, pc_resend_id, pc_hunter_confidence, pc_hunter_method, pc_email_risk, pc_notes.
These fields are also present in sender.sent_rows[] / sender.drafted_rows[] — auditor can source them
from run-state.json without re-reading Excel.

For rows in enricher.failed_rows[] where pc_status was written during enricher:
- verify they already have pc_status set in Excel (spot-check via single-row read with filePath+sheetName)
- if missing: write pc_status + pc_notes now

For rows in batch_loader.need_email_rows[] that have no enricher entry (shouldn't happen, but guard):
```
Use controlled reason vocabulary only — do NOT generate free-text reasons.
Allowed pc_notes values: "email_not_found", "domain_not_found", "hunter_credits_exhausted",
  "undeliverable", "enricher_skipped", "no_enricher_result_for_row"
→ write pc_status="email_not_found", pc_notes="no_enricher_result_for_row"
```

## Step 3 — Spot-check rows

```
spot_count = min(3, len(sender.sent_rows[]))
IF spot_count = 0: skip this step (nothing was sent).
ELSE: pick {spot_count} random rows from sender.sent_rows[]:

sharepoint_excel_read_range
  filePath="Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}"
  sheetName="{config.attendee_sheet}"
  address="{pc_status_col}{row}:{pc_resend_id_col}{row}"
→ confirm pc_status = "sent" and pc_resend_id is non-empty
→ log: "Excel audit write verified: {spot_count} row(s) spot-checked — confirmed."
→ IF any row shows empty pc_status: post warning comment but continue (non-blocking)
```

## Step 4 — Handle draft_review reviewer notification (if applicable)

IF config.send_mode = "draft_review" AND sender.drafted_count > 0:

```
Dedup guard — check for existing open approval before creating a new one:
GET /api/companies/{companyId}/approvals?issueId={parent_issue_id}&status=pending
→ IF any approval is already pending for this parent issue:
   post comment "Approval already pending for {parent_issue_id} — skipping duplicate approval creation."
   PATCH parent → in_review (if not already). Continue to Step 5. Skip resend_send_email.

ELSE: proceed with notification and approval below.

NOTE on Resend sender verification: config.outlook_user (e.g. marketing@medicodio.site) must be
a verified sender domain in the Resend account. If this send fails with a 422 or "sender not verified"
error, post warning comment "Reviewer notification failed — {error}. Approval request still posted.
Manual notification required to {review_email}." and continue.

resend_send_email
  from="{config.outlook_user}"
  to="{config.review_email}"
  subject="[{config.event_name}] {drafted_count} outreach drafts ready for review — {today}"
  html:
    <p>{drafted_count} outreach emails drafted for <strong>{event_name}</strong>.</p>
    {summary table: first_name | last_name | company | draft_id — one row per drafted email}
    <p>Review drafts in Outlook, then approve or reject in Paperclip.</p>
→ IF fails: post warning but continue — approval request must still be created

POST /api/companies/{companyId}/approvals
{
  "type": "request_board_approval",
  "requestedByAgentId": "{PAPERCLIP_AGENT_ID}",
  "issueIds": ["{parent_issue_id}"],
  "payload": {
    "title": "Review and approve {drafted_count} outreach drafts for {event_name}",
    "summary": "Drafts created for {drafted_count} attendees. Review in Outlook then approve to send.",
    "recommendedAction": "Approve to send via Resend. Reject with note to skip."
  }
}

PATCH /api/issues/{parent_issue_id}
{ "status": "in_review", "comment": "{drafted_count} drafts awaiting review." }
```

## Step 5 — Write run log to SharePoint

Extract from run_state:
```
run_id_safe    = run_state.run_id_safe
detail_log_path = "Marketing-Specialist/event-outreach/{event_slug}/run-logs/runs/{run_id_safe}.md"
daily_log_path  = "Marketing-Specialist/event-outreach/{event_slug}/run-logs/{YYYY-MM-DD}.md"
```

**5a — Write detail log (once, never overwritten):**
```
sharepoint_write_file
  path="{detail_log_path}"
  content:
---
# Event Outreach Run — {config.event_name}
**Run ID:** {run_id_safe}
**Date:** {YYYY-MM-DD HH:MM UTC}
**Parent Issue:** {parent_issue_id}

## Config Used
| Key | Value |
|-----|-------|
| event_name | {event_name} |
| attendee_file | {attendee_file} |
| batch_size | {batch_size} |
| send_mode | {send_mode} |
| min_send_pct | {min_send_pct}% |

## Results
| Metric | Count |
|--------|-------|
| Batch size | {batch_size_actual} |
| Had email (original) | {len(has_email_rows)} |
| Hunter found | {enricher.hunter_found_count} |
| Pattern guessed | {enricher.guessed_count} |
| Not found | {enricher.not_found_count} |
| Domain not found | {enricher.domain_not_found_count} |
| Sent / Drafted | {sender.sent_count + sender.drafted_count} |
| Errors | {sender.error_count} |
| Send % | {sender.send_pct:.0f}% |

## Rows Not Emailed
{table: excel_row | name | company | reason}
Reason values MUST be one of: email_not_found | domain_not_found | hunter_credits_exhausted | undeliverable | enricher_skipped | error
Do NOT write free-text explanations in the reason column.

## Pre-Check Summary
- Delivery updates: {pre_check_a stats}
- Inbox replies: {pre_check_b stats}
---
```

**5b — Append row to daily summary:**
```
sharepoint_read_file path="{daily_log_path}"
→ IF missing: initialise content as:
  "# Daily Run Summary — {YYYY-MM-DD}\n\n| Time (UTC) | Event | Batch | Sent | Not Found | Errors | Detail |\n|---|---|---|---|---|---|---|\n"
→ append one row:
  "| {HH:MM} | {event_slug} | {batch_size_actual} | {sent+drafted} | {not_found} | {errors} | [view](runs/{run_id_safe}.md) |\n"
sharepoint_write_file path="{daily_log_path}" content="{updated}"
→ IF either write fails: post warning comment but continue — do NOT block on log failure.
```

## Step 6 — Finalise run-state.json and post summary

Append `auditor` section:

```json
"auditor": {
  "status": "complete",
  "completed_at": "{ISO}",
  "rows_written": N,
  "run_log_path": "{detail_log_path}"
},
"pipeline_status": "complete"
```

```
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
```

Post final comment on PARENT issue (not child):
```
POST /api/issues/{parent_issue_id}/comments
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "body": "Run complete for {event_name}.\nSent/Drafted: {sent+drafted} | Not found: {not_found} | Errors: {errors}\nDetail log: {detail_log_path}\nDaily summary: {daily_log_path}"
}
```

Teams notification (non-blocking):
```
teams_send_channel_message
content: "✅ Event Outreach Complete — {event_name} | Sent: {sent} | Enriched: {hunter_found} | Skipped: {not_found} | Errors: {errors}"
IF fails → add warning to this issue's comment and continue.
```

## Step 7 — Close both issues

IF config.send_mode = "direct":
```
PATCH /api/issues/{parent_issue_id}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done" }
```
(If draft_review: parent already set to in_review in Step 4 — do NOT change status here.)

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done", "comment": "Audit complete. Pipeline closed." }
```

✓ PIPELINE COMPLETE.
