# Pre-Check A — Delivery Status

**TOOL RULE LINE 1:** Delivery status source = `resend_get_email` ONLY. Never use Outlook for delivery checks.
**STATE:** Read `run_state_path` from issue description. Write `pre_check_a` section back before creating next child.
**CREATES NEXT:** `[EO-PRE-CHECK-B]` child issue. Exit after child confirmed created.
**DO NOT:** Send emails. Run Hunter. Re-read config.md. Perform any Phase 1–8 work.

---

## Step 1 — Load state

```
sharepoint_read_file path="{run_state_path from issue description}"
→ parse JSON → store as run_state
→ IF file missing: post blocked comment "run-state.json not found at {path}.
  Check parent issue {parent_issue_id} for prior errors." STOP.
→ extract: event_slug, config.attendee_file, config.attendee_sheet
```

## Step 2 — Find candidate rows

```
sharepoint_excel_read_range
  filePath="Marketing-Specialist/event-outreach/{event_slug}/{attendee_file}"
  sheetName="{attendee_sheet}"
  address="A1:ZZ1"                          ← header row only
→ find column letters for: pc_status, pc_delivery_status, pc_resend_id,
  pc_delivery_notes, pc_notes, pc_email_used

sharepoint_excel_read_range
  filePath="Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}"
  sheetName="{config.attendee_sheet}"
  address="{pc_status_col}1:{pc_status_col}2000"
→ count non-empty cells (excl. header) → last_row
→ IF last_row = 0: skip to Step 5 (no prior sends)

sharepoint_excel_read_range
  filePath="Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}"
  sheetName="{config.attendee_sheet}"
  address="{pc_status_col}1:{pc_delivery_status_col}{last_row}"
→ collect row numbers where pc_status = "sent" AND pc_delivery_status is empty
→ IF none found: skip to Step 5
```

## Step 3 — Check delivery for each candidate row

For each candidate row — read pc_resend_id first:

```
sharepoint_excel_read_range address="{pc_resend_id_col}{row}:{pc_resend_id_col}{row}"
```

**IF pc_resend_id non-empty:** call `resend_get_email id="{pc_resend_id}"`

**IF pc_resend_id empty:** read pc_notes for this row. If it contains `resend_id:{uuid}`:
- extract UUID → use as resend_id → call `resend_get_email`
- write extracted UUID to pc_resend_id column for this row immediately

**IF pc_resend_id empty AND no pattern in pc_notes:**
- pc_delivery_status = "unknown"
- pc_delivery_notes = "no resend_id stored — email sent before Resend ID tracking was added"
- no API call

Map `last_event` → columns:

| last_event | pc_delivery_status | pc_delivery_notes |
|------------|-------------------|-------------------|
| delivered | delivered | (blank) |
| opened | delivered | opened |
| clicked | delivered | clicked |
| bounced | bounced | Bounce reported by Resend |
| complained | complained | Spam complaint |
| queued / sent | (leave blank) | (leave blank — in transit) |
| API error | (leave blank) | Resend API error: {error} |

## Step 4 — Write delivery results to Excel

```
sharepoint_excel_write_range  ← one call per updated row
  filePath="Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}"
  sheetName="{config.attendee_sheet}"
  address="{pc_delivery_status_col}{row}:{pc_delivery_notes_col}{row}"
  values=[["{status}", "{notes}"]]
```

## Step 5 — Update run-state.json and post comment

Append `pre_check_a` section to run_state JSON:

```json
"pre_check_a": {
  "status": "complete",
  "completed_at": "{ISO timestamp}",
  "last_row": N,
  "delivered_count": N,
  "bounced_count": N,
  "complained_count": N,
  "unknown_count": N,
  "in_transit_count": N
}
```

```
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
→ IF write fails: retry once after 3s
→ IF still fails: post blocked comment on this issue AND on parent {parent_issue_id}.
  Set this issue → blocked. Do NOT create next child. STOP.
```

Post comment:
```
PRE-CHECK A: {delivered} delivered, {bounced} bounced, {complained} complained,
{unknown} unknown (no resend_id), {in_transit} still in transit.
```

## Step 6 — Create next child issue and close

```
POST /api/companies/{companyId}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[EO-PRE-CHECK-B] Event Outreach — Pre-Check B — {event_slug}",
  "description": "phase_file: routines/event-outreach/pre-check-b.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}\nevent_slug: {event_slug}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
→ IF creation fails: retry once. If still fails: post blocked comment with API error. STOP.
```

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done", "comment": "Pre-Check A complete. Next: [EO-PRE-CHECK-B] created." }
```
