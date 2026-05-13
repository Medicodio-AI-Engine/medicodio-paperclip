# Employee Onboarding — Orchestrator

**Trigger:** API-triggered (HR agent heartbeat detected an onboarding issue) or manual via Paperclip.
**Concurrency policy:** `always_enqueue` — each employee is a separate independent run.
**Catch-up policy:** `skip_missed`.

**Role:** Bootstrap pipeline only. Phase 0 routing → validate payload → seed run-state.json → create first child issue. EXIT.

**DO NOT:** Execute any Phase 1–10 logic. Do not create SharePoint folders, send emails, copy templates, or process replies in this file. All phase work happens in `employee-onboarding/{phase-file}.md`.

---

## Phase Routing — Title Prefix Gate (FIRST CHECK ON EVERY WAKE)

When you wake, look at the current Paperclip issue title prefix BEFORE any other action.

| Title prefix | Read this file | Do NOT read this orchestrator |
|---|---|---|
| `[HR-ONBOARD]` | `routines/employee-onboarding.md` (this file) — continue below | — |
| `[HR-VALIDATE-INPUTS]` | `routines/employee-onboarding/validate-inputs.md` | ✗ |
| `[HR-SEND-INITIAL]` | `routines/employee-onboarding/send-initial.md` | ✗ |
| `[HR-AWAIT-REPLY]` | `routines/employee-onboarding/await-reply.md` | ✗ |
| `[HR-PROCESS-REPLY]` | `routines/employee-onboarding/process-reply.md` | ✗ |
| `[HR-ONBOARDING-REPLY]` (legacy) | `routines/employee-onboarding/process-reply.md` | ✗ |
| `[HR-VALIDATE-DOCS]` | `routines/employee-onboarding/validate-docs.md` | ✗ |
| `[HR-REQUEST-RESUB]` | `routines/employee-onboarding/request-resubmission.md` | ✗ |
| `[HR-COMPLETE-SUB]` | `routines/employee-onboarding/complete-submission.md` | ✗ |
| `[HR-UPLOAD-SP]` | `routines/employee-onboarding/upload-sharepoint.md` | ✗ |
| `[HR-CLOSE]` | `routines/employee-onboarding/close-case.md` | ✗ |

**If the current issue title starts with any `[HR-*]` prefix OTHER THAN `[HR-ONBOARD]`:**
Read the mapped phase file immediately. Follow ONLY that file. Do NOT continue reading this orchestrator. Do NOT re-bootstrap run-state.json. Do NOT re-create folders.

**If the current issue has no prefix or starts with `[HR-ONBOARD]`:** proceed with the orchestrator steps below.

**Backward-compat — payload-based legacy routing:** if the issue title has no `[HR-*]` prefix AND the run payload has `source: "api"` AND `messageId` is present, treat this wake as `[HR-PROCESS-REPLY]` — read `routines/employee-onboarding/process-reply.md` and follow it. Do NOT bootstrap a new run-state.json.

**Special case — heartbeat reply on a parked `[HR-AWAIT-REPLY]` issue:** if the title is `[HR-AWAIT-REPLY]` AND the payload also contains `messageId` (heartbeat injected a reply onto a parked phase issue rather than creating a new `[HR-PROCESS-REPLY]` child), route to `routines/employee-onboarding/process-reply.md`. Treat as if the title were `[HR-PROCESS-REPLY]`. Do NOT execute `await-reply.md`. This catches the race where the heartbeat reused the await-reply issue.

**Legacy `[HR-ONBOARDING-REPLY]` prefix:** route to `routines/employee-onboarding/process-reply.md` (see `_shared.md § §14` — listed in the routing table as the legacy alias for `[HR-PROCESS-REPLY]`).

---

## Shared conventions

All conventions (audit-log format, status table, ID masking, timestamps, HTML rule, binary upload rule, run-state.json schema, case-tracker.md schema, child issue description format, failure handling) live in:

```
routines/employee-onboarding/_shared.md
```

All email and Teams notification HTML bodies live in:

```
routines/employee-onboarding/_email-templates.md
```

This orchestrator references those files by section. It MUST NOT duplicate their content.

---

## Orchestrator Steps (fresh `[HR-ONBOARD]` trigger only)

### Step 0 — Confirm this is a fresh trigger

If you reached this step, the issue title starts with `[HR-ONBOARD]` (or no prefix and no `messageId` in payload). Continue.

If `source` and `messageId` came in via payload but the title prefix did NOT match a phase prefix above, that is a configuration error. Post a blocked comment on this issue:

```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
{
  "body": "Configuration error — issue has no [HR-*] title prefix but payload contains messageId. Cannot infer phase. Human must fix issue title or routine config."
}
```

→ Notify `human_in_loop_email` if known from payload. STOP.

### Step 1 — Read employee data from payload

Read order (do NOT skip steps):

1. Check `PAPERCLIP_WAKE_PAYLOAD_JSON` env var. If present, parse it, extract `payload` field.
2. If absent or `payload` empty: `GET /api/issues/{PAPERCLIP_TASK_ID}/heartbeat-context` (see `_shared.md § §19`). Extract employee fields from the run payload embedded in the response.
3. If still no employee data: scan the issue body for `employee_full_name:`, `employee_email:` etc. key-value lines (legacy compat path).
4. If none yielded the required base fields → post blocked comment listing the missing fields, notify `human_in_loop_email` if known (otherwise escalate via the team chain of command), STOP.

**FULL required-field validation (orchestrator now blocks early to avoid wasted scaffolding):**

| Field | Required | Notes |
|---|---|---|
| `employee_full_name` | yes | non-empty |
| `employee_email` | yes | non-empty, must contain `@` |
| `role` | yes | non-empty |
| `employee_type` | yes | MUST be one of: `intern`, `fresher`, `fte`, `experienced`, `contractor`, `rehire`. (`intern_fte_form` is deprecated — see `AGENTS.md`.) |
| `date_of_joining` | yes | ISO `YYYY-MM-DD` |
| `recruiter_or_hr_name` | yes | non-empty |
| `recruiter_or_hr_email` | yes | non-empty, must contain `@` |
| `human_in_loop_name` | yes | non-empty |
| `human_in_loop_email` | yes | non-empty, must contain `@` |

**Optional fields** (Phase 1 inspects but does not block on): `phone_number`, `alternate_candidate_email`, `date_of_birth` (ISO), `permanent_address`, `temporary_address`, `hiring_manager_name`, `hiring_manager_email`, `business_unit`, `location`, `joining_mode`, `notes_from_hr`, `special_document_requirements`.

**Validation behavior:**
- If `employee_type` value is missing OR not in the allowed list → send `_email-templates.md § §UNKNOWN_EMPLOYEE_TYPE_ALERT` to `human_in_loop_email` (if known), post blocked comment, STOP. Do NOT create run-state.json.
- If any OTHER required field is missing → post blocked comment listing the specific missing fields, notify `human_in_loop_email` (if known), STOP. Do NOT create run-state.json.
- This early validation prevents wasted scaffolding (folders, Excel copy, run-state, child issue) for payloads that Phase 1 would reject anyway.

### Step 2 — Compute case_id and SharePoint paths

```
case_id        = "{employee_email}-{date_of_joining}"           ← see _shared.md § §11
base_folder    = "HR-Onboarding/{employee_full_name} - {date_of_joining}"
run_state_path = "{base_folder}/run-state.json"
case_tracker_path = "{base_folder}/case-tracker.md"
```

### Step 3 — Idempotency check (rehire collision per _shared.md § §11)

```
sharepoint_list_folder path="HR-Onboarding"
→ does folder "{employee_full_name} - {date_of_joining}" already exist?
```

**Branch A — folder does NOT exist:** proceed to Step 4 with `case_id` unchanged.

**Branch B — folder exists AND no run-state.json inside it:** treat as orphaned scaffold. Proceed with `case_id` unchanged.

**Phase 1 reconcile contract for Branch B:** `validate-inputs.md` Step 5 MUST call `sharepoint_get_file_info` on `case_tracker_path` FIRST. If a pre-existing `case-tracker.md` is found, Phase 1 MUST escalate (notify human, do NOT overwrite). This protects against losing prior-run state when an orphan folder contained a case-tracker.md but no run-state.json. The orchestrator only checks for run-state.json here; case-tracker.md detection is Phase 1's responsibility.

**Branch C — folder exists AND run-state.json exists AND case_id status is NOT terminal** (terminal = `completed`, `cancelled`, `withdrawn`, `stalled`, `escalated`):
→ This is a duplicate workflow trigger for an ACTIVE case. Post blocked comment:

```
"Active onboarding case already in progress for {employee_full_name} (case_id: {case_id}, current_phase: {x}, run-state: {run_state_path}). Refusing to bootstrap a duplicate run. If this trigger is intentional, manually update or cancel the existing case first."
```

→ Notify `human_in_loop_email` via plain `outlook_send_email` (subject: `HR Alert: Duplicate onboarding trigger blocked — {employee_full_name}`). STOP.

---

### Step 3.5 — Audit-log scan for cross-case duplicates (CRITICAL — runs AFTER Branch A/B/C/D)

Folder-name check above only catches collisions where `employee_full_name + date_of_joining` matches EXACTLY. It does NOT catch the case where the SAME person was onboarded earlier with:
- a slightly different name (`Sameer Mansur` vs `Sameer S Mansur`), or
- a typo'd email that has since been corrected (`gmai.com` vs `gmail.com`), or
- mixed case / extra whitespace in either name or email.

Run this scan AFTER Branch A/B/C/D — even Branch A (folder doesn't exist) must run this check, because a duplicate may exist under a DIFFERENT folder name.

#### Normalization helpers

```
norm_email(s)        = trim(lowercase(s))
norm_name(s)         = trim(collapse_consecutive_whitespace(lowercase(s)))
levenshtein(a, b)    = standard edit distance (insertions + deletions + substitutions)
```

`collapse_consecutive_whitespace` replaces runs of `\s+` with a single space, then strips leading/trailing space.

#### Scan logic

```
sharepoint_read_file path="HR-Onboarding/audit-log.csv"
  → IF file missing: create with header row per _shared.md § §3, continue (no collisions possible since no prior cases).
  → ELSE parse pipe-delimited rows; skip header.

Group rows by case_id. For each case_id, capture the LATEST row's:
  - current_status (column 8)
  - employee_email (column 3)
  - employee_full_name (column 4)

Build active_cases = [
  { case_id, latest_status, employee_email, employee_full_name }
  for each case_id where latest_status NOT IN: completed, cancelled, withdrawn, stalled, escalated, blocked, escalated_approval_timeout
]

candidate = {
  norm_email_X = norm_email(payload.employee_email)
  norm_name_X  = norm_name(payload.employee_full_name)
  norm_date_X  = payload.date_of_joining   ← already ISO
}

collisions = []
FOR each c in active_cases:
  // Skip aggregate / non-case rows: heartbeat_tick + heartbeat_skip rows often carry case_id = "—".
  IF c.case_id == "—" OR c.case_id is empty: continue

  // Parse case_id with rehire-aware regex from _shared.md § §11:
  //   /^(.+@.+)-(\d{4}-\d{2}-\d{2})(?:-rehire-(\d+))?$/
  // Match groups → (email_Y, date_Y, rehire_N).
  IF case_id does NOT match the regex: continue   // malformed legacy row — skip rather than crash

  email_Y, date_Y, rehire_N = parsed groups
  norm_email_Y = norm_email(email_Y)
  norm_name_Y  = norm_name(c.employee_full_name)
  norm_date_Y  = date_Y

  IF norm_date_Y == norm_date_X:
      reason = null
      IF norm_email_Y == norm_email_X: reason = "exact_email_match"
      ELSE IF levenshtein(norm_email_Y, norm_email_X) <= 2: reason = "typo_distance_email"
      ELSE IF norm_name_Y == norm_name_X: reason = "exact_name_match"
      ELSE IF levenshtein(norm_name_Y, norm_name_X) <= 2: reason = "typo_distance_name"
      ELSE IF norm_name_Y starts with norm_name_X OR norm_name_X starts with norm_name_Y:
             reason = "name_prefix_overlap"   ← catches "Sameer Mansur" vs "Sameer S Mansur"

      IF reason is not null:
        collisions.append({ case_id: c.case_id, reason, latest_status: c.latest_status })
```

#### Branch on collisions

**If `collisions` is empty:** proceed to Step 4 (write run-state.json).

**If `collisions` is non-empty:** treat as a duplicate workflow attempt — block:

```
1. Post blocked comment on this issue:
   "Active onboarding case already exists for what appears to be the same candidate.
    Collisions found:
    {for each c in collisions: <li>case_id={c.case_id} (current_status={c.latest_status}) — reason: {c.reason}</li>}

    Refusing to bootstrap a new run. If this trigger is intentional (true rehire / different person / etc.),
    either cancel the existing case(s) OR re-trigger with payload-level flag `skip_dedup: true`."

2. outlook_send_email to human_in_loop_email (template _email-templates.md § §DUPLICATE_WORKFLOW_ALERT — see below):
   subject: HR Alert: Duplicate onboarding workflow blocked — {employee_full_name}
   body: include the same collision list + suggestion to resolve

3. Append to HR-Onboarding/audit-log.csv per _shared.md § §4:
   {now}|—|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|blocked|duplicate_workflow_detected|Orchestrator blocked — collision(s) with active case(s)|{collisions joined: case_id=X reason=Y; case_id=Z reason=W}|{PAPERCLIP_TASK_ID}
   ← case_id column is "—" because we refuse to commit to a new case_id when a duplicate is suspected.

4. STOP. Do NOT create run-state.json. Do NOT create any child issue.
```

#### Bypass via `skip_dedup`

If `payload.skip_dedup == true` (set by HR when re-triggering after confirming the new case is genuinely separate): skip the entire Step 3.5 scan, log the bypass in audit-log brief_reason, proceed to Step 4. Use sparingly — only when the existing case(s) genuinely refer to a different person/event.

**Branch D — folder exists AND run-state.json exists AND case_id status IS terminal `completed`:**
→ Rehire collision. Resolve per `_shared.md § §11`:
- Loop suffix `-rehire-1`, `-rehire-2`, … until a non-existent folder is found.
- New `case_id = "{employee_email}-{date_of_joining}-rehire-{N}"`
- Recompute `base_folder`, `run_state_path`, `case_tracker_path` with the new case_id (folder name stays `{employee_full_name} - {date_of_joining}-rehire-{N}`).
- `outlook_send_email` using template `_email-templates.md § §REHIRE_COLLISION_ALERT` to `human_in_loop_email` BEFORE Step 4.

### Step 4 — Write initial run-state.json

Use the schema in `_shared.md § §12`. Initial content:

```json
{
  "schema_version": 1,
  "case_id": "{case_id}",
  "parent_issue_id": "{PAPERCLIP_TASK_ID}",
  "base_folder": "{base_folder}",
  "run_state_path": "{run_state_path}",
  "case_tracker_path": "{case_tracker_path}",
  "created_at": "{ISO now}",
  "last_updated": "{ISO now}",
  "current_phase": "validate_inputs",
  "phases_complete": ["orchestrator"],
  "payload": {
    "employee_full_name": "...",                                  // required (orchestrator already validated)
    "employee_email": "...",                                      // required
    "role": "...",                                                // required
    "employee_type": "intern|fresher|fte|experienced|contractor|rehire",  // required
    "date_of_joining": "YYYY-MM-DD",                              // required
    "recruiter_or_hr_name": "...",                                // required
    "recruiter_or_hr_email": "...",                               // required
    "human_in_loop_name": "...",                                  // required
    "human_in_loop_email": "...",                                 // required
    "phone_number": "{value or null}",                            // optional
    "alternate_candidate_email": "{value or null}",               // optional
    "date_of_birth": "{ISO or null}",                             // optional
    "permanent_address": "{value or null}",                       // optional
    "temporary_address": "{value or null}",                       // optional
    "hiring_manager_name": "{value or null}",                     // optional
    "hiring_manager_email": "{value or null}",                    // optional — used by heartbeat 14-day escalation if present
    "business_unit": "{value or null}",                           // optional
    "location": "{value or null}",                                // optional
    "joining_mode": "{value or null}",                            // optional
    "notes_from_hr": "{value or null}",                           // optional
    "special_document_requirements": "{value or null}"            // optional — §INITIAL_CONTRACTOR consumes this
  },
  "reminders": {
    "nudge_1_sent_at": null,
    "nudge_2_sent_at": null
  },
  "orchestrator": {
    "status": "complete",
    "completed_at": "{ISO now}",
    "rehire_resolution": "{none | -rehire-1 | -rehire-2 | ...}"
  }
}
```

**Top-level paths (CRITICAL — phase files read these instead of recomputing):**
- `base_folder`: full path including rehire suffix if any. Example: `HR-Onboarding/Jane Doe - 2026-05-01-rehire-1`.
- `run_state_path`: `{base_folder}/run-state.json`.
- `case_tracker_path`: `{base_folder}/case-tracker.md`.

**IMPORTANT:** all required-list fields above were validated in Step 1 — write them as-is, no `null`. Only OPTIONAL fields may be `null`. Phase files trust these paths and field types.

Folder may not exist yet (Phase 1 creates the subfolders). The base folder MUST exist before we write run-state.json:

```
sharepoint_create_folder parentPath="HR-Onboarding" folderName="{employee_full_name} - {date_of_joining}{rehire_suffix or ""}"
→ IF this returns "already exists" AND we are in Branch B/D → proceed (expected).
→ IF this fails for any other reason → post blocked comment "Cannot create base folder at {base_folder}. Error: {error}". STOP.
```

Then:

```
sharepoint_write_file path="{run_state_path}" content="{JSON above}"
→ IF write fails: retry once after 3s.
→ IF still fails: post blocked comment "Cannot write run-state.json to {run_state_path}. Check SharePoint permissions. Error: {error}". STOP.
```

### Step 5 — Seed audit-log

Append to `HR-Onboarding/audit-log.csv` per `_shared.md § §3` and `§4`. All required fields are present (Step 1 validated them), so no em-dashes are needed:

```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|initiated|case_created|Orchestrator bootstrapped — run-state.json written. Pipeline handed to validate-inputs.|rehire={rehire_resolution}|{PAPERCLIP_TASK_ID}
```

**Note:** `event = case_created` maps to `current_status = initiated` per the §5 status transition table. Use exactly those values.

### Step 6 — Post comment on this issue

```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "body": "Orchestrator complete. case_id={case_id}. run_state_path={run_state_path}. Creating [HR-VALIDATE-INPUTS] child for Phase 1."
}
```

### Step 7 — Create the `[HR-VALIDATE-INPUTS]` child issue (idempotent)

**Step 7a — Idempotency check (handles orchestrator retry):**

If Step 4 + Step 5 + Step 6 succeeded on a prior wake but Step 7 failed, the heartbeat / Paperclip may retry this orchestrator wake. We MUST NOT create a duplicate `[HR-VALIDATE-INPUTS]` child.

```
GET /api/companies/{PAPERCLIP_COMPANY_ID}/issues?parentId={PAPERCLIP_TASK_ID}&title-prefix=[HR-VALIDATE-INPUTS]
→ IF any open issue (status ∈ {todo, in_progress, in_review}) is returned:
   - Reuse that issue id as validate_inputs_issue_id.
   - Post comment "Step 7 idempotent — existing [HR-VALIDATE-INPUTS] child {id} found; not creating a duplicate."
   - Skip Step 7b and continue to Step 8.
→ ELSE: proceed to Step 7b.
```

**Step 7b — Create the child:**

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[HR-VALIDATE-INPUTS] {employee_full_name} — Phase 1 input validation",
  "description": "phase_file: routines/employee-onboarding/validate-inputs.md\nrun_state_path: {run_state_path}\nparent_issue_id: {PAPERCLIP_TASK_ID}\ncase_id: {case_id}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{PAPERCLIP_TASK_ID}",
  "status": "todo",
  "priority": "high"
}
→ IF creation fails: retry once. If still fails: post blocked comment "Failed to create [HR-VALIDATE-INPUTS] child: {error}". STOP — do NOT mark orchestrator as done. (Heartbeat will not re-attempt this — humans must.)
→ Store returned issue id as validate_inputs_issue_id.
```

### Step 8 — Mark orchestrator issue as in_review and exit

**Checkpoint:** only run this step if Steps 1–7 all succeeded. If ANY prior step posted a `blocked` comment or hit a STOP path, you MUST NOT reach Step 8 — the orchestrator issue stays `in_review` (its initial state) or `blocked` per the prior step's failure handling, NOT in `in_review` as set by this step.

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "status": "in_review",
  "comment": "Pipeline bootstrapped. [HR-VALIDATE-INPUTS] child created (issue: {validate_inputs_issue_id}). This orchestrator issue stays in_review while phases run; final status update happens after Phase 10."
}
```

**Do not execute any further phase logic.** Phase 1 will create case-tracker.md (including the Phase Tracker table). The orchestrator does NOT touch case-tracker.md — it does not yet exist.

Exit heartbeat. ✓

---

## Failure handling for the orchestrator

| Situation | Action |
|---|---|
| Required base fields missing in payload | Post blocked comment, notify `human_in_loop_email` if known, STOP |
| Base folder create fails | Post blocked comment with error, STOP |
| `run-state.json` write fails after retry | Post blocked comment on this issue, STOP — do NOT create child |
| Active duplicate workflow detected (Branch C) | Post blocked comment + notify human, STOP |
| Rehire collision (Branch D) | Resolve case_id with `-rehire-N` suffix, notify human, continue |
| `[HR-VALIDATE-INPUTS]` child create fails after retry | Post blocked comment, STOP — do NOT mark orchestrator done |
| Audit-log seed row fails | Notify human, set this issue → blocked, STOP |

For every failure above: this orchestrator issue stays in_review or blocked. It MUST NOT transition to `done` unless Step 7 succeeded.

---

## What this orchestrator does NOT do

- Validate the full required-field list — that is Phase 1 (`validate-inputs.md`).
- Create SharePoint subfolders (`01_Raw_Submissions`, etc.) — Phase 1.
- Copy the HRMS Excel template — Phase 1.
- Create or write `case-tracker.md` — Phase 1.
- Send any emails to the candidate — Phase 2 (`send-initial.md`).
- Process candidate replies — Phase 4 (`process-reply.md`, triggered by heartbeat).
- Run document validation — Phase 5 (`validate-docs.md`, invokes the document-validator skill).
- Create Paperclip approvals — Phase 7+8 (`complete-submission.md`).
- Upload to SharePoint Verified folder — Phase 7+8 auto-upload or Phase 9 fallback.
- Send completion or IT setup emails — Phase 10 (`close-case.md`).

---

## Status on exit (orchestrator)

Per `_shared.md § §21`. The orchestrator is Phase 0 — it routes input, creates the `[HR-VALIDATE-INPUTS]` child, and exits.

| Outcome | This issue (`[HR-ONBOARD]`) | Notes |
|---|---|---|
| Input parsed + Phase 1 child created | **`in_progress`** | Acts as the parent for the whole pipeline. Status will be advanced by downstream phases per the case-status mapping in `_shared.md § §21`. |
| Required input field(s) missing or malformed | `blocked` | Comment names the missing fields; human re-files with corrected inputs. |
| Pre-existing active workflow on same `case_id` (Branch C) | `blocked` with link to the existing parent | Do NOT cancel either side. |
| Paperclip API call to create child failed | `blocked` | Human re-triggers. |

This parent issue is the long-lived case anchor. Every downstream phase reads `parent_issue_id` from its child issue description and reports back here. Final transition to `done` happens only at Phase 10 (`close-case.md` Step terminal). All other status changes (`in_review` ↔ `in_progress` ↔ `blocked`) are driven by the case-status mapping in `_shared.md § §21`.
