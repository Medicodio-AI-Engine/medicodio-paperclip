# Phase 10 — Close Case

**Title prefix:** `[HR-CLOSE]`
**Created by:** `upload-sharepoint.md` Step 11.
**Creates next:** NONE. This is the terminal phase. It also PATCHes the parent orchestrator issue to `done`.

---

## No-leak header

**TOOL RULE LINE 1:** This phase uses: `sharepoint_read_file` / `sharepoint_write_file` for run-state and case-tracker, `outlook_send_email` TWICE (candidate completion + IT setup), `teams_send_channel_message` non-blocking, Paperclip API (PATCH parent issue to done, PATCH this issue to done, POST comments). NO other tools. NO transfers. NO `outlook_read_attachment`. NO list/search operations.

**STATE:** Read `run_state_path` from this issue description. Append `close_case` section to run-state.json before exit.

**CREATES NEXT:** Nothing. Terminal. PATCHes parent orchestrator issue to `done`.

**DO NOT:**
- Upload anything (Phase 9 already finalized SharePoint state).
- Re-run validation (Phase 5 already did).
- Re-send the verification request (Phase 7+8 already did).
- Re-create the approval (Phase 7+8 already did; Phase 9 confirmed it approved).
- Skip the IT setup email — it is required for every closed onboarding.

---

## References

- Conventions: `routines/employee-onboarding/_shared.md`
- Templates: `routines/employee-onboarding/_email-templates.md`

---

## Step 1 — Load run-state.json

```
sharepoint_read_file path="{run_state_path}"
→ Parse JSON. Validate schema_version == 1.
→ IF file missing → blocked comment on this issue + parent_issue_id, STOP.
```

Extract — **read paths from run-state top-level:**
```
payload                  = run_state.payload
employee_full_name       = payload.employee_full_name
employee_email           = payload.employee_email
alternate_email          = payload.alternate_candidate_email
phone_number             = payload.phone_number
role                     = payload.role
employee_type            = payload.employee_type
date_of_joining          = payload.date_of_joining
human_in_loop_email      = payload.human_in_loop_email
recruiter_or_hr_name     = payload.recruiter_or_hr_name
recruiter_or_hr_email    = payload.recruiter_or_hr_email
case_tracker_path        = run_state.case_tracker_path     ← top-level
base_folder              = run_state.base_folder           ← top-level (rehire-aware)
case_id                  = run_state.case_id
parent_issue_id          = run_state.parent_issue_id
```

**Guards:**
- If `run_state.upload_sharepoint.status != "complete"` → blocked comment "Phase 10 invoked but Phase 9 did not complete." Phase Tracker row 10 → `blocked`. STOP.
- If `run_state.complete_submission.status != "complete"` → blocked comment "Phase 10 invoked but Phase 7+8 did not complete." Phase Tracker row 10 → `blocked`. STOP.
- All of the following MUST be true:
  - At least one verified file present in `02_Verified_Documents/` (per `run_state.upload_sharepoint.verified_present_count > 0`).
  - Approval status is approved (per `run_state.upload_sharepoint.approval_id` and `approved_at` present).
- If any guard fails → blocked comment listing the specific failure. STOP.

---

## Step 2 — Flip Phase Tracker row 10 → in_progress

Update row 10:
```
| 10 | Close case | close-case.md | in_progress | {now} | — | {PAPERCLIP_TASK_ID} | Sending candidate + IT emails, closing case |
```
Write the file. On retry failure: notify human, audit-log escalated, STOP.

---

## Step 3 — Send candidate completion email

Use `_email-templates.md § §COMPLETION_CANDIDATE` to `{employee_email}`. If `alternate_email` is non-null and non-empty, include it in `ccRecipients` (otherwise omit the CC list entirely).

Capture returned `messageId` as `completion_email_message_id`.

**On failure:**
- Retry once after 5s.
- If still fails: `outlook_send_email` to `{human_in_loop_email}` (subject `HR Alert: Failed to send completion email — {employee_full_name}`). Audit-log escalated row. Phase Tracker row 10 → `blocked`. STOP — do NOT close case until candidate is informed.

Recipients accumulator:
```
candidate_recipients = ["{employee_email}"]
IF alternate_email present: candidate_recipients.append("{alternate_email}")
```

---

## Step 4 — Send IT setup notification email

Use `_email-templates.md § §IT_SETUP` to `$IT_SUPPORT_EMAIL` (env var, typically `itadmin@medicodio.ai`), CC `{human_in_loop_email}` and `{recruiter_or_hr_email}`.

**On failure:**
- Retry once after 5s.
- If still fails: `outlook_send_email` to `{human_in_loop_email}` (subject `HR Alert: Failed to send IT setup email — {employee_full_name}`). Audit-log warning row. Continue (NON-blocking — the case still closes, but IT must be notified manually).
- **Persist failure for heartbeat retry sweep:** write `run_state.close_case.it_setup_email_sent = false` and `run_state.close_case.it_setup_retries = 0`. The `email-heartbeat.md` IT-retry sweep will scan completed cases with `it_setup_email_sent == false` and re-attempt up to 3 times.

Capture returned `messageId` as `it_setup_email_message_id`. If failed, leave as `null`.

---

## Step 5 — Append audit-log row (delivery gate — TASK-011 + TASK-013)

Compute delivery proof BEFORE writing any row:

```
candidate_ok = candidate_completion_message_id is non-empty string of length >= 20
it_ok        = it_setup_email_message_id is non-empty string of length >= 20
```

Step 3 retry policy already blocks the phase when `candidate_ok` is false, so reaching this step implies `candidate_ok == true`. The decision below is therefore driven by `it_ok`.

### Step 5a — Branch on it_ok

**Branch — `it_ok == true` (both mails proven sent):**

Append exactly one audit-log row, event = `case_completed`. The brief_reason includes BOTH messageIds verbatim — this is the end-to-end delivery audit (TASK-013):

```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|completed|case_completed|Onboarding closed — candidate completion mail + IT setup mail both confirmed sent|candidate_msg={candidate_completion_message_id} it_msg={it_setup_email_message_id} recipients={candidate_recipients joined by ","}|{PAPERCLIP_TASK_ID}
```

Audit-log readers (heartbeat sweeps, dashboards, status checks) treat `case_completed` as proof of both deliveries. The row format is the contract.

**Branch — `it_ok == false` (candidate mail sent, IT mail failed):**

Do NOT write `case_completed`. Write `case_completion_partial` instead — heartbeat IT-setup-retry sweep (`email-heartbeat.md` STEP 5d) re-attempts IT mail and flips the row only after a successful retry:

```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|completed|case_completion_partial|Onboarding closed for candidate but IT setup mail failed — heartbeat IT-retry sweep will re-attempt|candidate_msg={candidate_completion_message_id} it_msg=null|{PAPERCLIP_TASK_ID}
```

The candidate-facing closure stands (mail confirmed delivered). Only the IT-side leg is pending. Heartbeat sweep flips this case to `case_completed` (with both messageIds) once IT mail lands.

Either way, write exactly ONE row in Step 5 per phase wake.

---

## Step 6 — Update run-state.json

Append:
```json
"close_case": {
  "status": "complete | partial_it",
  "completed_at": "{ISO now}",
  "candidate_completion_email_sent": true,
  "candidate_completion_retries": 0,
  "candidate_completion_recipients": ["{employee_email}", "{alternate_email if present}"],
  "candidate_completion_message_id": "{completion_email_message_id}",
  "it_setup_email_sent": true|false,
  "it_setup_retries": 0,
  "it_setup_recipients": ["$IT_SUPPORT_EMAIL", "{human_in_loop_email}", "{recruiter_or_hr_email}"],
  "it_setup_message_id": "{it_setup_email_message_id or null}",
  "parent_patch_succeeded": true|false,
  "parent_patch_retries": 0,
  "final_status": "completed | completion_partial"
}
```

Field meaning:
- `status = "complete"` ⇔ both mails proven sent. Audit row written in Step 5 is `case_completed`.
- `status = "partial_it"` ⇔ candidate mail proven sent, IT mail failed. Audit row is `case_completion_partial`. Heartbeat IT-retry sweep (`email-heartbeat.md` STEP 5d) reads `it_setup_email_sent == false` and re-attempts; on success it writes `case_completed` and flips both fields.
- `candidate_completion_email_sent` always `true` here (Step 3 blocks the phase otherwise).
- `candidate_completion_retries` / `it_setup_retries` are heartbeat-owned counters. Phase 10 writes them as `0` initially.

Top-level:
- Add `close_case` to `phases_complete[]`.
- `current_phase = "closed"` (terminal sentinel).
- `last_updated = now`.

Write per `_shared.md § §12`. On retry failure: notify human, Phase Tracker row 10 → `blocked`, STOP. (Emails already sent — log warning that run-state may be stale.)

---

## Step 7 — Update case-tracker — flip header to COMPLETED, row 10 to done

Read `case-tracker.md`. Update the top header:
```
**CASE STATUS: COMPLETED**
```
(replacing the existing `**CASE STATUS: IN PROGRESS**`).

Update row 10:
```
| 10 | Close case | close-case.md | done | {row10.Started from Step 2} | {now} | {PAPERCLIP_TASK_ID} | Completion email sent ({completion_email_message_id}); IT email {sent or failed} |
```

Append Status History rows:
```
| {now} | completed | All phases complete. Completion email sent to candidate ({candidate_recipients}). IT setup email {sent to ITSUPPORT_EMAIL or "send failed — see audit-log"}. |
```

Write the file. On retry failure: notify human, audit-log escalated, STOP.

---

## Step 8 — Teams notification (non-blocking)

Use `_email-templates.md § §Teams_Onboarding_Complete`. Substitute all placeholders. Non-blocking per `_shared.md § §18`.

---

## Step 9 — PATCH parent orchestrator issue to `done`

This is the ONLY phase that closes the parent orchestrator issue.

```
PATCH /api/issues/{parent_issue_id}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "status": "done",
  "comment": "Onboarding completed for {employee_full_name}. Case ID: {case_id}. SharePoint: {base_folder}/. Completion email sent to: {candidate_recipients}. IT setup notification: {sent or failed — see audit-log}."
}
```

**On failure (retry once):** audit-log escalated row, notify human (subject `HR Alert: Failed to mark parent issue as done — {employee_full_name}`). Continue — do NOT block this issue from closing. The audit-log + case-tracker already say `completed`.

**Persist failure for heartbeat retry sweep:** write `run_state.close_case.parent_patch_succeeded = false` and `run_state.close_case.parent_patch_retries = 0`. The `email-heartbeat.md` parent-PATCH sweep will scan completed cases with `parent_patch_succeeded == false` and re-attempt the PATCH up to 5 times.

---

## Step 10 — Post comment and close this child issue

```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
{ "body": "Phase 10 complete. Case CLOSED. SharePoint: {base_folder}/. Completion email sent to {candidate_recipients}. IT setup email sent to $IT_SUPPORT_EMAIL." }

PATCH /api/issues/{PAPERCLIP_TASK_ID}
{ "status": "done", "comment": "Phase 10 complete. Onboarding pipeline closed." }
```

Exit heartbeat. ✓

---

## Failure handling reference

| Situation | Action |
|---|---|
| `run-state.json` missing at Step 1 | Blocked comment on this issue + parent. STOP. |
| Guards in Step 1 fail | Blocked comment listing failure. STOP. |
| Candidate completion email fails after retry | Notify human, audit-log escalated, Phase Tracker row 10 → blocked. STOP. |
| IT setup email fails after retry | Notify human, audit-log warning row. Continue (non-blocking). |
| `case-tracker.md` write fails after retry | Notify human, audit-log escalated, STOP. |
| `run-state.json` write fails after retry | Notify human, Phase Tracker row 10 → blocked. STOP. |
| Parent issue PATCH to done fails | Notify human, audit-log escalated. Continue closing this issue. |
| Audit-log write fails after retry | Notify human, Phase Tracker row 10 → blocked. STOP. |

---

## What this phase does NOT do

- Upload or delete anything in SharePoint (Phase 9 finalized).
- Send any reminder (heartbeat owns nudges, and we are past nudges here).
- Create another child issue. Terminal.
- Re-poll approvals (Phase 9 already acted on the approved transition).
- Re-validate documents.
- Modify Document Tracker statuses (Phase 9 set them to `uploaded`).

---

## Status on exit

Per `_shared.md § §21`. This is the **terminal** phase — only phase that closes the parent.

| Outcome | This child issue (`[HR-CLOSE]`) | Parent orchestrator issue |
|---|---|---|
| Candidate completion email + IT setup email + parent PATCH all succeed | `done` | **`done`** (terminal — case_status = `completed`) |
| Completion email send fail (after retry) | `blocked` | `blocked` |
| IT setup email send fail (after retry) | `done` for this child; parent stays `in_progress` and heartbeat IT-setup-retry sweep picks it up | `in_progress` (heartbeat will close once retry succeeds) |
| Parent PATCH to `done` fails | `done` for this child; parent stays unchanged and heartbeat parent-patch-retry sweep picks it up | unchanged; heartbeat will finalize |
