# Intern → HRMS Form Routine

**Trigger:** Manual — HR creates a Paperclip issue when deciding to convert an intern to FTE.  
Issue title prefix: `[INTERN-FTE-FORM]`  
**Concurrency policy:** `always_enqueue` — each employee is a separate independent run  

---

## Global Conventions

- **Timestamps:** ISO-8601 UTC: `YYYY-MM-DDTHH:MM:SSZ`
- **Government ID masking:** Never output, log, or email Aadhaar/PAN digits. Use `"Aadhaar received ✓"` etc.
- **HTML emails:** All emails MUST use `isHtml: true`.
- **CC rule:** Every email to candidate MUST include `ccRecipients: ["{recruiter_or_hr_email}"]`.

---

## Inputs

Read from issue body (key: value lines):

| Field | Description |
|---|---|
| `employee_full_name` | Full name |
| `employee_email` | Candidate email |
| `role` | Job role |
| `employee_type` | Must be `intern` |
| `date_of_joining` | ISO date |
| `recruiter_or_hr_name` | HR contact name |
| `recruiter_or_hr_email` | HR contact email |
| `human_in_loop_name` | Human reviewer name |
| `human_in_loop_email` | Human reviewer email |
| `phone_number` | Candidate phone |

---

## SharePoint Paths

```
Template:  hr-onboarding/templates/EmployeeSheet_Onboarding_Form_Medicodio_HRMS.xlsx
Employee:  HR-Onboarding/{employee_full_name} - {date_of_joining}/
Verified:  HR-Onboarding/{employee_full_name} - {date_of_joining}/02_Verified_Documents/
Form copy: HR-Onboarding/{employee_full_name} - {date_of_joining}/EmployeeSheet_{employee_full_name}.xlsx
```

---

## PHASE 0 — Source routing gate

```
Step 0. Read PAPERCLIP_WAKE_PAYLOAD_JSON → payload.
  IF source == "api" AND messageId is present (non-empty string):
    → This is a heartbeat-triggered reply run — do NOT re-run Phases 1–3.
    → Extract from payload: case_id, messageId, employee_email, employee_full_name,
      date_of_joining, role, recruiter_or_hr_name, recruiter_or_hr_email,
      human_in_loop_email, phone_number, current_status
    → Recover excel_url:
        IF payload contains non-empty `excel_url` field:
          → use it directly as {excel_url} — skip sharepoint_get_file_info
        ELSE:
          sharepoint_get_file_info
            filePath = "HR-Onboarding/{employee_full_name} - {date_of_joining}/EmployeeSheet_{employee_full_name}.xlsx"
          → store webUrl as {excel_url}
          → If file not found: notify human_in_loop_email, STOP.
    → Jump directly to PHASE 4. Do NOT copy template, read docs, fill Excel, or re-send email.

  ELSE: This is a fresh trigger — proceed to Step 1.

Step 1. Read issue title.
  → IF title starts with "[INTERN-FTE-FORM]": proceed to Step 2.
  → ELSE: STOP — wrong routine.

Step 2. Parse all required fields from issue body.
  → If any required field missing: post blocked comment listing missing fields,
    notify human_in_loop_email, STOP.

Step 2a. Set case_id = "fte-form-{employee_email}-{date_of_joining}"
  (Distinct prefix ensures no collision with onboarding case IDs in the shared audit-log.
   Heartbeat routes by employee_type = "intern_fte_form", not by case_id prefix.)

Step 2b. Append case_created row to audit-log (CSV append pattern):
  sharepoint_read_file path="HR-Onboarding/audit-log.csv"
  → append:
  {now}|{case_id}|{employee_email}|{employee_full_name}|intern_fte_form|{human_in_loop_email}|{recruiter_or_hr_name}|initiated|case_created|HRMS form routine started|employee_type=intern|{PAPERCLIP_TASK_ID}
  sharepoint_write_file path="HR-Onboarding/audit-log.csv"
  NOTE: employee_type column MUST be "intern_fte_form" — heartbeat uses this value to route replies to this routine, not the onboarding routine.
```

---

## PHASE 1 — Copy template

```
Step 3. Copy master template to employee folder:
  sharepoint_copy_file
    sourcePath     = "hr-onboarding/templates/EmployeeSheet_Onboarding_Form_Medicodio_HRMS.xlsx"
    destFolderPath = "HR-Onboarding/{employee_full_name} - {date_of_joining}"
    newName        = "EmployeeSheet_{employee_full_name}.xlsx"
  → Polls automatically until copy completes (up to 60 s).
  → CRITICAL: The response includes a `webUrl` field — store this immediately as {excel_url}.
    This is the employee's copy link. Do NOT use the template's URL. Do NOT call sharepoint_get_file_info for the URL.
  → On failure: notify human_in_loop_email, STOP.

Step 4. Confirm copy is valid:
  → If the copy response has size = 0 or is missing webUrl: notify human_in_loop_email, STOP.
  → Do NOT call sharepoint_get_file_info — the copy response already has all required metadata.

Step 5. Write minimal case-tracker entry so heartbeat can retrieve recruiter_or_hr_email:
  sharepoint_write_file
    path = "HR-Onboarding/{employee_full_name} - {date_of_joining}/fte-form-tracker.md"
    content:
    ---
    # HRMS Form Tracker — {employee_full_name}

    | Field | Value |
    |-------|-------|
    | Name | {employee_full_name} |
    | Email | {employee_email} |
    | Role | {role} |
    | Phone | {phone_number} |
    | Date of Joining | {date_of_joining} |
    | HR Contact | {recruiter_or_hr_name} |
    | HR Contact Email | {recruiter_or_hr_email} |
    | Case ID | {case_id} |
    | Form URL | {excel_url} |

    ## Status History
    | Timestamp | Status | Notes |
    |-----------|--------|-------|
    | {now} | initiated | HRMS form case created |
    ---
  → Heartbeat reads `HR Contact Email`, `Role`, and `Phone` from this file to populate recruiter_or_hr_email, role, and phone_number for issue creation and CC on nudge emails.

Step 5a. Post issue comment: "Template copied → EmployeeSheet_{employee_full_name}.xlsx | URL: {excel_url}"
```

---

## PHASE 2 — Auto-fill from verified documents

```
Step 6. List all files in verified documents folder:
  sharepoint_list_folder
    path = "HR-Onboarding/{employee_full_name} - {date_of_joining}/02_Verified_Documents/"
  → If folder empty or not found: notify human_in_loop_email, STOP.

Step 7. Read each document via sharepoint_download_binary:
  For each file listed in Step 6:
    sharepoint_download_binary
      filePath = "HR-Onboarding/{employee_full_name} - {date_of_joining}/02_Verified_Documents/{filename}"
    → Returns: { contentBase64, mimeType, size, name }
    → image (image/jpeg, image/png, image/gif, image/webp): Claude vision reads content directly — inspect visually
    → PDF (application/pdf): use extractedText. If response contains "SCANNED_PDF_NO_TEXT" → scanned image, treat as image
    → DOCX: use extractedText
    → Do NOT skip any file — every file must be read before extraction

  Extract the following fields where visible:

  | Excel Field           | Source Document(s)                        |
  |-----------------------|-------------------------------------------|
  | Full Name             | Any ID / Resume                           |
  | Date of Birth         | Aadhaar / PAN / Passport                  |
  | Personal Email        | Resume / candidate email                  |
  | Phone Number          | payload phone_number                      |
  | Permanent Address     | Aadhaar / Address Proof                   |
  | Temporary Address     | Aadhaar / Address Proof                   |
  | PAN Number            | PAN card — write "PAN received ✓" ONLY    |
  | Aadhaar Number        | Aadhaar — write "Aadhaar received ✓" ONLY |
  | Highest Qualification | Education Certificates                    |
  | Role / Designation    | payload role field                        |
  | Date of Joining       | payload date_of_joining                   |
  | Emergency Contact     | Resume (if present)                       |

  MANDATORY: Never write actual Aadhaar or PAN digits into the Excel. Use placeholders only.

Step 8. Write extracted values into the Excel copy:
  sharepoint_write_excel (or sharepoint_update_file with Excel edit capability)
    filePath = "HR-Onboarding/{employee_full_name} - {date_of_joining}/EmployeeSheet_{employee_full_name}.xlsx"
  → Fill only fields where value was successfully extracted.
  → Leave blanks for fields that could not be determined — do NOT guess.

Step 9. Build two lists:
  filled_fields  = [list of field names successfully auto-filled]
  missing_fields = [list of field names left blank — candidate must fill]

Step 10. Post issue comment: "Auto-fill complete. Filled: {N} fields. Blank (candidate to fill): {M} fields."
```

---

## PHASE 3 — Email candidate with form link

```
Step 11. Confirm {excel_url} is set from Phase 1 Step 3 copy response.
  → If missing for any reason, call:
    sharepoint_get_file_info
      filePath = "HR-Onboarding/{employee_full_name} - {date_of_joining}/EmployeeSheet_{employee_full_name}.xlsx"
    → Extract webUrl → store as {excel_url}
  → Double-check: {excel_url} must contain the employee's name in the path, NOT "EmployeeSheet_Onboarding_Form_Medicodio_HRMS". If it points to the template, STOP and notify human_in_loop_email.

Step 12. outlook_send_email
  to: {employee_email}
  ccRecipients: ["{recruiter_or_hr_email}"]
  subject: "Action Required: Review Your Onboarding Form – {employee_full_name}"
  isHtml: true
  body:
    <p>Hi {employee_full_name},</p>
    <p>Your onboarding form has been partially pre-filled using the documents you submitted. Please review and complete it.</p>
    <p><strong>Form link:</strong> <a href="{excel_url}">Click here to open your onboarding form</a></p>
    <p><strong>Fields we have pre-filled for you:</strong></p>
    <ul>{filled_fields as list items}</ul>
    <p><strong>Fields requiring your input (please fill these in the form):</strong></p>
    <ul>{missing_fields as list items}</ul>
    <p>Once you have reviewed and filled in all remaining fields, please reply to this email with <strong>"done"</strong>.</p>
    <p>Regards,<br>{recruiter_or_hr_name}<br>HR Team, Medicodio AI</p>
  → On failure: notify human_in_loop_email immediately, STOP.

Step 13. Post issue comment: "Form link emailed to {employee_email}. Awaiting 'done' reply."

Step 14. Set issue status to in_review — waiting on candidate.
  PATCH /api/issues/{PAPERCLIP_TASK_ID}
    body: { "status": "in_review" }
  → On failure: log warning, continue — non-blocking.

Step 14a. Append awaiting_form_reply row to audit-log (CSV append pattern):
  {now}|{case_id}|{employee_email}|{employee_full_name}|intern_fte_form|{human_in_loop_email}|{recruiter_or_hr_name}|awaiting_form_reply|initial_email_sent|Form email sent — heartbeat polling active|Excel: {excel_url}|{PAPERCLIP_TASK_ID}
  → event MUST be "initial_email_sent" — heartbeat computes last_outbound_email_timestamp by looking for this event. Using any other event name causes the TIMESTAMP GUARD to fire and skip this case.
```

---

## PHASE 4 — On candidate reply "done"

**Entry point when heartbeat detects reply and triggers routine with `source: "api"` + `messageId` in payload.**

```
Step 15. Set issue status back to in_progress:
  PATCH /api/issues/{PAPERCLIP_TASK_ID}
    body: { "status": "in_progress" }

Step 16. Read candidate reply:
  outlook_read_email messageId="{messageId}"
  → Confirm sender is employee_email (or alternate if provided).
  → If unexpected sender: notify human_in_loop_email, STOP.

Step 17. Classify reply:
  → Contains "done" / "submitted" / "filled" / "completed":
    → proceed to Step 18
  → Contains a question or request for help:
    → outlook_send_email to human_in_loop_email:
      subject: "HR: Candidate question on HRMS form — {employee_full_name}"
      body: forward candidate question, ask HR to respond directly
    → Keep issue in_review, STOP this run — heartbeat resumes on next reply
  → Withdrawal / cancellation:
    → notify human_in_loop_email, close issue as cancelled, STOP

Step 18. Verify the Excel has been updated (candidate made edits):
  sharepoint_get_file_info
    filePath = "HR-Onboarding/{employee_full_name} - {date_of_joining}/EmployeeSheet_{employee_full_name}.xlsx"
  → Recover baseline: read HR-Onboarding/audit-log.csv, find the most recent row for {case_id}
    where event = "initial_email_sent" → extract its timestamp as {form_email_sent_at}.
  → Check: file lastModifiedDateTime must be AFTER {form_email_sent_at}.
  → If file not modified (lastModifiedDateTime ≤ form_email_sent_at):
      outlook_send_email to employee_email:
        subject: "Action Required: Your Onboarding Form Is Not Yet Updated"
        isHtml: true
        body: <p>Hi {employee_full_name},</p><p>It appears the onboarding form has not been updated yet. Please open the link below, fill in the remaining fields, and reply <strong>"done"</strong> once complete.</p><p><a href="{excel_url}">Open your onboarding form</a></p><p>Regards,<br>{recruiter_or_hr_name}</p>
      → Append audit-log row: {now}|{case_id}|{employee_email}|{employee_full_name}|intern_fte_form|{human_in_loop_email}|{recruiter_or_hr_name}|awaiting_form_reply|form_reprompt_sent|Re-prompted candidate — form not yet modified|—|{PAPERCLIP_TASK_ID}
      → PATCH issue status back to in_review, STOP.

Step 19. Send completed form link to HR:
  outlook_send_email
    to: {human_in_loop_email}
    ccRecipients: ["{recruiter_or_hr_email}"]
    subject: "HRMS Onboarding Form Completed — {employee_full_name}"
    isHtml: true
    body:
      <p>Hi,</p>
      <p>The HRMS onboarding form for <strong>{employee_full_name}</strong> has been reviewed and completed by the candidate.</p>
      <p><strong>Form:</strong> <a href="{excel_url}">EmployeeSheet_{employee_full_name}.xlsx</a></p>
      <p><strong>Details:</strong></p>
      <ul>
        <li>Name: {employee_full_name}</li>
        <li>Role: {role}</li>
        <li>Joining Date: {date_of_joining}</li>
        <li>Employee Type: intern</li>
      </ul>
      <p>Please review and action accordingly.</p>
      <p>Regards,<br>HR Automation<br>Medicodio AI</p>

Step 19a. Append form_reply_received row to audit-log (CSV append pattern):
  {now}|{case_id}|{employee_email}|{employee_full_name}|intern_fte_form|{human_in_loop_email}|{recruiter_or_hr_name}|hrms_form_submitted|form_reply_received|Candidate confirmed form completed|messageId: {messageId}|{PAPERCLIP_TASK_ID}

Step 20. Update fte-form-tracker to record HRMS form completion:
  sharepoint_read_file
    path = "HR-Onboarding/{employee_full_name} - {date_of_joining}/fte-form-tracker.md"
  → Append row to Status History table:
    | {now} | hrms_form_submitted | HRMS onboarding Excel form reviewed and completed by candidate. HR notified. Form: {excel_url} |
  → Update header to show: **CASE STATUS: HRMS FORM SUBMITTED**
  sharepoint_write_file (overwrite full file with updated content)
    path = "HR-Onboarding/{employee_full_name} - {date_of_joining}/fte-form-tracker.md"
  → On failure: log warning in issue comment, continue — non-blocking.

Step 21. Post final issue comment: "HRMS form completed by candidate. HR notified. Form: {excel_url}"

Step 22. Update Paperclip issue → done
```

---

## Failure handling

| Scenario | Action |
|---|---|
| Template copy fails | Notify human_in_loop_email, STOP |
| Verified docs folder empty | Notify human_in_loop_email, STOP |
| Email to candidate fails | Notify human_in_loop_email, STOP |
| Candidate file not modified after "done" | Re-prompt candidate once, wait for next reply |
| HR email fails | Log warning, post issue comment, do NOT block closure |
| Unexpected sender on reply | Notify human_in_loop_email, do not proceed |
