# Phase 7+8 — Complete Submission (auto-upload Verified + create approval)

**Title prefix:** `[HR-COMPLETE-SUB]`
**Created by:** `validate-docs.md` Step 11 Branch Y (when `decision == "all_present_clean"`).
**Creates next:** NONE. The pipeline parks here. `email-heartbeat.md` polls Paperclip approval status; when it transitions to approved, the heartbeat creates `[HR-UPLOAD-SP]`.

---

## No-leak header

**TOOL RULE LINE 1:** This phase uses: `sharepoint_read_file` / `sharepoint_write_file` for run-state and case-tracker, `sharepoint_transfer_from_outlook` for each verified doc upload (RAW already happened in Phase 4), `sharepoint_get_file_info` for post-upload integrity, `outlook_send_email` (human verification request), `teams_send_channel_message` non-blocking, Paperclip API including `POST /api/issues/{id}/approvals`. **FORBIDDEN here:** `outlook_read_attachment` — see `_shared.md § §9.2`. Use `sharepoint_transfer_from_outlook` only for the verified uploads in this phase.

**STATE:** Read `run_state_path` from this issue description. Append `complete_submission` section to run-state.json before exit. Store `approval_id` so the heartbeat can poll it.

**CREATES NEXT:** Nothing. Heartbeat polls Paperclip approval status.

**DO NOT:**
- Send the candidate completion email. That is Phase 10.
- Send the IT setup email. That is Phase 10.
- Mark the parent orchestrator issue as `done`. Only Phase 10.
- Re-upload `01_Raw_Submissions/` files. Phase 4 did that.
- Run document validation. Phase 5 did that.
- Send the resubmission email. Phase 6 owns that branch.

---

## References

- Conventions: `routines/employee-onboarding/_shared.md`
- Templates: `routines/employee-onboarding/_email-templates.md`

---

## Step 1 — Load run-state.json and this issue's description

```
sharepoint_read_file path="{run_state_path}"
→ Parse JSON. Validate schema_version == 1.
→ IF file missing → blocked comment on this issue + parent_issue_id, STOP.
```

Read `round_index` from issue description.

Extract — **read paths from run-state top-level:**
```
payload                = run_state.payload
employee_full_name     = payload.employee_full_name
employee_email         = payload.employee_email
phone_number           = payload.phone_number
role                   = payload.role
employee_type          = payload.employee_type
date_of_joining        = payload.date_of_joining
human_in_loop_name     = payload.human_in_loop_name
human_in_loop_email    = payload.human_in_loop_email
recruiter_or_hr_name   = payload.recruiter_or_hr_name
recruiter_or_hr_email  = payload.recruiter_or_hr_email
case_tracker_path      = run_state.case_tracker_path     ← top-level
base_folder            = run_state.base_folder           ← top-level (rehire-aware)
verified_folder        = "{base_folder}/02_Verified_Documents"
case_id                = run_state.case_id
parent_issue_id        = run_state.parent_issue_id

this_validation_round  = first(r in run_state.validate_docs.rounds where r.round == round_index)
attachments_validated  = this_validation_round.attachments_validated      ← from Phase 5
identity_outcome       = this_validation_round.identity_check_outcome
```

**Guard:** if `this_validation_round.decision != "all_present_clean"` → blocked comment "Phase 7+8 invoked but Phase 5 decision was {decision}." Phase Tracker row 7+8 → `blocked`. STOP.

---

## Step 2 — Flip Phase Tracker row 7+8 → in_progress

Update row 7+8:
```
| 7+8 | Complete + approval | complete-submission.md | in_progress | {now} | — | {PAPERCLIP_TASK_ID} | Round {round_index} — uploading verified + creating approval |
```
Write the file. On retry failure: notify human, audit-log escalated, STOP.

---

## Step 3 — Resolve `(messageId, attachmentId)` per accepted doc

Phase 5 already populated `attachments_validated[]` with per-attachment `verified` and `source` fields. This step has TWO explicit branches — do NOT conflate.

Phase 5 multi-round aggregation means `attachments_validated` contains entries from EVERY process_reply round (not only the current one). Each entry carries `source` set to `"this_round"` or `"round_{N}"` per Phase 5 Step 6c. ALL entries carry valid `messageId` + `attachmentId` directly (Phase 5 preserves them through aggregation).

### Branch A — entry has `messageId` AND `attachmentId` populated

This is the normal path for both `source == "this_round"` AND `source == "round_{N}"`. Phase 5 emits both fields for every entry.

```
For each entry e in attachments_validated:
  IF e.verified == true AND e.messageId AND e.attachmentId:
    use e.messageId + e.attachmentId directly → add to verified_files
  IF e.verified == false:
    skip (Phase 5 already flagged the discrepancy; we are in the clean branch, so this should not normally appear). Log a warning to case-tracker Status History: "Unexpected: attachment {e.filename} verified=false reached complete-submission. Skipped from verified upload."
    Continue with the rest. Do NOT block.
```

### Branch B — entry has neither messageId nor attachmentId (Attachment Lookup fallback)

Defensive fallback for malformed or hand-edited run-state where an entry's `messageId`/`attachmentId` are missing.

```
For each entry e in attachments_validated where e.verified == true AND (e.messageId is null OR e.attachmentId is null):
  READ case-tracker.md Attachment Lookup table.
  Find the MOST RECENT row where Filename == e.filename.
  Use that row's Message ID + Attachment ID → add to verified_files.
  IF no matching row → critical inconsistency:
    - Notify human (subject `HR Alert: Attachment Lookup missing for {filename} — {employee_full_name}`).
    - Append audit-log row with event=escalated, brief_reason="Attachment Lookup row missing for verified file {filename} with null messageId".
    - Skip this file from upload (continue with rest).
```

Build `verified_files = [{filename, messageId, attachmentId, contentType, source_round: e.source}, ...]`.

---

## Step 4 — Upload each verified doc to `02_Verified_Documents/`

For each entry in `verified_files`:

### 4a — Resolve destination filename (no overwrite)
```
candidate_name = "{filename}"
sharepoint_get_file_info path="{verified_folder}/{candidate_name}"
→ IF exists AND size > 0: append timestamp suffix before extension per _shared.md § §8.
→ ELSE IF exists AND size == 0: delete the empty file, use {candidate_name}.
→ ELSE: use {candidate_name}.
```

### 4b — Transfer
```
sharepoint_transfer_from_outlook
  messageId    = "{messageId}"
  attachmentId = "{attachmentId}"
  destPath     = "{verified_folder}/{final_filename}"
  mimeType     = "{contentType}"
→ Per _shared.md § §8 retry policy: HTTP 429/503 → wait 10s, retry up to 3 times total. On 3rd failure → escalate (notify human, audit-log escalated), skip this file, continue with remaining.
```

### 4c — Post-upload integrity check
```
sharepoint_get_file_info path="{verified_folder}/{final_filename}"
→ Confirm size > 0.
→ IF size == 0 or not found → delete the empty file, escalate, skip this file.
```

Record `verified_uploads = [{filename, dest_path, size, transferred: true|false, error: null|"..."}]`.

**After loop:**

```
N_success = count(verified_uploads where transferred == true AND error is null)
N_fail    = count(verified_uploads where transferred == false OR error is not null)
N_total   = N_success + N_fail
partial   = (N_fail > 0)
```

- IF `N_success == 0` (all uploads failed): notify human, audit-log escalated, Phase Tracker row 7+8 → `blocked`. STOP — do NOT create approval.
- IF `partial == true` (some uploads succeeded, some failed): **do NOT create the approval.** Partial uploads must not be auto-approved — the human must reconcile first.
  - `outlook_send_email` to `{human_in_loop_email}`:
    - subject: `HR Alert: Partial verified upload — {employee_full_name} ({N_success}/{N_total})`
    - isHtml: true
    - body: `<p>Hi,</p><p>Verified upload for <strong>{employee_full_name}</strong> ({employee_email}) is partial — {N_success} of {N_total} files were uploaded successfully; {N_fail} failed. The approval has NOT been created. Please investigate the failed files and either retry manually or run Phase 6 to request re-submission.</p><p>Failed files:</p><ul>{rows: <li>{filename} — error: {error}</li>}</ul><p>Successful files:</p><ul>{rows: <li>{filename}</li>}</ul><p>Case ID: {case_id}</p><p>Regards,<br>HR Automation</p>`
  - Audit-log row with `event=escalated`, brief_reason="Phase 7+8 partial verified upload — approval blocked".
  - Set `run_state.complete_submission.partial = true` (writes happen in Step 11).
  - Phase Tracker row 7+8 → `blocked`. STOP — do NOT proceed to Steps 6/7/8.
- IF `partial == false` (all `N_success == N_total`): proceed to Step 5.

---

## Step 5 — Update case-tracker Document Tracker to `verified`

Read `case-tracker.md`. For each row whose `Document` label corresponds to a successfully transferred file in `verified_uploads`, update:
- `Status` → `verified` (NOT yet `uploaded` — that happens in Phase 9 when the human-approved final state is reached).
- `Verified` column → `✓` with the timestamp.

For docs marked clean in Phase 5 but failed upload here, set Status → `received` (still present, but not in verified folder). Add a note in `Issues` column: `verified upload failed — escalated`.

Append Status History row (delay write — combined with Step 9 below).

---

## Step 6 — Append audit-log row

Per `_shared.md § §3` and `§4`:
```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|complete_submission_received|files_uploaded|Verified documents auto-uploaded to 02_Verified_Documents (round {round_index})|{N_success}/{N_total} files|{PAPERCLIP_TASK_ID}
```

---

## Step 7 — Write run-state placeholder BEFORE creating approval (idempotency anchor)

The heartbeat polls cases whose latest `current_status == awaiting_human_verification`. If this phase wake creates the approval and then crashes before writing `complete_submission.approval_id`, the next heartbeat tick will see `awaiting_human_verification` (the row from Step 6 above) but no approval_id in run-state — that path is blocked (see `_shared.md § §17`). To prevent that, write a PLACEHOLDER run-state.complete_submission section FIRST:

```json
"complete_submission": {
  "status": "in_progress",
  "started_at": "{ISO now}",
  "round_index": {round_index},
  "verified_uploads": [...],
  "verified_count": N_success,
  "total_files_attempted": N_total,
  "partial": false,
  "human_verification_email_sent": false,         // Step 8 flips to true
  "approval_id": null,                            // Step 9b fills this in
  "approval_created_at": null,
  "approval_target_issue": "{parent_issue_id}",
  "approval_required_approver": "{human_in_loop_email}"
}
```

Top-level: set `current_phase = "awaiting_approval"` ONLY after this write succeeds (the audit-log row below uses that sentinel to keep heartbeat bucketing accurate).

Write `run-state.json`. On retry failure: notify human, Phase Tracker row 7+8 → `blocked`, STOP — do NOT proceed to Step 8.

---

## Step 8 — Send human verification request email

Use template `_email-templates.md § §HUMAN_VERIFICATION_REQUEST` to `{human_in_loop_email}`.

Fill in the dynamic sections:
```
summary_of_action_taken = "Phase 4 received {total_attachments} attachments across {N_rounds} round(s). Phase 5 validated; identity={identity_outcome}. Phase 7+8 transferred {N_success}/{N_total} files to 02_Verified_Documents."
received_docs_html_list = <li>...</li> for each filename in verified_uploads where transferred == true (NOT every attempted file)
discrepancy_summary     = "None" (we are in the clean branch) — or list discrepancies that were resolved in earlier rounds if you want.
reminder_1_yes_no       = "Yes" if run_state.reminders.nudge_1_sent_at is not null, else "No"
reminder_2_yes_no       = "Yes" if run_state.reminders.nudge_2_sent_at is not null, else "No"
identity_check_outcome  = {identity_outcome}
```

**On failure (retry once):** notify human via plain outlook_send_email (subject `HR Alert: Failed to send verification request — {employee_full_name}`), audit-log escalated. Phase Tracker row 7+8 → `blocked`. STOP — do NOT create approval until human is reachable.

On success: flip `run_state.complete_submission.human_verification_email_sent = true`. Write run-state. If write fails after retry: log warning, continue (approval will still be created and heartbeat will detect it).

---

## Step 9 — Create the Paperclip approval (idempotent)

### Step 9a — Idempotency check

If this phase wake retried, an approval may already exist. Check before creating a duplicate:

```
GET /api/issues/{parent_issue_id}/approvals
→ For each approval in the response: if its title == "Verify onboarding documents for {employee_full_name}" AND its status ∈ {pending, approved}, REUSE that approval_id (skip to Step 9c).
→ Otherwise: proceed to Step 9b.
```

### Step 9b — Create approval

```
POST /api/issues/{parent_issue_id}/approvals
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "Verify onboarding documents for {employee_full_name}",
  "body": "{N_success}/{N_total} mandatory documents have been uploaded to 02_Verified_Documents. Identity check: {identity_outcome}. Please review and approve to trigger SharePoint final state (or reject with reason).\n\nFolder: {base_folder}\nFiles uploaded ({N_success}):\n{newline-joined list of verified_uploads filenames where transferred == true}\n{IF partial == true (should not occur — Step 4 STOPs on partial): list failed files too}",
  "required_approver_email": "{human_in_loop_email}"
}
→ Capture returned approval_id.
→ On retry failure (after 1 retry): notify human, audit-log escalated, Phase Tracker row 7+8 → blocked. STOP. (run-state already has placeholder approval_id=null; heartbeat will see this case as stuck and notify on next tick.)
```

**Important:** the approval is created on `parent_issue_id` (the orchestrator issue), NOT on this phase issue. The heartbeat polls approvals scoped to the parent orchestrator issue.

### Step 9c — Finalize run-state.complete_submission

Update `run_state.complete_submission`:
- `approval_id = {approval_id}`
- `approval_created_at = {ISO now}` (or reuse the existing one if Step 9a found an existing approval)
- `status = "complete"`
- `completed_at = {ISO now}`

Write run-state. On retry failure: notify human, log warning. Continue — the approval exists and the heartbeat will detect it once run-state can be re-read. Phase Tracker row 7+8 → `blocked` only if heartbeat cannot recover next tick.

---

## Step 10 — Update case-tracker

Append Status History rows (combined write with Step 5 updates):
```
| {now} | complete_submission_received | Round {round_index}: {N_success} verified docs uploaded to 02_Verified_Documents |
| {now} | awaiting_human_verification  | Paperclip approval {approval_id} created on parent issue. Awaiting {human_in_loop_email}. |
```

Write the file. On retry failure: notify human, audit-log escalated, STOP.

Append audit-log row for the verification request:
```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|awaiting_human_verification|human_notified|Verification request email sent + Paperclip approval created|approval_id={approval_id}|{PAPERCLIP_TASK_ID}
```

Also finalize `phases_complete[]` and `current_phase`:
- Add `complete_submission` to `phases_complete[]` (only if not already).
- Confirm `current_phase = "awaiting_approval"` (Step 7 already set this; verify and re-write run-state if drift).
- `last_updated = now`.

Write run-state. On retry failure: log warning, continue — approval already exists.

---

## Step 11 — Teams notification (non-blocking)

Use `_email-templates.md § §Teams_Documents_Verified`. Fill `{verified_count}/{total_count}` from `verified_uploads` success count.

---

## Step 12 — Flip Phase Tracker row 7+8 → done

Update row 7+8:
```
| 7+8 | Complete + approval | complete-submission.md | done | {row7.Started from Step 2} | {now} | {PAPERCLIP_TASK_ID} | Round {round_index} — {N_success}/{N_total} verified; approval={approval_id} |
```

Write the file.

---

## Step 13 — PATCH parent issue and close this issue

PATCH parent orchestrator issue to in_review:
```
PATCH /api/issues/{parent_issue_id}
{
  "status": "in_review",
  "comment": "Phase 7+8 complete. Documents in 02_Verified_Documents. Paperclip approval {approval_id} created — awaiting {human_in_loop_email}. Heartbeat polls every 30 min for approval status."
}
```

Post comment and close this issue:
```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
{ "body": "Phase 7+8 complete. {N_success}/{N_total} verified docs uploaded. Approval ({approval_id}) awaiting {human_in_loop_email}. No new child — heartbeat polls approval and will create [HR-UPLOAD-SP] when approved." }

PATCH /api/issues/{PAPERCLIP_TASK_ID}
{ "status": "done", "comment": "Phase 7+8 complete. Awaiting approval." }
```

Exit heartbeat. ✓

---

## Failure handling reference

| Situation | Action |
|---|---|
| `run-state.json` missing at Step 1 | Blocked comment on this issue + parent. STOP. |
| `round_index` missing | Blocked comment. STOP. |
| `decision != all_present_clean` | Blocked comment, Phase Tracker row 7+8 → blocked. STOP. |
| Attachment lookup missing for a file | Notify human, audit-log escalated, skip the file. Continue. |
| All verified uploads fail | Notify human, audit-log escalated, Phase Tracker row 7+8 → blocked. STOP — do NOT create approval. |
| Some verified uploads fail | Continue with remaining, mark failures in Document Tracker, audit-log per failure. |
| Verification request email fails after retry | Notify human, audit-log escalated, Phase Tracker row 7+8 → blocked. STOP — do NOT create approval. |
| Approval create fails after retry | Notify human, audit-log escalated, Phase Tracker row 7+8 → blocked. STOP. |
| `case-tracker.md` write fails after retry | Notify human, audit-log escalated. STOP. |
| `run-state.json` write fails after retry | Notify human, Phase Tracker row 7+8 → blocked. STOP. |
| Audit-log write fails after retry | Notify human, Phase Tracker row 7+8 → blocked. STOP. |

---

## What this phase does NOT do

- Send the candidate completion email (Phase 10).
- Send the IT setup email (Phase 10).
- Mark parent orchestrator issue as done (Phase 10).
- Re-upload raw files. Phase 4 already did.
- Re-run validation. Phase 5 already did.
- Write `discrepancy-log.md` in `03_Exception_Notes/`. Phase 9 owns that.
- Poll the approval status itself — heartbeat owns polling.

---

## Status on exit

Per `_shared.md § §21`:

| Outcome | This child issue (`[HR-COMPLETE-SUB]`) | Parent orchestrator issue |
|---|---|---|
| Auto-upload to `02_Verified_Documents/` complete + Paperclip approval created | `done` | **`in_review`** (waiting on human approver; case_status = `awaiting_human_verification`) |
| Auto-upload partial-failed | `done` (Phase 9 fallback path will pick up) but with explicit comment noting failures | `in_review` |
| Auto-upload total fail | `blocked` | `blocked` |
| Approval create failed | `blocked` | `blocked` |
| run-state or audit-log write failed | `blocked` | `blocked` |
