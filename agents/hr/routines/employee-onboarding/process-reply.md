# Phase 4 — Process Candidate Reply

**Title prefix:** `[HR-PROCESS-REPLY]` (preferred). Legacy: `[HR-ONBOARDING-REPLY]` — same handling.
**Created by:** `email-heartbeat.md` STEP 2 when one or more replies are detected.
**Creates next:** `[HR-VALIDATE-DOCS]` child (if any reply had attachments), OR no child (if all replies were acknowledgement-only / questions / withdrawal / cancellation).

---

## No-leak header

**TOOL RULE LINE 1:** This phase uses: `sharepoint_read_file` / `sharepoint_write_file` (run-state.json, case-tracker.md), `outlook_read_email`, `outlook_list_attachments`, `sharepoint_transfer_from_outlook` (RAW uploads ONLY), `sharepoint_get_file_info` (post-upload integrity), `outlook_send_email` (human alerts for alternate sender / withdrawal / cancellation / questions), `teams_send_channel_message`, Paperclip API. **FORBIDDEN here:** `outlook_read_attachment` for the purpose of uploading (that is Phase 5's tool — see `_shared.md § §9`). RAW uploads must use `sharepoint_transfer_from_outlook`.

**STATE:** Read `run_state_path` from this issue description. Append a new entry to `run_state.process_reply.rounds[]` before creating next child or exiting.

**CREATES NEXT:**
- If at least one classified reply had document attachments → `[HR-VALIDATE-DOCS]` child.
- If all replies were ack-only / question / withdrawal / cancellation → no child. Heartbeat continues polling (unless withdrawal/cancellation, which is terminal).

**DO NOT:**
- Run the document-validator skill. That is Phase 5 (`validate-docs.md`).
- Call `outlook_read_attachment` to upload files. Use `sharepoint_transfer_from_outlook`. See `_shared.md § §9`.
- Send the initial document-request email. That is Phase 2.
- Send the resubmission email. That is Phase 6.
- Re-create SharePoint folders.

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

Extract — **read paths from run-state top-level, do NOT recompute:**
```
payload                = run_state.payload
employee_full_name     = payload.employee_full_name
employee_email         = payload.employee_email
employee_type          = payload.employee_type
alternate_email        = payload.alternate_candidate_email      ← may be null
human_in_loop_email    = payload.human_in_loop_email
recruiter_or_hr_name   = payload.recruiter_or_hr_name
recruiter_or_hr_email  = payload.recruiter_or_hr_email
case_tracker_path      = run_state.case_tracker_path             ← top-level (rehire-aware)
case_id                = run_state.case_id
parent_issue_id        = run_state.parent_issue_id
base_folder            = run_state.base_folder                   ← top-level (rehire-aware)
raw_folder             = "{base_folder}/01_Raw_Submissions"
exception_folder       = "{base_folder}/03_Exception_Notes"
```

Read this issue's description (per `_shared.md § §15` and `email-heartbeat.md` STEP 2 issue-create body). Extract:
```
messageIds   = description.messageIds                 ← comma-separated, chronological
reply_count  = description.reply_count                ← integer (used for sanity check)
```

**Guard:** if `messageIds` is missing or empty → blocked comment "Phase 4 invoked without messageIds list. Heartbeat may have created an invalid sub-issue." Phase Tracker row 4 → `blocked`. STOP.

Parse `messageIds` → `messageId_list` (split by `,`, trim whitespace). Verify `len(messageId_list) == reply_count` (warn-log mismatch but continue with `messageId_list`).

Determine `round_index` (idempotent — handles wake retry):
```
existing_rounds = run_state.process_reply.rounds or []

// Idempotency: if a prior partial run wrote a round entry tagged with this PAPERCLIP_TASK_ID,
// reuse it instead of appending. This protects against duplicate rounds when the same
// [HR-PROCESS-REPLY] issue wakes twice.
existing_for_this_wake = first(r in existing_rounds where r.paperclip_task_id == PAPERCLIP_TASK_ID)

IF existing_for_this_wake is not null:
  round_index = existing_for_this_wake.round
  // resume this round — overwrite, do not append
ELSE:
  round_index = max(r.round for r in existing_rounds) + 1   ← 1-based; if list empty, start at 1
```

Store `PAPERCLIP_TASK_ID` in the round entry (Step 7) so future retries find it.

---

## Step 2 — Flip Phase Tracker row 4 → in_progress, set parent back to in_progress

Read `case-tracker.md`, update row 4:
```
| 4 | Process reply | process-reply.md | in_progress | {now} | — | {PAPERCLIP_TASK_ID} | Round {round_index} — processing {reply_count} reply(s) |
```
Write the file. On retry failure: notify human, audit-log escalated, STOP.

PATCH the parent orchestrator issue back to `in_progress` (candidate replied → routine is active again):
```
PATCH /api/issues/{parent_issue_id}
{ "status": "in_progress", "comment": "Candidate reply detected (round {round_index}, {reply_count} message(s)). Phase 4 processing." }
```
On failure: append warning to next comment, continue (non-blocking).

---

## Step 3 — Initialise round accumulator

```
round = {
  "round": round_index,
  "paperclip_task_id": "{PAPERCLIP_TASK_ID}",          ← for retry idempotency
  "started_at": "{ISO now}",
  "messageIds_processed": [],
  "raw_uploads": [],                                    ← list of {filename, messageId, attachmentId, contentType, size}
  "classification_per_message": [],                     ← list of {messageId, classification, sender}
  "final_classification": null,                         ← one of: complete | partial | ack_only | question | withdrawal | cancellation | alternate_sender_pending
  "pending_side_effects": [],                           ← list of superseded classifications (e.g. ["question_routed_to_human", "ack_only"])
  "terminal_event": null,                               ← set if withdrawal or cancellation
  "has_attachments": false
}
```

---

## Step 4 — Inline loop over messageIds (chronological order)

For each `messageId` in `messageId_list`:

### 4a — Read the email metadata

```
outlook_read_email messageId="{messageId}"
→ Capture: sender (from address), subject, receivedDateTime, body_text (or body_html).
```

If `outlook_read_email` returns an error → append warning to round notes, skip this message (continue loop). After loop: include `messageIds_processed[]` with skipped messages flagged.

### 4b — Confirm sender (STRICT — gate for 4c)

**Ordering rule:** Step 4c (attachment list + transfer) MUST run ONLY if Step 4b classified the sender as `confirmed`. If 4b classifies as `alternate_sender_pending`, the agent MUST skip 4c entirely for this messageId and continue with classification at Step 4d (which will see `alternate_sender_pending` already set).

```
sender_email = lowercased email of the From: address
allowed = [lowercased(employee_email)] + ([lowercased(alternate_email)] if alternate_email present)
```

**If `sender_email NOT IN allowed`:**
- `outlook_send_email` using `_email-templates.md § §REPLY_ALTERNATE_SENDER_ALERT` to `{human_in_loop_email}`.
- Append audit-log row:
  ```
  {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|awaiting_document_submission|reply_from_alternate_sender|Notified human — reply from unrecognized sender|sender={sender_email} messageId={messageId}|{PAPERCLIP_TASK_ID}
  ```
- Add to `round.classification_per_message`: `{messageId, classification: "alternate_sender_pending", sender: sender_email}`.
- **Skip this messageId for attachment processing.** Continue loop (do not break). Do not auto-upload any of its attachments.

### 4c — List and upload attachments to 01_Raw_Submissions

Only if Step 4b passed (sender confirmed):

```
outlook_list_attachments messageId="{messageId}"
→ Capture list of {attachmentId, name, contentType, size}
```

If the list is empty → this is a text-only message. Skip Step 4c-i; classification will be determined in Step 4d.

For each attachment:

#### Step 4c-i — Reject archives upfront
Apply the archive-name regex (case-insensitive):
```
ARCHIVE_REGEX = /\.(zip|rar|7z|tar|tgz|bz2|gz|xz|zip\.\d+|rar\.\d+)$/i
```
If `name` matches `ARCHIVE_REGEX`:
- Do NOT transfer. Add a marker to `round.raw_uploads` with `transferred: false, reason: "archive — candidate will be asked to re-send unzipped (Phase 5)"`.
- Continue to next attachment.

#### Step 4c-ii — Resolve destination filename (no silent overwrite)
```
candidate_name = "{attachment.name}"
sharepoint_get_file_info path="{raw_folder}/{candidate_name}"
→ IF exists: append timestamp suffix before extension per _shared.md § §8.
  e.g. "Aadhaar.pdf" → "Aadhaar_2026-04-23T09-15-00Z.pdf"
→ ELSE: use candidate_name as-is.
```

#### Step 4c-iii — Transfer
```
sharepoint_transfer_from_outlook
  messageId    = "{messageId}"
  attachmentId = "{attachment.attachmentId}"
  destPath     = "{raw_folder}/{final_filename}"
  mimeType     = "{attachment.contentType}"
→ Per _shared.md § §8 retry policy: on HTTP 429/503 wait 10s, retry up to 3 times total. On 3rd failure → escalate (notify human via plain outlook_send_email), audit-log escalated row, skip this file (continue with remaining attachments).
```

#### Step 4c-iv — Post-upload integrity check
```
sharepoint_get_file_info path="{raw_folder}/{final_filename}"
→ Confirm size > 0.
→ IF size == 0 or not found → delete the empty file, escalate (audit-log escalated row, notify human), continue to next attachment.
```

#### Step 4c-v — Record raw upload
```
round.raw_uploads.append({
  "filename": "{final_filename}",
  "messageId": "{messageId}",
  "attachmentId": "{attachment.attachmentId}",
  "contentType": "{attachment.contentType}",
  "size": {confirmed size},
  "transferred": true,
  "raw_path": "{raw_folder}/{final_filename}"
})
```

After all attachments for this messageId: if any `round.raw_uploads` entry has `transferred: true`, set `round.has_attachments = true`.

### 4d — Classify this message

Use the email body text (+ subject) and the attachment presence to classify ONE of:

| Classification | Heuristic |
|---|---|
| `complete` | Multiple attachments AND body suggests "please find all docs", "attached all", or all mandatory docs visibly named in the body. (Final completeness decided by Phase 5 — this is best-effort.) |
| `partial` | Some attachments but body indicates only a few of the requested docs are included ("sending Aadhaar, PAN will follow") |
| `ack_only` | No attachments AND body is an acknowledgement only ("noted", "will send by evening", "sending tomorrow", "received your email") |
| `question` | No attachments AND body asks a question or requests clarification |
| `withdrawal` | Body indicates candidate is no longer joining or postponing indefinitely. Look for: "withdrawing", "no longer joining", "decline", "not joining". Terminal. |
| `cancellation` | Body indicates HR or candidate is cancelling onboarding. Look for: "cancel", "rescind". Terminal. |
| `alternate_sender_pending` | Already set by 4b — do not reclassify. |

Add to `round.classification_per_message`: `{messageId, classification, sender: sender_email}`.

### 4e — Per-classification side-effects (inside the loop)

- `question` → `outlook_send_email` to `{human_in_loop_email}` (subject: `HR Alert: Candidate question — {employee_full_name}`, body: paraphrase of the question, link to the messageId). Append audit-log row with `event = human_notified` (status unchanged per `_shared.md § §5`). Append `"question_routed_to_human"` to `round.pending_side_effects[]`. Continue loop.
- `ack_only` → append `"ack_only"` to `round.pending_side_effects[]` (recorded so the Status History rows reflect it even if a later message supersedes the classification). Continue loop.
- `alternate_sender_pending` → already handled by 4b (human notified). Continue loop.
- `withdrawal` → set `round.terminal_event = "withdrawal"`. Do NOT process further messageIds — break the loop after this one.
- `cancellation` → set `round.terminal_event = "cancellation"`. Break the loop.
- `complete`, `partial` → no extra email here. Continue loop.

After loop completes (or after `break`): proceed to Step 5.

---

## Step 5 — Determine round.final_classification

Apply this precedence (first match wins):

1. If `round.terminal_event == "withdrawal"` → `final_classification = "withdrawal"`.
2. If `round.terminal_event == "cancellation"` → `final_classification = "cancellation"`.
3. If any message classified as `complete` AND `round.has_attachments == true` → `final_classification = "complete"`.
4. If any message classified as `partial` AND `round.has_attachments == true` → `final_classification = "partial"`.
5. If `round.has_attachments == true` (any attachments transferred) → `final_classification = "partial"` (conservative — Phase 5 decides completeness).
6. If any message classified as `question` → `final_classification = "question"`.
7. If any message classified as `alternate_sender_pending` AND no other class above → `final_classification = "alternate_sender_pending"`.
8. Else → `final_classification = "ack_only"`.

---

## Step 6 — Update case-tracker and audit-log per final_classification

### 6a — Append a Status History row

Map `final_classification` → status:

| `final_classification` | `current_status` | Status History note |
|---|---|---|
| `complete` | `complete_submission_received` | Round {round_index}: {reply_count} reply(s), {N} attachments transferred to 01_Raw_Submissions |
| `partial` | `partial_submission_received` | Round {round_index}: {reply_count} reply(s), {N} attachments transferred; phase 5 will check completeness |
| `ack_only` | `candidate_acknowledged` | Round {round_index}: ack-only reply; no documents yet |
| `question` | `awaiting_document_submission` | Round {round_index}: candidate asked a question; human notified |
| `withdrawal` | `withdrawn` | Round {round_index}: candidate withdrew |
| `cancellation` | `cancelled` | Round {round_index}: cancellation received |
| `alternate_sender_pending` | `awaiting_document_submission` | Round {round_index}: reply from unrecognized sender; human notified |

Write the row to `case-tracker.md` Status History.

### 6b — Append Attachment Lookup rows (one per transferred upload, dedup-guarded)

For each `round.raw_uploads` entry where `transferred == true`:

1. Check if a row with the same `(filename, round_index)` already exists in the Attachment Lookup table (defensive — handles retry of this same wake).
2. If it exists, SKIP this append (do not duplicate).
3. Otherwise append:
```
| {filename} | {messageId} | {attachmentId} | {contentType} | {round_index} |
```

Never remove or rewrite existing rows. Append-only. Phase 9 fallback reads the most-recent row per filename.

### 6c — Append audit-log row

Per `_shared.md § §3` and `§4`, using the mapped current_status:
```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|{mapped_current_status}|reply_detected|Round {round_index}: classified {final_classification}; raw uploads={N}|messageIds={messageId_list_joined};raw_files={comma-separated filenames}|{PAPERCLIP_TASK_ID}
```

Write case-tracker AFTER all updates above (one write, not multiple).

---

## Step 7 — Update run-state.json

Append the round to `run_state.process_reply.rounds[]`:
```json
"process_reply": {
  "processed_message_ids": [ ...existing ids..., <new ids appended below> ],
  "rounds": [
    ...existing rounds...,
    {
      "round": {round_index},
      "started_at": "{...}",
      "completed_at": "{ISO now}",
      "messageIds_processed": ["m1", "m2", ...],
      "raw_uploads": [ ... full list with transferred flag ... ],
      "classification_per_message": [ ... ],
      "final_classification": "{final_classification}",
      "terminal_event": "{terminal_event or null}",
      "has_attachments": true|false
    }
  ]
}
```

**Append-to-`processed_message_ids` rule (TASK-007):**

- Initialise `run_state.process_reply.processed_message_ids = []` if absent (legacy run-state pre-dating TASK-007).
- For every id in this round's `messageIds_processed`: append to `processed_message_ids` if not already present (set semantics — no duplicates).
- Never reorder existing entries. Never remove entries (even after withdrawal / cancellation — the messageId is still "seen" and must not produce a fresh sub-issue from a heartbeat re-poll).
- The heartbeat (`email-heartbeat.md` STEP 2 3a diff) reads this list to compute `new_messages`. Skipping the append here will cause the same reply to be routed twice on the next tick.

Update top-level fields:
- If `final_classification ∈ {complete, partial}` → `current_phase = "validate_docs"`.
- If `final_classification == "ack_only"` → `current_phase = "await_reply"` (heartbeat keeps polling — no new child).
- If `final_classification == "question"` → `current_phase = "await_reply"` (heartbeat keeps polling).
- If `final_classification == "alternate_sender_pending"` → `current_phase = "await_reply"`.
- If `final_classification == "withdrawal"` → `current_phase = "closed_withdrawn"` (terminal).
- If `final_classification == "cancellation"` → `current_phase = "closed_cancelled"` (terminal).

Add `process_reply` to `phases_complete[]` ONLY if this is the first time (do not append twice for repeated rounds — guard with `if "process_reply" not in phases_complete`).

Set `last_updated = now`. Write per `_shared.md § §12`. On retry failure: notify human, Phase Tracker row 4 → `blocked`. STOP — do NOT create next child.

---

## Step 8 — Teams notification (only when attachments arrived)

Send `_email-templates.md § §Teams_Documents_Received` ONLY if `final_classification ∈ {complete, partial}`. Otherwise skip Teams for this round (ack/question/withdrawal/cancellation are not "documents received").

Compute the `Received:` and `Missing:` lists best-effort from the filenames in `round.raw_uploads` (Phase 5 will do the real completeness check). If unsure, write `Received: {filenames}` and `Missing: (to be determined by Phase 5)`.

Non-blocking per `_shared.md § §18`.

---

## Step 9 — Flip Phase Tracker row 4 → done (or skipped/blocked per branch)

Read `case-tracker.md`, update row 4:
```
| 4 | Process reply | process-reply.md | done | {row4.Started from Step 2} | {now} | {PAPERCLIP_TASK_ID} | Round {round_index} — classified {final_classification}; raw uploads={N} |
```

If `terminal_event` is set, also flip rows 5–10 to `skipped` with note `Terminal — round {round_index} ended with {terminal_event}`.

Write the file.

---

## Step 10 — Branch on `final_classification`

### Branch A — Documents present (`complete` or `partial`)

Create the `[HR-VALIDATE-DOCS]` child issue:

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
{
  "title": "[HR-VALIDATE-DOCS] {employee_full_name} — round {round_index} validation",
  "description": "phase_file: routines/employee-onboarding/validate-docs.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}\npaperclip_issue_id: {parent_issue_id}\ncase_id: {case_id}\nround_index: {round_index}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
→ On retry failure: blocked comment, Phase Tracker row 4 → blocked. STOP.
→ Store returned issue id as validate_docs_issue_id.
```

Post comment on this issue, then close:
```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
{ "body": "Phase 4 round {round_index} complete. {N} attachments transferred to 01_Raw_Submissions. Classification: {final_classification}. Creating [HR-VALIDATE-DOCS] child ({validate_docs_issue_id})." }

PATCH /api/issues/{PAPERCLIP_TASK_ID}
{ "status": "done", "comment": "Phase 4 round {round_index} complete. Next: [HR-VALIDATE-DOCS]." }
```

### Branch B — Acknowledgement only (`ack_only`)

No child. Heartbeat continues polling. Post comment + close this issue:
```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
{ "body": "Round {round_index}: candidate acknowledgement received, no documents yet. No new child. Heartbeat keeps polling — Phase 4 will be re-triggered on the next reply." }

PATCH /api/issues/{PAPERCLIP_TASK_ID}
{ "status": "done", "comment": "Round {round_index}: ack-only. Heartbeat continues." }
```

### Branch C — Question (`question`)

Human already notified in Step 4e. No child. Post comment + close:
```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
{ "body": "Round {round_index}: candidate asked a question. Human ({human_in_loop_email}) notified. No new child. Heartbeat keeps polling." }

PATCH /api/issues/{PAPERCLIP_TASK_ID}
{ "status": "done", "comment": "Round {round_index}: question routed to human." }
```

### Branch D — Alternate sender pending (`alternate_sender_pending`)

Human already notified in Step 4b. No child, no auto-processing. Post comment + close:
```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
{ "body": "Round {round_index}: reply from unrecognized sender; awaiting human confirmation. Heartbeat keeps polling." }

PATCH /api/issues/{PAPERCLIP_TASK_ID}
{ "status": "done" }
```

### Branch E — Withdrawal (`withdrawal`)

Terminal. **Orphan raw uploads are KEPT as archive** — earlier messages in this round may have uploaded files to `01_Raw_Submissions/` before the withdrawal message broke the loop. Those files are NOT deleted (audit trail). Instead, write an orphan note:

```
sharepoint_write_file path="{exception_folder}/orphan-raw-round-{round_index}.md"
content:
---
# Orphan Raw Uploads — Round {round_index}

**Terminal event:** withdrawal at {ISO timestamp}
**Reason:** Candidate withdrew partway through the multi-message reply round. Earlier messages in this round uploaded files to 01_Raw_Submissions/ before the withdrawal was detected.

## Files uploaded before withdrawal
| Filename | Message ID | Attachment ID | Content Type |
|----------|-----------|---------------|--------------|
{rows: one per round.raw_uploads where transferred == true}

These files are retained as archive — they will NOT be processed by Phase 5+ since the case is now in `withdrawn` state.
---
```

On write failure: log warning, continue (non-blocking — orphan note is informational).

Then notify human, set parent issue to escalated state for manual closure:
```
outlook_send_email
  to      = {human_in_loop_email}
  subject = "HR Alert: Candidate withdrew — {employee_full_name}"
  isHtml  = true
  body    = <p>Hi,</p><p>Candidate <strong>{employee_full_name}</strong> ({employee_email}) indicated withdrawal in their latest reply. Case ID: {case_id}.</p><p>The pipeline has been paused. Please close the case manually if confirmed.</p><p>Regards,<br>HR Automation</p>
```

Audit-log row:
```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|withdrawn|case_withdrawn|Candidate withdrew — pipeline paused for manual closure|round={round_index}|{PAPERCLIP_TASK_ID}
```

Teams: send `_email-templates.md § §Teams_Escalation` with reason = "Candidate withdrew".

PATCH parent issue to in_review (manual closure required). Close this issue. STOP (no child).

### Branch F — Cancellation (`cancellation`)

Similar to withdrawal — orphan raw uploads are KEPT and recorded via the same orphan note (`{exception_folder}/orphan-raw-round-{round_index}.md`, with `**Terminal event:** cancellation` in the body). Then `event = case_cancelled`, `current_status = cancelled`. Audit-log row uses `case_cancelled`. Teams `§Teams_Escalation` with reason = "Candidate / HR cancelled onboarding". PATCH parent issue → in_review. Close this issue. STOP.

Exit heartbeat. ✓

---

## Failure handling reference

| Situation | Action |
|---|---|
| `run-state.json` missing at Step 1 | Blocked comment on this issue + parent. STOP. |
| `messageIds` missing from issue description | Blocked comment. STOP. |
| `outlook_read_email` fails for a messageId | Skip that messageId, log warning in round, continue loop. |
| Attachment transfer fails after 3 retries | Skip that file, escalate (human notify + audit-log escalated), continue with remaining. |
| Post-upload size = 0 | Delete file, escalate, continue. |
| `case-tracker.md` write fails after retry | Notify human, audit-log escalated, STOP. |
| `run-state.json` write fails after retry | Notify human, Phase Tracker row 4 → blocked. STOP. |
| `[HR-VALIDATE-DOCS]` child create fails after retry | Blocked comment, Phase Tracker row 4 → blocked. STOP. |
| Audit-log write fails after retry | Notify human, Phase Tracker row 4 → blocked. STOP. |

---

## What this phase does NOT do

- Read or visually inspect attachment content for validation. That is Phase 5 (`validate-docs.md`) — it calls `outlook_read_attachment` per `_shared.md § §9.1`.
- Build the discrepancy list. That is Phase 5.
- Upload to `02_Verified_Documents/`. That is Phase 7+8 auto-upload or Phase 9 fallback.
- Send the resubmission email. That is Phase 6.
- Touch the Document Tracker rows (only Phase 5 owns those).
- Close the parent orchestrator issue. That is Phase 10 only.

---

## Status on exit

Per `_shared.md § §21`:

| Outcome | This child issue (`[HR-PROCESS-REPLY]`) | Parent orchestrator issue |
|---|---|---|
| Reply with attachments → `[HR-VALIDATE-DOCS]` created | `done` | `in_progress` (active processing) |
| Acknowledgement-only / question reply | `done` (no child created) | `in_review` (still waiting for documents) |
| Withdrawal classification | `done` | `cancelled` — terminal |
| Cancellation classification | `done` | `cancelled` — terminal |
| Raw upload to SharePoint failed | `blocked` | `blocked` |
| run-state or audit-log write failed | `blocked` | `blocked` |
