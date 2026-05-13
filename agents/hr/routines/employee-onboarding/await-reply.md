# Phase 3 — Await Candidate Reply

**Title prefix:** `[HR-AWAIT-REPLY]`
**Created by:** `send-initial.md` (Step 10)
**Creates next:** NONE. The `email-heartbeat.md` routine takes over. Heartbeat creates `[HR-PROCESS-REPLY]` when a reply arrives.

---

## No-leak header

**TOOL RULE LINE 1:** This phase calls `sharepoint_read_file` and `sharepoint_write_file` for run-state.json and case-tracker.md, plus Paperclip API calls (PATCH issue, POST comment). NO email tools. NO Teams tools. NO outlook search. NO folder/file operations beyond case-tracker / run-state.

**STATE:** Read `run_state_path` from this issue description. Append `await_reply` section to run-state.json before exit.

**CREATES NEXT:** Nothing. Heartbeat polling owns reply detection. This phase only flips state, parks the issue, and exits.

**DO NOT:**
- Search Outlook for replies.
- Send any email (initial, nudge, or otherwise).
- Send any Teams notification.
- Create another child issue.
- Poll, sleep, or loop.

---

## References

- Conventions: `routines/employee-onboarding/_shared.md`
- Templates: `routines/employee-onboarding/_email-templates.md`

---

## Step 1 — Load run-state.json

```
sharepoint_read_file path="{run_state_path}"
→ Parse JSON. Validate schema_version == 1.
→ IF file missing → see _shared.md § §17 (blocked comment on this issue + parent_issue_id, STOP).
```

Extract — **read paths from run-state top-level, do NOT recompute:**
```
payload               = run_state.payload
employee_full_name    = payload.employee_full_name
employee_email        = payload.employee_email
employee_type         = payload.employee_type
human_in_loop_email   = payload.human_in_loop_email
recruiter_or_hr_name  = payload.recruiter_or_hr_name
case_tracker_path     = run_state.case_tracker_path     ← top-level
case_id               = run_state.case_id
parent_issue_id       = run_state.parent_issue_id
outlook_message_id    = run_state.send_initial.outlook_message_id
```

**Guard:** if `run_state.send_initial.status != "complete"` → this phase was started out of order. Post a blocked comment on this issue and `parent_issue_id`:
```
"Phase 3 started before Phase 2 completed. run_state.send_initial.status = {value}. Refusing to advance pipeline."
```
Phase Tracker row 3 → `blocked`. STOP.

---

## Step 2 — Flip Phase Tracker row 3 → in_progress

Read `case-tracker.md`, update row 3:
```
| 3 | Await candidate reply | await-reply.md | in_progress | {now} | — | {PAPERCLIP_TASK_ID} | Awaiting heartbeat reply detection |
```
Write the file. On failure: retry once. If still fails: notify human, audit-log escalated, STOP.

---

## Step 3 — Update parent (orchestrator) issue to `in_review`

The orchestrator issue is the one humans watch. Mark it `in_review` so platform signals to humans that the candidate is the blocker, not the agent.

**Pre-check (defensive — never zombie a closed parent):**
```
GET /api/issues/{parent_issue_id}
→ Capture parent.status.
→ IF parent.status ∈ {done, cancelled, withdrawn}:
   - This is anomalous — a closed parent should not have an active [HR-AWAIT-REPLY] child. Likely race or manual intervention.
   - Post blocked comment on this issue:
     "Parent issue {parent_issue_id} is already {parent.status}. Refusing to patch it back to in_review (would zombie a closed case). Phase 3 paused — manual investigation required."
   - Notify human_in_loop_email (subject "HR Alert: Phase 3 found parent already closed — {employee_full_name}").
   - Append audit-log row with event=escalated, brief_reason="Parent already {parent.status} when Phase 3 ran".
   - Phase Tracker row 3 → blocked. STOP. Do NOT continue to Step 4.
→ ELSE: proceed with PATCH below.
```

```
PATCH /api/issues/{parent_issue_id}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "status": "in_review",
  "comment": "Awaiting candidate document submission. Heartbeat polling active (every 30 min). Nudge cadence: Nudge 1 at 24h, Nudge 2 at 48h, stalled at 72h."
}
```

On PATCH failure (non-2xx after one retry): append warning to the comment in Step 6 (do NOT stop — heartbeat reads audit-log, not issue status).

---

## Step 4 — Append audit-log row

Per `_shared.md § §3` and `§4`:
```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|awaiting_document_submission|awaiting_reply|Routine paused — heartbeat polling active. Parent issue {parent_issue_id} set to in_review.|Nudge cadence: 24h/48h/72h-stall outlook_message_id={outlook_message_id}|{PAPERCLIP_TASK_ID}
```

(Use `current_status = awaiting_document_submission` per `_shared.md § §5`.)

---

## Step 5 — Update run-state.json

Append:
```json
"await_reply": {
  "status": "complete",
  "completed_at": "{ISO now}",
  "parent_issue_status_set_to": "in_review",
  "heartbeat_takes_over": true,
  "nudge_schedule": { "nudge_1": "24h", "nudge_2": "48h", "stall": "72h" }
}
```

Add `await_reply` to `phases_complete[]`. Set `current_phase = "process_reply"` (the next phase that will run, even though it is heartbeat-triggered). Set `last_updated = now`.

Write per `_shared.md § §12`. On retry failure: notify human, Phase Tracker row 3 → `blocked`, STOP.

---

## Step 6 — Flip Phase Tracker row 3 → done, append Status History row

Read `case-tracker.md`, update row 3:
```
| 3 | Await candidate reply | await-reply.md | done | {row3.Started from Step 2} | {now} | {PAPERCLIP_TASK_ID} | Pipeline parked — heartbeat polling active |
```

Append Status History row:
```
| {now} | awaiting_document_submission | Parent issue set to in_review. Heartbeat polling every 30 min. |
```

Write the file. On retry failure: notify human, audit-log escalated, STOP.

---

## Step 7 — Post comment on this issue and close

```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
{
  "body": "Phase 3 complete. Parent issue ({parent_issue_id}) set to in_review. Heartbeat will create [HR-PROCESS-REPLY] child when candidate replies, or send Nudge 1 at 24h."
}
```

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
{
  "status": "done",
  "comment": "Phase 3 complete. No next child — heartbeat owns reply detection."
}
```

Exit heartbeat. ✓

---

## Failure handling reference

| Situation | Action |
|---|---|
| `run-state.json` missing | Blocked comment on this issue + parent. STOP. |
| `send_initial.status != complete` | Out-of-order trigger. Blocked comment, Phase Tracker row 3 → blocked. STOP. |
| `case-tracker.md` write fails after retry | Notify human, audit-log escalated. STOP. |
| `run-state.json` write fails after retry | Notify human, Phase Tracker row 3 → blocked. STOP. |
| Parent issue PATCH to in_review fails | Append warning to comment in Step 7, continue (non-blocking). |
| Audit-log write fails after retry | Notify human, Phase Tracker row 3 → blocked. STOP. |

---

## What this phase does NOT do

- Search Outlook (heartbeat does that — `email-heartbeat.md` STEP 2).
- Send any reminder (heartbeat Paths A/B/C).
- Send any Teams notification (no event worth notifying — pipeline is parked).
- Process replies (Phase 4 `process-reply.md`, triggered by heartbeat).
- Mark the parent orchestrator issue as `done` — that happens only in Phase 10 (`close-case.md`).

---

## Status on exit

Per `_shared.md § §21`:

| Outcome | This child issue (`[HR-AWAIT-REPLY]`) | Parent orchestrator issue |
|---|---|---|
| Wake-up, nothing to do (the normal case — heartbeat owns polling) | **`in_review`** — this issue exists as a marker for the awaiting-reply state; the comment must say "Heartbeat polling. Next action: candidate reply or Nudge 1 on {date}." | stays `in_review` |
| Wake-up because comment from user/board | answer the comment, then re-PATCH this child back to `in_review` (the checkout flipped it to `in_progress`) | derive from `_shared.md § §21` case-status mapping |

Anti-thrash: every wake on this issue ends with `PATCH status=in_review` UNLESS the heartbeat has already moved the case past this phase (in which case this child should already be `done`). Idle wakes that leave the child in `in_progress` are a bug — they conflict with the case-status `awaiting_document_submission` mapping.
