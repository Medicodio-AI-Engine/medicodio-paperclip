# Batch Loader — Config + Batch Selection (PHASE 0 + PHASE 1)

**WARNING LINE 1:** `last_row` MUST come from `{first_name_col}1:{first_name_col}2000`. NEVER from pc_status column. pc_status column only covers already-processed rows — it is far smaller than true attendee count.
**STATE:** Config already in run-state.json from orchestrator. Do NOT re-read config.md from SharePoint.
**CREATES NEXT:** `[EO-ENRICHER]` if need_email rows exist. `[EO-SENDER]` directly if all rows have email.
**DO NOT:** Run Hunter. Send emails. Re-read config.md.

---

## Step 1 — Load state

```
sharepoint_read_file path="{run_state_path from issue description}"
→ parse JSON → store as run_state
→ IF file missing: post blocked "run-state.json not found at {path}." STOP.
→ extract config.* (all 14 fields), event_slug, parent_issue_id
```

## Step 2 — Verify attendee file exists

```
sharepoint_get_file_info
  path="Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}"
→ IF not found: post blocked "Attendee file not found:
  Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}" STOP.
```

## Step 3 — Read header row and determine last_row

```
sharepoint_excel_read_range
  filePath="Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}"
  sheetName="{config.attendee_sheet}"
  address="A1:ZZ1"
→ identify column letters for all canonical fields (use inference rules from column-map.md if cached)

sharepoint_excel_read_range address="{first_name_col}1:{first_name_col}2000"
→ count non-empty cells (excluding header) → last_row   ← THIS IS THE TRUE LAST ROW
```

## Step 4 — Load or generate column map

```
sharepoint_get_file_info
  path="Marketing-Specialist/event-outreach/{event_slug}/column-map.md"
```

**IF exists AND contains `prior_delivery_status` AND `pc_resend_id`:**
```
sharepoint_read_file path="Marketing-Specialist/event-outreach/{event_slug}/column-map.md"
→ parse each line: canonical_field: header | column_index
→ build column_map in memory
```

**IF missing or stale (missing required fields):** Parse headers from Step 3 result using canonical field inference rules (see event-outreach.md for inference table). Write column-map.md to SharePoint. Post comment: "First run: column map generated."

## Step 5 — Sanity check

```
sharepoint_excel_read_range address="{pc_email_used_col}1:{pc_email_used_col}{last_row}"
→ count non-empty → email_written_count

sharepoint_excel_read_range address="{pc_status_col}1:{pc_status_col}{last_row}"
→ count non-empty → known_processed_count
```

IF known_processed_count = 0 AND email_written_count > 0:
```
HALT — post blocked:
"HALT: pc_status column appears empty but pc_email_used has {email_written_count} values.
Column mapping is likely wrong. Check column-map.md and verify pc_status column letter.
Do NOT proceed — risk of re-sending to already-processed rows."
STOP.
```

## Step 6 — Find next batch of eligible rows

A row is ELIGIBLE if AND ONLY IF ALL of the following:
- pc_status is EMPTY or "pending" (not sent/draft_created/skipped/email_not_found/domain_not_found/error/unsubscribed)
- AND prior_delivery_status ≠ "sent" (never re-process rows sent by prior system)
- AND pc_reply_intent ≠ "unsubscribe" (never re-contact opted-out contacts — compliance rule)

A row is SKIPPED (write nothing to it) if:
- prior_delivery_status = "sent" — leave ALL pc_* columns untouched

```
Read pc_status + prior_delivery_status + pc_reply_intent columns (row-bounded, narrow slices)
→ collect first {config.batch_size} eligible rows in ascending row order
→ IF zero eligible rows:
   Write batch_loader section to run-state.json FIRST (required for audit completeness):
   {
     "batch_loader": {
       "status": "complete_zero_eligible",
       "completed_at": "{ISO}",
       "last_row": {last_row},
       "batch_size_actual": 0,
       "has_email_rows": [],
       "need_email_rows": []
     }
   }
   Post comment "All attendees processed for {config.event_name}. Nothing to do."
   PATCH parent issue → done
   PATCH this issue → done
   STOP.
```

For each eligible row — read name + contact columns:
```
sharepoint_excel_read_range address="{first_name_col}{row}:{title_col}{row}"
sharepoint_excel_read_range address="{email_col}{row}:{email_col}{row}"
sharepoint_excel_read_range address="{domain_col}{row}:{domain_col}{row}"  ← if domain_col ≥ 0
```

Build two arrays:
- `has_email_rows[]` — rows where email column is non-empty
- `need_email_rows[]` — rows where email column is empty

Each row object includes: `excel_row`, `first_name`, `last_name`, `name_prefix` (if present), `middle_name` (if present), `company`, `title`, `email` (or null), `domain` (or null).

For every entry in `has_email_rows[]` — set `pc_email_source = "original"` on the object.
For every entry in `need_email_rows[]` — set `domain: null` explicitly if domain column is empty (never leave domain field absent — enricher relies on it to know whether to skip WebSearch).

## Step 7 — Update run-state.json

Append `batch_loader` section:

```json
"batch_loader": {
  "status": "complete",
  "completed_at": "{ISO}",
  "last_row": {last_row},
  "batch_size_actual": {len(has_email_rows) + len(need_email_rows)},
  "has_email_rows": [ ...full row objects... ],
  "need_email_rows": [ ...full row objects... ]
}
```

```
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
→ IF fails: retry once (3s). If still fails: post blocked on this + parent. STOP.
```

Post comment:
```
Batch loaded: {total} rows | Has email: {len(has_email_rows)} | Missing email: {len(need_email_rows)}
```

## Step 8 — Create next child issue and close

**IF need_email_rows is non-empty → create `[EO-ENRICHER]`:**
```
POST /api/companies/{companyId}/issues
{
  "title": "[EO-ENRICHER] Event Outreach — Enricher — {event_slug}",
  "description": "phase_file: routines/event-outreach/enricher.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}\nevent_slug: {event_slug}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
```

**IF need_email_rows is empty → skip enricher, create `[EO-SENDER]` directly:**
```
POST /api/companies/{companyId}/issues
{
  "title": "[EO-SENDER] Event Outreach — Sender — {event_slug}",
  "description": "phase_file: routines/event-outreach/sender.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}\nevent_slug: {event_slug}",
  ...
}
```

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
{ "status": "done", "comment": "Batch loaded. Next child created." }
```
