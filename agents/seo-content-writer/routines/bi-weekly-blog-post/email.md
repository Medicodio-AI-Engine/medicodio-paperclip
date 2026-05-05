# Email — Approval Request (Phase 4)

⛔ **HARD STOP RULE: This phase does ONE thing — send the approval email + set parent to in_review + close self. After Step 6, EXIT IMMEDIATELY. Do NOT create [BLOG-REVISE] or [BLOG-PUBLISH]. Email-monitor routine creates the next child when the approver replies.**

**BOUNDARY LINE 1:** Send ONE email only. Do not send to both approvers.
**BOUNDARY LINE 2:** CC naveen@medicodio.ai on every send — no exceptions.
**BOUNDARY LINE 3:** After sending, exit. Do NOT create a next child issue here. The email-monitor routine creates the next child.
**BOUNDARY LINE 4:** Email MUST be sent as HTML (`bodyType="HTML"`). Never send plain text. Never improvise the email body — use the exact HTML template in Step 2.
**BOUNDARY LINE 5:** The draft link in the email MUST be the SharePoint `webUrl` from `sharepoint_get_file_info`. Never use a filename, file path, or download URL.
**BOUNDARY LINE 6:** NEVER include the blog content or markdown in the email body. The email contains ONLY the metadata table + SEO scorecard + reply instructions. The approver clicks the SharePoint link to read the draft.
**BOUNDARY LINE 7:** NEVER send to `OUTLOOK_MAILBOX`. If `approverEmail` == `OUTLOOK_MAILBOX` (i.e. `karthik.r@medicodio.ai`), the run-state.json has a bad value. Post blocked: "approverEmail resolves to sender address — run-state.json approverEmail is invalid. Check orchestrator category routing." STOP.
**STATE:** Reads run-state.json + seo-check.md. Writes `email` section. Sets parent → in_review. Closes self.

---

## Step 1 — Load state

```
run_state_path = extract from issue description
parent_issue_id = extract from issue description

sharepoint_read_file path="{run_state_path}"
→ extract: topic, primaryKeyword, category, approverEmail, runFolder, seoScore, wordCount, write.draft_path

sharepoint_read_file path="{runFolder}/logs/seo-check.md"
→ store scorecard_content (for email body)

sharepoint_get_file_info path="{runFolder}/draft.md"
→ extract the "webUrl" field from the response
→ store as draft_share_url
→ MUST be an https:// URL pointing to the SharePoint web viewer
→ NEVER use a file path, filename, or download link as draft_share_url
→ IF sharepoint_get_file_info fails or returns no webUrl: post blocked "Cannot get SharePoint webUrl for draft.md". STOP.
```

## Step 2 — Compose approval email

**Subject:** `[Blog Review] {topic} — SEO Score: {seoScore}/100`

**HTML Body:**
```html
<p>Hi {firstName from approverEmail},</p>

<p>A new blog post is ready for your review before publishing to medicodio.ai.</p>

<table border="1" cellpadding="6" cellspacing="0">
<tr><td><strong>Title</strong></td><td>{topic}</td></tr>
<tr><td><strong>Target Keyword</strong></td><td>{primaryKeyword}</td></tr>
<tr><td><strong>Word Count</strong></td><td>{wordCount}</td></tr>
<tr><td><strong>SEO Score</strong></td><td>{seoScore}/100</td></tr>
<tr><td><strong>Draft</strong></td><td><a href="{draft_share_url}">View in SharePoint</a></td></tr>
</table>

<br>
<h3>SEO Keyword Scorecard</h3>
{scorecard_content — paste the markdown table as HTML table}

<br>
<p><strong>To approve:</strong> Reply with "Approved" or "Looks good"</p>
<p><strong>To request changes:</strong> Reply with your specific changes (e.g. "Change paragraph 2 from X to Y")</p>
<p><strong>To start over:</strong> Reply with "Start over"</p>

<br><br>
<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, Helvetica, sans-serif; color:#333333; line-height:1.5; border-left:3px solid #0a1d56; padding-left:16px;">
  <tr><td>
    <table cellpadding="0" cellspacing="0" border="0">
      <tr><td style="font-family: Arial, Helvetica, sans-serif; font-size:14px; color:#0a1d56; font-weight:700; padding-bottom:2px;">Thanks &amp; Regards,</td></tr>
      <tr><td style="font-family: Arial, Helvetica, sans-serif; font-size:16px; color:#0a1d56; font-weight:700; padding-bottom:4px;">Medicodio</td></tr>
      <tr><td style="font-family: Arial, Helvetica, sans-serif; font-size:12px; color:#666666; padding-bottom:10px; letter-spacing:0.3px; text-transform:uppercase;">AI Powered Medical Coding</td></tr>
      <tr><td style="font-family: Arial, Helvetica, sans-serif; font-size:13px; color:#333333; padding-top:8px; border-top:1px solid #e5e7eb;">
        <a href="https://medicodio.ai/" style="color:#0a1d56; text-decoration:none; font-weight:600;" target="_blank">MediCodio AI</a>
        <span style="color:#c0c5d1; padding:0 6px;">|</span>
        <a href="https://www.linkedin.com/company/medicodioai/" style="color:#0a1d56; text-decoration:none; font-weight:600;" target="_blank">LinkedIn</a>
        <span style="color:#c0c5d1; padding:0 6px;">|</span>
        <a href="mailto:karthik.r@medicodio.ai" style="color:#0a1d56; text-decoration:none; font-weight:600;">karthik.r@medicodio.ai</a>
      </td></tr>
    </table>
  </td></tr>
</table>
```

## Step 3 — Send email

```
IF approverEmail == OUTLOOK_MAILBOX:
  POST /api/issues/{PAPERCLIP_TASK_ID}/comments
  { "body": "BLOCKED: approverEmail == OUTLOOK_MAILBOX (karthik.r@medicodio.ai). run-state.json has invalid approverEmail. Check orchestrator category routing and correct run-state.json manually." }
  PATCH issue → blocked. STOP.

outlook_send_email
  mailbox="{OUTLOOK_MAILBOX}"
  to="{approverEmail}"
  cc="naveen@medicodio.ai"
  subject="{subject}"
  body="{HTML body}"
  bodyType="HTML"
→ capture: conversationId, messageId, sentAt
→ IF fails: retry once. If still fails: post blocked on self + parent. STOP.
```

## Step 4 — Save email section to run-state.json

```
sharepoint_read_file path="{run_state_path}"
→ append:
"email": {
  "status": "sent",
  "sent_at": "{ISO}",
  "to": "{approverEmail}",
  "cc": "naveen@medicodio.ai",
  "subject": "{subject}",
  "conversation_id": "{conversationId}",
  "message_id": "{messageId}"
},
"conversationId": "{conversationId}",
"messageId": "{messageId}",
"lastCheckedAt": "{sentAt}",
"status": "awaiting_reply",
"phases.email": "done"
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
```

## Step 5 — Write email.md log

```
sharepoint_write_file
  path="{runFolder}/logs/email.md"
  content:
---
# Email Log — {topic}
**Sent at:** {ISO}
**From:** {OUTLOOK_MAILBOX}
**To:** {approverEmail}
**CC:** naveen@medicodio.ai
**Subject:** {subject}
**conversationId:** {conversationId}
**messageId:** {messageId}
---
```

## Step 6 — Set parent to in_review and close self

```
PATCH /api/issues/{parent_issue_id}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "in_review", "comment": "Approval email sent to {approverEmail}. Waiting for reply." }

PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done", "comment": "Email sent. conversationId: {conversationId}. Email-monitor will check for replies every 6h." }
```

**Pipeline pauses here. Email-monitor routine takes over.** ✓
