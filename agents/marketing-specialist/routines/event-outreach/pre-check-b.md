# Pre-Check B — Reply Detection

**TOOL RULE LINE 1:** Inbox scan = `outlook_list_messages` ONLY. Never send emails in this phase.
**STATE:** Read `run_state_path` from issue description. Write `pre_check_b` section back before creating next child.
**CREATES NEXT:** `[EO-BATCH-LOADER]` child issue. Exit after child confirmed created.
**DO NOT:** Run Hunter. Compose outreach emails. Re-read config.md. Perform any Phase 1–8 work.

---

## Step 1 — Load state

```
sharepoint_read_file path="{run_state_path from issue description}"
→ parse JSON → store as run_state
→ IF file missing: post blocked "run-state.json not found at {path}." STOP.
→ extract: event_slug, config.outlook_user, config.review_email,
  config.event_name, config.attendee_file, config.attendee_sheet
```

## Step 2 — Find sent emails not yet checked for replies

```
sharepoint_excel_read_range
  filePath="Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}"
  sheetName="{config.attendee_sheet}"
  address="A1:ZZ1"   ← header row
→ find column letters for: pc_status, pc_email_used, pc_reply_received,
  pc_reply_intent, pc_reply_snippet, first_name, last_name, job_title, organization_name

last_row = IF run_state.pre_check_a.last_row exists THEN run_state.pre_check_a.last_row
           ELSE: sharepoint_excel_read_range
                   filePath="Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}"
                   sheetName="{config.attendee_sheet}"
                   address="{first_name_col}1:{first_name_col}2000"
                 → count non-empty (excl. header) → last_row

sharepoint_excel_read_range
  filePath="Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}"
  sheetName="{config.attendee_sheet}"
  address="{pc_email_used_col}1:{pc_reply_received_col}{last_row}"   ← 2 cols, row-bounded
→ collect all rows where pc_email_used is non-empty AND pc_reply_received is empty
→ build: candidate_emails = { email_address: row_number }
→ IF empty: skip to Step 5
```

## Step 3 — Scan Outlook inbox

```
outlook_list_messages
  mailbox="{config.outlook_user}"
  folder="Inbox"
  top=100
→ filter to messages received in last 7 days
→ for each message: check if sender address matches any key in candidate_emails
→ collect matches: [ { row, sender, subject, body_preview } ]
→ IF no matches: skip to Step 5
```

## Step 4 — Classify and write reply data

For each matched message — read first 500 chars of body if body_preview is short.

Classify intent (use subject + body). When the message is non-English, heavily HTML-encoded, or an ambiguous multi-thread reply chain → classify as `uncertain`.

| Signal | Intent |
|--------|--------|
| demo, meeting, call, interested, learn more, schedule, curious | demo_interest |
| unsubscribe, remove me, opt out, stop emailing | unsubscribe |
| out of office, OOO, away, vacation, maternity, paternity, annual leave | out_of_office |
| thanks, looks good, great, will share, forwarding | positive |
| not interested, no thanks, wrong person, irrelevant, please stop | negative |
| non-English, unreadable encoding, ambiguous multi-thread | uncertain |
| anything else | neutral |

Write to Excel for each matched row:
```
sharepoint_excel_write_range
  filePath="Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}"
  sheetName="{config.attendee_sheet}"
  address="{pc_reply_received_col}{row}:{pc_reply_snippet_col}{row}"
  values=[["yes", "{intent}", "{first 100 chars of body}"]]
```

For rows classified as `unsubscribe` — ALSO write pc_status to lock row from future batches:
```
sharepoint_excel_write_range
  filePath="Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}"
  sheetName="{config.attendee_sheet}"
  address="{pc_status_col}{row}:{pc_notes_col}{row}"
  values=[["unsubscribed", "", "", "", "", "", "", "", "", "", "", "opt-out received"]]
```

For any row classified as `demo_interest`:
```
resend_send_email
  from="{config.outlook_user}"
  to="{config.review_email}"
  subject="[{config.event_name}] Demo interest — {first_name} {last_name} ({organization_name})"
  html="<p><strong>{first_name} {last_name}</strong> ({job_title}, {organization_name}) replied with interest.</p>
        <p><strong>Email:</strong> {pc_email_used}</p>
        <p><strong>Reply:</strong> {reply_snippet}</p>
        <p>Follow up promptly — warm lead.</p>"
```

## Step 5 — Update run-state.json and post comment

Append `pre_check_b` to run_state:

```json
"pre_check_b": {
  "status": "complete",
  "completed_at": "{ISO}",
  "reply_count": N,
  "demo_interest_count": N,
  "out_of_office_count": N,
  "unsubscribe_count": N,
  "other_count": N
}
```

```
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
→ IF fails: retry once (3s). If still fails: post blocked on this + parent. Set blocked. STOP.
```

Post comment:
```
PRE-CHECK B: {reply_count} replies found.
Demo interest: {demo} | OOO: {ooo} | Unsubscribe: {unsub} | Other: {other}
{demo > 0 ? "Warm leads notified to {review_email}." : ""}
MANDATORY: Proceeding to batch load. PRE-CHECKs are maintenance only — outreach pipeline starts next.
```

## Step 6 — Create next child issue and close

```
POST /api/companies/{companyId}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[EO-BATCH-LOADER] Event Outreach — Batch Loader — {event_slug}",
  "description": "phase_file: routines/event-outreach/batch-loader.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}\nevent_slug: {event_slug}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
```

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done", "comment": "Pre-Check B complete. Next: [EO-BATCH-LOADER] created." }
```
