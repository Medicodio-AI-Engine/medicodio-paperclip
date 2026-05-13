# Phase 6 — Request Resubmission

**Title prefix:** `[HR-REQUEST-RESUB]`
**Created by:** `validate-docs.md` Step 11 Branch X (when `decision == "discrepancies"`).
**Creates next:** NONE. Heartbeat owns the next reply detection — it will create `[HR-PROCESS-REPLY]` when the candidate replies again.

---

## No-leak header

**TOOL RULE LINE 1:** This phase uses: `sharepoint_read_file` / `sharepoint_write_file` for run-state and case-tracker, `outlook_send_email` TWICE (human alert + candidate resubmission request), `teams_send_channel_message` non-blocking, Paperclip API. NO other tools. NO `outlook_read_attachment`. NO `sharepoint_transfer_from_outlook`. NO `outlook_list_attachments`. NO `outlook_search_emails` (heartbeat owns search).

**STATE:** Read `run_state_path` from this issue description. Append `request_resubmission` round entry to run-state.json before exit.

**CREATES NEXT:** Nothing. Heartbeat will trigger Phase 4 again when candidate replies.

**DO NOT:**
- Run document validation again. Phase 5 already produced the discrepancy_list.
- Build a new discrepancy list. Read from `run_state.validate_docs.rounds[round_index - 1].discrepancy_list`.
- Modify Document Tracker. That is Phase 5's domain.
- Mark the parent issue as `done` or `cancelled`. Only Phase 10 closes the parent.

---

## References

- Conventions: `routines/employee-onboarding/_shared.md`
- Templates: `routines/employee-onboarding/_email-templates.md`

---

## Step 1 — Load run-state.json and read this issue's description

```
sharepoint_read_file path="{run_state_path}"
→ Parse JSON. Validate schema_version == 1.
→ IF file missing → blocked comment on this issue + parent_issue_id, STOP.
```

Read issue description for `round_index`.

Extract — **read paths from run-state top-level:**
```
payload                = run_state.payload
employee_full_name     = payload.employee_full_name
employee_email         = payload.employee_email
employee_type          = payload.employee_type
human_in_loop_email    = payload.human_in_loop_email
recruiter_or_hr_name   = payload.recruiter_or_hr_name
recruiter_or_hr_email  = payload.recruiter_or_hr_email
case_tracker_path      = run_state.case_tracker_path     ← top-level
case_id                = run_state.case_id
parent_issue_id        = run_state.parent_issue_id

this_validation_round  = first(r in run_state.validate_docs.rounds where r.round == round_index)
discrepancy_list       = this_validation_round.discrepancy_list
identity_check_outcome = this_validation_round.identity_check_outcome
decision               = this_validation_round.decision
```

**Guard:** if `decision != "discrepancies"` → blocked comment "Phase 6 invoked but Phase 5 decision was {decision}. Refusing to send resubmission email." Phase Tracker row 6 → `blocked`. STOP.

**Guard:** if `discrepancy_list` is empty AND `decision == "discrepancies"` → blocked comment "Phase 6 invoked with empty discrepancy_list — cannot send vague resubmission email." Phase Tracker row 6 → `blocked`. STOP. (Resubmission emails MUST list exact items.)

---

## Step 1b — Input-quality guard on discrepancy_list

Each item in `discrepancy_list` MUST be specific enough to drive a candidate action. Vague items (just `"Aadhaar missing"` without a verb or context) would produce a vague resubmission email — forbidden.

For each item `d` in `discrepancy_list`:

```
specificity = (
  has_doc_name_keyword(d.note) AND
  has_action_or_reason(d.note)
)

where:
  has_doc_name_keyword = note mentions at least one known doc name (Aadhaar, PAN, Resume, Payslip, Offer Letter, Relieving Letter, Passport, Photo, Address Proof, Driver's License, Voter ID, HRMS Form, etc.) OR explicit filename in quotes
  has_action_or_reason = note contains a verb like ["missing", "not received", "unreadable", "password-protected", "wrong file", "archive", "scanned", "name mismatch", "DOB mismatch", "expired", "low resolution", "blank", "corrupted"]
```

If `specificity == false`, choose ONE remediation:

**Option A — Auto-enrich (preferred when doc name is detected but verb is missing):**
- Default the verb to `not received — please resend a clear scan`. Mutate the item's note in-place: `"{original} — not received, please resend a clear scan"`.

**Option B — Escalate (when item is so vague no doc name is detected):**
- Notify `human_in_loop_email` (subject `HR Alert: Vague discrepancy item from Phase 5 — {employee_full_name}`, body: the raw note + ask human to clarify before sending resubmission).
- Append audit-log row with `event = human_notified`.
- Phase Tracker row 6 → `blocked`. STOP — do NOT send a vague resubmission email.

The output of this step is a `discrepancy_list_specific` (auto-enriched in Option A) that Step 4 uses to render the candidate email.

---

## Step 2 — Flip Phase Tracker row 6 → in_progress

Update row 6:
```
| 6 | Request resubmission | request-resubmission.md | in_progress | {now} | — | {PAPERCLIP_TASK_ID} | Round {round_index} — {N} discrepancies |
```
Write the file. On retry failure: notify human, audit-log escalated, STOP.

---

## Step 3 — Send human alert

```
outlook_send_email using template _email-templates.md § §DISCREPANCY_HUMAN
  to            = {human_in_loop_email}
  isHtml        = true
  substitute    {discrepancy_items_as_html_list} with <li>...</li> entries for each item in discrepancy_list
                 (NEVER include ID digits — see _shared.md § §2)
→ On failure: retry once after 5s. If still fails: append warning to a comment on this issue, audit-log escalated row, continue (do NOT block the candidate email — the human will still see this via the audit-log and Teams alert).
```

---

## Step 4 — Send candidate resubmission email

```
outlook_send_email using template _email-templates.md § §RESUBMISSION_CANDIDATE
  to            = {employee_email}
  ccRecipients  = ["{recruiter_or_hr_email}"]
  isHtml        = true
  substitute    {exact_discrepancy_items_as_html_list} with <li>...</li> entries from discrepancy_list

  STRICT RULES:
  - Each list item MUST be specific. Examples allowed:
      "Aadhaar card not received"
      "Payslip for {month} is unreadable — please resend a clear scan"
      "Latest Resume contains password protection — please remove the password"
  - Forbidden vague items:
      "Some documents are missing"
      "Please resend everything"
      "Issues with your submission"
  - NEVER write any ID digits (Aadhaar / PAN / etc.) in the list.
```

Capture returned `messageId` as `resubmission_message_id`.

**On failure:**
- Retry once after 5s.
- If still fails: `outlook_send_email` to `{human_in_loop_email}` (subject `HR Alert: Failed to send resubmission email — {employee_full_name}`, body with error). Append `escalated` row to audit-log. Phase Tracker row 6 → `blocked`. STOP.

---

## Step 5 — Append audit-log rows

Row 5a — resubmission requested:
```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|awaiting_resubmission|resubmission_requested|Resubmission email sent to candidate (round {round_index})|{N} items; messageId={resubmission_message_id}|{PAPERCLIP_TASK_ID}
```

Row 5b — human notified (status unchanged per `_shared.md § §5`):
```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|awaiting_resubmission|human_notified|Discrepancy alert email sent to human|{N} items|{PAPERCLIP_TASK_ID}
```

---

## Step 6 — Teams notification (non-blocking)

Use `_email-templates.md § §Teams_Documents_Incomplete`. Build `Missing:` and `Invalid:` lists from `discrepancy_list` (best-effort split: items containing "missing" / "not received" → Missing; others → Invalid). Non-blocking per `_shared.md § §18`.

---

## Step 7 — Update run-state.json

Append to `run_state.request_resubmission.rounds[]` (create the array if first time):
```json
{
  "round": {round_index},
  "started_at": "{...}",
  "completed_at": "{ISO now}",
  "discrepancy_count": {N},
  "items_sent_to_candidate": [{discrepancy_list items}],
  "candidate_email_message_id": "{resubmission_message_id}",
  "human_alert_sent": true|false
}
```

Top-level:
- Add `request_resubmission` to `phases_complete[]` ONLY if not already present.
- `current_phase = "await_reply"` (heartbeat takes over).
- `last_updated = now`.

Write per `_shared.md § §12`. On retry failure: notify human, Phase Tracker row 6 → `blocked`, STOP.

---

## Step 8 — Flip Phase Tracker row 6 → done, append Status History row

Update row 6:
```
| 6 | Request resubmission | request-resubmission.md | done | {row6.Started from Step 2} | {now} | {PAPERCLIP_TASK_ID} | Round {round_index} — {N} items requested |
```

**Note:** Phase 5 only ever flips row 6 to `skipped` (on a clean round). It never flips rows 7+8/9/10 to `skipped`. Therefore there is no "flip rows 7+8/9/10 back to pending" case to handle here — that scenario is unreachable under current Phase 5 logic. Do NOT add defensive flips for those rows.

Append Status History row:
```
| {now} | awaiting_resubmission | Round {round_index}: resubmission requested — {N} items |
```

Write the file. On retry failure: notify human, audit-log escalated, STOP.

---

## Step 9 — PATCH parent orchestrator issue back to `in_review`

```
PATCH /api/issues/{parent_issue_id}
{
  "status": "in_review",
  "comment": "Resubmission requested (round {round_index}, {N} items). Heartbeat polling for candidate reply. Phase 6 paused — heartbeat will re-trigger Phase 4 on next reply."
}
```
On failure: append warning to comment in Step 10, continue.

---

## Step 10 — Close this issue and exit

```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
{ "body": "Phase 6 complete. Resubmission email sent to {employee_email}. {N} items requested. Heartbeat will detect next reply and re-trigger Phase 4 (validate-docs → here again if still incomplete, or complete-submission if clean)." }

PATCH /api/issues/{PAPERCLIP_TASK_ID}
{ "status": "done", "comment": "Phase 6 round {round_index} complete. No next child — heartbeat owns reply detection." }
```

Exit heartbeat. ✓

---

## Failure handling reference

| Situation | Action |
|---|---|
| `run-state.json` missing at Step 1 | Blocked comment on this issue + parent. STOP. |
| `round_index` missing | Blocked comment. STOP. |
| `decision != discrepancies` | Blocked comment, Phase Tracker row 6 → blocked. STOP. |
| `discrepancy_list` empty when expected | Blocked comment, Phase Tracker row 6 → blocked. STOP. |
| Human alert email fails after retry | Audit-log escalated row, continue (do not block candidate email). |
| Candidate resubmission email fails after retry | Notify human, audit-log escalated, Phase Tracker row 6 → blocked. STOP. |
| `case-tracker.md` write fails after retry | Notify human, audit-log escalated, STOP. |
| `run-state.json` write fails after retry | Notify human, Phase Tracker row 6 → blocked. STOP. |
| Parent issue PATCH fails | Append warning to comment, continue (non-blocking). |
| Audit-log write fails after retry | Notify human, Phase Tracker row 6 → blocked. STOP. |

---

## What this phase does NOT do

- Validate documents (Phase 5 already did, this phase only consumes the discrepancy list).
- Build the discrepancy list (read from run-state).
- Upload anything to SharePoint (Phase 7+8 / Phase 9).
- Create a child issue (heartbeat owns the next trigger).
- Mark parent orchestrator issue as done / cancelled (only Phase 10).
- Send Nudge emails (heartbeat owns those — Paths A/B/C in `email-heartbeat.md`).

---

## Status on exit

Per `_shared.md § §21`:

| Outcome | This child issue (`[HR-REQUEST-RESUB]`) | Parent orchestrator issue |
|---|---|---|
| Resubmission email sent successfully | `done` | **`in_review`** (waiting for candidate resubmission; heartbeat polls) |
| `outlook_send_email` assert fail (apply same Step 4a-style check as send-initial) | `blocked` | `blocked` |
| run-state or audit-log write failed | `blocked` | `blocked` |
