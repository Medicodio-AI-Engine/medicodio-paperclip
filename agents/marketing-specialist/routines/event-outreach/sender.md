# Sender — Sufficiency Check + Compose + Send (PHASE 3 + PHASE 4)

**DATA RULE LINE 1:** All row data comes from run-state.json. Do NOT re-read Excel for batch data.
**EMAIL TOOL LINE 2:** `resend_send_email` for direct mode. `outlook_create_draft` for draft_review mode. NEVER use outlook_send_message to deliver email — Resend is the ONLY delivery mechanism.
**WRITE RULE LINE 3:** Write Excel audit for each row IMMEDIATELY after send — before moving to next row.
**STATE:** Reads `batch_loader.has_email_rows[]` + `enricher.enriched_rows[]` + `config.*` from run-state.json.
**CREATES NEXT:** `[EO-AUDITOR]` child issue.
**DO NOT:** Re-run Hunter. Re-read config.md. Read Excel for batch row data.

---

## Step 1 — Load state

```
sharepoint_read_file path="{run_state_path from issue description}"
→ IF missing: post blocked "run-state.json not found at {path}." STOP.
→ extract: batch_loader.has_email_rows[], config.*,
  enricher.enriched_rows[] (may be absent if enricher was skipped),
  event_slug, parent_issue_id
```

Build sendable list:
```
IF run_state.enricher EXISTS AND run_state.enricher.enriched_rows is non-null:
  enricher_rows = enricher.enriched_rows[] filtered to rows where resolved_email is non-empty
ELSE:
  enricher_rows = []   ← enricher was skipped (all rows had email)

sendable = batch_loader.has_email_rows[] + enricher_rows
→ each entry has: excel_row, first_name, last_name, company, title,
  resolved_email (or original email for has_email rows),
  pc_email_source, pc_hunter_method, pc_hunter_confidence, pc_email_risk
```

## Step 2 — Sufficiency check

```
sendable_count = len(sendable)
total_batch    = batch_loader.batch_size_actual

IF total_batch = 0:
  post blocked "batch_size_actual is 0 in run-state.json — batch-loader may have exited early.
  Check parent issue for batch-loader comment." STOP.

send_pct = (sendable_count / total_batch) * 100
```

Post comment regardless of result:
- IF send_pct >= min_send_pct: `Sufficiency check passed: {send_pct:.0f}% have email ({sendable}/{total}). Proceeding.`
- IF send_pct < min_send_pct: `Sufficiency check: {send_pct:.0f}% have email ({sendable}/{total}). Below {min_send_pct}% threshold. Sending to {sendable} — proceeding regardless.`

**Always proceed — partial send is better than no send.**

## Step 3 — Read email template (once, reuse for all rows)

```
sharepoint_read_file
  path="Marketing-Specialist/event-outreach/{event_slug}/{config.email_body_file}"
→ store as email_template_html
```

## Step 4 — Compose and send each row

For each row in sendable:

**Compose subject (mandatory personalisation, max 60 chars):**
- Must reference the event or an in-person meeting
- Angle must match the body's pain point
- If title is missing or unrecognisable → use config.email_subject with placeholder substitution
- No ALL CAPS, no excessive punctuation

**Compose HTML body:**
- Use email_template_html as the guardrail for tone, intent, length (~150 words), and CTA
- Craft a unique version per recipient — adapt the opening hook based on their title (e.g. clinical vs. administrative framing), but use ONLY information from the template and the row data
- NEVER mention their job title explicitly in the body
- NEVER fabricate facts about their company — if you have no company-specific fact, use the template's generic framing unchanged
- Replace all placeholders: {first_name}, {event_name}, {event_dates}, {event_location}, {booth_number}, {company}
- Append mandatory signature block (from AGENTS.md) — verify composed_html ends with `</table>` of signature

**Idempotency check before send — skip if already sent:**
```
sharepoint_excel_read_range
  filePath="Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}"
  sheetName="{config.attendee_sheet}"
  address="{pc_resend_id_col}{row}:{pc_draft_id_col}{row}"
→ IF pc_resend_id OR pc_draft_id is non-empty:
   post warning comment "Row {row} already has resend/draft ID — skipping to prevent duplicate send."
   add row to sent_rows[] with existing ID, continue to next row.
```

**Send:**

IF config.send_mode = "direct":
```
resend_send_email
  from="{config.outlook_user}"
  to="{resolved_email}"
  subject="{composed_subject}"
  html="{composed_html}"
→ capture returned email ID → pc_resend_id
```

IF config.send_mode = "draft_review":
```
outlook_create_draft
  mailbox="{config.outlook_user}"
  to="{resolved_email}"
  subject="{composed_subject}"
  body="{composed_html}"
  bodyType="HTML"
→ capture draft message ID → pc_draft_id
```

**Write to Excel IMMEDIATELY after each send (before moving to next row):**
```
sharepoint_excel_write_range
  filePath="Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}"
  sheetName="{config.attendee_sheet}"
  address="{pc_status_col}{row}:{pc_resend_id_col}{row}"
  values=[[
    "sent",                    ← pc_status (or "draft_created")
    "{pc_email_source}",       ← pc_email_source
    "{resolved_email}",        ← pc_email_used
    "",                        ← pc_draft_created_at (blank for direct)
    "{ISO now}",               ← pc_sent_at (or pc_draft_created_at for draft)
    "{event_slug}",            ← pc_event
    "{pc_draft_id or ''}",     ← pc_draft_id
    "{pc_resend_id or ''}",    ← pc_resend_id
    "{pc_hunter_confidence}",  ← pc_hunter_confidence
    "{pc_hunter_method}",      ← pc_hunter_method
    "{pc_email_risk}",         ← pc_email_risk
    ""                         ← pc_notes (blank on success)
  ]]
→ on error: pc_status="error", pc_notes="{error_message_only}" — NEVER put resend IDs in pc_notes
```

Post progress comment every 10 rows: `Progress: {sent}/{sendable_count} emails {sent/drafted}.`

## Step 5 — Update run-state.json

Append `sender` section:

```json
"sender": {
  "status": "complete",
  "completed_at": "{ISO}",
  "sendable_count": N,
  "sent_count": N,
  "drafted_count": N,
  "error_count": N,
  "send_pct": N,
  "sent_rows": [
    {
      "excel_row": N,
      "email": "...",
      "pc_resend_id": "...",
      "pc_sent_at": "...",
      "pc_email_source": "...",
      "pc_hunter_method": "...",
      "pc_email_risk": "..."
    }
  ],
  "drafted_rows": [
    {
      "excel_row": N,
      "email": "...",
      "pc_draft_id": "...",
      "pc_email_source": "...",
      "pc_hunter_method": "...",
      "pc_email_risk": "..."
    }
  ]
}
```

```
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
→ IF fails: retry once (3s). If still fails: post blocked on this + parent. STOP.
```

Teams notification (non-blocking):
```
teams_send_channel_message
content: "📧 Event Outreach Batch — {event_name} | Sent: {sent} | Drafted: {drafted} | Skipped: {not_found} | Errors: {errors}"
IF fails → add warning to comment and continue.
```

## Step 6 — Create next child issue and close

```
POST /api/companies/{companyId}/issues
{
  "title": "[EO-AUDITOR] Event Outreach — Auditor — {event_slug}",
  "description": "phase_file: routines/event-outreach/auditor.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}\nevent_slug: {event_slug}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
```

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
{ "status": "done", "comment": "Send phase complete. {sent} sent, {drafted} drafted, {errors} errors. [EO-AUDITOR] created." }
```
