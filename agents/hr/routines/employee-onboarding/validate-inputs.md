# Phase 1 — Validate Inputs

**Title prefix:** `[HR-VALIDATE-INPUTS]`
**Created by:** orchestrator (`employee-onboarding.md` Step 7)
**Creates next:** `[HR-SEND-INITIAL]` child issue

---

## No-leak header

**TOOL RULE LINE 1:** This phase runs ONLY SharePoint folder/file tools (`sharepoint_list_folder`, `sharepoint_create_folder`, `sharepoint_copy_file`, `sharepoint_read_file`, `sharepoint_write_file`, `sharepoint_get_file_info`) and one `outlook_send_email` call (only if `phone_number` missing or `employee_type == rehire`). NO other tools.

**STATE:** Read `run_state_path` from this issue description. Append `validate_inputs` section to run-state.json before creating next child.

**CREATES NEXT:** `[HR-SEND-INITIAL]` child issue. Exit AFTER child confirmed created.

**DO NOT:**
- Send the initial document-request email (that is Phase 2).
- Process candidate replies (Phase 4).
- Run document validation (Phase 5).
- Create Paperclip approvals (Phase 7+8).
- Upload anything to `02_Verified_Documents/` (Phase 7+8 or 9).
- Re-read `employee-onboarding.md` (the orchestrator). You already came from it via the new child issue.

---

## References

- Conventions: `routines/employee-onboarding/_shared.md`
- Templates: `routines/employee-onboarding/_email-templates.md`

This file references those by section. Do NOT duplicate their content here.

---

## Step 1 — Load run-state.json

Read `run_state_path` from the current issue description (per `_shared.md § §15`).

```
sharepoint_read_file path="{run_state_path}"
→ Parse JSON. Validate schema_version == 1.
→ IF file missing → see _shared.md § §17 (post blocked comment on this issue + parent_issue_id, STOP).
```

Extract into local variables — **read paths from run-state top-level fields, do NOT recompute:**

```
payload                = run_state.payload
employee_full_name     = payload.employee_full_name
employee_email         = payload.employee_email
date_of_joining        = payload.date_of_joining
case_id                = run_state.case_id
parent_issue_id        = run_state.parent_issue_id
base_folder            = run_state.base_folder              ← read from run-state, rehire-aware (see _shared.md § §11)
run_state_path         = run_state.run_state_path           ← read from run-state
case_tracker_path      = run_state.case_tracker_path        ← read from run-state
```

**Guard:** if `base_folder` / `case_tracker_path` are missing from run-state (older orchestrator wrote partial schema), post blocked comment on this issue + parent. STOP. The orchestrator MUST populate these.

---

## Step 2 — Inspect optional payload fields

The orchestrator already validated ALL required fields (see orchestrator Step 1). Phase 1 does NOT re-validate them — trust the orchestrator. If a required field is somehow missing from `run_state.payload` here, that is a schema corruption, not an input error: post blocked comment "run-state.payload is missing required field {x} — orchestrator should have blocked this. Schema corruption suspected." Notify human, STOP.

Phase 1's job at this step: inspect OPTIONAL fields and act on each.

**Optional fields inspected:** `phone_number`, `alternate_candidate_email`, `date_of_birth`, `permanent_address`, `temporary_address`, `hiring_manager_name`, `hiring_manager_email`, `business_unit`, `location`, `joining_mode`, `notes_from_hr`, `special_document_requirements`.

### Step 2a — Phone number missing or empty

If `payload.phone_number` is missing, null, or empty string:

```
outlook_send_email using template _email-templates.md § §PHONE_NUMBER_REQUEST
→ to: {employee_email}
→ isHtml: true
→ on failure: notify {human_in_loop_email} via plain outlook_send_email (subject "HR Alert: Failed to send phone-number request"), append escalated row to audit-log per _shared.md § §4. Continue — do not STOP for this.
```

Then in run-state.json set `payload.phone_number = "pending — requested via email"`.

Post comment on this issue:
```
"phone_number missing in payload — request email sent to {employee_email}. Proceeding with onboarding. Phone will be filled in by Phase 4 when candidate replies."
```

Continue to Step 2b. Do NOT stop.

### Step 2b — Unknown employee_type (REMOVED)

The orchestrator (Step 1) validates `employee_type` against the allowed list and blocks the run before Phase 1 is ever reached. This step is intentionally a no-op in Phase 1.

If you somehow encounter an unrecognized `employee_type` here (orchestrator was bypassed), treat as schema corruption:
- Post blocked comment on this issue + `parent_issue_id`: "employee_type={value} is not in allowed list. Orchestrator should have blocked. Suspected schema bypass."
- Notify `human_in_loop_email`. STOP. Do NOT call `§UNKNOWN_EMPLOYEE_TYPE_ALERT` (orchestrator already did).

### Step 2c — Other required fields missing (REMOVED)

Same as 2b — orchestrator already validated. Treat any missing required field as schema corruption: blocked comment + notify human + STOP.

### Step 2d — Rehire pre-confirmation

If `payload.employee_type == "rehire"`:

```
outlook_send_email using template _email-templates.md § §INITIAL_REHIRE_PRECONFIRMATION
→ to: {human_in_loop_email}
```

This does NOT block the pipeline. Phase 2 will still send the standard document request, but the human reviewer has been pinged that this is a rehire so they can validate that prior-doc reuse is acceptable.

Continue to Step 3.

---

## Step 3 — Orphan-folder reconcile + create SharePoint subfolders

### Step 3a — Orphan reconcile check (Branch B from orchestrator)

The orchestrator may have routed here via Branch B (folder exists but no run-state.json). Phase 1 MUST detect a pre-existing `case-tracker.md` before overwriting anything:

```
sharepoint_get_file_info path="{case_tracker_path}"
→ IF file exists (size > 0):
    - Notify {human_in_loop_email}:
        subject: "HR Alert: Orphan case-tracker.md found — {employee_full_name}"
        isHtml: true
        body: <p>Hi,</p><p>A pre-existing case-tracker.md was found at <strong>{case_tracker_path}</strong> for case <strong>{case_id}</strong>. The orchestrator routed here via Branch B (orphan-folder reconcile). Phase 1 refuses to overwrite the existing tracker.</p><p>Manual reconcile required — either delete the orphan tracker or cancel the new onboarding trigger.</p><p>Regards,<br>HR Automation</p>
    - Append to audit-log per _shared.md § §4:
      {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|escalated|escalated|Orphan case-tracker.md found — refusing to overwrite|path={case_tracker_path}|{PAPERCLIP_TASK_ID}
    - Post blocked comment on this issue + parent_issue_id with the same message. STOP. Do NOT proceed to Step 3b.
→ IF file does not exist (or get_file_info returns 404): continue to Step 3b.
```

### Step 3b — Create the three subfolders

The base folder already exists (orchestrator created it). Create the three subfolders below it.

```
sharepoint_create_folder
  parentPath="{base_folder}"
  folderName="01_Raw_Submissions"

sharepoint_create_folder
  parentPath="{base_folder}"
  folderName="02_Verified_Documents"

sharepoint_create_folder
  parentPath="{base_folder}"
  folderName="03_Exception_Notes"
```

For each call: on `"already exists"` response → continue (orphan-reuse case). On any other error → notify `human_in_loop_email`, append escalated row to audit-log, STOP. Do NOT continue with partial folder structure.

---

## Step 4 — Copy HRMS Excel template

```
sharepoint_copy_file
  sourcePath     = "hr-onboarding/templates/EmployeeSheet_Onboarding_Form_Medicodio_HRMS.xlsx"
  destFolderPath = "{base_folder}"
  newName        = "EmployeeSheet_{employee_full_name}.xlsx"
```

**Critical — capture the `webUrl` from the copy response.** This is the per-employee form link. Do NOT use the template's URL.

### Step 4a — Fail-close validation

The HRMS form link is mandatory for Phase 2's initial email. If this step does not produce a usable `excel_url`, **the routine MUST NOT create the `[HR-SEND-INITIAL]` child issue.** Reason: Phase 2 would emit an email without the form link (silent missing-form-link delivery to candidate) or block at its own precondition wasting a heartbeat cycle.

Validate the copy:
```
sharepoint_get_file_info path="{base_folder}/EmployeeSheet_{employee_full_name}.xlsx"
→ Confirm size > 0.
→ Confirm webUrl is non-empty and well-formed (starts with "https://").
```

**If ANY check fails (copy returned no webUrl, file size 0, webUrl empty/malformed):**
1. Notify `{human_in_loop_email}` — subject `HR Alert: HRMS Excel template copy failed — {employee_full_name}`, body names the failing check.
2. Append audit-log row (13 columns, col-13 = `outlook` since the human-notify email used Outlook):
   ```
   {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|blocked|phase_blocked|HRMS Excel copy failed — {which_check} — Phase 1 cannot complete|excel_url={got_value}|{PAPERCLIP_TASK_ID}|outlook
   ```
   (`current_status = blocked`, `event = phase_blocked` per `_shared.md § §5`.)
3. Post Paperclip comment on THIS issue:
   ```
   POST /api/issues/{PAPERCLIP_TASK_ID}/comments
   { "body": "Phase 1 blocked — HRMS Excel template copy did not return a usable webUrl. {which_check} failed. Human notified at {human_in_loop_email}. Phase 2 NOT created. Fix the SharePoint template or path, then re-trigger [HR-ONBOARD]." }
   ```
4. PATCH this issue: `{ "status": "blocked", "comment": "See above." }`. Phase Tracker row 1 → `blocked`.
5. **STOP. Do NOT create `[HR-SEND-INITIAL]`.** The case is parked until a human re-triggers.

Store `excel_url = {webUrl from copy response}` only after all checks pass.

---

## Step 5 — Build the per-employee `case-tracker.md`

Use the template from `_shared.md § §13`. Substitute all `{placeholders}` with the values from `run_state.payload` (or the `case_id`, `excel_url`, `parent_issue_id` you computed). For optional fields that are absent, write `—` (em-dash). For `phone_number` after Step 2a, write `pending — requested via email`.

### Document Tracker rows

The `{document_rows_by_employee_type}` placeholder MUST be expanded based on `payload.employee_type`. Use this mapping:

#### `intern` / `fresher`
```markdown
| Latest Resume                          | Yes | pending | — | — | — |
| Passport Size Photo                    | Yes | pending | — | — | — |
| Education Certificates (SSLC → highest) | Yes | pending | — | — | — |
| PAN Card                               | Yes | pending | — | — | — |
| Passport (if applicable)               | No  | pending | — | — | — |
| Permanent Address                      | Yes | pending | — | — | — |
| Temporary Address                      | Yes | pending | — | — | — |
| Aadhaar Card                           | Yes | pending | — | — | — |
| Address Proof (Aadhaar / DL / Voter ID)| Yes | pending | — | — | — |
| Full Name                              | Yes | pending | — | — | — |
| Email                                  | Yes | pending | — | — | — |
| Date of Birth                          | Yes | pending | — | — | — |
| HRMS Onboarding Form (Excel)           | Yes | pending | — | — | — |
```

#### `fte` / `experienced`
```markdown
| Highest Qualification Certificate              | Yes | pending | — | — | — |
| All Companies Offer / Appointment Letters      | Yes | pending | — | — | — |
| 3 Months Payslips                              | Yes | pending | — | — | — |
| All Companies Relieving Letters                | Yes | pending | — | — | — |
| Aadhaar Card                                   | Yes | pending | — | — | — |
| PAN Card                                       | Yes | pending | — | — | — |
| Address Proof                                  | Yes | pending | — | — | — |
| Full Name                                      | Yes | pending | — | — | — |
| Email                                          | Yes | pending | — | — | — |
| Date of Birth                                  | Yes | pending | — | — | — |
| HRMS Onboarding Form (Excel)                   | Yes | pending | — | — | — |
```

#### `contractor`
```markdown
| Latest Resume                                  | Yes | pending | — | — | — |
| PAN Card                                       | Yes | pending | — | — | — |
| Aadhaar Card                                   | Yes | pending | — | — | — |
| Address Proof                                  | Yes | pending | — | — | — |
| Full Name                                      | Yes | pending | — | — | — |
| Email                                          | Yes | pending | — | — | — |
| Date of Birth                                  | Yes | pending | — | — | — |
| HRMS Onboarding Form (Excel)                   | Yes | pending | — | — | — |
[IF payload.special_document_requirements present and non-empty:
| Additional ({special_document_requirements})  | Yes | pending | — | — | — |
]
```

#### `rehire`
```markdown
| Latest Resume                                  | Yes | pending | — | — | — |
| Updated Address                                | Yes | pending | — | — | — |
| Address Proof                                  | Yes | pending | — | — | — |
| Updated PAN (if changed)                       | No  | pending | — | — | — |
| Updated Aadhaar (if changed)                   | No  | pending | — | — | — |
| Full Name                                      | Yes | pending | — | — | — |
| Email                                          | Yes | pending | — | — | — |
| Date of Birth                                  | Yes | pending | — | — | — |
| HRMS Onboarding Form (Excel)                   | Yes | pending | — | — | — |
```

### Phase Tracker initial rows

The `## Phase Tracker` table MUST include all 11 rows (0 through 10). Row 0 (orchestrator) is `done` because we got here. Row 1 (validate-inputs) is initially `in_progress` — Step 7 below flips it to `done` before child creation.

```markdown
| 0   | Orchestrator           | employee-onboarding.md          | done        | {orchestrator_started_at} | {orchestrator_completed_at} | {parent_issue_id} | Run-state.json written |
| 1   | Validate inputs        | validate-inputs.md              | in_progress | {now}                     | —                           | {PAPERCLIP_TASK_ID} | Phase 1 started |
| 2   | Send initial email     | send-initial.md                 | pending     | —    | —    | — | — |
| 3   | Await candidate reply  | await-reply.md                  | pending     | —    | —    | — | — |
| 4   | Process reply          | process-reply.md                | pending     | —    | —    | — | — |
| 5   | Validate documents     | validate-docs.md                | pending     | —    | —    | — | — |
| 6   | Request resubmission   | request-resubmission.md         | pending     | —    | —    | — | — |
| 7+8 | Complete + approval    | complete-submission.md          | pending     | —    | —    | — | — |
| 9   | Upload to SharePoint   | upload-sharepoint.md            | pending     | —    | —    | — | — |
| 10  | Close case             | close-case.md                   | pending     | —    | —    | — | — |
```

Use `run_state.created_at` for row 0's `Started` and `run_state.orchestrator.completed_at` for row 0's `Completed`.

### Status History initial row

```markdown
| {run_state.created_at} | initiated | Case created (orchestrator) |
```

(Phase 1 will add a second row in Step 7 when it completes.)

### Write the file

```
sharepoint_write_file path="{case_tracker_path}" content="{full case-tracker.md from _shared.md § §13 template, all placeholders filled, Phase Tracker built per above, Document Tracker rows expanded per employee_type}"
→ On write failure: retry once. If still fails: notify {human_in_loop_email}, append escalated row to audit-log, STOP.
```

---

## Step 6 — Seed audit-log row

Append per `_shared.md § §3` and `§4`:

```
{now}|{case_id}|{employee_email}|{employee_full_name}|{payload.employee_type}|{payload.human_in_loop_email}|{payload.recruiter_or_hr_name}|initiated|sharepoint_folder_created|Subfolders created (01_Raw, 02_Verified, 03_Exception). HRMS Excel copied. case-tracker.md written.|excel_url={excel_url}|{PAPERCLIP_TASK_ID}
```

---

## Step 7 — Update run-state.json

Append `validate_inputs` section. Add `validate_inputs` to `phases_complete[]`. Set `current_phase = "send_initial"`. Set `last_updated = now`.

```json
"validate_inputs": {
  "status": "complete",
  "completed_at": "{ISO now}",
  "folders_created": ["01_Raw_Submissions", "02_Verified_Documents", "03_Exception_Notes"],
  "excel_url": "{excel_url}",
  "excel_file_path": "{base_folder}/EmployeeSheet_{employee_full_name}.xlsx",
  "case_tracker_path": "{case_tracker_path}",
  "phone_number_request_sent": true|false,
  "rehire_preconfirmation_sent": true|false
}
```

Also update `payload.phone_number` in run-state if Step 2a fired (set to `"pending — requested via email"`).

Write per `_shared.md § §12` read/write pattern:
```
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
→ On retry failure: notify human, set Phase Tracker row 1 → blocked, STOP. Do NOT create next child.
```

---

## Step 8 — Flip Phase Tracker row 1 → done

Read `case-tracker.md`, update row 1 in the Phase Tracker table:

```
| 1 | Validate inputs | validate-inputs.md | done | {started_at} | {now} | {PAPERCLIP_TASK_ID} | Inputs validated; folders + Excel + case-tracker created |
```

Append a new row to Status History:
```
| {now} | initiated | Phase 1 complete — folders, Excel form, case-tracker initialised |
```

Write the updated case-tracker:
```
sharepoint_write_file path="{case_tracker_path}" content="{updated content}"
→ On failure: retry once. If still fails: notify human, append escalated row, STOP — do NOT create next child.
```

---

## Step 9 — Post comment on this issue

```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "body": "Phase 1 complete. Subfolders created. HRMS form: {excel_url}. case-tracker.md written. Creating [HR-SEND-INITIAL] child for Phase 2."
}
```

---

## Step 10 — Create `[HR-SEND-INITIAL]` child issue

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[HR-SEND-INITIAL] {employee_full_name} — Phase 2 send initial email",
  "description": "phase_file: routines/employee-onboarding/send-initial.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}\ncase_id: {case_id}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
→ IF creation fails: retry once. If still fails: post blocked comment with the API error. Flip Phase Tracker row 1 back to in_progress AND add a `blocked` note. STOP — do NOT mark this issue done.
→ Store returned issue id as send_initial_issue_id.
```

---

## Step 11 — Close this child issue and exit

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "status": "done",
  "comment": "Phase 1 complete. Next: [HR-SEND-INITIAL] created ({send_initial_issue_id})."
}
```

Exit heartbeat. ✓

---

## Failure handling reference (Phase 1 specific)

| Situation | Action |
|---|---|
| `run-state.json` missing at Step 1 | See `_shared.md § §17` — blocked comment on this issue + parent. STOP. |
| Required field missing (Step 2c) | Blocked comment listing fields + notify human. STOP. |
| Unknown `employee_type` (Step 2b) | Notify human via `§UNKNOWN_EMPLOYEE_TYPE_ALERT`. STOP. |
| Folder create fails (Step 3) other than "already exists" | Notify human, audit-log escalated row, STOP. |
| HRMS Excel copy returns size=0 or no webUrl (Step 4) | Notify human, audit-log escalated row, STOP. |
| `case-tracker.md` write fails (Step 5) | Retry once. If still fails: notify human, audit-log escalated row, STOP. |
| `run-state.json` write fails (Step 7) | Retry once. If still fails: notify human, Phase Tracker row 1 → blocked, STOP. |
| `[HR-SEND-INITIAL]` create fails (Step 10) | Retry once. If still fails: blocked comment, Phase Tracker row 1 → blocked, STOP. |

---

## What this phase does NOT do

- Send the document-request email (Phase 2 `send-initial.md`).
- Send any Teams notification (Phase 2 sends `§Teams_Onboarding_Started` after the initial email is on the wire).
- Process candidate replies or attachments (Phase 4).
- Run document validation (Phase 5).
- Touch `01_Raw_Submissions`, `02_Verified_Documents`, or `03_Exception_Notes` content — only creates the empty folders.

---

## Status on exit

Per `_shared.md § §21`:

| Outcome | This child issue (`[HR-VALIDATE-INPUTS]`) | Parent orchestrator issue |
|---|---|---|
| Success → `[HR-SEND-INITIAL]` created | `done` (PATCH at Step 10 close-issue equivalent) | stays `in_progress` (active processing — Phase 2 about to run) |
| HRMS Excel copy failed (Step 4a) | `blocked` with comment naming the failing check | `blocked` with same reason |
| Folder create or run-state write failed | `blocked` | `blocked` |
| Any required env var missing at wake | `blocked` (per §20) | `blocked` |

No silent exits. If you skip the PATCH because the phase is delegating to a child, the comment MUST say so explicitly.
