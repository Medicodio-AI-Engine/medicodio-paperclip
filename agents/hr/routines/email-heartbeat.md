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

Poll for candidate email replies on all active onboarding cases.  
Send a nudge if 24h has elapsed since last outbound email with no reply.  
Delegate to the onboarding routine reply-processing phases when a reply arrives.

---

## STEP 1 — Load active cases

1. `sharepoint_read_file path="HR-Onboarding/audit-log.csv"`
   → Parse all rows (pipe-delimited CSV, skip header row)
   → Filter rows where `current_status` NOT IN: `completed`, `cancelled`, `withdrawn`, `stalled`, `escalated`, `verified_by_human`, `sharepoint_upload_in_progress`, `uploaded_to_sharepoint`, `hrms_form_submitted`  
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

2. If no active cases → append to audit-log:
   ```
   {now}|—|—|—|—|—|—|—|heartbeat_tick|No active cases|—|—
   ```
   → STOP

---

## STEP 2 — Check for replies (per case)

For each active case:

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
      → For each message: check if sender matches `employee_email` or `alternate_candidate_email`  
      → If message found from an unrecognized sender:
        - `outlook_send_email` to `{human_in_loop_email}`:
          - subject: `HR Alert: Possible reply from alternate address — {employee_full_name}`
          - isHtml: true
          - body: `<p>Hi,</p><p>A possible reply was detected for <strong>{employee_full_name}</strong> from an unrecognized email address (not {employee_email}). Please review and confirm if this is from the candidate.</p><p>Case ID: {case_id}</p><p>Regards,<br>HR Automation</p>`
        - Append to audit-log:
          ```
          {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|{current_status}|reply_from_alternate_sender|Notified human — reply from unrecognized sender|Awaiting human confirmation|{paperclip_issue_id or —}
          ```
        - Do NOT auto-delegate to onboarding routine — needs human confirmation
        - Skip nudge for this tick; continue to next case

4. IF one or more replies found (from step 3a or 3b):

   **Collect ALL reply messageIds for this case first (do not process one-by-one):**
   → messageId_list = all reply messages sorted chronologically (oldest first)
   → N = total count

   **Determine title prefix by employee_type:**
   - `intern_fte_form` → title prefix: `[INTERN-FTE-FORM]`
   - all other types   → title prefix: `[HR-ONBOARDING-REPLY]`

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

## STEP 3 — Nudge decision (no-reply cases only)

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

## STEP 4 — Send nudge email

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

## STEP 5 — Heartbeat completion log

20. After processing all cases, append to audit-log:
    ```
    {now}|—|—|—|—|—|—|—|heartbeat_tick|Processed {N} active cases. Replies detected: {R}. Nudges sent: {X}. Cases stalled: {S}.|—|—
    ```

---

## Failure handling

| Scenario | Action |
|----------|--------|
| audit-log unreadable | `outlook_send_email` to all known `human_in_loop_email` addresses, log error, STOP |
| `outlook_search_emails` fails for one case | Append warning row to audit-log, skip that case, continue with remaining |
| Nudge email send fails | `outlook_send_email` to `human_in_loop_email`, append failure row to audit-log, do NOT mark nudge as sent |
| Onboarding routine trigger fails on reply detected | `outlook_send_email` to `human_in_loop_email` with `messageId` for manual handling, append failure row to audit-log |

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
