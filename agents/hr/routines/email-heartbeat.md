# Email Heartbeat Routine

**Trigger:** Cron — every 30 minutes  
**Concurrency policy:** `skip_if_running` — never overlap heartbeat runs  
**Catch-up policy:** `skip_missed`

---

## Global Conventions

- **Timestamps:** All timestamps MUST be ISO-8601 UTC format: `YYYY-MM-DDTHH:MM:SSZ` (e.g. `2026-04-23T09:15:00Z`). Never use local time or ambiguous formats.
- **Audit-log ownership:** The heartbeat writes to `HR-Onboarding/audit-log.csv` ONLY. It does NOT write to any per-employee `case-tracker.md`. Case-tracker updates are the exclusive responsibility of the onboarding routine.

---

## Audit-Log Format

File: `HR-Onboarding/audit-log.csv` — pipe-delimited CSV (`|`). Never use comma as delimiter.

**Append pattern:** `sharepoint_read_file path="HR-Onboarding/audit-log.csv"` → add new line at end → `sharepoint_write_file path="HR-Onboarding/audit-log.csv"` with full updated content.

Every row appended by the heartbeat MUST include all 12 columns:

```
{timestamp}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|{current_status}|{event}|{action_taken}|{brief_reason}|{paperclip_issue_id}
```

Use `—` (em-dash) for fields that do not apply (e.g. `case_id` on the heartbeat tick summary row, `paperclip_issue_id` on heartbeat-only rows). Never leave a field blank.

---

## Purpose

The heartbeat owns three responsibilities. Each tick processes every active case across all three:

1. **Reply detection** — poll for candidate email replies on cases awaiting submission. When replies are detected, create a `[HR-PROCESS-REPLY]` child issue carrying the messageIds list — the onboarding agent processes them via Phase 4.
2. **Nudge cadence** — send Nudge 1 at 24h, Nudge 2 at 48h, mark stalled at 72h for cases with no candidate reply.
3. **Approval polling** — for cases in `awaiting_human_verification`, poll the Paperclip approval status. When the approval transitions to `approved`, create the `[HR-UPLOAD-SP]` child so Phase 9 takes over. Notify on rejection / withdrawal / timeout (> 7 days pending).

This heartbeat does NOT validate documents, run the document-validator skill, upload binaries, or mark the parent orchestrator issue as `done`. It only routes work to the onboarding phase files via title-prefixed child issues.

---

## STEP 1 — Load active cases

1. `sharepoint_read_file path="HR-Onboarding/audit-log.csv"`
   → Parse all rows (pipe-delimited CSV, skip header row)
   → Build TWO buckets from the audit-log:
     - **email-poll bucket** — cases where `current_status` NOT IN: `completed`, `cancelled`, `withdrawn`, `stalled`, `escalated`, `awaiting_human_verification`, `verified_by_human`, `sharepoint_upload_in_progress`, `uploaded_to_sharepoint`, `blocked`, `hrms_form_submitted`. These cases get reply-check (STEP 2) and nudge-decision (STEP 3) processing.
     - **approval-poll bucket** — cases where `current_status == awaiting_human_verification`. These cases get approval-poll (STEP 6) processing only. They do NOT receive reply-checks or nudges (the candidate already sent everything; we are waiting on the human reviewer).
   → For each active case, group rows by `case_id` and extract:
     - `employee_email`          (from any row for this `case_id`)
     - `employee_full_name`      (from any row for this `case_id`)
     - `employee_type`           (from `case_created` row)
     - `case_id`                 (from `case_created` row — format is `{employee_email}-{date_of_joining}` for onboarding cases, `fte-form-{employee_email}-{date_of_joining}` for intern_fte_form cases)
     - `date_of_joining`         (parse from `case_id` — everything after the last `-YYYY` prefix; format: `YYYY-MM-DD`)
     - `human_in_loop_email`     (from `case_created` row)
     - `recruiter_or_hr_name`    (from `case_created` row)
     - `recruiter_or_hr_email`   (read from tracker file — for `intern_fte_form` cases: `fte-form-tracker.md` field `HR Contact Email`; for all others: `case-tracker.md` field `HR Contact Email`; `null` if file not present)
     - `role`                    (for `intern_fte_form` cases only: read from `fte-form-tracker.md` field `Role`; not required for onboarding cases)
     - `phone_number`            (for `intern_fte_form` cases only: read from `fte-form-tracker.md` field `Phone`; `null` if not present)
     - `excel_url`               (for `intern_fte_form` cases only: read from `fte-form-tracker.md` field `Form URL`; `null` if not present — Phase 0 falls back to path reconstruction if null)
     - `current_status`          (from the most recent row for this `case_id`)
     - `last_outbound_email_timestamp`  (timestamp of most recent `initial_email_sent` OR `form_reprompt_sent` OR `reminder_1_sent` OR `reminder_2_sent` row)
     - `reminder_1_sent`         (`true` if a row with event=`reminder_1_sent` exists for this `case_id`, else `false`)
     - `reminder_2_sent`         (`true` if a row with event=`reminder_2_sent` exists for this `case_id`, else `false`)
     - `reminder_1_sent_timestamp`      (timestamp of `reminder_1_sent` row, if present)
     - `reminder_2_sent_timestamp`      (timestamp of `reminder_2_sent` row, if present)
     - `alternate_candidate_email`      (read from `HR-Onboarding/{employee_full_name} - {date_of_joining}/case-tracker.md` field `alternate_candidate_email`, or `null` if not present)
     - `paperclip_issue_id`      (column 12 of the `case_created` row for this `case_id`; `null` if missing — legacy rows pre-date this field)
     - `last_reply_routed_timestamp`    (timestamp of the most recent `reply_detected` row for this `case_id`; `null` if no such row exists)

   **TIMESTAMP GUARD:** For each case, if `last_outbound_email_timestamp` is missing, null, or unparseable:
   → Append to audit-log:
   ```
   {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|{current_status}|heartbeat_skip|Skipped — timestamp missing or malformed|Cannot compute elapsed time|{paperclip_issue_id or —}
   ```
   → `outlook_send_email` to `{human_in_loop_email}`:
     - subject: `HR Alert: Cannot process case for {employee_full_name} — timestamp error`
     - isHtml: true
     - body: `<p>Hi,</p><p>The heartbeat could not process the onboarding case for <strong>{employee_full_name}</strong> ({employee_email}) because the last outbound email timestamp is missing or malformed in the audit log.</p><p>Case ID: {case_id}</p><p>Manual inspection of the audit log is required.</p><p>Regards,<br>HR Automation</p>`
   → Exclude this case from further processing this tick

1c. Supplement missing `paperclip_issue_id` for active cases:
    `GET /api/companies/{PAPERCLIP_COMPANY_ID}/issues?assigneeAgentId={HR_AGENT_ID}&status=in_review`
    → For each returned issue: extract `case_id` from description (line starting with `case_id:`)
    → If that `case_id` matches an active case where `paperclip_issue_id` is null → set `paperclip_issue_id = issue.id`
    → Any active case still missing `paperclip_issue_id` after this step:
      - `outlook_send_email` to `{human_in_loop_email}`:
        - subject: `HR Alert: Cannot route replies for {employee_full_name} — Paperclip issue ID unknown`
        - isHtml: true
        - body: `<p>Hi,</p><p>The heartbeat could not find the Paperclip issue ID for case <strong>{case_id}</strong> ({employee_full_name}, {employee_email}). Reply sub-issue routing will fail without it. Manual lookup required.</p><p>Regards,<br>HR Automation</p>`
      - Append to audit-log:
        ```
        {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|{current_status}|heartbeat_skip|Skipped — paperclip_issue_id unknown after Paperclip query|Cannot create reply sub-issue|—
        ```
      - Exclude from further processing this tick

1d. **Audit-log ↔ Paperclip bridge check — catches cases missing from audit-log.**

The bucket above is derived from `audit-log.csv` alone. If a Phase 1 run wrote `case-tracker.md` and `run-state.json` but FAILED or SKIPPED the audit-log append (e.g. an agent partial-completed Phase 1 — folders / run-state / tracker landed but the audit-log row was malformed or skipped), the case will be invisible to the heartbeat. Bridge it here:

```
GET /api/companies/{PAPERCLIP_COMPANY_ID}/issues?assigneeAgentId={HR_AGENT_ID}&status=todo,in_progress,in_review&title-prefix=[HR-ONBOARD]
→ For each returned issue:
   - Parse description for `case_id:` line. If absent, also look for `employee_email:` line and reconstruct `{employee_email}-{date_of_joining}`.
   - Compare against the union of (email-poll bucket ∪ approval-poll bucket ∪ cases already flagged for skip in 1c).
```

For each Paperclip-active `[HR-ONBOARD]` issue whose `case_id` is **NOT present in any heartbeat bucket**:

1. **Notify `human_in_loop_email`** (subject `HR Alert: Onboarding case missing from audit-log — {employee_full_name}`, body names the Paperclip issue id and the expected `case_id`, asks the human to inspect SharePoint folder and re-trigger Phase 1 if data is missing).

2. **Append audit-log row** (13 cols, col-13 = `outlook` for the notify email):
   ```
   {now}|{reconstructed_case_id}|{employee_email or —}|{employee_full_name or —}|—|—|—|escalated|case_missing_from_audit_log|Paperclip [HR-ONBOARD] issue {paperclip_issue_id} active but case_id not in audit-log|Phase 1 audit write likely failed or skipped — human must re-trigger|{paperclip_issue_id}|outlook
   ```

3. **Dedup**: if a `case_missing_from_audit_log` row already exists for this `paperclip_issue_id` within the last 24h, do NOT re-notify. One alert per case per day.

4. **Do NOT** auto-add this case to a bucket and start polling. The audit-log is the source of truth for case state; if it's missing, the case may be in any phase. Human inspection required.

This bridge catches any case where Phase 1 partially completes but the audit-log row never lands.

2. If no active cases (after bridge check) → append to audit-log:
   ```
   {now}|—|—|—|—|—|—|—|heartbeat_tick|No active cases|—|—|—
   ```
   → STOP

---

## STEP 1.5 — Cross-case duplicate detection (CRITICAL — runs BEFORE STEP 2)

A single human candidate may have ended up with two `case_id`s in the audit-log due to:
- Re-trigger after typo correction (old `gmai.com` case still active + new `gmail.com` case).
- Re-trigger with slightly different `employee_full_name` (e.g. `Sameer Mansur` vs `Sameer S Mansur`) — orchestrator's older folder-name check missed this.
- Manual recovery sub-issues (`Recover stalled issue MED-XXX`) creating parallel case identities.

If two active cases refer to the same human, the heartbeat would otherwise route the candidate's email replies to BOTH parents, creating duplicate `[HR-PROCESS-REPLY]` sub-issues and confusing downstream phases. This step detects + blocks that scenario.

### Normalization (same as orchestrator Step 3.5)

```
norm_email(s)        = trim(lowercase(s))
norm_name(s)         = trim(collapse_consecutive_whitespace(lowercase(s)))
levenshtein(a, b)    = standard edit distance
```

### Scan

Build a `collision_set` from the email-poll bucket built in STEP 1:

```
collisions_by_case_id = {}    ← map: case_id → list of conflicting case_ids

FOR each pair (X, Y) in email_poll_bucket where X.case_id != Y.case_id:
  IF X.date_of_joining != Y.date_of_joining: continue
  norm_email_X = norm_email(X.employee_email);  norm_name_X = norm_name(X.employee_full_name)
  norm_email_Y = norm_email(Y.employee_email);  norm_name_Y = norm_name(Y.employee_full_name)

  reason = null
  IF norm_email_X == norm_email_Y: reason = "exact_email_match"
  ELSE IF levenshtein(norm_email_X, norm_email_Y) <= 2: reason = "typo_distance_email"
  ELSE IF norm_name_X == norm_name_Y: reason = "exact_name_match"
  ELSE IF levenshtein(norm_name_X, norm_name_Y) <= 2: reason = "typo_distance_name"
  ELSE IF norm_name_X starts with norm_name_Y OR norm_name_Y starts with norm_name_X: reason = "name_prefix_overlap"

  IF reason is not null:
    collisions_by_case_id[X.case_id].append({ other_case_id: Y.case_id, reason })
    collisions_by_case_id[Y.case_id].append({ other_case_id: X.case_id, reason })
```

### Action on each colliding case

For each `case_id` present as a KEY in `collisions_by_case_id`:

1. **Exclude this case from STEP 2 (reply check) and STEP 3 (nudge) for this tick.** Do NOT search Outlook, do NOT create `[HR-PROCESS-REPLY]`, do NOT send nudge.

2. **Dedup the alert:** check the audit-log for an existing `event = duplicate_workflow_detected` row for this `case_id` within the last 24 hours. If one exists, just skip silently (do not spam human).

3. **Else, notify human ONCE per 24h:**
   ```
   outlook_send_email
     to:      {human_in_loop_email for case_id}
     subject: HR Alert: Duplicate active cases detected — heartbeat paused for {employee_full_name}
     isHtml:  true
     body:
     <p>Hi,</p>
     <p>The heartbeat detected that <strong>case_id={case_id}</strong> ({employee_full_name}, {employee_email}) appears to refer to the same candidate as one or more other active cases:</p>
     <ul>{for each conflict: <li>case_id=<code>{other_case_id}</code> — reason: <code>{reason}</code></li>}</ul>
     <p>Heartbeat has PAUSED reply detection and nudges for ALL conflicting cases until a human resolves the duplicate. Please:</p>
     <ol>
       <li>Identify which case_id is the canonical one to keep.</li>
       <li>Mark the others as <code>cancelled</code> by appending a <code>case_cancelled</code> audit-log row.</li>
       <li>Optionally cancel the corresponding Paperclip parent issue(s).</li>
     </ol>
     <p>Regards,<br>HR Automation</p>
   ```

4. **Append to audit-log** (column 8 = literal `blocked`, NOT the prior status, per `_shared.md § §5` mapping for `duplicate_workflow_detected`):
   ```
   {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|blocked|duplicate_workflow_detected|Heartbeat paused — collision with {conflict_count} other active case(s)|{collision_list joined: case_id=X reason=Y; ...}|{paperclip_issue_id or —}
   ```
   After this row, the case will no longer appear in the email-poll bucket on future ticks (status `blocked` is in the STEP 1 exclusion list). The case stays paused until a human manually appends a `case_cancelled` row OR opens a fresh case under a clean case_id.

### Branch on the surviving cases

After excluding all case_ids in `collisions_by_case_id`, build `email_poll_bucket_clean` = `email_poll_bucket` minus those excluded. The rest of STEP 2 + STEP 3 + STEP 4 operates on `email_poll_bucket_clean` only.

If `email_poll_bucket_clean` is empty AND `approval_poll_bucket` is also empty (STEP 5), continue to STEP 6 completion log with `collision_count = N` recorded.

---

## STEP 2 — Check for replies (email-poll bucket only)

For each case in `email_poll_bucket_clean` built in STEP 1.5 (cases in `awaiting_human_verification` are NOT in this bucket — they get handled in STEP 5 below; cases flagged as duplicates by STEP 1.5 are also excluded):

### STEP 2 — Pre-poll channel cross-check

Before any `outlook_search_emails` call, read this case's `run-state.json` from `case.run_state_path` (already resolved during STEP 1 audit-log scan; if absent, do a fresh `sharepoint_read_file`). Run the channel-eligibility check below; only call `outlook_search_emails` when it passes.

**Required conditions for Outlook polling (all must be true):**

- `run_state.send_initial.status == "complete"` — the initial email actually went out.
- `run_state.send_initial.outlook_message_id` is a non-empty string of length ≥ 20.
- The `email_tool` field, if present, is `"outlook"`.

**Backward-compat for legacy cases (pre-2026-05-13):** If `run_state.send_initial.email_tool` is absent AND `outlook_message_id` is present and well-formed (length ≥ 20), treat as `email_tool == "outlook"` and proceed with the poll. Reason: cases created before the field was introduced still went through Outlook by routine convention; flagging every one of them on first deploy would spam humans.

**Take the channel-mismatch path ONLY when:**
- `email_tool` is **present** AND is **not** `"outlook"`, OR
- `outlook_message_id` is absent / empty / shorter than 20 chars (regardless of `email_tool`).

If neither mismatch trigger fires, proceed to 3a below. Otherwise:

1. **Dedup check.** Read the audit-log rows for this `case_id` (already in context from STEP 1). If a row already exists with `event=heartbeat_channel_mismatch`, the human has already been notified — DO NOT re-notify. Skip this case for this tick. Continue to next case.

2. **First occurrence — notify human.** `outlook_send_email`:
   - to: `{human_in_loop_email}`
   - ccRecipients: `["{recruiter_or_hr_email}"]`
   - subject: `HR Alert: Reply detection paused — wrong email channel for {employee_full_name}`
   - isHtml: true
   - body: `<p>Hi,</p><p>The welcome email for <strong>{employee_full_name}</strong> ({employee_email}) was sent via <strong>{run_state.send_initial.email_tool or "unknown"}</strong>, not Outlook. The heartbeat polls Outlook only, so candidate replies will be missed.</p><p><strong>Action:</strong> Inspect the case in Paperclip ({paperclip_issue_id}) and either (a) re-send the welcome via Outlook, or (b) manually watch the alternate inbox until reply arrives.</p><p>Case ID: {case_id}</p><p>Regards,<br>HR Automation</p>`

3. **Append audit-log row** (13 columns, col-13 = `outlook`):
   ```
   {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|escalated|heartbeat_channel_mismatch|Outlook poll skipped — send_initial.email_tool={got_value}, outlook_message_id={got_value or "—"}|Human notified once; dedup on this event|{paperclip_issue_id}|outlook
   ```
   (`current_status = escalated` per `_shared.md § §5`. Once written, this case falls out of the email-poll bucket on next tick because STEP 1 excludes `escalated`.)

4. **Skip 3a/3b** for this case. Do NOT call `outlook_search_emails`. Continue to next case.

If all asserts pass → proceed with 3a below.

3a. `outlook_search_emails`  
    query: `"from:{employee_email}"`  
    → Compute search cutoff: `max(last_outbound_email_timestamp, last_reply_routed_timestamp)` — use whichever is later; if `last_reply_routed_timestamp` is null, use `last_outbound_email_timestamp` alone  
    → Collect **ALL** messages received AFTER that cutoff, sorted chronologically (oldest first)

3b. IF no results from 3a:
    → subject query depends on employee_type:
      - IF `employee_type` == `intern_fte_form`: query: `"subject:Review Your Onboarding Form {employee_full_name}"`
      - ELSE: query: `"subject:Onboarding Documents {employee_full_name}"`
    → `outlook_search_emails` with that query
      → Collect all messages received AFTER `last_outbound_email_timestamp`

    **STRICT sender verification (NO exceptions):**

    For each message found by the subject-search:
    ```
    sender_email_norm = trim(lowercase(message.from.email))
    case_email_norm   = trim(lowercase(case.employee_email))
    alt_email_norm    = trim(lowercase(case.alternate_candidate_email))   ← may be null

    is_match = (sender_email_norm == case_email_norm)
            OR (alt_email_norm is not null AND sender_email_norm == alt_email_norm)
    ```

    - **`is_match == true`** → treat as a normal reply (add this message's `messageId` to the in-progress reply list for step 4 below — same handling as step 3a results).
    - **`is_match == false`** (sender does NOT match `employee_email` or `alternate_candidate_email` exactly after normalization) → MUST take the `reply_from_alternate_sender` path:
      - `outlook_send_email` to `{human_in_loop_email}`:
        - subject: `HR Alert: Possible reply from alternate address — {employee_full_name}`
        - isHtml: true
        - body: `<p>Hi,</p><p>A possible reply was detected for <strong>{employee_full_name}</strong> from an unrecognized email address:</p><table><tr><td><strong>Expected:</strong></td><td>{employee_email}</td></tr><tr><td><strong>Alternate on file:</strong></td><td>{alternate_candidate_email or "—"}</td></tr><tr><td><strong>Actual sender:</strong></td><td>{message.from.email}</td></tr></table><p>Please review and confirm if this is from the candidate. Case ID: {case_id}</p><p>Regards,<br>HR Automation</p>`
      - Append to audit-log:
        ```
        {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|{current_status}|reply_from_alternate_sender|Notified human — subject-match reply from unrecognized sender|sender={message.from.email} expected={employee_email}|{paperclip_issue_id or —}
        ```
      - Do NOT add this message to the reply list. Do NOT create `[HR-PROCESS-REPLY]` for it.
      - Skip nudge for this tick; continue to next case.

    **NO partial-match, NO typo-tolerance, NO subject-only fallback at the routing step.** If the sender email is not an EXACT normalized match for `employee_email` or `alternate_candidate_email`, the message goes to the alternate-sender path. Humans confirm whether it's a real reply before pipeline acts on it. Permissive matching is the root cause of cross-case sub-issue duplication (one human's reply ending up routed to a different person's case).

4. IF one or more replies found (from step 3a or 3b, both gated by the strict sender check above):

   **Collect ALL reply messageIds for this case first (do not process one-by-one):**
   → messageId_list = all reply messages sorted chronologically (oldest first)
   → N = total count

   **Determine title prefix by employee_type:**
   - `intern_fte_form` → title prefix: `[INTERN-FTE-FORM]`
   - all other types   → title prefix: `[HR-PROCESS-REPLY]` (this is the new prefix; the orchestrator in `employee-onboarding.md` also accepts the legacy `[HR-ONBOARDING-REPLY]` for backward compat — for new sub-issues always use `[HR-PROCESS-REPLY]`)

   **Build child issue description (key-value lines):**
   ```
   source: api
   case_id: {case_id}
   messageIds: {messageId1},{messageId2},...        ← comma-separated, chronological order
   reply_count: {N}
   employee_email: {employee_email}
   employee_full_name: {employee_full_name}
   employee_type: {employee_type}
   date_of_joining: {date_of_joining}
   recruiter_or_hr_name: {recruiter_or_hr_name}
   recruiter_or_hr_email: {recruiter_or_hr_email}
   human_in_loop_email: {human_in_loop_email}
   current_status: {current_status}
   parent_issue_id: {paperclip_issue_id}
   [IF phone_number non-null:            phone_number: {value}]
   [IF alternate_candidate_email non-null: alternate_candidate_email: {value}]
   [IF intern_fte_form AND role non-null: role: {value}]
   [IF intern_fte_form AND excel_url non-null: excel_url: {value}]
   ```

   **Create ONE child issue (one per case per tick — not one per message):**
   ```
   POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
   Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
   {
     "title": "{prefix} {employee_full_name} — {N} new reply(s)",
     "description": "{key-value lines above}",
     "assigneeAgentId": "{HR_AGENT_ID}",
     "parentId": "{paperclip_issue_id}",
     "status": "todo",
     "priority": "high"
   }
   ```
   → Agent picks it up by title prefix → reads `messageIds` → processes each in sequence → jumps to Phase 4.

   On success:
   - Append to audit-log:
     ```
     {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|{current_status}|reply_detected|Reply sub-issue created — {N} message(s) queued|Sub-issue: {created_issue_id} Parent: {paperclip_issue_id}|{paperclip_issue_id}
     ```
   - Continue to next case (do NOT send nudge)

   On failure (issue creation returns error — retry once, then escalate):
   - `outlook_send_email` to `{human_in_loop_email}`:
     - subject: `HR Alert: Failed to create reply sub-issue for {employee_full_name}`
     - isHtml: true
     - body: `<p>Hi,</p><p>The heartbeat detected {N} reply(s) from <strong>{employee_full_name}</strong> ({employee_email}) but failed to create the reply processing sub-issue after one retry.</p><p>Case ID: {case_id}<br>Message IDs: {messageId1},{messageId2},...<br>Expected parent issue: {paperclip_issue_id}<br>Error: {error}</p><p>Manual intervention required — process replies manually and re-trigger if needed.</p><p>Regards,<br>HR Automation</p>`
   - Append to audit-log:
     ```
     {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|{current_status}|escalated|Failed to create reply sub-issue after retry|{error}|{paperclip_issue_id or —}
     ```
   - Continue to next case (do NOT send nudge)

   → Continue to next case (do NOT send nudge for any case that had replies)

5. IF no reply found:
   → Proceed to STEP 3 (nudge check)

---

## STEP 3 — Nudge decision (email-poll bucket, no-reply cases only)

6. Compute `reference_timestamp`:
   - If `reminder_2_sent` = true → use `reminder_2_sent_timestamp`
   - Else if `reminder_1_sent` = true → use `reminder_1_sent_timestamp`
   - Else → use `last_outbound_email_timestamp`
   
   Compute `elapsed` = now − `reference_timestamp`

7. IF `elapsed` < 24h:
   → Append to audit-log:
   ```
   {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|{current_status}|heartbeat_tick|No action — within 24h window|{elapsed} elapsed|{paperclip_issue_id or —}
   ```
   → Skip this case

8. IF `elapsed` ≥ 24h AND `current_status` = `stalled`:
   → Append to audit-log:
   ```
   {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|stalled|heartbeat_tick|Already stalled — no action|—|{paperclip_issue_id or —}
   ```
   → Skip this case

9. IF `elapsed` ≥ 24h AND `current_status` NOT `stalled`:
   → Check audit-log (already loaded in STEP 1): has `reminder_1_sent` or `reminder_2_sent` event been sent for this `case_id` in the last 24h?
     - `reminder_1_sent` row exists AND its timestamp is < 24h ago → skip (avoid duplicate nudge)
     - `reminder_2_sent` row exists AND its timestamp is < 24h ago → skip (avoid duplicate nudge)
   → If no recent nudge in audit-log → proceed to STEP 4

---

## STEP 4 — Send nudge email (email-poll bucket only)

10. Determine nudge path:
    - **Path A:** `reminder_1_sent` = false → this is Nudge 1 → steps 11–14
    - **Path B:** `reminder_1_sent` = true AND `reminder_2_sent` = false → this is Nudge 2 → steps 15–18
    - **Path C:** `reminder_1_sent` = true AND `reminder_2_sent` = true → post-Nudge-2 stall check → step 19

---

### Path A — NUDGE 1

11. `outlook_send_email`
    - to: `{employee_email}`
    - ccRecipients: `["{recruiter_or_hr_email}"]`
    - subject: IF `employee_type` == `intern_fte_form`: `Reminder: Please Complete Your Onboarding Form – {employee_full_name}` ELSE: `Reminder: Pending Onboarding Documents – {employee_full_name}`
    - isHtml: true
    - body: IF `employee_type` == `intern_fte_form`:
      ```html
      <p>Hi {employee_full_name},</p>
      <p>This is a reminder to complete your HRMS onboarding form shared with you earlier.</p>
      <p>Please open the form, fill in the remaining fields, and reply <strong>"done"</strong> at the earliest so we can proceed.</p>
      <p>Regards,<br>{recruiter_or_hr_name}</p>
      ```
      ELSE:
      ```html
      <p>Hi {employee_full_name},</p>
      <p>This is a reminder to share your onboarding documents requested earlier.</p>
      <p>Please send the required documents at the earliest so that we can proceed.</p>
      <p>Regards,<br>{recruiter_or_hr_name}</p>
      ```
    - On failure: `outlook_send_email` to `{human_in_loop_email}` (subject: `HR Alert: Failed to send Nudge 1 to {employee_full_name}`), log failure, do NOT mark nudge as sent, skip this case

12. `outlook_send_email`
    - to: `{human_in_loop_email}`
    - subject: `HR Alert: First reminder sent to {employee_full_name}`
    - isHtml: true
    - body:
      ```html
      <p>Hi,</p>
      <p>The first reminder has been sent to <strong>{employee_full_name}</strong> ({employee_email}) as no documents were received within 24 hours.</p>
      <p>Case ID: {case_id}</p>
      <p>Regards,<br>HR Automation</p>
      ```

13. Append to audit-log:
    ```
    {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|{current_status}|reminder_1_sent|Nudge 1 email sent to candidate|No reply after 24h|{paperclip_issue_id or —}
    ```

13a. **Persist to run-state.reminders** (CRITICAL — `§HUMAN_VERIFICATION_REQUEST` template reads this):
    - Read run-state.json from path computed per Step 5a regex.
    - Set `run_state.reminders.nudge_1_sent_at = {now}`.
    - sharepoint_write_file. On retry failure: log warning, continue (audit-log already captured the nudge; verification email will fall back to "No" which is incorrect but not blocking).

14. Update issue comment: `"Nudge 1 sent to {employee_email} at {now}"`

---

### Path B — NUDGE 2

15. `outlook_send_email`
    - to: `{employee_email}`
    - ccRecipients: `["{recruiter_or_hr_email}"]`
    - subject: IF `employee_type` == `intern_fte_form`: `Urgent Reminder: Please Complete Your Onboarding Form – {employee_full_name}` ELSE: `Urgent Reminder: Onboarding Documents Pending – {employee_full_name}`
    - isHtml: true
    - body: IF `employee_type` == `intern_fte_form`:
      ```html
      <p>Hi {employee_full_name},</p>
      <p>This is a final automated reminder to complete your HRMS onboarding form.</p>
      <p>Please open the form, fill in the remaining fields, and reply <strong>"done"</strong> as soon as possible to avoid any delay in your onboarding.</p>
      <p>Regards,<br>{recruiter_or_hr_name}</p>
      ```
      ELSE:
      ```html
      <p>Hi {employee_full_name},</p>
      <p>This is a follow-up regarding your pending onboarding documents.</p>
      <p>Please share them as soon as possible to avoid any delay in your onboarding process.</p>
      <p>Regards,<br>{recruiter_or_hr_name}</p>
      ```
    - On failure: `outlook_send_email` to `{human_in_loop_email}` (subject: `HR Alert: Failed to send Nudge 2 to {employee_full_name}`), log failure, do NOT mark nudge as sent, skip this case

16. `outlook_send_email`
    - to: `{human_in_loop_email}`
    - subject: `HR Alert: Second reminder sent to {employee_full_name} — action may be needed`
    - isHtml: true
    - body:
      ```html
      <p>Hi,</p>
      <p>The second (final automated) reminder has been sent to <strong>{employee_full_name}</strong> ({employee_email}).</p>
      <p>If no response is received within 24 hours, the case will be marked as <strong>stalled</strong> and manual follow-up will be required.</p>
      <p>Case ID: {case_id}</p>
      <p>Regards,<br>HR Automation</p>
      ```

17. Append to audit-log:
    ```
    {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|{current_status}|reminder_2_sent|Nudge 2 email sent to candidate|No reply after 48h — final automated reminder|{paperclip_issue_id or —}
    ```

17a. **Persist to run-state.reminders** (CRITICAL — `§HUMAN_VERIFICATION_REQUEST` template reads this):
    - Read run-state.json from path computed per Step 5a regex.
    - Set `run_state.reminders.nudge_2_sent_at = {now}`.
    - sharepoint_write_file. On retry failure: log warning, continue.

18. Update issue comment: `"Nudge 2 sent to {employee_email} at {now}"`

---

### Path C — POST-NUDGE 2 STALL CHECK

19. IF `elapsed` ≥ 24h since `reminder_2_sent_timestamp`:
    - `outlook_send_email` to `{human_in_loop_email}`:
      - subject: `HR Alert: Case stalled — {employee_full_name}`
      - isHtml: true
      - body:
        ```html
        <p>Hi,</p>
        <p>No response has been received from <strong>{employee_full_name}</strong> ({employee_email}) after two automated reminders.</p>
        <p>The case has been marked as <strong>stalled</strong>. Manual follow-up is required.</p>
        <p>Case ID: {case_id}</p>
        <p>Regards,<br>HR Automation</p>
        ```
    - Append to audit-log:
      ```
      {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|stalled|case_stalled|Case marked stalled — no response after 2 reminders|Manual follow-up required|{paperclip_issue_id or —}
      ```
    - Update issue comment: `"Case stalled — no response after 2 reminders. Manual follow-up required."`
    - STOP automated actions for this case

    ELSE (`elapsed` < 24h since `reminder_2_sent_timestamp`):
    - Append to audit-log:
      ```
      {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|{current_status}|heartbeat_tick|Waiting post-Nudge-2|{elapsed} elapsed since Nudge 2|{paperclip_issue_id or —}
      ```
    - Skip this case

---

## STEP 5 — Approval polling (approval-poll bucket only)

This step processes cases in the **approval-poll bucket** built in STEP 1 — those with `current_status == awaiting_human_verification`. It does NOT process email-poll bucket cases.

For each case in the approval-poll bucket:

### 5a — Compute run_state_path (rehire-aware) and read run-state.json

Use the regex in `_shared.md § §11` Heartbeat rehire parsing to extract date_of_joining and optional rehire_N from `case_id`:
```
ARCHIVE-AWARE PARSE:
case_id matches /^(.+@.+)-(\d{4}-\d{2}-\d{2})(?:-rehire-(\d+))?$/
groups: email_part, doj, rehire_N (may be null)

folder_suffix = "" IF rehire_N is null ELSE "-rehire-{rehire_N}"
base_folder   = "HR-Onboarding/{employee_full_name} - {doj}{folder_suffix}"
run_state_path = "{base_folder}/run-state.json"
```

```
sharepoint_read_file path="{run_state_path}"
→ Parse JSON.
→ IF file missing → append audit-log row with event=heartbeat_skip, brief_reason="run-state.json missing for awaiting-approval case at {run_state_path}". Notify {human_in_loop_email}. Skip this case.
→ ON SUCCESS: ALSO read run_state.base_folder and run_state.run_state_path from the JSON. If they disagree with the heartbeat-computed path, log a warning but USE the run-state-stored values (orchestrator-stored paths are authoritative — defensive against heartbeat regex bugs).
```

Extract:
```
approval_id            = run_state.complete_submission.approval_id
approval_created_at    = run_state.complete_submission.approval_created_at
approval_target_issue  = run_state.complete_submission.approval_target_issue
parent_issue_id        = run_state.parent_issue_id
required_approver      = run_state.complete_submission.approval_required_approver
```

**Guard:** if `approval_id` is null → audit-log row with `event=heartbeat_skip`, brief_reason `awaiting_human_verification but no approval_id in run-state`. Notify human. Skip this case.

### 5b — Poll Paperclip approval status

```
GET /api/approvals/{approval_id}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
→ Capture: status (one of: pending | approved | rejected | withdrawn), approver_email, decided_at, rejection_reason (if rejected).
→ On non-2xx after one retry: audit-log row with event=approval_polled and brief_reason "API error: {error}". Skip this case (do NOT mark stalled).
```

Append audit-log row for the poll itself (event=approval_polled, status unchanged per `_shared.md § §5`):
```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|{current_status}|approval_polled|Polled approval {approval_id} — status={approval.status}|created_at={approval_created_at}|{parent_issue_id}
```

### 5c — Branch on approval.status

#### Branch P1 — `approved` (idempotent child creation)

Approval was granted. Create the `[HR-UPLOAD-SP]` child issue (Phase 9 takes over).

**Step P1a — Idempotency check (prevents duplicate Phase 9 wakes on retry):**

```
GET /api/companies/{PAPERCLIP_COMPANY_ID}/issues?parentId={parent_issue_id}&title-prefix=[HR-UPLOAD-SP]
→ IF any open child (status ∈ {todo, in_progress, in_review}) is returned:
   - Skip create. Reuse the existing child id.
   - Append audit-log row event=approval_polled, brief_reason="[HR-UPLOAD-SP] child already exists ({existing_id}) — not creating duplicate".
   - Continue to next case (do NOT proceed to P1b).
→ ELSE: proceed to P1b.
```

**Step P1b — Write the approval_approved audit-log row BEFORE creating the child.** Reason: if the child create fails AFTER the row is written, the next heartbeat tick sees `current_status = verified_by_human` (which is NOT in the approval-poll bucket exclusion list — wait, actually it IS in the exclusion list per `_shared.md`). Hmm — re-check: the approval-poll bucket filter is `current_status == awaiting_human_verification`. The email-poll bucket excludes `verified_by_human`. So after writing this row, neither bucket includes the case → next tick will NOT retry the child create automatically.

Therefore: the audit-log row + child create are NOT idempotent across ticks. To safely handle a child-create failure, we MUST keep `current_status == awaiting_human_verification` until the child is confirmed created.

**Corrected order:**
1. P1b — Create child first (POST below).
2. P1c — Only AFTER successful child create, append the `approval_approved` audit-log row that flips `current_status` to `verified_by_human`.
3. If child create fails: do NOT write the row. The case stays in `awaiting_human_verification` and the next tick retries via P1a (which will not find a child) + this branch.

**P1b — Create child:**
```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[HR-UPLOAD-SP] {employee_full_name} — Phase 9 final upload",
  "description": "phase_file: routines/employee-onboarding/upload-sharepoint.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}\ncase_id: {case_id}\napproval_id: {approval_id}",
  "assigneeAgentId": "{HR_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
→ On retry failure: notify {human_in_loop_email} (subject `HR Alert: Failed to create [HR-UPLOAD-SP] child after approval — {employee_full_name}`), audit-log row event=escalated, brief_reason="Failed to create [HR-UPLOAD-SP] after retry — case still awaiting_human_verification". Skip this case (next tick retries). Do NOT write approval_approved row.
```

**P1c — On success, write the row:**
```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|verified_by_human|approval_approved|Approval {approval_id} approved — created [HR-UPLOAD-SP] child {created_issue_id}|approver={approver_email}|{parent_issue_id}
```

#### Branch P2 — `rejected`

Approval was rejected. Pipeline cannot proceed without human intervention.

- `outlook_send_email` to `{human_in_loop_email}`:
  - subject: `HR Alert: Approval rejected — {employee_full_name}`
  - isHtml: true
  - body:
    ```html
    <p>Hi,</p>
    <p>The Paperclip approval for <strong>{employee_full_name}</strong> ({employee_email}) has been rejected.</p>
    <table>
      <tr><td><strong>Case ID</strong></td><td>{case_id}</td></tr>
      <tr><td><strong>Approval ID</strong></td><td>{approval_id}</td></tr>
      <tr><td><strong>Rejected by</strong></td><td>{approver_email}</td></tr>
      <tr><td><strong>Decided at</strong></td><td>{decided_at}</td></tr>
      <tr><td><strong>Reason</strong></td><td>{rejection_reason or "(none provided)"}</td></tr>
    </table>
    <p>The pipeline has been paused. Manual intervention required to reset state and re-trigger the routine.</p>
    <p>Regards,<br>HR Automation</p>
    ```
- Append audit-log row:
  ```
  {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|escalated|escalated|Approval {approval_id} REJECTED — pipeline paused|approver={approver_email} reason={rejection_reason}|{parent_issue_id}
  ```
- Teams notification: `_email-templates.md § §Teams_Escalation` with reason = "Approval rejected: {rejection_reason}".

Do NOT create any child issue. Pipeline stays paused for human action.

#### Branch P3 — `withdrawn`

Approval was withdrawn (rare; e.g. approver retracted). Treat as rejection-soft:

- Notify human (subject `HR Alert: Approval withdrawn — {employee_full_name}`, body similar to Branch P2 with `Withdrawn` instead of `Rejected`).
- Append audit-log row with event=escalated and brief_reason "Approval withdrawn".
- No child issue.

#### Branch P4 — `pending`

Approval still pending. Check timeout:

```
elapsed_since_approval_created = now − approval_created_at
```

- If `elapsed_since_approval_created < 7 days`:
  - Append audit-log row:
    ```
    {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|awaiting_human_verification|heartbeat_tick|Approval {approval_id} still pending ({elapsed} since creation)|approver={required_approver}|{parent_issue_id}
    ```
  - Skip this case (no nudge, no child — just keep polling next tick).

- If `elapsed_since_approval_created >= 7 days AND elapsed_since_approval_created < 14 days`:
  - Check whether a timeout-notify row was sent in the last 24h (search audit-log for `event=human_notified` AND `brief_reason` containing `approval timeout` for this case_id). If yes → skip (avoid spam).
  - Else → send timeout email using `_email-templates.md § §APPROVAL_TIMEOUT_HUMAN` to `{human_in_loop_email}` (and CC `{required_approver}` if different).
  - Append audit-log row:
    ```
    {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|awaiting_human_verification|human_notified|Approval timeout reminder — pending > 7 days|approval_id={approval_id} elapsed={elapsed}|{parent_issue_id}
    ```

- If `elapsed_since_approval_created >= 14 days` (ESCALATION CEILING — daily reminders STOP):
  - Check whether a `case_escalated_approval_timeout` row already exists for this `case_id`. If yes → skip (case already escalated, no more reminders).
  - Else → escalate ONCE:
    - `outlook_send_email` to `{human_in_loop_email}`, CC `payload.hiring_manager_email` if present (escalation to next-up):
      ```
      subject: HR Alert: ESCALATION — approval pending > 14 days for {employee_full_name}
      isHtml: true
      body:
      <p>Hi,</p>
      <p>The Paperclip approval for <strong>{employee_full_name}</strong> ({employee_email}) has been pending for more than 14 days. Daily reminders have stopped — this is a one-time escalation to the next-up.</p>
      <table>
        <tr><td><strong>Case ID</strong></td><td>{case_id}</td></tr>
        <tr><td><strong>Approval ID</strong></td><td>{approval_id}</td></tr>
        <tr><td><strong>Created at</strong></td><td>{approval_created_at}</td></tr>
        <tr><td><strong>Required approver</strong></td><td>{required_approver}</td></tr>
        <tr><td><strong>Elapsed</strong></td><td>{elapsed}</td></tr>
      </table>
      <p>The case has been marked as <strong>escalated</strong>. Manual decision required: either approve/reject in Paperclip or formally close the case.</p>
      <p>Regards,<br>HR Automation</p>
      ```
    - Teams notification: `_email-templates.md § §Teams_Escalation` with reason = "Approval pending > 14 days — escalated to manager".
    - Append audit-log row (this FLIPS current_status to escalated, removing case from approval-poll bucket — daily reminders stop):
      ```
      {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|escalated|escalated|Approval pending > 14 days — case escalated|approval_id={approval_id} elapsed={elapsed} cc_hiring_manager={hiring_manager_email or "n/a"}|{parent_issue_id}
      ```
    - Note: this row uses `event = escalated`, which is in `_shared.md § §5`. The brief_reason marker `case_escalated_approval_timeout` is matched via the description text for the dedup check on subsequent ticks.

---

### 5d — IT-setup email retry sweep

Phase 10 (`close-case.md`) marks `run_state.close_case.it_setup_email_sent = false` when the IT setup email fails. This sweep scans completed cases for that flag and retries up to 3 times.

```
SCAN audit-log for rows where event = case_completed (recent N days — limit to last 14 days to avoid scanning history forever):
  FOR EACH such case:
    Compute base_folder and run_state_path per Step 5a regex.
    sharepoint_read_file path="{run_state_path}"
    → IF run_state.close_case.it_setup_email_sent == true → skip case.
    → IF run_state.close_case.it_setup_retries >= 3 → skip case (max retries reached; human must investigate). Audit-log row event=escalated brief_reason="IT setup email max retries exhausted" ONCE — dedup by case_id.
    → ELSE retry:
      outlook_send_email using _email-templates.md § §IT_SETUP
        to: $IT_SUPPORT_EMAIL
        CC: {human_in_loop_email}, {recruiter_or_hr_email}
      On success:
        - run_state.close_case.it_setup_email_sent = true
        - run_state.close_case.it_setup_message_id = {messageId}
        - run_state.close_case.it_setup_retries = N + 1
        - sharepoint_write_file run_state.json
        - Append audit-log row:
          {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|completed|it_setup_retry|IT setup email retry {N+1}/3 succeeded|messageId={it_setup_message_id}|{parent_issue_id}
      On failure:
        - run_state.close_case.it_setup_retries = N + 1
        - sharepoint_write_file run_state.json
        - Append audit-log row:
          {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|completed|it_setup_retry|IT setup email retry {N+1}/3 failed|error={error}|{parent_issue_id}
        - On 3rd failure, notify human (subject `HR Alert: IT setup email failed after 3 retries — {employee_full_name}`).
```

### 5e — Orphan parent-PATCH retry sweep

Phase 10 marks `run_state.close_case.parent_patch_succeeded = false` when the PATCH parent→done fails. This sweep retries up to 5 times.

```
SCAN audit-log for rows where event = case_completed (recent 14 days):
  FOR EACH such case:
    Compute run_state_path; read run-state.
    → IF run_state.close_case.parent_patch_succeeded == true → skip case.
    → IF run_state.close_case.parent_patch_retries >= 5 → skip case. Audit-log row event=escalated brief_reason="Parent PATCH max retries exhausted" ONCE — dedup by case_id.
    → ELSE:
      GET /api/issues/{parent_issue_id}
      → IF parent.status == "done" → already done (race / human flipped manually). Set run_state.close_case.parent_patch_succeeded = true, write. Skip case.
      → ELSE retry PATCH:
        PATCH /api/issues/{parent_issue_id}
        { "status": "done", "comment": "Heartbeat retry — onboarding completed (case_id: {case_id})." }
        On success:
          - run_state.close_case.parent_patch_succeeded = true
          - run_state.close_case.parent_patch_retries = N + 1
          - sharepoint_write_file run_state.json
          - Append audit-log row:
            {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|completed|parent_patch_retry|Parent PATCH retry {N+1}/5 succeeded|—|{parent_issue_id}
        On failure:
          - run_state.close_case.parent_patch_retries = N + 1
          - sharepoint_write_file run_state.json
          - Append audit-log row with event=parent_patch_retry brief_reason="retry {N+1}/5 failed: {error}".
          - On 5th failure, notify human.
```

---

## STEP 6 — Heartbeat completion log

After processing all email-poll-bucket and approval-poll-bucket cases (and the IT-retry + parent-patch sweeps), append to audit-log (13 columns, col-13 = `—` for tick rows):
    ```
    {now}|—|—|—|—|—|—|—|heartbeat_tick|Processed {E} email-poll, {A} approval-poll, {IR} IT-retry, {PR} parent-patch cases. Replies detected: {R}. Nudges sent: {X}. Cases stalled: {S}. Approvals approved: {AA}. Approvals rejected/withdrawn: {AR}. Pending approvals: {AP}. Approvals escalated (14d): {AE}. Duplicate cases paused: {DUP}.|—|—|—
    ```

### STEP 6a — Anti-thrash status normalization

After all per-case work above and BEFORE writing the heartbeat_tick row, iterate the email-poll-bucket-clean once more for Paperclip-status reconciliation. For each case that had **no new events written this tick** (no reply detected, no nudge sent, no escalation raised):

1. Read `parent.status` from Paperclip: `GET /api/issues/{paperclip_issue_id}`. (Cheap; you already have the issue id.)
2. Derive the **expected** parent status from the latest column-8 (`current_status`) via `_shared.md § §21` "Case-status → Paperclip-status mapping". Examples:
   - `current_status = awaiting_document_submission` → expected `in_review`
   - `current_status = awaiting_resubmission` → expected `in_review`
   - `current_status = under_automated_review` → expected `in_progress`
   - `current_status = awaiting_human_verification` → expected `in_review`
3. If `parent.status != expected`, PATCH it:
   ```
   PATCH /api/issues/{paperclip_issue_id}
   Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
   { "status": "{expected}", "comment": "Heartbeat status normalize — case_status={current_status}, normalized parent to {expected} per _shared.md § §21." }
   ```
4. If `parent.status == expected`, **do nothing** (no PATCH, no comment). The whole point of this step is to NOT thrash on idle ticks.

This neutralizes the Paperclip-checkout automatic `in_progress` flip without adding a per-tick PATCH for every case. Only cases that have drifted off the expected mapping get corrected.

### STEP 6b — Daily channel/audit reconciliation (first tick after 09:00 IST per day)

Detect "first tick of the day": read the most recent `heartbeat_tick` row from audit-log. If its timestamp's calendar date in IST (Asia/Kolkata) is strictly earlier than today's date in IST, this tick is the daily reconciliation tick. Otherwise skip 6b.

On the daily tick, for each case in email-poll-bucket-clean AND approval-poll-bucket:

1. Read `run-state.json`.
2. Find the row in audit-log where `event=initial_email_sent` for this case_id.
3. Read both fields:
   - `rs = run_state.send_initial.email_tool` (machine field) — may be absent on legacy cases.
   - `al = audit-log col-13 from the initial_email_sent row` — may be absent on legacy rows (< 13 cols).
4. Decide:
   - **Both absent** → legacy case. Skip silently. Do NOT notify. (Pre-fix cases predate the column; the heartbeat-channel-mismatch fast path covers any actually-broken legacy case.)
   - **One present, one absent** → partial-migration mid-write. This is the only inconsistency worth alerting on. Treat as mismatch.
   - **Both present and equal** → consistent. Skip.
   - **Both present and unequal** → real divergence. Mismatch.

5. **On mismatch** (only the partial-migration and both-present-unequal cases above):
   - Notify `human_in_loop_email`: subject `HR Alert: Audit/run-state channel mismatch — {employee_full_name}`, body names the divergence (`rs={rs}`, `al={al}`).
   - Append audit-log row (13 cols):
     ```
     {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|escalated|audit_reconciliation_failed|run_state.email_tool={rs} != audit_col_13={al}|Daily reconciliation found divergence — manual review required|{paperclip_issue_id}|outlook
     ```
   - Dedup: if such a row already exists for this case_id within the last 24h, do NOT re-notify. One alert per case per day max.

This step is idempotent across ticks (only first daily tick fires it) and silent on legacy data (no first-deploy mass-page).

---

## Failure handling

| Scenario | Action |
|----------|--------|
| audit-log unreadable | `outlook_send_email` to all known `human_in_loop_email` addresses, log error, STOP |
| `outlook_search_emails` fails for one case | Append warning row to audit-log, skip that case, continue with remaining |
| Nudge email send fails | `outlook_send_email` to `human_in_loop_email`, append failure row to audit-log, do NOT mark nudge as sent |
| `[HR-PROCESS-REPLY]` child create fails for a case | `outlook_send_email` to `human_in_loop_email` with `messageIds` for manual handling, append `escalated` row to audit-log, continue to next case |
| `run-state.json` missing for awaiting-approval case (STEP 6a) | Append `heartbeat_skip` audit-log row, notify human, skip case (do NOT crash heartbeat) |
| `approval_id` null in run-state for awaiting-approval case | Append `heartbeat_skip` row + notify human, skip case |
| `GET /api/approvals/{approval_id}` fails after retry | Append `approval_polled` audit-log row with error in brief_reason, skip case (retry next tick) |
| `[HR-UPLOAD-SP]` child create fails after retry (Branch P1) | Notify human, append `escalated` row, skip case (retry next tick — Phase 9 must run to advance) |
| Approval rejected (Branch P2) | Notify human, append `escalated` row, Teams escalation. Do NOT create child. |
| Approval withdrawn (Branch P3) | Notify human, append `escalated` row. Do NOT create child. |
| Approval pending > 7 days (Branch P4) | Send timeout reminder once per 24h via `_email-templates.md § §APPROVAL_TIMEOUT_HUMAN`, append `human_notified` row. Keep polling. |

**Teams failure notification (non-blocking) — send on any failure that causes STOP or prevents a case from advancing:**
  teams_send_channel_message
    teamId    = $TEAMS_HR_TEAM_ID
    channelId = $TEAMS_HR_CHANNEL_ID
    contentType = "html"
    content:
      🔴 HR Email Heartbeat — Technical Failure<br>
      <br>
      Error: {error_message}<br>
      Step: {current_step_label} (e.g. "STEP 2 — Process replies")<br>
      Active cases at time of failure: {active_case_count}<br>
      <br>
      Heartbeat stopped. Human intervention may be required.
  If it fails → add "⚠️ Teams notification failed: {error_message}" to issue comment and continue.

**Do NOT send a Teams notification on quiet runs** (inbox checked, no replies found, no nudges sent). Only notify on failures.

---

## Data sensitivity

**NEVER** output or log full Aadhaar numbers, PAN numbers, or any government-issued ID digits in heartbeat logs, email bodies, issue comments, or audit entries. Use placeholders only (e.g. "Aadhaar received", not the number itself).
