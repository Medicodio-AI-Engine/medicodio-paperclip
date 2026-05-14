# Document Validator Skill

Validates documents received via email attachments. Extracts content, checks against a caller-supplied checklist, runs identity and cross-document consistency checks, and returns a structured result. The calling agent defines what documents are required and acts on the result.

**Caller must supply:** `messageId`, `employee_full_name`, `employee_email`, `employee_type`, `date_of_joining`. Optional: `date_of_birth`, `permanent_address`, `temporary_address`.

---

## Flags — two severities only

| Severity | Meaning | Caller action |
|----------|---------|--------------|
| `BLOCK` | Do not accept. Stop submission. | Escalate to `human_in_loop_email` immediately. Notify candidate of specific issue (no raw ID digits). |
| `WARN` | Provisional. Needs human sign-off. | Continue but escalate all WARN flags to `human_in_loop_email` before final acceptance. |

**Silence = no issue.** Emit a flag only when action is required. Skipped checks, passing checks, and checks not applicable to this employee type emit nothing.

Every flag has this shape:
```json
{
  "type": "<flag_type>",
  "severity": "BLOCK | WARN",
  "documents_involved": ["filename.ext"],
  "message": "Human-readable. No government ID digits — use [REDACTED].",
  "recommended_action": "What the caller should do."
}
```

---

## Step 1 — Read the email and list attachments

```
1a. outlook_read_email messageId="{messageId}"
    → note: hasAttachments, body text, sender email, sender name

1b. IF hasAttachments:
    outlook_list_attachments messageId="{messageId}"
    → collect: name, contentType, size, attachmentId for each file
```

---

## Step 2 — Extract content from each attachment

For each attachment, call `outlook_read_attachment`:

| File type | Supported | What you get |
|-----------|-----------|-------------|
| `.pdf` | ✅/⚠️ | `extractedText`. If response has `warning: "SCANNED_PDF_NO_TEXT"` → scanned image, no text layer → treat as `needs_manual_review`, notify `human_in_loop_email`, ask candidate to re-send as JPG/PNG or text-layer PDF |
| `.docx` | ✅ | `extractedText` |
| `.txt / .csv / .md` | ✅ | `text` |
| `.jpg / .jpeg / .png / .gif / .webp` | ✅ | Image content block — Claude vision reads directly |
| `.heic / .tiff` | ⚠️ | Flag for manual review — may not extract |
| `.xlsx / .xls` | 🚫 (presence-only) | **HRMS Onboarding Form.** Do NOT extract or parse content. Do NOT open the file. Do NOT check whether fields are filled. Record `present: true` based on attachment presence alone. Field-fill review is delegated to the human approver at `complete-submission.md` Step 8/9. |
| `.zip / .rar` | ❌ | Ask candidate to send files unzipped. BLOCK that attachment. |
| Other binary | ❌ | Metadata only — flag for manual verification |

**HRMS Excel hard rule:** for any `.xlsx` / `.xls` attachment (the HRMS Onboarding Form returned by the candidate), the ONLY check this skill performs is "did the candidate attach an Excel file." Never emit BLOCK or WARN flags about empty cells, missing fields, partial data, or content layout. Never call `outlook_read_attachment` to parse the workbook for validation. The human approver inspects field completeness manually after Phase 7+8 creates the approval. Skipping content parsing here is the correct behavior — do not "improve" it.

**Retain `contentBytes` (base64) and `contentType` per attachment** — required by the calling routine for SharePoint upload. Do not discard after validation.

Combine email body text + all extracted attachment text → **full submission text** for matching.

---

### 2a — Readability check (run first on every file)

If an image or scanned PDF is blurry, too dark, overexposed, or low-resolution such that **any critical field** (name, DOB, ID number, dates, institution name) cannot be read:

→ Emit BLOCK flag `unreadable_document`. Do not attempt any further checks on that file.

```
message: "Document is too blurry / low-resolution to read critical fields."
recommended_action: "Ask candidate to re-upload a clear, high-resolution scan or photo."
```

---

### 2b — AI-generation detection (run on every file before identity checks)

Flag if **either** visual OR metadata signal is present.

**Visual signals** (images and scanned PDFs):
- Pixel-perfect fonts with zero scan artifacts or compression noise
- No official stamps, seals, watermarks, or embossed marks
- Suspiciously uniform margins and spacing — template-generated appearance
- No fold marks, shadows, or physical document texture
- Signatures look typed or are unnaturally uniform

**Metadata signals** (PDFs and DOCX):
- Creator/producer field references Canva, Adobe Firefly, DALL-E, Midjourney, ChatGPT, or similar AI/design tools
- Document creation date is recent but document claims to be historical (e.g., degree cert PDF created 2026, degree awarded 2019)
- No scanner or printer metadata on a document that should be a physical scan

If any signal is present → Emit BLOCK flag `suspected_ai_generated`. Stop all further validation for that file. Escalate to `human_in_loop_email` immediately.

```
message: "Document shows signs of AI generation or digital fabrication ({brief reason — visual or metadata signal})."
recommended_action: "Escalate to human immediately. Do not accept. Request original physical document scan."
```

---

## Step 3 — Match against the required checklist

The calling agent provides the checklist — required items with keywords to detect.

For each required item:
- `present` — found in text, attachment name, or extracted text/image
- `pending` — not found anywhere
- `unclear` — partial match, ambiguous, needs follow-up

**Tips:**
- Normalise: lowercase, strip punctuation before keyword search
- One attachment may satisfy multiple items (e.g., Aadhaar → Photo ID + Address Proof)
- Attachments clearly unrelated to the checklist (company PRDs, meeting notes) do not count
- For images: use visual content to identify document type even without a text label

**HRMS Onboarding Form (Excel) — presence-only match:**

The checklist item `HRMS Onboarding Form (Excel)` is satisfied by attachment presence alone:
- If the candidate's reply (any round) carries any `.xlsx` or `.xls` attachment → `status = "present"`. Set `evidence = "Excel attachment received — content not parsed; human approver will verify fields"`. Do NOT mark `unclear`.
- No Excel attached anywhere → `status = "pending"`.
- Never assign `unclear` to this item. Never inspect the workbook to decide.

Do not run any of the identity / consistency / expiry checks (Step 3b–3e) against an Excel file. Those checks apply to PDFs and images only. An `.xlsx` is invisible to Step 3b–3e by construction.

---

## Step 3b — Identity checks: name and DOB

**Pre-processing before any comparison:**
- Strip name prefixes: Mr, Mrs, Ms, Dr, Prof, Shri, Smt
- Strip name suffixes: Jr, Sr, II, III, IV
- Normalise: lowercase, collapse whitespace
- DOB: normalise all formats to `YYYY-MM-DD` before comparing (handle `DD/MM/YYYY`, `DD-MM-YYYY`, `Month DD YYYY`)

**Name matching rules:**

| Scenario | Outcome |
|----------|---------|
| Exact match after normalisation | Pass — no flag |
| Same tokens, different order ("Rajan Karthik" vs "Karthik Rajan") | Pass — no flag |
| Initials match full name ("K. Rajan" vs "Karthik Rajan") | WARN — `name_variation` |
| Middle name present on doc but absent in payload (or vice versa) | WARN — `name_variation` |
| Single-character typo | WARN — `name_variation` |
| Clearly different name (different first name or surname — not a variation) | BLOCK — `name_mismatch` |

**DOB matching rules:**

| Scenario | Outcome |
|----------|---------|
| Exact match after normalisation | Pass — no flag |
| Only partial DOB visible (year only, or month+year) | Pass — insufficient to dispute |
| Full date visible and does not match | BLOCK — `dob_mismatch` |
| `date_of_birth` not supplied by caller | Skip — no flag |

**Cross-document name consistency:**
After checking each document against `employee_full_name`, compare names across all submitted documents against each other. If two documents show clearly different names (not a variation):
→ BLOCK — `cross_doc_name_mismatch`
```
documents_involved: ["{doc_A}", "{doc_B}"]
message: "Name on {doc_A} does not match name on {doc_B}."
```

---

## Step 3c — Universal cross-document consistency checks

Run for all employee types. Emit only when a conflict is found.

**PAN consistency** (if PAN is visible on ≥2 documents):
- Compare PAN across documents
- Mismatch → BLOCK — `pan_number_mismatch`
- Never include actual PAN digits in the flag message — use `[REDACTED]`

**Address consistency** (if `permanent_address` or `temporary_address` supplied):
- Extract address from Aadhaar and any address proof
- Significant mismatch (different city or state) → WARN — `address_mismatch`
- Minor variation (abbreviation, missing pin code) → no flag

**Photo consistency** (if ≥2 photos present — e.g., Aadhaar + passport photo + submitted photo):
- Visually compare: do they appear to be the same person?
- Apparent mismatch → WARN — `photo_identity_mismatch`; escalate to human

---

## Step 3d — Employee-type-aware cross-document checks

Apply only the branch matching `employee_type`. Emit nothing for inapplicable branches.

### fte / experienced

**Payslip employer vs relieving letter employer:**
- Extract employer from each payslip and each relieving letter
- Payslip employer not found in any relieving letter → WARN — `employer_name_mismatch`
- Use label "payslip employer" / "relieving letter employer" in message — do not log actual company name

**Payslip recency:**
- All 3 payslips must fall within 4 months before `date_of_joining`
- Any payslip older than that → WARN — `payslip_stale`

**Payslip month continuity:**
- 3 payslips must represent 3 consecutive calendar months
- Gaps present → WARN — `payslip_months_not_consecutive`

**Relieving letter date:**
- Relieving letter date must be before `date_of_joining`
- Date is after `date_of_joining` → WARN — `relieving_letter_date_conflict`

### fresher / intern

**Education certificate year sequence:**
- Extract year from each cert: SSLC/10th, PUC/12th/Diploma, Degree
- Sequence must be: SSLC year < 12th year < Degree year
- Impossible sequence → BLOCK — `education_year_sequence_invalid`
- Plausible but suspiciously compressed timeline (e.g., degree 1 year after 10th) → WARN — `education_timeline_implausible`

### contractor

No employment cross-checks. Skip this step entirely.

### rehire

Only validate newly submitted documents. Reused docs from a prior case are not re-validated unless another check (expiry, name mismatch, AI generation) flags them. Emit nothing for clean reused docs.

---

## Step 3e — Document validity and expiry checks

**Passport:**
- Expired as of `date_of_joining` → BLOCK — `passport_expired`
- Expires within 6 months of `date_of_joining` → WARN — `passport_expiring_soon`
- Expiry date not readable → no flag

**Address proof (utility bills, bank statements, rental agreements):**
- Document date more than 3 months before `date_of_joining` → WARN — `address_proof_stale`
- Date not readable → no flag

**Relieving letter (fte/experienced only):**
- Date after `date_of_joining` → WARN — `relieving_letter_date_conflict` (emit once — do not duplicate if already flagged in Step 3d)

---

## Step 4 — Build a structured validation result

**DATA SENSITIVITY:** Never include Aadhaar digits, PAN digits, or any government ID number in any field. Use `[REDACTED]`.

**Decision logic:**
- Any `BLOCK` flag → `decision: "blocked"`
- No BLOCK + ≥1 WARN → `decision: "provisional"`
- Zero flags → `decision: "proceed"`

```json
{
  "sender": { "name": "...", "email": "..." },
  "attachments": [
    {
      "name": "aadhaar.jpg",
      "contentType": "image/jpeg",
      "readable": true,
      "extractedLength": 800,
      "messageId": "AAMkAGI...",
      "attachmentId": "AAMkAGI...att"
    }
  ],
  "checklist": [
    { "item": "Aadhaar Card", "status": "present", "evidence": "Aadhaar received — number [REDACTED]" },
    { "item": "PAN Card", "status": "pending", "evidence": null },
    { "item": "Highest Qualification Certificate", "status": "unclear", "evidence": "Certificate present but blurry — re-upload requested" }
  ],
  "summary": {
    "total": 8,
    "present": 5,
    "pending": 2,
    "unclear": 1
  },
  "mismatch_flags": [
    {
      "type": "suspected_ai_generated",
      "severity": "BLOCK",
      "documents_involved": ["degree_cert.pdf"],
      "message": "Degree certificate PDF was created by Canva (PDF metadata). Document claims issue year 2019 but PDF creation date is 2026.",
      "recommended_action": "Escalate to human immediately. Do not accept. Request original physical scan."
    },
    {
      "type": "payslip_stale",
      "severity": "WARN",
      "documents_involved": ["payslip_jan2025.pdf"],
      "message": "Payslip date is more than 4 months before joining date.",
      "recommended_action": "Request a more recent payslip or HR confirmation."
    }
  ],
  "identity_checks": {
    "name_on_documents": "Karthik R.",
    "name_matches_candidate": "warn",
    "dob_on_documents": "1995-06-15",
    "dob_matches_candidate": true,
    "cross_doc_name_consistent": true
  },
  "validation_summary": {
    "block_count": 1,
    "warn_count": 1,
    "decision": "blocked"
  },
  "notes": "One document blocked — suspected AI generation. One payslip warning requires human review."
}
```

`identity_checks.name_matches_candidate` values: `true` (exact/equivalent match), `"warn"` (variation — needs human), `false` (mismatch — blocked).

---

## Step 5 — Reply with HTML (always)

**Check before sending:** No raw Aadhaar, PAN, or government ID digits in the reply body.

All replies MUST use `isHtml: true`. Never plain text.

The calling agent provides the reply template. This skill fills it with actual results:

```
outlook_reply
  messageId: "{messageId}"
  body: "{HTML body from calling agent's template}"
  isHtml: true
  replyAll: false
```

HTML rules: `<p>` paragraphs, `<ol><li>` numbered lists, `<ul><li>` bullet lists, `<strong>` bold, `<br>` signature breaks. No markdown in body.

---

## Step 6 — Return result to calling agent

Pass the result back. Caller acts on `validation_summary.decision`:

| `decision` | Caller action |
|-----------|--------------|
| `"proceed"` | All checks passed. Continue to next phase. |
| `"provisional"` | WARN flags present. Escalate all WARN flags to `human_in_loop_email` before final acceptance. |
| `"blocked"` | BLOCK flag(s) present. Do NOT accept submission. Escalate to `human_in_loop_email` immediately. Notify candidate of specific issue without exposing ID digits. |

This skill does not decide what happens next — the calling routine owns that.
