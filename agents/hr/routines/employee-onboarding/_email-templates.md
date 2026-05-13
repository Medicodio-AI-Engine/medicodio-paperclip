# Email & Notification Templates — Employee Onboarding

**Purpose:** Single source for every email body and Teams notification used by the onboarding pipeline. Phase files reference templates here by section anchor — they MUST NOT inline HTML.

**Universal rule:** every outlook_send_email MUST set `isHtml: true`. See `_shared.md § §7`.

**Variable substitution:** all `{placeholders}` are replaced from `run_state.json.payload` or phase-local values. Never leave a placeholder unresolved in an outgoing email. If a value is missing, route to the corresponding `*_missing` template or notify human (`_shared.md § §16`).

---

## §INITIAL_INTERN_FRESHER

**Used by:** Phase 2 `send-initial.md` when `employee_type ∈ {intern, fresher}`.

```
Subject: Documents Required for Onboarding – {employee_full_name}

isHtml: true
to: {employee_email}
ccRecipients: ["{recruiter_or_hr_email}"]

Body:
<p>Hi {employee_full_name},</p>
<p>Good day!!!</p>
<p>As discussed, please find below the list of documents that need to be sent as soon as possible.</p>
<p><strong>List of Documents:</strong></p>
<ol>
  <li>Latest Resume</li>
  <li>Passport Size Photo (Soft Copy)</li>
  <li>Education Certificates: SSLC to Highest Education</li>
  <li>PAN Card (Scan Copy)</li>
  <li>Passport Scan Copy (If Applicable)</li>
  <li>Permanent and Temporary Address (Detailed Address)</li>
  <li>Address Proof (Aadhaar, DL, or Voter ID). Aadhaar Card copy is mandatory.</li>
</ol>
<p><strong>Please also share the following details:</strong></p>
<ul>
  <li>Full Name</li>
  <li>Email ID</li>
  <li>DOB</li>
</ul>
<p><strong>Additionally, please fill in and return the HRMS Onboarding Form:</strong></p>
<p><a href="{excel_url}">Click here to open your HRMS Onboarding Form</a></p>
<p>Please fill in all fields in the form and send it back along with your documents.</p>
<p>For any clarifications, please contact the undersigned.</p>
<p>Regards,<br>{recruiter_or_hr_name}</p>
```

---

## §INITIAL_FTE_EXPERIENCED

**Used by:** Phase 2 `send-initial.md` when `employee_type ∈ {fte, experienced}`.

```
Subject: Documents Required for Onboarding – {employee_full_name}

isHtml: true
to: {employee_email}
ccRecipients: ["{recruiter_or_hr_email}"]

Body:
<p>Hi {employee_full_name},</p>
<p>Good day!!!</p>
<p>As discussed, please find below the list of documents that need to be sent as soon as possible.</p>
<p><strong>Required Documents:</strong></p>
<ol>
  <li>Highest Qualification Certificate</li>
  <li>All Companies Offer Letter / Appointment Letter</li>
  <li>3 Months Payslips</li>
  <li>All Companies Relieving Letter</li>
  <li>Aadhaar Card (Mandatory)</li>
  <li>PAN Card</li>
  <li>Address Proof (Any one: Rental Agreement, Electricity Bill, Gas Bill, Phone Bill)</li>
</ol>
<p><strong>Please also share the following details:</strong></p>
<ul>
  <li>Full Name</li>
  <li>Email ID</li>
  <li>DOB</li>
</ul>
<p><strong>Additionally, please fill in and return the HRMS Onboarding Form:</strong></p>
<p><a href="{excel_url}">Click here to open your HRMS Onboarding Form</a></p>
<p>Please fill in all fields in the form and send it back along with your documents.</p>
<p>For any clarifications, please contact the undersigned.</p>
<p>Regards,<br>{recruiter_or_hr_name}</p>
```

---

## §INITIAL_CONTRACTOR

**Used by:** Phase 2 `send-initial.md` when `employee_type == contractor`.

**PRE-RENDER RULE (mandatory) — evaluate BEFORE sending:**
- If `payload.special_document_requirements` is present and non-empty:
  - Insert exactly this line as the final `<li>` of the `<ol>`: `<li>Additional requirements: {special_document_requirements}</li>` (with `{special_document_requirements}` substituted, HTML-escaped).
- Else:
  - Omit that `<li>` entirely.
- **The bracketed `[IF ... ELSE ...]` pseudo-code below MUST NEVER appear in the sent email body.** If you see `[IF` or `ELSE:` in your draft body, you have not pre-rendered. Re-render before send.

```
Subject: Documents Required for Onboarding – {employee_full_name}

isHtml: true
to: {employee_email}
ccRecipients: ["{recruiter_or_hr_email}"]

Body (template — pre-render conditional before send):
<p>Hi {employee_full_name},</p>
<p>Good day!!!</p>
<p>Please share the following documents for your onboarding:</p>
<ol>
  <li>Latest Resume</li>
  <li>PAN Card</li>
  <li>Aadhaar Card</li>
  <li>Address Proof</li>
  <li>Full Name, Email ID, DOB</li>
  {{CONDITIONAL_ADDITIONAL_REQUIREMENTS — see PRE-RENDER RULE above}}
</ol>
<p><strong>Additionally, please fill in and return the HRMS Onboarding Form:</strong></p>
<p><a href="{excel_url}">Click here to open your HRMS Onboarding Form</a></p>
<p>Please fill in all fields in the form and send it back along with your documents.</p>
<p>Regards,<br>{recruiter_or_hr_name}</p>
```

---

## §INITIAL_REHIRE_PRECONFIRMATION

**Used by:** Phase 1 `validate-inputs.md` when `employee_type == rehire`, BEFORE the full document request goes out.

Purpose: ask the human reviewer whether prior docs can be reused or full re-submission is needed.

```
Subject: HR Alert: Rehire case — {employee_full_name}

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>A rehire onboarding case has been created for <strong>{employee_full_name}</strong> ({employee_email}).</p>
<p>Joining date: {date_of_joining}</p>
<p>Case ID: {case_id}</p>
<p>Please confirm whether prior documents can be reused, or if a full new submission is required. Reply to this email to proceed.</p>
<p>Documents typically required for a rehire: Resume, Updated Address, Address Proof, Updated PAN/Aadhaar if changed, Full Name, Email, DOB.</p>
<p>Regards,<br>HR Automation</p>
```

---

## §PHONE_NUMBER_REQUEST

**Used by:** Phase 1 `validate-inputs.md` when `phone_number` is missing from payload.

After sending, set `phone_number = "pending — requested via email"` and continue. Do NOT block onboarding.

```
Subject: Quick Detail Required – Onboarding for {employee_full_name}

isHtml: true
to: {employee_email}

Body:
<p>Hi {employee_full_name},</p>
<p>We are initiating your onboarding process. Could you please share your contact phone number at the earliest so we can update our records?</p>
<p>Please reply to this email with your phone number.</p>
<p>Regards,<br>{recruiter_or_hr_name}</p>
```

---

## §UNKNOWN_EMPLOYEE_TYPE_ALERT

**Used by:** Phase 1 `validate-inputs.md` when `employee_type` not in allowed list. Triggers STOP after this email.

```
Subject: HR Alert: Unknown employee_type for {employee_full_name}

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>Cannot proceed with onboarding for <strong>{employee_full_name}</strong> — unrecognized employee_type: <strong>{value}</strong>.</p>
<p>Please correct the issue type and re-trigger the routine.</p>
<p>Case ID (not created — pipeline halted): {employee_email}-{date_of_joining}</p>
<p>Regards,<br>HR Automation</p>
```

---

## §DUPLICATE_WORKFLOW_ALERT

**Used by:** orchestrator Step 3.5 when the audit-log dedup scan detects an active case that appears to be the same candidate (exact / typo-distance / name-prefix-overlap match).

```
Subject: HR Alert: Duplicate onboarding workflow blocked — {employee_full_name}

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>An attempt was made to bootstrap a new onboarding pipeline for <strong>{employee_full_name}</strong> ({employee_email}), but the orchestrator detected one or more ACTIVE cases that appear to be the same candidate:</p>
<ul>{collision_items_html — one <li> per collision: <li>case_id=<code>{case_id}</code> (current_status=<code>{latest_status}</code>) — reason: <code>{reason}</code></li>}</ul>
<p>The pipeline has NOT been bootstrapped (no SharePoint folder, no run-state.json, no child issue). Please:</p>
<ol>
  <li>Confirm whether this is genuinely a new case (different person / different event / true rehire). If yes, re-trigger with payload-level flag <code>skip_dedup: true</code>.</li>
  <li>OR cancel the existing case(s) listed above before re-triggering.</li>
</ol>
<p>If the existing case(s) are stuck or stalled and should not block this new run, mark them as <code>cancelled</code> or <code>completed</code> in the audit-log before re-triggering.</p>
<p>Regards,<br>HR Automation</p>
```

---

## §REHIRE_COLLISION_ALERT

**Used by:** Phase 1 `validate-inputs.md` when a completed case already exists for `{employee_email + date_of_joining}` (see `_shared.md § §11`).

```
Subject: HR Alert: Same-date rehire case detected for {employee_full_name}

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>A completed onboarding case already exists for <strong>{employee_full_name}</strong> ({employee_email}) with joining date {date_of_joining}.</p>
<p>A new case is being created as a rehire with Case ID: <strong>{new_case_id}</strong>.</p>
<p>Please confirm this is intended before proceeding.</p>
<p>Regards,<br>HR Automation</p>
```

---

## §REPLY_ALTERNATE_SENDER_ALERT

**Used by:** Phase 4 `process-reply.md` when reply sender is NOT `employee_email` or `alternate_candidate_email`.

Pipeline does NOT auto-process the reply — awaits human confirmation.

```
Subject: HR Alert: Possible reply from alternate address — {employee_full_name}

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>A possible reply was detected for <strong>{employee_full_name}</strong> from an unrecognized email address:</p>
<ul>
  <li>Expected: {employee_email}</li>
  <li>Alternate on file: {alternate_candidate_email or "—"}</li>
  <li>Actual sender: {actual_sender}</li>
</ul>
<p>Please review and confirm if this is from the candidate. Case ID: {case_id}</p>
<p>Regards,<br>HR Automation</p>
```

---

## §PHOTO_MISMATCH_HUMAN

**Used by:** Phase 5 `validate-docs.md` when photo consistency check detects different faces across documents.

Never include the actual photo or ID digits.

```
Subject: HR Alert: Photo mismatch — {employee_full_name}

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>During document validation for <strong>{employee_full_name}</strong> ({employee_email}), the photos on the following documents appear to be of different people:</p>
<ul>
  <li>{document_a_name}</li>
  <li>{document_b_name}</li>
</ul>
<p>Documents have been retained but not accepted. A re-upload request has been sent to the candidate.</p>
<p>Case ID: {case_id}</p>
<p>Regards,<br>HR Automation</p>
```

---

## §PHOTO_MISMATCH_CANDIDATE

**Used by:** Phase 5 `validate-docs.md`, sent to candidate alongside the human alert.

```
Subject: Action Required: Document Re-upload – {employee_full_name}

isHtml: true
to: {employee_email}

Body:
<p>Hi {employee_full_name},</p>
<p>Thank you for sharing your documents.</p>
<p>We noticed an inconsistency between the photos on your submitted documents. Please re-upload the correct copies so we can complete the verification.</p>
<p>If you have any questions, please reach out to {recruiter_or_hr_name}.</p>
<p>Regards,<br>{recruiter_or_hr_name}</p>
```

---

## §DISCREPANCY_HUMAN

**Used by:** Phase 6 `request-resubmission.md` — notifies the human reviewer of all issues found.

```
Subject: HR Alert: Discrepancies found — {employee_full_name}

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>Discrepancies were found during document review for <strong>{employee_full_name}</strong> ({employee_email}).</p>
<p>Issues:</p>
<ul>{discrepancy_items_as_html_list}</ul>
<p>A resubmission request has been sent to the candidate. Case ID: {case_id}</p>
<p>Regards,<br>HR Automation</p>
```

---

## §RESUBMISSION_CANDIDATE

**Used by:** Phase 6 `request-resubmission.md` — asks the candidate to correct specific issues.

**Critical:** the list MUST be exact. Never vague ("some documents are missing"). Always concrete ("Aadhaar card is missing", "Payslip from {month} is unreadable").

**HTML-escape rule:** when substituting `{exact_discrepancy_items_as_html_list}`, each item's text (everything between `<li>` and `</li>`) MUST be HTML-escaped — replace `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`. Only the `<li>` / `</li>` wrappers themselves remain unescaped. Same rule applies to `{discrepancy_items_as_html_list}` in `§DISCREPANCY_HUMAN`, `{received_docs_html_list}` in `§HUMAN_VERIFICATION_REQUEST`, and `{filenames_html_list}` in `§UPLOAD_COMPLETE_HUMAN`.

```
Subject: Resubmission Required – Onboarding Documents for {employee_full_name}

isHtml: true
to: {employee_email}
ccRecipients: ["{recruiter_or_hr_email}"]

Body:
<p>Hi {employee_full_name},</p>
<p>Thank you for sharing your documents.</p>
<p>We found a few issues. Please re-send or correct the following:</p>
<ol>{exact_discrepancy_items_as_html_list}</ol>
<p>Please share corrected documents at the earliest.</p>
<p>Regards,<br>{recruiter_or_hr_name}</p>
```

---

## §HUMAN_VERIFICATION_REQUEST

**Used by:** Phase 7+8 `complete-submission.md` after all mandatory docs are clean. Triggers human approval.

```
Subject: HR Action Required: Verify onboarding documents for {employee_full_name}

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi {human_in_loop_name},</p>
<p>All required documents have been received and passed automated review for <strong>{employee_full_name}</strong>.</p>

<table>
  <tr><td><strong>Name</strong></td><td>{employee_full_name}</td></tr>
  <tr><td><strong>Email</strong></td><td>{employee_email}</td></tr>
  <tr><td><strong>Phone</strong></td><td>{phone_number}</td></tr>
  <tr><td><strong>Role</strong></td><td>{role}</td></tr>
  <tr><td><strong>Type</strong></td><td>{employee_type}</td></tr>
  <tr><td><strong>Joining Date</strong></td><td>{date_of_joining}</td></tr>
  <tr><td><strong>Case ID</strong></td><td>{case_id}</td></tr>
  <tr><td><strong>SharePoint folder</strong></td><td>HR-Onboarding/{employee_full_name} - {date_of_joining}/</td></tr>
</table>

<p><strong>Summary of action taken:</strong> {summary_of_action_taken}</p>
<p><strong>Documents received:</strong></p>
<ul>{received_docs_html_list}</ul>
<p><strong>Discrepancies cleared in earlier rounds:</strong> {discrepancy_summary or "None"}</p>
<p><strong>Nudges sent:</strong> Nudge 1 — {reminder_1_yes_no}, Nudge 2 — {reminder_2_yes_no}</p>
<p><strong>Identity check outcome:</strong> {identity_check_outcome}</p>
<p><strong>Action required:</strong> Please review documents in 02_Verified_Documents and approve the SharePoint upload via the Paperclip approval on this issue.</p>
<p>Regards,<br>HR Automation</p>
```

---

## §SHAREPOINT_UPLOAD_FAILURE_HUMAN

**Used by:** Phase 9 `upload-sharepoint.md` on any `sharepoint_transfer_from_outlook` failure after retries.

```
Subject: HR Alert: SharePoint upload failure — {employee_full_name}

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>SharePoint upload failed for <strong>{employee_full_name}</strong> ({employee_email}) after 3 retries.</p>
<table>
  <tr><td><strong>Case ID</strong></td><td>{case_id}</td></tr>
  <tr><td><strong>Folder</strong></td><td>HR-Onboarding/{employee_full_name} - {date_of_joining}/</td></tr>
  <tr><td><strong>Filename</strong></td><td>{filename}</td></tr>
  <tr><td><strong>Failure stage</strong></td><td>{stage}</td></tr>
  <tr><td><strong>Error</strong></td><td>{error_message}</td></tr>
</table>
<p>Files successfully uploaded so far: {success_list}</p>
<p>Manual intervention required to upload remaining files.</p>
<p>Regards,<br>HR Automation</p>
```

---

## §UPLOAD_COMPLETE_HUMAN

**Used by:** Phase 9 `upload-sharepoint.md` after all files successfully uploaded.

```
Subject: Onboarding documents uploaded — {employee_full_name}

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>Documents have been uploaded to SharePoint for <strong>{employee_full_name}</strong>.</p>
<p>Folder: HR-Onboarding/{employee_full_name} - {date_of_joining}/</p>
<p>Files uploaded:</p>
<ul>{filenames_html_list}</ul>
<p>Case ID: {case_id}</p>
<p>Regards,<br>HR Automation</p>
```

---

## §COMPLETION_CANDIDATE

**Used by:** Phase 10 `close-case.md` — sent to candidate confirming onboarding closed.

**PRE-RENDER RULE (mandatory) — evaluate BEFORE sending:**
- If `payload.alternate_candidate_email` is present and non-empty:
  - Set `ccRecipients = ["{alternate_candidate_email}"]`.
- Else:
  - OMIT `ccRecipients` from the API call entirely (do not pass an empty array, do not pass `null`).
- **The bracketed `[{alternate_candidate_email if present, else omit}]` text MUST NEVER appear in the sent email envelope or body.**

```
Subject: Onboarding Completed – Next Steps

isHtml: true
to: {employee_email}
ccRecipients: {{CONDITIONAL_ALTERNATE_EMAIL — see PRE-RENDER RULE above}}

Body:
<p>Dear {employee_full_name},</p>
<p>We are pleased to confirm that your onboarding process has been successfully completed.</p>
<p>Your joining date is <strong>{date_of_joining}</strong>. Further details regarding your next steps — including reporting instructions, system access, and any pre-joining formalities — will be shared with you shortly via email.</p>
<p>If you have any questions or require any changes, please reply to this email and our HR team will assist you promptly.</p>
<p>Welcome aboard!</p>
<p>Warm regards,<br>HR Team<br>Medicodio AI</p>
```

---

## §IT_SETUP

**Used by:** Phase 10 `close-case.md` — notifies IT to provision the joiner.

```
Subject: New Joiner IT Setup Required – {employee_full_name} ({role}) – Joining {date_of_joining}

isHtml: true
to: $IT_SUPPORT_EMAIL
ccRecipients: ["{human_in_loop_email}", "{recruiter_or_hr_email}"]

Body:
<p>Hi IT Team,</p>
<p>Please be informed that a new team member is joining Medicodio AI and requires full IT setup to be ready before their joining date.</p>

<p><strong>New Joiner Details:</strong></p>
<ul>
  <li><strong>Name:</strong> {employee_full_name}</li>
  <li><strong>Role:</strong> {role}</li>
  <li><strong>Date of Joining:</strong> {date_of_joining}</li>
  <li><strong>Employee Type:</strong> {employee_type}</li>
  <li><strong>Phone Number:</strong> {phone_number}</li>
  <li><strong>Contact Email:</strong> {employee_email}</li>
</ul>

<p><strong>Action Required — please ensure the following are ready by {date_of_joining}:</strong></p>
<ol>
  <li>Laptop / workstation provisioned and configured</li>
  <li>Company email account created per naming convention</li>
  <li>Required software and tools installed for role: {role}</li>
  <li>Access provisioned to relevant systems, repositories, and internal tools</li>
  <li>VPN / remote access configured if applicable</li>
  <li>Any role-specific hardware or peripherals arranged</li>
</ol>

<p>Please keep everything ready before the joining date. If you need any additional information, reach out to {recruiter_or_hr_name} at {recruiter_or_hr_email}.</p>
<p>Regards,<br>HR Team<br>Medicodio AI</p>
```

---

## §NUDGE_1_CANDIDATE

**Used by:** `email-heartbeat.md` Path A — first reminder after 24h silence.

```
Subject: Reminder: Pending Onboarding Documents – {employee_full_name}

isHtml: true
to: {employee_email}
ccRecipients: ["{recruiter_or_hr_email}"]

Body:
<p>Hi {employee_full_name},</p>
<p>This is a reminder to share your onboarding documents requested earlier.</p>
<p>Please send the required documents at the earliest so that we can proceed.</p>
<p>Regards,<br>{recruiter_or_hr_name}</p>
```

---

## §NUDGE_1_HUMAN

**Used by:** `email-heartbeat.md` Path A — notifies human reviewer of first reminder.

```
Subject: HR Alert: First reminder sent to {employee_full_name}

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>The first reminder has been sent to <strong>{employee_full_name}</strong> ({employee_email}) as no documents were received within 24 hours.</p>
<p>Case ID: {case_id}</p>
<p>Regards,<br>HR Automation</p>
```

---

## §NUDGE_2_CANDIDATE

**Used by:** `email-heartbeat.md` Path B — final automated reminder at 48h.

```
Subject: Urgent Reminder: Onboarding Documents Pending – {employee_full_name}

isHtml: true
to: {employee_email}
ccRecipients: ["{recruiter_or_hr_email}"]

Body:
<p>Hi {employee_full_name},</p>
<p>This is a follow-up regarding your pending onboarding documents.</p>
<p>Please share them as soon as possible to avoid any delay in your onboarding process.</p>
<p>Regards,<br>{recruiter_or_hr_name}</p>
```

---

## §NUDGE_2_HUMAN

**Used by:** `email-heartbeat.md` Path B — notifies human reviewer of second reminder.

```
Subject: HR Alert: Second reminder sent to {employee_full_name} — action may be needed

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>The second (final automated) reminder has been sent to <strong>{employee_full_name}</strong> ({employee_email}).</p>
<p>If no response is received within 24 hours, the case will be marked as <strong>stalled</strong> and manual follow-up will be required.</p>
<p>Case ID: {case_id}</p>
<p>Regards,<br>HR Automation</p>
```

---

## §STALLED_HUMAN

**Used by:** `email-heartbeat.md` Path C — case marked stalled after no response to Nudge 2 within 24h.

```
Subject: HR Alert: Case stalled — {employee_full_name}

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>No response has been received from <strong>{employee_full_name}</strong> ({employee_email}) after two automated reminders.</p>
<p>The case has been marked as <strong>stalled</strong>. Manual follow-up is required.</p>
<p>Case ID: {case_id}</p>
<p>Regards,<br>HR Automation</p>
```

---

## §TIMESTAMP_ERROR_HUMAN

**Used by:** `email-heartbeat.md` STEP 1 timestamp guard.

```
Subject: HR Alert: Cannot process case for {employee_full_name} — timestamp error

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>The heartbeat could not process the onboarding case for <strong>{employee_full_name}</strong> ({employee_email}) because the last outbound email timestamp is missing or malformed in the audit log.</p>
<p>Case ID: {case_id}</p>
<p>Manual inspection of the audit log is required.</p>
<p>Regards,<br>HR Automation</p>
```

---

## §MISSING_PAPERCLIP_ID_HUMAN

**Used by:** `email-heartbeat.md` STEP 1c when `paperclip_issue_id` cannot be recovered for an active case.

```
Subject: HR Alert: Cannot route replies for {employee_full_name} — Paperclip issue ID unknown

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>The heartbeat could not find the Paperclip issue ID for case <strong>{case_id}</strong> ({employee_full_name}, {employee_email}).</p>
<p>Reply sub-issue routing will fail without it. Manual lookup required.</p>
<p>Regards,<br>HR Automation</p>
```

---

## §SUB_ISSUE_CREATE_FAILURE_HUMAN

**Used by:** `email-heartbeat.md` STEP 2 when reply sub-issue creation fails after retry.

```
Subject: HR Alert: Failed to create reply sub-issue for {employee_full_name}

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>The heartbeat detected {N} reply(s) from <strong>{employee_full_name}</strong> ({employee_email}) but failed to create the reply processing sub-issue after one retry.</p>
<table>
  <tr><td><strong>Case ID</strong></td><td>{case_id}</td></tr>
  <tr><td><strong>Message IDs</strong></td><td>{messageId_list}</td></tr>
  <tr><td><strong>Expected parent issue</strong></td><td>{paperclip_issue_id}</td></tr>
  <tr><td><strong>Error</strong></td><td>{error}</td></tr>
</table>
<p>Manual intervention required — process replies manually and re-trigger if needed.</p>
<p>Regards,<br>HR Automation</p>
```

---

## §NUDGE_SEND_FAILURE_HUMAN

**Used by:** `email-heartbeat.md` STEP 4 when nudge email send fails.

```
Subject: HR Alert: Failed to send Nudge {nudge_number} to {employee_full_name}

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>The heartbeat tried to send Nudge {nudge_number} to <strong>{employee_full_name}</strong> ({employee_email}) but the outlook send failed.</p>
<p>Case ID: {case_id}<br>Error: {error}</p>
<p>Nudge was NOT marked as sent — the heartbeat will retry on its next tick.</p>
<p>Regards,<br>HR Automation</p>
```

---

## §APPROVAL_TIMEOUT_HUMAN

**Used by:** `email-heartbeat.md` approval-poll step when a Paperclip approval has been open > 7 days.

```
Subject: HR Alert: Approval pending > 7 days — {employee_full_name}

isHtml: true
to: {human_in_loop_email}

Body:
<p>Hi,</p>
<p>The Paperclip approval for <strong>{employee_full_name}</strong> ({employee_email}) has been pending for more than 7 days.</p>
<table>
  <tr><td><strong>Case ID</strong></td><td>{case_id}</td></tr>
  <tr><td><strong>Approval ID</strong></td><td>{approval_id}</td></tr>
  <tr><td><strong>Created at</strong></td><td>{approval_created_at}</td></tr>
</table>
<p>Please review and approve (or reject with reason) in Paperclip.</p>
<p>Regards,<br>HR Automation</p>
```

---

## §Teams_Onboarding_Started

**Used by:** Phase 2 `send-initial.md` (Step 17a).

```
contentType: html
content:
🟢 Onboarding Started — {employee_full_name}<br>
<br>
Role: {role} ({employee_type})<br>
Joining: {date_of_joining}<br>
Email: {employee_email}<br>
HR Contact: {recruiter_or_hr_name}<br>
Case: {PAPERCLIP_TASK_ID}<br>
<br>
Document request email sent. Awaiting candidate submission.
```

---

## §Teams_Documents_Received

**Used by:** Phase 4 `process-reply.md` (Step 25a) after raw upload completes.

```
contentType: html
content:
📄 Documents Received — {employee_full_name}<br>
<br>
Received: {received_list_with_check_marks}<br>
Missing: {missing_list_or_None}<br>
Source: Email ({now})<br>
Case: {PAPERCLIP_TASK_ID}<br>
<br>
Proceeding to validation.
```

---

## §Teams_Documents_Verified

**Used by:** Phase 7+8 `complete-submission.md` after auto-upload to 02_Verified_Documents.

```
contentType: html
content:
✅ Documents Verified — {employee_full_name}<br>
<br>
Verified: {verified_count}/{total_count} documents<br>
Case: {PAPERCLIP_TASK_ID}<br>
Next: Human review approval requested from {human_in_loop_email}<br>
<br>
All mandatory documents received and validated. Awaiting HR sign-off.
```

---

## §Teams_Documents_Incomplete

**Used by:** Phase 6 `request-resubmission.md` (Step 35a).

```
contentType: html
content:
⚠️ Documents Incomplete — {employee_full_name}<br>
<br>
Missing: {missing_list_or_None}<br>
Invalid: {invalid_list_or_None}<br>
Case: {PAPERCLIP_TASK_ID}<br>
<br>
Follow-up email sent to candidate. Awaiting resubmission.
```

---

## §Teams_Onboarding_Complete

**Used by:** Phase 10 `close-case.md` after case fully closed.

```
contentType: html
content:
✅ Onboarding Complete — {employee_full_name}<br>
<br>
Role: {role} ({employee_type})<br>
Joining: {date_of_joining}<br>
SharePoint: HR-Onboarding/{employee_full_name} - {date_of_joining}/<br>
Case: {PAPERCLIP_TASK_ID}<br>
<br>
All documents verified and archived. Completion email sent to candidate. Case closed.
```

---

## §Teams_Escalation

**Used by:** any phase on unrecoverable failure that sets status = `escalated` or `blocked`.

```
contentType: html
content:
🔴 Escalation Required — {employee_full_name}<br>
<br>
Reason: {escalation_reason}<br>
Phase: {current_phase}<br>
Action: Human review required<br>
Notified: {human_in_loop_email}<br>
Case: {PAPERCLIP_TASK_ID}<br>
<br>
Routine paused. Awaiting human resolution.
```

---

## §Teams_Heartbeat_Failure

**Used by:** `email-heartbeat.md` on any failure that causes STOP or prevents a case from advancing. NOT sent on quiet runs (no replies, no nudges).

```
contentType: html
content:
🔴 HR Email Heartbeat — Technical Failure<br>
<br>
Error: {error_message}<br>
Step: {current_step_label}<br>
Active cases at time of failure: {active_case_count}<br>
<br>
Heartbeat stopped. Human intervention may be required.
```
