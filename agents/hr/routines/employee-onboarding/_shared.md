# Shared Conventions — Employee Onboarding

**Purpose:** Single source of truth for conventions every phase file relies on. Phase files reference sections here by name — they MUST NOT duplicate the rules below.

**Never edit this file from inside a phase run.** It is read-only at runtime.

---

## §1. Timestamp Format

All timestamps MUST be ISO-8601 UTC: `YYYY-MM-DDTHH:MM:SSZ`
Example: `2026-04-23T09:15:00Z`
Never use local time. Never use ambiguous formats.

---

## §2. Government ID Masking

NEVER output, log, comment, or include in any email the digits of Aadhaar, PAN, or any government-issued ID.

| Allowed | Forbidden |
|---|---|
| `"Aadhaar received ✓"` | `"Aadhaar: 1234 5678 9012"` |
| `"PAN card on file"` | `"PAN: ABCDE1234F"` |
| `[REDACTED]` in exception notes | Last 4 digits, first 4 digits, full ID |

Applies to: audit-log rows, issue comments, email bodies, case-tracker, exception notes, Teams notifications.

---

## §3. Audit Log — Format

**File:** `HR-Onboarding/audit-log.csv`
**Delimiter:** pipe `|` ONLY. Never comma.

**Header row** (written once at file creation, never rewritten):
```
timestamp|case_id|employee_email|employee_full_name|employee_type|human_in_loop_email|recruiter_or_hr_name|current_status|event|action_taken|brief_reason|paperclip_issue_id|email_tool
```

**Every appended row MUST have all 13 columns.** Use `—` (em-dash) for fields that genuinely do not apply. Never leave a field blank.

```
{timestamp}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|{current_status}|{event}|{action_taken}|{brief_reason}|{paperclip_issue_id}|{email_tool}
```

**Column 13 — `email_tool`** (added 2026-05-13). Valid values:
- `outlook` — row written after a successful `outlook_send_email` / `outlook_reply` / `outlook_forward`.
- `resend` — row written after `resend_send_email` / `resend_send_batch` (bulk only per AGENTS.md).
- `—` — non-email events (folder created, attachment uploaded, heartbeat tick, etc.).

Source of truth: the MCP tool that actually returned 2xx for the send. If the row records an email-send failure (`event=email_send_failed`), `email_tool` is the tool that was attempted.

**Legacy rows (< 13 columns):** treat as valid, preserve as-is. Append new rows with all 13 columns. Never rewrite or pad old rows. Parsers MUST tolerate rows with 11 or 12 columns and treat the missing fields as `unknown` (col-13) or `—` (col-12).

---

## §4. Audit Log — Append Pattern

Only this pattern is allowed:

```
1. sharepoint_read_file path="HR-Onboarding/audit-log.csv"
2. Append new line (13 pipe-delimited columns) to end of content
3. sharepoint_write_file path="HR-Onboarding/audit-log.csv" content="{full updated content}"
```

Never write a partial file. Never use any tool that streams CSV rows. Always read → append → write full content.

If `sharepoint_read_file` fails because file does not exist → create with header row, then append. If write fails after retry → notify human_in_loop_email, set phase status = blocked, STOP.

---

## §5. Status Transition Table

Every audit-log row's `current_status` MUST match this table for the given `event`. Never guess. Never invent a status.

| Event | `current_status` to write |
|-------|--------------------------|
| `case_created` | `initiated` |
| `initial_email_sent` | `initial_email_sent` |
| `awaiting_reply` | `awaiting_document_submission` |
| `candidate_acknowledged` | `candidate_acknowledged` |
| `reminder_1_sent` | `awaiting_document_submission` |
| `reminder_2_sent` | `awaiting_document_submission` |
| `reply_detected` | `awaiting_document_submission` |
| `reply_from_alternate_sender` | `awaiting_document_submission` |
| `partial_submission_received` | `partial_submission_received` |
| `complete_submission_received` | `complete_submission_received` |
| `under_automated_review` | `under_automated_review` |
| `discrepancy_found` | `discrepancy_found` |
| `resubmission_requested` | `awaiting_resubmission` |
| `human_notified` | (unchanged — do not write a new status) |
| `human_approved` | `verified_by_human` |
| `sharepoint_folder_created` | `initiated` |
| `files_uploaded` | `uploaded_to_sharepoint` |
| `case_completed` | `completed` |
| `case_stalled` | `stalled` |
| `case_cancelled` | `cancelled` |
| `case_withdrawn` | `withdrawn` |
| `escalated` | `escalated` |
| `heartbeat_tick` | (unchanged) |
| `heartbeat_skip` | (unchanged) |
| `approval_polled` | (unchanged) |
| `approval_approved` | `verified_by_human` |
| `phase_started` | (unchanged) |
| `phase_completed` | (unchanged) |
| `phase_blocked` | `blocked` |
| `email_send_failed` | `blocked` |
| `duplicate_workflow_detected` | `blocked` |
| `sharepoint_upload_in_progress` | `sharepoint_upload_in_progress` |
| `form_reprompt_sent` | `awaiting_document_submission` |
| `hrms_form_submitted` | `hrms_form_submitted` |
| `approval_rejected` | `escalated` |
| `approval_withdrawn` | `escalated` |
| `it_setup_retry` | (unchanged) |
| `parent_patch_retry` | (unchanged) |
| `orphan_raw_archived` | (unchanged) |

**Special case — `reply_detected` with terminal classification:**
When a candidate reply is classified as `withdrawal` or `cancellation` (see `process-reply.md` Step 4d), the `reply_detected` row written by Step 6c MUST still map to `awaiting_document_submission` per this table. The terminal status is set by the SECOND row that Step 6c writes (`event = case_withdrawn` → `withdrawn`, or `event = case_cancelled` → `cancelled`). The two rows together preserve §5 consistency.

**Special case — "latest current_status" rule for heartbeat:**
`email-heartbeat.md` STEP 1 groups audit-log rows by `case_id` and reads "the most recent row's `current_status` COLUMN (column 8) verbatim, regardless of `event`." That means rows with events `(unchanged)` carry forward the prior status in column 8 — they do NOT carry the literal string `(unchanged)`. Example:

```
2026-05-01T10:00:00Z|jane@x.com-2026-05-01|...|complete_submission_received|complete_submission_received|...
2026-05-01T10:00:05Z|jane@x.com-2026-05-01|...|awaiting_human_verification|human_notified|...
2026-05-01T10:30:00Z|jane@x.com-2026-05-01|...|awaiting_human_verification|approval_polled|...
```

Latest column-8 value = `awaiting_human_verification` (NOT `complete_submission_received`, NOT `(unchanged)`). Writers of `(unchanged)` events MUST copy the prior status forward into column 8.

---

## §6. Status Model (full lifecycle)

```
initiated
  → initial_email_sent
  → awaiting_document_submission
  → candidate_acknowledged
  → partial_submission_received
  → complete_submission_received
  → under_automated_review
  → discrepancy_found
  → awaiting_resubmission
  → awaiting_human_verification
  → verified_by_human
  → sharepoint_upload_in_progress
  → uploaded_to_sharepoint
  → completed
```

**Exception statuses (terminal):** `stalled` | `escalated` | `withdrawn` | `cancelled` | `blocked`

---

## §7. HTML Email Rule

Every email sent by any onboarding phase MUST use `isHtml: true`.
Use `<p>` for paragraphs, `<ol><li>` for numbered lists, `<ul><li>` for bullets, `<strong>` for bold, `<br>` for signature line breaks.
Never send plain text. Never inline-style.

---

## §8. Binary File Uploads — CRITICAL

When transferring a PDF, image, or any non-text file from Outlook to SharePoint, ALWAYS use:

```
sharepoint_transfer_from_outlook
  messageId    = "{messageId}"
  attachmentId = "{attachmentId}"
  destPath     = "HR-Onboarding/{full_path}/{filename}"
  mimeType     = "{detected MIME type}"
```

One call. Server-side stream. Binary bytes never enter the context window.

**Forbidden combination:** `outlook_read_attachment` + `sharepoint_upload_binary`. Base64 truncates above ~75 KB. Files corrupt silently.

**Retry policy:** on HTTP 429 or 503, wait 10s, retry up to 3 times total. On 3rd failure, escalate (notify human_in_loop_email, audit-log row with `event=escalated`), continue to next file.

**Post-upload integrity check:** after every transfer, call `sharepoint_get_file_info` on the dest path. Confirm `size > 0`. If size is 0 or file not found → delete the empty file, escalate, continue.

**Duplicate filename handling:** if a file with the same name already exists at the destination, append a timestamp suffix before the extension. Example: `Aadhaar.pdf` → `Aadhaar_2026-04-23T09-15-00Z.pdf`. Never silently overwrite.

---

## §9. `outlook_read_attachment` — Two-Context Rule

This tool has two completely opposite usage rules depending on context. Read carefully.

### §9.1 — Phase 5 (Document Validation) — MANDATORY

In Phase 5 (`validate-docs.md`), `outlook_read_attachment` MUST be called on EVERY image and PDF attachment before any validation check. This is the only way Claude can visually inspect document content.

- Skipping this call = the document was never validated. Filename and size alone are NOT validation.
- Apply to: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.pdf`, `.docx`.
- Do NOT apply to `.zip` or `.rar` — flag those immediately, ask candidate to re-send unzipped.

### §9.2 — Phase 9 (SharePoint Upload) — FORBIDDEN

In Phase 9 (`upload-sharepoint.md`) and the auto-upload step inside Phase 7 (`complete-submission.md`), `outlook_read_attachment` MUST NEVER be used for uploading. Use `sharepoint_transfer_from_outlook` (see §8).

The §9.2 forbidden rule applies EXCLUSIVELY to uploads. It does NOT override the §9.1 mandatory rule.

---

## §10. SharePoint Base Path

```
HR-Onboarding/{employee_full_name} - {date_of_joining}/
```

Subfolders (created in Phase 1):
- `01_Raw_Submissions/` — original bytes from candidate, uploaded immediately on receipt.
- `02_Verified_Documents/` — clean copies after validation passed.
- `03_Exception_Notes/` — `discrepancy-log.md`, escalation notes.

Per-case files at root:
- `case-tracker.md` — human-readable per-person tracker (see §13).
- `run-state.json` — machine-readable pipeline state (see §12).

Global file at HR-Onboarding root:
- `audit-log.csv` — append-only event log across all cases (see §3).

---

## §11. Case ID (Idempotency Key)

```
case_id = "{employee_email}-{date_of_joining}"
```

Example: `jane.doe@example.com-2026-05-01`

### Rehire collision handling

If a `completed` case already exists for the same `employee_email + date_of_joining`:
- Suffix the case_id with `-rehire-{N}`, starting at 1 and incrementing if the previous rehire ID also exists.
- Example: `jane.doe@example.com-2026-05-01-rehire-1`
- Notify `human_in_loop_email` (see `_email-templates.md § REHIRE_COLLISION_ALERT`) before proceeding.
- Use the suffixed case_id for ALL subsequent audit-log rows and SharePoint paths in this run.

### Exact rehire path format

```
case_id        = "{employee_email}-{date_of_joining}-rehire-{N}"
base_folder    = "HR-Onboarding/{employee_full_name} - {date_of_joining}-rehire-{N}"
run_state_path = "{base_folder}/run-state.json"
case_tracker_path = "{base_folder}/case-tracker.md"
```

Examples (N=1):
- `case_id = "jane.doe@example.com-2026-05-01-rehire-1"`
- `base_folder = "HR-Onboarding/Jane Doe - 2026-05-01-rehire-1"`

**Phase files MUST NOT recompute `base_folder` from `{employee_full_name}` + `{date_of_joining}` themselves.** The orchestrator stores `base_folder`, `run_state_path`, and `case_tracker_path` at the TOP LEVEL of `run-state.json` (see §12). Every phase reads those values directly. This is the only safe way to handle rehire suffixes.

### Heartbeat rehire parsing

`email-heartbeat.md` reads `case_id` from the audit-log and MUST parse it with this regex:
```
^(.+@.+)-(\d{4}-\d{2}-\d{2})(?:-rehire-(\d+))?$
```
Groups: `email`, `date_of_joining`, `rehire_N` (may be null).
The heartbeat computes `base_folder` as:
- `"HR-Onboarding/{employee_full_name} - {date_of_joining}"` if `rehire_N` is null.
- `"HR-Onboarding/{employee_full_name} - {date_of_joining}-rehire-{rehire_N}"` if present.

The heartbeat then reads `run-state.json` from `{base_folder}/run-state.json` and uses the `base_folder` / `run_state_path` / `case_tracker_path` stored INSIDE run-state.json for any subsequent path operations (defensive — orchestrator-stored paths are authoritative).

---

## §12. `run-state.json` Schema

Path: `{base_folder}/run-state.json` where `base_folder` follows the rehire-aware format in §11.

Created by orchestrator (Phase 0). Read + updated by every phase. Never deleted.

**Field annotations:**
- `(required)` — always present, never null.
- `(optional)` — may be absent or null at parse time. Phase files MUST handle absent/null gracefully.
- `(populated by phase N)` — added by that specific phase; absent before that phase ran.

```json
{
  "schema_version": 1,                                          // (required)
  "case_id": "{case_id}",                                       // (required) — rehire-aware per §11
  "parent_issue_id": "{paperclip_issue_id of orchestrator wake}", // (required)
  "base_folder": "HR-Onboarding/{employee_full_name} - {date_of_joining}{-rehire-N if applicable}",  // (required) — phase files read this, do NOT recompute
  "run_state_path": "{base_folder}/run-state.json",             // (required)
  "case_tracker_path": "{base_folder}/case-tracker.md",         // (required)
  "created_at": "{ISO timestamp}",                              // (required)
  "last_updated": "{ISO timestamp}",                            // (required)
  "current_phase": "validate_inputs | send_initial | await_reply | process_reply | validate_docs | request_resubmission | complete_submission | awaiting_approval | upload_sharepoint | close_case | closed | closed_withdrawn | closed_cancelled",  // (required)
  "phases_complete": [],                                        // (required) — array of phase names
  "payload": {
    "employee_full_name": "...",                                // (required)
    "employee_email": "...",                                    // (required)
    "role": "...",                                              // (required)
    "employee_type": "intern | fresher | fte | experienced | contractor | rehire",  // (required)
    "date_of_joining": "YYYY-MM-DD",                            // (required)
    "recruiter_or_hr_name": "...",                              // (required)
    "recruiter_or_hr_email": "...",                             // (required)
    "human_in_loop_name": "...",                                // (required)
    "human_in_loop_email": "...",                               // (required)
    "phone_number": "...",                                      // (optional) — may be "pending — requested via email" after Phase 1 Step 2a
    "alternate_candidate_email": "...",                         // (optional, nullable)
    "date_of_birth": "YYYY-MM-DD",                              // (optional, nullable) — Phase 5 identity check skipped if null
    "permanent_address": "...",                                 // (optional, nullable)
    "temporary_address": "...",                                 // (optional, nullable)
    "hiring_manager_name": "...",                               // (optional, nullable)
    "hiring_manager_email": "...",                              // (optional, nullable) — used by heartbeat 14-day escalation if present
    "business_unit": "...",                                     // (optional, nullable)
    "location": "...",                                          // (optional, nullable)
    "joining_mode": "...",                                      // (optional, nullable)
    "notes_from_hr": "...",                                     // (optional, nullable)
    "special_document_requirements": "..."                      // (optional, nullable) — §INITIAL_CONTRACTOR uses this
  },
  "reminders": {                                                // (populated by email-heartbeat as nudges fire)
    "nudge_1_sent_at": "{ISO} or null",
    "nudge_2_sent_at": "{ISO} or null"
  },
  "validate_inputs": {
    "status": "complete",
    "completed_at": "{ISO}",
    "folders_created": ["01_Raw_Submissions", "02_Verified_Documents", "03_Exception_Notes"],
    "excel_url": "...",
    "case_tracker_path": "..."
  },
  "send_initial": {
    "status": "complete",
    "completed_at": "{ISO}",
    "template_used": "fte",
    "sent_to": "{employee_email}",
    "cc": ["{recruiter_or_hr_email}"],
    "outlook_message_id": "...",                                 // non-empty Outlook id; required when email_tool=outlook
    "email_tool": "outlook"                                      // REQUIRED. one of: outlook | resend. heartbeat asserts this == "outlook" before polling Outlook for replies (see email-heartbeat.md STEP 2 channel cross-check). Resend forbidden for 1:1 transactional per AGENTS.md.
  },
  "process_reply": {
    "rounds": [
      {
        "round": 1,
        "messageIds_processed": ["...", "..."],
        "raw_uploads": [{"filename": "...", "messageId": "...", "attachmentId": "..."}],
        "classification": "complete | partial | ack_only | question | withdrawal | cancellation"
      }
    ]
  },
  "validate_docs": {
    "rounds": [
      {
        "round": 1,
        "discrepancy_list": ["..."],
        "identity_check_outcome": "pass | warning | fail",
        "attachments_validated": [{"filename": "...", "messageId": "...", "attachmentId": "...", "round": 1}]
      }
    ]
  },
  "complete_submission": {                                       // (populated by Phase 7+8)
    "status": "in_progress | complete | partial_failed",
    "started_at": "{ISO}",
    "completed_at": "{ISO}",
    "round_index": N,
    "verified_uploads": [{"filename":"...","dest_path":"...","size":N,"transferred":true|false,"error":null|"..."}],
    "verified_count": N,
    "total_files_attempted": N,
    "partial": true|false,                                       // true if any uploads failed
    "human_verification_email_sent": true,
    "approval_id": "{paperclip_approval_id} or null",           // null between Step 11a (placeholder) and Step 11c (post-approval write)
    "approval_created_at": "{ISO}",
    "approval_target_issue": "{parent_issue_id}",
    "approval_required_approver": "{human_in_loop_email}"
  },
  "upload_sharepoint": {                                         // (populated by Phase 9)
    "status": "complete",
    "completed_at": "{ISO}",
    "approval_id": "{approval_id}",
    "approver_email": "...",
    "approved_at": "{ISO}",
    "verified_present_count": N,
    "expected_count": N,
    "fallback_log": [],
    "cleanup_log": [],
    "exception_notes_written": true|false,
    "raw_submissions_intact": true|false
  },
  "close_case": {                                                // (populated by Phase 10)
    "status": "complete",
    "completed_at": "{ISO}",
    "candidate_completion_email_sent": true,
    "candidate_completion_recipients": ["..."],
    "it_setup_email_sent": true|false,                          // false → heartbeat IT-retry sweep picks it up
    "it_setup_retries": 0,                                      // incremented by heartbeat retry sweep
    "parent_patch_succeeded": true|false,                       // false → heartbeat parent-patch sweep picks it up
    "parent_patch_retries": 0,                                  // incremented by heartbeat retry sweep
    "final_status": "completed"
  }
}
```

### Read / write pattern (every phase)

```
1. run_state_path = description.run_state_path  ← from current issue description
2. sharepoint_read_file path="{run_state_path}"
   → IF missing: post blocked comment on this issue + parent_issue_id, STOP.
3. Parse JSON. Validate schema_version == 1.
4. Execute phase steps.
5. Update phase section (e.g. "validate_inputs": { ... }).
6. Append phase name to phases_complete[].
7. Set last_updated = now, current_phase = next-phase-name.
8. sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
   → IF write fails: retry once after 3s.
   → IF still fails: post blocked comment on this issue + parent_issue_id, STOP (do NOT create next child).
```

---

## §13. `case-tracker.md` Schema

Path: `HR-Onboarding/{employee_full_name} - {date_of_joining}/case-tracker.md`

Created by Phase 1 (`validate-inputs.md`). Updated by every later phase.

```markdown
---
# Onboarding Case Tracker — {employee_full_name}
**CASE STATUS: IN PROGRESS**

| Field | Value |
|-------|-------|
| Name | {employee_full_name} |
| Email | {employee_email} |
| Phone | {phone_number} |
| Role | {role} |
| Type | {employee_type} |
| Joining Date | {date_of_joining} |
| HR Contact | {recruiter_or_hr_name} |
| HR Contact Email | {recruiter_or_hr_email} |
| Human Reviewer | {human_in_loop_name} |
| Human Reviewer Email | {human_in_loop_email} |
| Case ID | {case_id} |
| HRMS Form URL | {excel_url} |
| Parent Issue | {parent_issue_id} |

## Phase Tracker
(Pipeline progress. Each phase file updates its own row.)

| # | Phase | File | Status | Started | Completed | Child Issue | Notes |
|---|-------|------|--------|---------|-----------|-------------|-------|
| 0 | Orchestrator           | employee-onboarding.md          | done    | {ts} | {ts} | {issue_id} | Run-state.json written |
| 1 | Validate inputs        | validate-inputs.md              | pending | —    | —    | —          | — |
| 2 | Send initial email     | send-initial.md                 | pending | —    | —    | —          | — |
| 3 | Await candidate reply  | await-reply.md                  | pending | —    | —    | —          | — |
| 4 | Process reply          | process-reply.md                | pending | —    | —    | —          | — |
| 5 | Validate documents     | validate-docs.md                | pending | —    | —    | —          | — |
| 6 | Request resubmission   | request-resubmission.md         | pending | —    | —    | —          | — |
| 7+8 | Complete + approval  | complete-submission.md          | pending | —    | —    | —          | — |
| 9 | Upload to SharePoint   | upload-sharepoint.md            | pending | —    | —    | —          | — |
| 10 | Close case            | close-case.md                   | pending | —    | —    | —          | — |

## Status History
| Timestamp | Status | Notes |
|-----------|--------|-------|
| {ts} | initiated | Case created |

## Document Tracker
(Updated automatically at each submission. Status: pending / received / verified / rejected / uploaded)

| Document | Required | Status | Submitted At | Issues | Verified |
|----------|----------|--------|--------------|--------|----------|
{document_rows_by_employee_type}

## Identity Verification
| Check | Result | Notes |
|-------|--------|-------|
| Name on documents matches candidate | pending | — |
| DOB on documents matches provided DOB | pending | — |
| Name consistent across all documents | pending | — |

## Reminders Sent
| Nudge | Sent At | Response |
|-------|---------|----------|
| Nudge 1 | — | — |
| Nudge 2 | — | — |

## Attachment Lookup
(One row appended per accepted attachment each round. Phase 9 fallback uses the most recent row per filename to re-fetch bytes.)

| Filename | Message ID | Attachment ID | Content Type | Round |
|----------|------------|---------------|--------------|-------|
---
```

### Phase Tracker — status values

| Value | Meaning |
|-------|---------|
| `pending` | Phase not yet started |
| `in_progress` | Phase file actively running |
| `done` | Phase completed successfully |
| `skipped` | Phase intentionally bypassed (e.g. Phase 6 skipped when no discrepancies) |
| `blocked` | Phase hit an unrecoverable error; human intervention required |

### Phase Tracker — update protocol (every phase file)

1. On entry: read case-tracker.md → flip own row to `in_progress` → write `Started = {now}`, `Child Issue = {PAPERCLIP_TASK_ID}`, `Notes = {brief}`.
2. On successful completion: flip own row to `done` → write `Completed = {now}`, `Notes = {brief outcome}`.
3. On unrecoverable block: flip own row to `blocked` → write `Notes = {short reason}`. Notify human_in_loop_email.
4. On intentional skip (branch routing): flip own row to `skipped` → write `Notes = {reason for skip}`.

### Row-ownership rule (refined)

Each phase OWNS its own row — only that phase may write `done`/`Started`/`Completed`/`Child Issue` columns. A phase MAY set a **later** row to `skipped` or back to `pending` when its branch decision determines that later phase is bypassed (e.g. `validate-docs.md` clean branch sets row 6 to `skipped`) or re-entered (e.g. `request-resubmission.md` may flip rows 7+8/9/10 back to `pending` after a previously-clean round became dirty in a later round).

**A phase MUST NEVER overwrite another phase's `done`/`Started`/`Completed`/`Child Issue` columns.** Cross-row writes are restricted to flipping later rows' `Status` between `pending` ↔ `skipped` ↔ `blocked` only.

---

## §14. Phase Routing — Title Prefixes

Every child issue title MUST begin with one of these prefixes. Agents read the prefix on wake, load only the mapped file, and execute only that file's steps.

| Title prefix | Phase file | Created by |
|---|---|---|
| `[HR-ONBOARD]` | `employee-onboarding.md` (orchestrator) | Paperclip routine trigger (manual or API) |
| `[HR-VALIDATE-INPUTS]` | `employee-onboarding/validate-inputs.md` | orchestrator |
| `[HR-SEND-INITIAL]` | `employee-onboarding/send-initial.md` | validate-inputs |
| `[HR-AWAIT-REPLY]` | `employee-onboarding/await-reply.md` | send-initial |
| `[HR-PROCESS-REPLY]` | `employee-onboarding/process-reply.md` | email-heartbeat (on reply detected) |
| `[HR-ONBOARDING-REPLY]` (LEGACY) | `employee-onboarding/process-reply.md` | (legacy heartbeat — accepted for backward compat; new heartbeat creates `[HR-PROCESS-REPLY]`) |
| `[HR-VALIDATE-DOCS]` | `employee-onboarding/validate-docs.md` | process-reply |
| `[HR-REQUEST-RESUB]` | `employee-onboarding/request-resubmission.md` | validate-docs (discrepancy branch) |
| `[HR-COMPLETE-SUB]` | `employee-onboarding/complete-submission.md` | validate-docs (clean branch) |
| `[HR-UPLOAD-SP]` | `employee-onboarding/upload-sharepoint.md` | email-heartbeat (on approval detected) |
| `[HR-CLOSE]` | `employee-onboarding/close-case.md` | upload-sharepoint |

**No-leak rule:** if an agent wakes on an issue whose title starts with `[HR-*]`, it MUST read ONLY the mapped phase file. It MUST NOT read this `_shared.md` directly except via references from inside the phase file. It MUST NOT read `employee-onboarding.md` (orchestrator) unless the prefix is `[HR-ONBOARD]`.

---

## §15. Child Issue — Description Format

Every `[HR-*]` child issue description MUST contain these BASE key-value lines (one per line, no blank lines between):

```
phase_file: {relative path from agents/hr/, e.g. routines/employee-onboarding/validate-inputs.md}
run_state_path: {sharepoint path to run-state.json}
parent_issue_id: {orchestrator issue id}
case_id: {case_id}
```

Phase-specific lines are appended on top of the base set. Known additional lines:
- `round_index: N` — used by process-reply, validate-docs, request-resubmission, complete-submission
- `messageIds: id1,id2,id3` — used by process-reply (created by heartbeat)
- `reply_count: N` — used by process-reply
- `approval_id: {id}` — used by upload-sharepoint (created by heartbeat approval-poll)
- `source: api` — heartbeat-created sub-issues (legacy compat)

Example for `[HR-PROCESS-REPLY]` (created by heartbeat):
```
phase_file: routines/employee-onboarding/process-reply.md
run_state_path: HR-Onboarding/Jane Doe - 2026-05-01/run-state.json
parent_issue_id: 1234-abcd-...
case_id: jane.doe@example.com-2026-05-01
messageIds: AAMkAD...01,AAMkAD...02
reply_count: 2
```

---

## §16. Notify Human Immediately — Trigger List

These conditions REQUIRE an immediate `outlook_send_email` to `human_in_loop_email` regardless of which phase you are in:

- No reply after first reminder (heartbeat)
- No reply after second reminder (heartbeat)
- `employee_type` unrecognized
- Submission email from sender that is not `employee_email` or `alternate_candidate_email`
- Any discrepancy found in Phase 5
- Candidate asks a process question or requests extension
- Document unavailable / candidate withdraws
- Name mismatch (Phase 5 identity check)
- Photo identity mismatch across documents (Phase 5)
- Rehire collision detected
- SharePoint folder unexpectedly already exists
- Existing case-tracker.md found at Phase 1 (orphan-folder reconcile)
- Duplicate workflow detected (same case_id active twice)
- Any `outlook_send_email` failure after retry (initial / nudge / resubmission / human-alert / IT-setup / completion)
- Any `sharepoint_transfer_from_outlook` failure after 3 retries
- Any `sharepoint_write_file` failure after retry (run-state.json, case-tracker.md, audit-log.csv)
- HRMS Excel copy returns size = 0 or missing webUrl (Phase 1)
- `case-tracker.md` write fails after retry (any phase)
- Document validator skill returns malformed result (Phase 5)
- Approval timeout (heartbeat detects approval older than 7 days)
- Approval rejected (heartbeat Branch P2)
- Approval withdrawn (heartbeat Branch P3)
- Approval escalated at 14 days (heartbeat Branch P4 ceiling)
- IT setup email failure (Phase 10 + heartbeat retry sweep exhausts 3 retries)
- Parent orchestrator issue PATCH to `done` fails (Phase 10 + heartbeat retry sweep exhausts 5 retries)
- Pre-existing active workflow on same case_id (orchestrator Branch C)

For every trigger above, also append an audit-log row with `event = human_notified` (status unchanged per §5).

---

## §17. Failure Handling Reference

| Situation | Action |
|---|---|
| `run-state.json` missing at phase start | Post blocked comment on this issue + `parent_issue_id`. Phase Tracker row → `blocked`. STOP. |
| `run-state.json` write fails after retry | Post blocked comment on this issue + `parent_issue_id`. Phase Tracker row → `blocked`. STOP. |
| `audit-log.csv` write fails after retry | Notify human, Phase Tracker row → `blocked`. STOP. |
| Outlook send fails | Notify human (via secondary outlook send to `human_in_loop_email`), audit-log `event = escalated`. STOP this phase. |
| SharePoint transfer fails after 3 retries | Notify human, audit-log `event = escalated`, continue with remaining files. |
| Child issue creation fails after retry | Notify human, Phase Tracker row → `blocked`. Do NOT exit this phase as `done` — human re-creates child manually. |
| Document validator skill returns malformed result | Notify human, Phase Tracker row 5 → `blocked`. STOP. |
| Approval times out (> 7 days in heartbeat) | Notify human, audit-log `event = escalated`. Keep case open for manual approval. |

---

## §18. Teams Notifications

All Teams notifications use:

```
teams_send_channel_message
  teamId      = $TEAMS_HR_TEAM_ID
  channelId   = $TEAMS_HR_CHANNEL_ID
  contentType = "html"
  content     = "{html body}"
```

**Rules:**
- Non-blocking. Failure → append `⚠️ Teams notification failed: {error}` to current Paperclip issue comment, continue.
- Never call `teams_list_teams` — bot is installed only in "Medicodio Agent" team.
- Tokens (`TEAMS_TENANT_ID`, `TEAMS_CLIENT_ID`, `TEAMS_CLIENT_SECRET`) are wired into MCP server via `mcp.json`. They are NOT in process env. Just call the tool.

Templates for each notification event live in `_email-templates.md § Teams_*`.

---

## §19. Paperclip API Conventions

Every API call MUST include this header:

```
X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
```

| Operation | Endpoint |
|---|---|
| Create child issue | `POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues` |
| Post comment | `POST /api/issues/{PAPERCLIP_TASK_ID}/comments` |
| Update issue | `PATCH /api/issues/{PAPERCLIP_TASK_ID}` |
| Read heartbeat context | `GET /api/issues/{PAPERCLIP_TASK_ID}/heartbeat-context` |
| List issues by status | `GET /api/companies/{PAPERCLIP_COMPANY_ID}/issues?assigneeAgentId={HR_AGENT_ID}&status=in_review` |
| Create approval | `POST /api/issues/{issue_id}/approvals` — for onboarding, `issue_id = parent_issue_id` (the orchestrator issue), NOT the current Phase 7+8 child issue. The heartbeat polls approvals scoped to the parent. |
| List approvals on an issue | `GET /api/issues/{issue_id}/approvals` |
| Read approval status | `GET /api/approvals/{approval_id}` |
| List child issues by parent + title prefix | `GET /api/companies/{PAPERCLIP_COMPANY_ID}/issues?parentId={parent}&title-prefix=[HR-*]` (used for idempotency checks before creating duplicate children) |

Child issue create body:
```json
{
  "title": "[HR-*] {short label} — {employee_full_name}",
  "description": "{key-value lines per §15}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
```

**Retry policy:** every API call retries once on 5xx. After second failure, escalate via `§16` notify-human and Phase Tracker `blocked`.

---

## §20. Environment Variables

These environment variables MUST be available to every wake. Phase files reference them as `${VAR}` or `$VAR`. They are NOT in `run-state.json`.

| Variable | Source | Required | Purpose |
|---|---|---|---|
| `PAPERCLIP_TASK_ID` | Paperclip wake context | required | UUID of the current child issue being processed |
| `PAPERCLIP_COMPANY_ID` | Paperclip wake context | required | Company UUID — used in `POST /api/companies/{id}/issues` |
| `PAPERCLIP_AGENT_ID` | Paperclip wake context | required | Agent UUID — used as `assigneeAgentId` when creating child issues |
| `PAPERCLIP_RUN_ID` | Paperclip wake context | required | Run UUID — used in `X-Paperclip-Run-Id` header |
| `PAPERCLIP_WAKE_PAYLOAD_JSON` | Paperclip wake context | optional | JSON payload from API/manual trigger; orchestrator reads `payload` field |
| `HR_AGENT_ID` | env / settings | required | Same as `PAPERCLIP_AGENT_ID` for HR agent; used by heartbeat issue queries |
| `IT_SUPPORT_EMAIL` | env (typically `itadmin@medicodio.ai`) | required | Recipient of Phase 10 §IT_SETUP email |
| `TEAMS_HR_TEAM_ID` | env (wired into MCP via `mcp.json`) | required | Target team for `teams_send_channel_message` |
| `TEAMS_HR_CHANNEL_ID` | env (wired into MCP via `mcp.json`) | required | Target channel |
| `TEAMS_TENANT_ID`, `TEAMS_CLIENT_ID`, `TEAMS_CLIENT_SECRET` | MCP server only | not visible in process env | Wired into the Teams MCP server; phase files MUST NOT reference directly |
| `OUTLOOK_MAILBOX` | env (configured by HR-ENV-VARS) | required | Mailbox alias used by every outlook_* tool call |

If any required env var is missing at wake: post a blocked comment on this issue and `parent_issue_id` (if known), notify `human_in_loop_email` if known, STOP. Do NOT attempt to invent values.

---

## §21. Paperclip Issue Status — Phase Exit Discipline

**Why this exists:** Two status systems run in parallel:

1. **Paperclip issue status** (`todo | in_progress | in_review | blocked | done | cancelled`) — stored in Paperclip DB, shown in the issue sidebar. Owned by the agent via `PATCH /api/issues/:id`. The Paperclip server only auto-changes it at **checkout** (`todo|backlog|blocked|in_review` → `in_progress`) and via the known reopen-on-comment heuristic (`done|cancelled` → `todo`).
2. **Case workflow status** — column 8 of `audit-log.csv`, owned by HR routines per `§5`. This is the source of truth for the heartbeat poll bucket.

These two **must be kept in sync** at every phase exit. A common failure: agent flips Paperclip status to `in_review` once after Phase 2, then on a later user comment the checkout flips it back to `in_progress`, and the agent forgets to re-PATCH. Sidebar shows `in_progress` forever even though the case is parked waiting for the candidate.

### Phase-exit status table

Every phase file MUST end with exactly one PATCH that matches the row below for its branch outcome. No silent exits. If a phase chooses not to PATCH, it MUST document why in a "Status on exit" comment.

| Phase / outcome | Paperclip status to PATCH on the child issue | Comment must include |
|---|---|---|
| `validate-inputs` success → `[HR-SEND-INITIAL]` created | `done` (this child) + parent stays `in_progress` | next child id, run_state path |
| `validate-inputs` blocked (Excel copy fail, etc.) | `blocked` (this child) + parent `blocked` | unblocker = `human_in_loop_email`, exact action to fix |
| `send-initial` success → `[HR-AWAIT-REPLY]` created | `done` (this child) + parent `in_review` (parent now waits for candidate) | outlook_message_id, nudge schedule (heartbeat owns next action) |
| `send-initial` blocked (assert fail, excel_url null, etc.) | `blocked` (this child) + parent `blocked` | which assert failed, manual re-trigger steps |
| `await-reply` (placeholder phase, heartbeat owns work) | `in_review` (this child) — issue exists as a marker, heartbeat creates `[HR-PROCESS-REPLY]` when reply arrives | "Heartbeat polling. Next action: candidate reply or Nudge 1 on {date}." |
| `process-reply` success → `[HR-VALIDATE-DOCS]` created | `done` (this child) + parent `in_progress` (active processing) | round_index, reply_count |
| `validate-docs` clean → `[HR-COMPLETE-SUB]` created | `done` (this child) + parent `in_progress` | round_index, no discrepancies |
| `validate-docs` dirty → `[HR-REQUEST-RESUB]` created | `done` (this child) + parent `in_review` (waiting for candidate again) | discrepancy_list |
| `request-resubmission` success | `done` (this child) + parent `in_review` | round_index, what was re-requested |
| `complete-submission` success (approval created) | `done` (this child) + parent `in_review` (waiting on human approval) | approval_id, approver email |
| `upload-sharepoint` success → `[HR-CLOSE]` created | `done` (this child) + parent `in_progress` (final phase running) | verified counts |
| `close-case` success | `done` (this child) + parent **`done`** | final summary, IT setup status |
| ANY phase blocked | `blocked` (this child) + parent `blocked` | unblocker, exact action |
| Heartbeat tick — no new events for this case | **no PATCH on parent** (idempotent) | (no comment) |
| Heartbeat tick — work done (nudge sent, sub-issue created) | parent stays whatever it was; if checkout flipped to `in_progress` and `case_status == awaiting_document_submission`, re-PATCH parent to `in_review` to neutralize | what was done this tick |
| User comment received on parent (not heartbeat) → agent answers | After answering: re-PATCH parent to whatever status the case_status mapping dictates (`in_review` if `awaiting_document_submission`, `in_progress` if active processing, `blocked` if blocked). Never leave the parent in raw post-checkout `in_progress` unless that's the right state. | response to user |

### Case-status → Paperclip-status mapping (parent issue)

When in doubt — especially the user-comment / heartbeat anti-thrash case — derive parent's Paperclip status from the latest column-8 value in audit-log:

| `current_status` (col-8) | Parent Paperclip status |
|---|---|
| `initiated`, `initial_email_sent` | `in_progress` |
| `awaiting_document_submission`, `candidate_acknowledged` | `in_review` (waiting for candidate; heartbeat owns nudges) |
| `partial_submission_received`, `complete_submission_received`, `under_automated_review` | `in_progress` (active processing) |
| `discrepancy_found`, `awaiting_resubmission` | `in_review` (waiting for candidate again) |
| `awaiting_human_verification` | `in_review` (waiting on human approver) |
| `verified_by_human`, `sharepoint_upload_in_progress`, `uploaded_to_sharepoint` | `in_progress` (active processing) |
| `completed` | `done` |
| `blocked`, `email_send_failed`, `phase_blocked`, `duplicate_workflow_detected` | `blocked` |
| `stalled`, `escalated`, `withdrawn`, `cancelled` | `cancelled` (terminal, no further automation) |

### Mandatory exit pattern

Every phase file MUST include a section titled `## Status on exit` near the bottom that mirrors the table row(s) for its outcomes. `email-heartbeat.md` MUST include the anti-thrash rule (STEP 6) that re-PATCHes the parent if checkout flipped status off the case-status mapping. Grep `grep -L "Status on exit" agents/hr/routines/employee-onboarding/*.md` should return no files once Phase 4.2 is complete.
