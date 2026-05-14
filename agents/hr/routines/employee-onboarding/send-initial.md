# Phase 2 — Send Initial Email

**Title prefix:** `[HR-SEND-INITIAL]`
**Created by:** `validate-inputs.md` (Step 10)
**Creates next:** `[HR-AWAIT-REPLY]` child issue

---

## No-leak header

**TOOL RULE LINE 1:** This phase runs `outlook_send_email` ONCE (initial document-request email), `teams_send_channel_message` ONCE (non-blocking), plus `sharepoint_read_file` / `sharepoint_write_file` for run-state.json and case-tracker.md, plus Paperclip API calls. NO other tools.

**STATE:** Read `run_state_path` from this issue description. Append `send_initial` section to run-state.json before creating next child.

**CREATES NEXT:** `[HR-AWAIT-REPLY]` child issue. Exit AFTER child confirmed created.

**DO NOT:**
- Re-create SharePoint folders (Phase 1 did that).
- Re-copy the HRMS Excel template (Phase 1 did that).
- Re-write case-tracker from scratch — only update Phase Tracker row 2 and Status History.
- Poll for replies (heartbeat does that).
- Process attachments (Phase 4).
- Send anything other than the templated initial email.

---

## References

- Conventions: `routines/employee-onboarding/_shared.md`
- Templates: `routines/employee-onboarding/_email-templates.md`

---

## Step 0 — Idempotency check

Before any work, confirm this phase has not already completed for this `case_id`. Reason: heartbeat-driven retries or a duplicate `[HR-SEND-INITIAL]` issue could otherwise re-send the candidate's initial email, producing two identical mails (Outlook + audit-log inconsistency).

```
1. Read this issue description → run_state_path, case_id, parent_issue_id.
2. sharepoint_read_file path="{run_state_path}"
   → IF file missing: post blocked comment, STOP.
3. Parse JSON. Check run_state.send_initial.status.
4. sharepoint_read_file path="HR-Onboarding/audit-log.csv"
   → Grep for rows with this case_id AND event=initial_email_sent.
```

If BOTH of the following are true:
- `run_state.send_initial.status == "complete"`
- An audit-log row exists with this `case_id` AND `event=initial_email_sent` AND col-13 = `outlook`

…then the email has already been sent successfully. **Skip the send entirely** and go straight to Step 10 (`[HR-AWAIT-REPLY]` create, if it doesn't already exist) and Step 11 (close this child issue). Post a comment on this issue noting the idempotent skip:

```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
{ "body": "Phase 2 idempotent skip — initial email already sent for case_id {case_id} (run_state.send_initial.status=complete, audit row found). No re-send. Verifying [HR-AWAIT-REPLY] exists, then closing this duplicate child." }
```

Before creating `[HR-AWAIT-REPLY]` in this skipped path, check it isn't already there:
```
GET /api/companies/{PAPERCLIP_COMPANY_ID}/issues?parentId={parent_issue_id}&title-prefix=[HR-AWAIT-REPLY]
→ IF result list non-empty: do NOT create a duplicate; just close this issue.
→ IF empty: proceed to Step 10 to create it.
```

If only one of the two conditions is true (e.g. audit row exists but `run_state.send_initial.status != complete`, indicating a crash mid-write), do NOT skip — the case is in an inconsistent state and needs the full send path to converge. Continue to Step 1.

---

## Step 1 — Load run-state.json

```
sharepoint_read_file path="{run_state_path from this issue description}"
→ Parse JSON. Validate schema_version == 1.
→ IF file missing → see _shared.md § §17 (post blocked comment on this issue + parent_issue_id, STOP).
```

Extract — **read paths from run-state top-level, do NOT recompute:**
```
payload                 = run_state.payload
employee_full_name      = payload.employee_full_name
employee_email          = payload.employee_email
employee_type           = payload.employee_type
recruiter_or_hr_name    = payload.recruiter_or_hr_name
recruiter_or_hr_email   = payload.recruiter_or_hr_email
human_in_loop_email     = payload.human_in_loop_email
excel_url               = run_state.validate_inputs.excel_url
base_folder             = run_state.base_folder              ← top-level
case_tracker_path       = run_state.case_tracker_path        ← top-level
case_id                 = run_state.case_id
parent_issue_id         = run_state.parent_issue_id
```

**Guard:** if `excel_url` is null or empty → fail-close:
1. Notify `human_in_loop_email` (subject `HR Alert: Cannot send initial email — HRMS form URL missing`).
2. Append audit-log row (13 cols, col-13 = `outlook` for the human-notify email):
   ```
   {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|blocked|phase_blocked|excel_url missing in run-state — Phase 1 did not produce HRMS form link|run_state.validate_inputs.excel_url={got_value}|{PAPERCLIP_TASK_ID}|outlook
   ```
3. **Post Paperclip comment on THIS issue** so the failure is visible in the issue thread (not just audit-log):
   ```
   POST /api/issues/{PAPERCLIP_TASK_ID}/comments
   { "body": "Phase 2 blocked — `excel_url` missing in run-state.json. Phase 1 (validate-inputs) did not produce the HRMS form link. Human notified at {human_in_loop_email}. No email sent. Re-trigger Phase 1 to repair." }
   ```
4. PATCH this issue: `{ "status": "blocked", "comment": "See above." }`. Phase Tracker row 2 → `blocked`.
5. STOP. Do NOT proceed to Step 2.

---

## Step 2 — Flip Phase Tracker row 2 → in_progress

Read `case-tracker.md`, set row 2:
```
| 2 | Send initial email | send-initial.md | in_progress | {now} | — | {PAPERCLIP_TASK_ID} | Phase 2 started |
```
Write the file. On failure: retry once. If still fails: notify human, audit-log escalated, STOP.

---

## Step 3 — Select template by employee_type

**Hard rule — use the canonical template:** Load the email body verbatim from `_email-templates.md`. Do NOT hand-roll an HTML body, do NOT paraphrase, do NOT omit sections. The canonical template is the only source for this email's structure. A common past failure originated here: a custom body was built and silently omitted the HRMS form link.

| `employee_type` | Template section |
|---|---|
| `intern`, `fresher` | `_email-templates.md § §INITIAL_INTERN_FRESHER` |
| `fte`, `experienced` | `_email-templates.md § §INITIAL_FTE_EXPERIENCED` |
| `contractor` | `_email-templates.md § §INITIAL_CONTRACTOR` (honor `special_document_requirements` conditional) |
| `rehire` | `_email-templates.md § §INITIAL_FTE_EXPERIENCED` (use FTE list as the standard rehire ask. The rehire pre-confirmation alert was already sent in Phase 1.) |

Substitute every `{placeholder}` with values from `payload`. Confirm no unresolved `{...}` remains in subject or body before sending.

### Step 3a — Body-substitution assert (MANDATORY)

After substitution, assert ALL of the following on the rendered `body` string:

- `body.includes(excel_url)` — the actual HRMS form URL appears verbatim in the email body. This is the primary defense against a custom template that drops the form link.
- `body.includes("href=\"" + excel_url + "\"")` OR `body.includes("href='" + excel_url + "'")` — the URL is wired as a real `<a href>` anchor, not just present as plain text. Plain text URLs render but don't always become clickable in Outlook.
- `body.includes("{")` is **false** — no unresolved `{placeholder}` survived substitution. If any `{...}` remains, a template variable was not provided.
- `body.length >= 500` — sanity floor. The canonical templates are ~1500–3000 chars; anything under 500 indicates a stub / accidentally truncated body.

**If ANY assert fails:**
1. Do NOT send the email. Skip Step 4 entirely.
2. Notify `human_in_loop_email` (subject `HR Alert: Initial email body assert failed — {employee_full_name}`, body names the failing assert and the body length).
3. Append audit-log row (13 cols, col-13 = `outlook` for the human-notify email):
   ```
   {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|blocked|phase_blocked|Email body assert failed: {which_assert} — custom template or unresolved placeholder|body_length={N}|{PAPERCLIP_TASK_ID}|outlook
   ```
4. Post Paperclip comment on this issue:
   ```
   POST /api/issues/{PAPERCLIP_TASK_ID}/comments
   { "body": "Phase 2 blocked — email body did not pass substitution assert ({which_assert} failed). Either the canonical `_email-templates.md` template was not used, or a placeholder is unresolved. Human notified. Re-trigger after fixing template selection." }
   ```
5. PATCH this issue: `{ "status": "blocked", "comment": "See above." }`. Phase Tracker row 2 → `blocked`. STOP.

Reason: the assert is cheap (string ops on the body you already built) and catches the entire class of failures where the agent invented a body that lacks the form link. Sending an email without `excel_url` is materially worse than blocking the phase and asking a human to fix the template.

---

## Step 4 — Send the email

**TOOL CHOICE — MACHINE-ENFORCED:** ONLY `outlook_send_email`. Never `resend_send_email` / `resend_send_batch` for this step. The post-send assert below is the enforcement gate — a Resend response will fail it and route this case to `blocked`.

```
outlook_send_email
  to            = "{employee_email}"
  ccRecipients  = ["{recruiter_or_hr_email}"]
  subject       = "{subject from template, with {employee_full_name} substituted}"
  isHtml        = true
  body          = "{body from template, all placeholders resolved, must include excel_url link}"
```

Capture from the response:
- `messageId` → store as `outlook_message_id` (existing).
- `conversationId` → store as `conversation_id` (TASK-005). This is the Outlook thread key the heartbeat uses for reply detection (`email-heartbeat.md` STEP 2 + Search Protocol). If the field is absent or empty, leave `conversation_id` null — the heartbeat will fall back to `from:`/`subject:` search for that case. Do NOT fabricate a value. Do NOT reuse `outlook_message_id` here.
- The `from` address actually used by the send → store as `inbox_used` (TASK-009). This must match one of the addresses listed in `HR-Onboarding/config.md` `monitored_mailboxes`. If absent in the response, fall back to the configured default sender mailbox (do NOT hardcode an address — read from config).

### Step 4a — Post-send schema assert (required)

Treat the send as **failed** if ANY of the following are true:
- The MCP call returned a non-2xx response.
- The response object has no `messageId` field, or `messageId` is null / empty / less than 20 characters.
- The tool actually invoked was anything other than `outlook_send_email` (Resend responses lack an Outlook-shaped `messageId` and will fail this assert).

This assert is the enforcement of `AGENTS.md` "1:1 transactional HR email = `outlook_send_email`" rule. Do NOT skip. Do NOT relax to "any non-empty string" — the assert exists precisely to catch a Resend swap.

**On failure (assert above or transport error):**
- Retry once after 5s using `outlook_send_email` (only). Never swap tools as a fallback.
- If still fails:
  - `outlook_send_email` to `{human_in_loop_email}` with subject `HR Alert: Failed to send initial document-request email — {employee_full_name}` and body summarizing the error AND the actual tool that was used (if a Resend swap was detected, name it explicitly).
  - Append audit-log row with **`event=email_send_failed`** (NOT `escalated`) — this maps to `current_status = blocked` per `_shared.md § §5`. Reason: `escalated` cases are EXCLUDED from the heartbeat email-poll bucket; using `blocked` correctly classifies this as a stuck-Phase-2 awaiting human intervention.
  - Audit-log row (13 columns — col-13 is the tool that was attempted, `outlook` if the assert failed on Outlook response, `resend` if a Resend swap was detected):
    ```
    {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|blocked|email_send_failed|Initial email send failed (assert: {outlook_message_id missing | resend swap detected | transport error}) after 1 retry|error={error_message}|{PAPERCLIP_TASK_ID}|{attempted_tool}
    ```
  - Teams notification: `_email-templates.md § §Teams_Escalation` with reason = "Phase 2 initial email send failure — case stuck awaiting manual intervention".
  - PATCH parent orchestrator issue:
    ```
    PATCH /api/issues/{parent_issue_id}
    { "status": "blocked", "comment": "Phase 2 failed — initial document-request email could not be sent. Human must investigate and re-trigger Phase 2 manually. See audit-log row event=email_send_failed." }
    ```
  - Phase Tracker row 2 → `blocked`. STOP — do NOT create next child.

---

## Step 5 — Append audit-log row

Per `_shared.md § §3` and `§4`. Row has 13 columns — col-13 is `email_tool=outlook` (this phase MUST use Outlook; Step 4a's assert guarantees that):
```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|initial_email_sent|initial_email_sent|Document request email sent|template={employee_type} excel_url={excel_url}|{PAPERCLIP_TASK_ID}|outlook
```

(Use `current_status = initial_email_sent` per `_shared.md § §5`. `email_tool` is the literal string `outlook`; never a variable here because this step is only reached after Step 4a confirms an Outlook send.)

---

## Step 6 — Teams notification (non-blocking)

Use template `_email-templates.md § §Teams_Onboarding_Started`. Send via:
```
teams_send_channel_message
  teamId      = $TEAMS_HR_TEAM_ID
  channelId   = $TEAMS_HR_CHANNEL_ID
  contentType = "html"
  content     = "{rendered template body}"
```

On failure → append `⚠️ Teams notification failed: {error}` to this issue's next comment, continue. Do NOT retry. Do NOT block.

---

## Step 7 — Update run-state.json

Append:
```json
"send_initial": {
  "status": "complete",
  "completed_at": "{ISO now}",
  "template_used": "{employee_type template name}",
  "sent_to": "{employee_email}",
  "cc": ["{recruiter_or_hr_email}"],
  "outlook_message_id": "{outlook_message_id}",
  "conversation_id": "{conversation_id or null}",
  "inbox_used": "{inbox_used}",
  "email_tool": "outlook",
  "subject": "{actual subject from the rendered template, with {employee_full_name} substituted}"
}
```

`email_tool` is REQUIRED and MUST be the literal string `outlook`. `email-heartbeat.md` STEP 2 asserts this before polling for replies. Any other value (or missing field) makes the case unrecoverable by heartbeat — it will fall into the `heartbeat_channel_mismatch` path.

`conversation_id` is the authoritative thread key. Heartbeat per-case reply poll matches Outlook messages whose `conversationId` equals this value. Subject-text matching is a fallback only and is forbidden as the primary input (per `email-heartbeat.md ## Search Protocol`).

`inbox_used` is the FROM-address the send went through. Heartbeat poll must target the mailbox listed in `HR-Onboarding/config.md` `monitored_mailboxes` whose address matches `inbox_used`. Polling the wrong mailbox loses replies.

Do NOT hardcode the subject line. It is derived per-case from the template + `employee_full_name`.

Add `send_initial` to `phases_complete[]`. Set `current_phase = "await_reply"`. Set `last_updated = now`.

Write per `_shared.md § §12`. On retry failure: notify human, Phase Tracker row 2 → `blocked`, STOP — do NOT create next child.

---

## Step 8 — Flip Phase Tracker row 2 → done, append Status History row

Re-read `case-tracker.md`, update row 2:
```
| 2 | Send initial email | send-initial.md | done | {row2.Started from Step 2} | {now} | {PAPERCLIP_TASK_ID} | {employee_type} template sent to {employee_email}; messageId={outlook_message_id} |
```

Append Status History row:
```
| {now} | initial_email_sent | Document request email sent — {employee_type} template; CC {recruiter_or_hr_email} |
```

Write the file. On retry failure: notify human, audit-log escalated, STOP.

---

## Step 9 — Post comment on this issue

```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "body": "Phase 2 complete. Initial email sent to {employee_email} (CC {recruiter_or_hr_email}). outlook_message_id={outlook_message_id}. Creating [HR-AWAIT-REPLY] child for Phase 3."
}
```

---

## Step 10 — Create `[HR-AWAIT-REPLY]` child issue

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[HR-AWAIT-REPLY] {employee_full_name} — awaiting candidate reply",
  "description": "phase_file: routines/employee-onboarding/await-reply.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}\npaperclip_issue_id: {parent_issue_id}\ncase_id: {case_id}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "medium"
}
→ IF creation fails: retry once. If still fails: post blocked comment, Phase Tracker row 2 → `blocked`. STOP.
→ Store returned issue id as await_reply_issue_id.
```

---

## Step 11 — Close this child issue

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "status": "done",
  "comment": "Phase 2 complete. Next: [HR-AWAIT-REPLY] created ({await_reply_issue_id})."
}
```

---

## Step 12 — PATCH parent orchestrator → in_review (MANDATORY)

The case is now waiting for the candidate; heartbeat owns the next action. The parent (orchestrator) issue MUST reflect that. Without this PATCH, the parent stays `in_progress` from checkout, drifts off the `_shared.md § §21` case-status mapping, and any subsequent user-comment wake triggers the post-checkout `in_progress` thrash pattern (checkout flips → agent answers → exits → status never restored).

Compute nudge timestamps for the comment:
- `nudge_1_due = now + 48h`
- `nudge_2_due = now + 96h`

```
PATCH /api/issues/{parent_issue_id}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "status": "in_review",
  "comment": "Phase 2 complete — initial document-request email sent to {employee_email} (CC {recruiter_or_hr_email}). outlook_message_id={outlook_message_id}. Heartbeat now polling for reply. Nudge 1 ~{nudge_1_due}, Nudge 2 ~{nudge_2_due}. case_status=awaiting_document_submission."
}
```

On failure: retry once after 3s. If still fails, do NOT block the heartbeat — append an audit-log row (`event=parent_patch_retry`, status unchanged per §5) and exit. The heartbeat STEP 6a anti-thrash rule will normalize the parent on the next tick. Reason: this is a status-sync nice-to-have, not a correctness gate — the case work itself is complete.

Exit heartbeat. ✓

---

## Failure handling reference

| Situation | Action |
|---|---|
| `run-state.json` missing at Step 1 | Blocked comment on this issue + parent. STOP. |
| `excel_url` missing in run-state | Notify human, audit-log escalated, Phase Tracker row 2 → blocked. STOP. |
| Initial email send fails after retry | Notify human, audit-log escalated, Phase Tracker row 2 → blocked. STOP. |
| Audit-log write fails after retry | Notify human, Phase Tracker row 2 → blocked. STOP. |
| `run-state.json` write fails after retry | Notify human, Phase Tracker row 2 → blocked. STOP. |
| `case-tracker.md` write fails after retry | Notify human, audit-log escalated, STOP. |
| Teams send fails | Append note to comment, continue (non-blocking). |
| `[HR-AWAIT-REPLY]` create fails after retry | Blocked comment, Phase Tracker row 2 → blocked. STOP. |

---

## What this phase does NOT do

- Validate inputs (Phase 1).
- Create SharePoint folders or copy templates (Phase 1).
- Poll for replies (`email-heartbeat.md`).
- Send any reminder / nudge email (heartbeat Paths A/B/C).
- Process candidate replies or attachments (Phase 4).
- Update Document Tracker, Identity Verification, Reminders Sent, or Attachment Lookup rows (later phases own those).

---

## Status on exit

Per `_shared.md § §21`:

| Outcome | This child issue (`[HR-SEND-INITIAL]`) | Parent orchestrator issue |
|---|---|---|
| Success → `[HR-AWAIT-REPLY]` created (Step 10) | `done` (set at Step 11) | **`in_review`** — parent is now waiting for candidate reply; heartbeat owns next action |
| `excel_url` null (Step 1 guard) | `blocked` with reason | `blocked` |
| `outlook_send_email` assert fail (Step 4a — wrong tool, missing messageId, or transport error) | `blocked` with reason | `blocked` |
| Audit-log / run-state / case-tracker write fail | `blocked` | `blocked` |
| `[HR-AWAIT-REPLY]` create fail | `blocked` | `blocked` |

**Critical:** after Step 11 PATCHes this child to `done`, the routine MUST also `PATCH /api/issues/{parent_issue_id}` to set parent status = `in_review`. The parent issue's sidebar must not show `in_progress` once the case is waiting on the candidate, or it will conflict with the heartbeat anti-thrash rule (see `email-heartbeat.md` STEP 6).

```
PATCH /api/issues/{parent_issue_id}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "in_review", "comment": "Phase 2 complete — initial document-request email sent to {employee_email}. Heartbeat now polling for reply. Nudge schedule: Nudge 1 at {now + 48h}, Nudge 2 at {now + 96h}." }
```
