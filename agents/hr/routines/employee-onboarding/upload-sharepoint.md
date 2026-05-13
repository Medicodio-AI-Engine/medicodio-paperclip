# Phase 9 — SharePoint Final Upload (post-approval)

**Title prefix:** `[HR-UPLOAD-SP]`
**Created by:** `email-heartbeat.md` approval-poll step (when an active `approval_id` transitions to approved).
**Creates next:** `[HR-CLOSE]` child issue (Phase 10).

---

## No-leak header

**TOOL RULE LINE 1:** This phase uses: `sharepoint_read_file` / `sharepoint_write_file` for run-state and case-tracker, `sharepoint_list_folder` and `sharepoint_get_file_info` for verifying 02_Verified_Documents content, `sharepoint_transfer_from_outlook` ONLY in the fallback case where 02_Verified_Documents is empty (Phase 7+8 already did the upload in the normal case), `outlook_send_email` for human notifications (upload complete, escalation), `teams_send_channel_message` non-blocking, Paperclip API including `GET /api/approvals/{approval_id}`. **FORBIDDEN here:** `outlook_read_attachment` — see `_shared.md § §9.2`.

**STATE:** Read `run_state_path` from this issue description. Append `upload_sharepoint` section to run-state.json before creating next child.

**CREATES NEXT:** `[HR-CLOSE]` child issue.

**DO NOT:**
- Send the candidate completion email (Phase 10).
- Send the IT setup email (Phase 10).
- Mark parent orchestrator issue as done (Phase 10).
- Validate documents (Phase 5 owns).
- Re-create approval (Phase 7+8 already created and approval was approved — this phase only verifies and acts on it).
- Re-upload files that are already in 02_Verified_Documents with size > 0. Only run the fallback if 02_Verified_Documents is empty.

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

Read issue description for `approval_id` (heartbeat puts this in the description).

Extract — **read paths from run-state top-level:**
```
payload                = run_state.payload
employee_full_name     = payload.employee_full_name
employee_email         = payload.employee_email
employee_type          = payload.employee_type
date_of_joining        = payload.date_of_joining
human_in_loop_email    = payload.human_in_loop_email
recruiter_or_hr_name   = payload.recruiter_or_hr_name
case_tracker_path      = run_state.case_tracker_path     ← top-level
base_folder            = run_state.base_folder           ← top-level (rehire-aware)
verified_folder        = "{base_folder}/02_Verified_Documents"
exception_folder       = "{base_folder}/03_Exception_Notes"
case_id                = run_state.case_id
parent_issue_id        = run_state.parent_issue_id

stored_approval_id     = run_state.complete_submission.approval_id
expected_round_index   = run_state.complete_submission.round_index
verified_uploads_meta  = run_state.complete_submission.verified_uploads
```

**Guard 1:** if `stored_approval_id != approval_id from description` → blocked comment "Phase 9 invoked with approval_id={x} but run-state has {y}. Refusing to proceed — likely heartbeat racing or stale routing." Phase Tracker row 9 → `blocked`. STOP.

**Guard 2:** verify the approval is actually approved:
```
GET /api/approvals/{approval_id}
→ Confirm response.status == "approved".
→ IF not approved:
   - Post blocked comment:
     "Phase 9 invoked but approval {approval_id} is currently {response.status} (was 'approved' when the heartbeat created this [HR-UPLOAD-SP] child). This is a race or a human action between the heartbeat poll and this Phase 9 wake.
      Resolution paths:
      (1) If the human intended to revert the approval, decide whether to re-approve the existing approval (the existing approval_id can be reused — no Phase 7+8 re-run needed) OR run Phase 6 manually to request a fresh resubmission.
      (2) If this is a transient API hiccup, retry this wake.
      Pipeline paused — Phase Tracker row 9 → blocked."
   - Phase Tracker row 9 → blocked. STOP.
```

**Guard 3:** verify `verified_uploads_meta` is non-empty AND at least one entry has `transferred == true`. If the meta is empty or all entries failed, refuse to close an empty case:
```
IF len(verified_uploads_meta) == 0 OR count(verified_uploads_meta where transferred == true) == 0:
  - Post blocked comment "Approval {approval_id} was approved but run_state.complete_submission.verified_uploads has no successful entries. Refusing to close an empty case. Either Phase 7+8 partial-failure path was bypassed or run-state was hand-edited."
  - Notify human_in_loop_email (subject `HR Alert: Phase 9 invoked with empty verified set — {employee_full_name}`).
  - Append audit-log row event=escalated.
  - Phase Tracker row 9 → blocked. STOP.
```

Capture `approver_email`, `approved_at` from the approval response.

---

## Step 2 — Flip Phase Tracker row 9 → in_progress, set status

Update row 9:
```
| 9 | Upload to SharePoint | upload-sharepoint.md | in_progress | {now} | — | {PAPERCLIP_TASK_ID} | Approval {approval_id} approved at {approved_at} by {approver_email} |
```
Write the file. On retry failure: notify human, audit-log escalated, STOP.

Append audit-log row for approval-approved transition:
```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|verified_by_human|human_approved|Approval {approval_id} approved|approver={approver_email} at={approved_at}|{PAPERCLIP_TASK_ID}
```

Append a second audit-log row for upload start:
```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|sharepoint_upload_in_progress|sharepoint_upload_in_progress|Final SharePoint state — checking 02_Verified_Documents|—|{PAPERCLIP_TASK_ID}
```

---

## Step 3 — Verify `02_Verified_Documents/` content

```
sharepoint_list_folder path="{verified_folder}"
→ Capture list of files with names and sizes.
```

Count files where `size > 0`. Call this `verified_present_count`.

Count files where `size == 0`. For each empty file: delete it, append to `cleanup_log[]`.

**Branch A — Normal path (verified_present_count >= expected):**
- `expected` = number of `transferred: true` entries in `verified_uploads_meta`.
- If `verified_present_count >= expected` → Phase 7+8 already uploaded everything cleanly. Skip fallback. Proceed to Step 5.

**Branch B — Fallback (verified_present_count < expected):**
- Phase 7+8 may have partially failed, or files were deleted between then and now. Run the per-file fallback transfer below.

---

## Step 4 — Fallback transfer (Branch B only)

For each entry in `verified_uploads_meta` whose `transferred: true` (Phase 7+8 thought it succeeded) but is now missing or size=0 in `02_Verified_Documents/`:

### 4a — Resolve `(messageId, attachmentId)`
- If `verified_uploads_meta` already has `messageId` + `attachmentId` (it should — Phase 7+8 stored them) → use directly.
- Else → read `case-tracker.md` Attachment Lookup, take the most recent row where `Filename = {filename}`, extract `messageId` + `attachmentId`.

### 4b — Transfer (up to 3 attempts)
```
sharepoint_transfer_from_outlook
  messageId    = "{messageId}"
  attachmentId = "{attachmentId}"
  destPath     = "{verified_folder}/{filename}"
  mimeType     = "{contentType}"
→ Per _shared.md § §8 retry policy: HTTP 429/503 → wait 10s, retry up to 3 total. On 3rd failure → escalate via §SHAREPOINT_UPLOAD_FAILURE_HUMAN, audit-log escalated, skip this file.
```

### 4c — Post-upload integrity check
```
sharepoint_get_file_info path="{verified_folder}/{filename}"
→ Confirm size > 0.
→ IF size == 0 → delete, escalate, skip.
```

Append each fallback action to `upload_sharepoint.fallback_log[]` in run-state (built in Step 7).

---

## Step 5 — Confirm raw submissions are intact (read-only check)

```
sharepoint_list_folder path="{base_folder}/01_Raw_Submissions"
→ Confirm the folder exists and has > 0 files (Phase 4 should have uploaded them earlier).
→ IF the folder is empty AND we had attachments in run_state.process_reply.rounds → log warning in run_state (do NOT fail this phase — verified copies are the source of truth at this point).
```

Do NOT re-upload raw files here. Raw uploads are Phase 4's responsibility.

---

## Step 6 — Write exception notes (if any)

Build a discrepancy summary across all validate_docs rounds. For each round:
- Collect resolved discrepancies (i.e. items that appeared in early rounds but cleared in later rounds).
- Collect unresolved warnings (e.g. identity_check_outcome == "warning" was passed despite this).

If anything to record, write/overwrite:
```
sharepoint_write_file path="{exception_folder}/discrepancy-log.md"
content:
---
# Discrepancy Log — {employee_full_name}
**Case ID:** {case_id}
**Final status:** Verified by human ({approver_email}) at {approved_at}

## Validation rounds summary
| Round | Decision | Discrepancies (count) | Identity outcome |
|-------|----------|----------------------|------------------|
{table rows per run_state.validate_docs.rounds — if rounds array is empty/absent, write a single row "— | (no validate_docs rounds in state — single-pass case) | — | —"}

## Resolved discrepancies (cleared across rounds)
{bulleted list — never include ID digits}

## Warnings accepted by human approval
{bulleted list — e.g. "Name differs by middle initial — accepted"}

---
```

If there is nothing meaningful to record → skip the write entirely. Do NOT create an empty file.

On write failure: retry once. If still fails: log warning in audit-log, continue (this is informational only — does NOT block phase).

---

## Step 7 — Update run-state.json

Append:
```json
"upload_sharepoint": {
  "status": "complete",
  "completed_at": "{ISO now}",
  "approval_id": "{approval_id}",
  "approver_email": "{approver_email}",
  "approved_at": "{approved_at}",
  "verified_present_count": N,
  "expected_count": N,
  "fallback_log": [
    {"filename": "...", "action": "transferred|skipped|failed", "error": null|"..."}
  ],
  "cleanup_log": ["..."],
  "exception_notes_written": true|false,
  "raw_submissions_intact": true|false
}
```

Top-level:
- Add `upload_sharepoint` to `phases_complete[]`.
- `current_phase = "close_case"`.
- `last_updated = now`.

Write per `_shared.md § §12`. On retry failure: notify human, Phase Tracker row 9 → `blocked`, STOP.

---

## Step 8 — Update case-tracker (final pre-close state)

For each row in the Document Tracker that has a verified file in `02_Verified_Documents/` (per Step 3's list):
- `Status` → `uploaded`
- `Verified` → `✓ {approver_email} {approved_at}`

Append Status History rows:
```
| {now} | verified_by_human            | Approval {approval_id} approved by {approver_email} |
| {now} | uploaded_to_sharepoint       | Final state — 02_Verified_Documents has {N} files; fallback transfers: {fallback_count} |
```

Write the file. On retry failure: notify human, audit-log escalated, STOP.

Append audit-log row:
```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|uploaded_to_sharepoint|files_uploaded|All files in 02_Verified_Documents confirmed (fallbacks={fallback_count})|N={verified_present_count}|{PAPERCLIP_TASK_ID}
```

---

## Step 9 — Send upload-complete email to human

Use `_email-templates.md § §UPLOAD_COMPLETE_HUMAN`. Substitute `{filenames_html_list}` with `<li>...</li>` per file.

On failure: retry once. If still fails: audit-log escalated row, log warning, continue (non-blocking — the human already approved, this is courtesy).

---

## Step 10 — Flip Phase Tracker row 9 → done

```
| 9 | Upload to SharePoint | upload-sharepoint.md | done | {row9.Started from Step 2} | {now} | {PAPERCLIP_TASK_ID} | {verified_present_count} files final; fallback={fallback_count}; exception_notes_written={true|false} |
```

Write the file.

---

## Step 11 — Create `[HR-CLOSE]` child issue

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
{
  "title": "[HR-CLOSE] {employee_full_name} — Phase 10 final close",
  "description": "phase_file: routines/employee-onboarding/close-case.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}\ncase_id: {case_id}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
→ On retry failure: blocked comment, Phase Tracker row 9 → blocked. STOP.
→ Store id as close_issue_id.
```

---

## Step 12 — Close this issue and exit

```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
{ "body": "Phase 9 complete. Final SharePoint state confirmed: {verified_present_count} files in 02_Verified_Documents. Fallback transfers: {fallback_count}. Exception notes: {written or not}. Creating [HR-CLOSE] child for Phase 10." }

PATCH /api/issues/{PAPERCLIP_TASK_ID}
{ "status": "done", "comment": "Phase 9 complete. Next: [HR-CLOSE]." }
```

Exit heartbeat. ✓

---

## Failure handling reference

| Situation | Action |
|---|---|
| `run-state.json` missing at Step 1 | Blocked comment on this issue + parent. STOP. |
| `approval_id` mismatch (Guard 1) | Blocked comment, Phase Tracker row 9 → blocked. STOP. |
| Approval not approved (Guard 2) | Blocked comment, Phase Tracker row 9 → blocked. STOP. |
| Fallback transfer fails for some files | Continue with rest, escalate per failure, do NOT block phase. |
| Fallback transfer fails for ALL files | Notify human, Phase Tracker row 9 → blocked. STOP. |
| Exception notes write fails | Log warning, continue (non-blocking). |
| Upload-complete email fails after retry | Audit-log escalated, log warning, continue. |
| `case-tracker.md` write fails after retry | Notify human, audit-log escalated, STOP. |
| `run-state.json` write fails after retry | Notify human, Phase Tracker row 9 → blocked. STOP. |
| `[HR-CLOSE]` create fails after retry | Blocked comment, Phase Tracker row 9 → blocked. STOP. |
| Audit-log write fails after retry | Notify human, Phase Tracker row 9 → blocked. STOP. |

---

## What this phase does NOT do

- Send the candidate completion email (Phase 10).
- Send the IT setup email (Phase 10).
- Mark parent orchestrator issue as `done` (Phase 10).
- Validate documents (Phase 5).
- Re-upload raw files (Phase 4 already did, and they are preserved as-is).
- Re-create or re-poll approval — heartbeat detected the approved transition and that is why we are here.
- Run a fresh round of document-validator skill — Phase 5 already validated; this phase only acts on the approved verified set.

---

## Status on exit

Per `_shared.md § §21`:

| Outcome | This child issue (`[HR-UPLOAD-SP]`) | Parent orchestrator issue |
|---|---|---|
| Final SharePoint upload + verification complete → `[HR-CLOSE]` created | `done` | `in_progress` (Phase 10 about to run) |
| Verified file count mismatch / fallback path needed | `done` after fallback completes; comment names exception_notes file | `in_progress` |
| Upload total fail | `blocked` | `blocked` |
| run-state or audit-log write failed | `blocked` | `blocked` |
