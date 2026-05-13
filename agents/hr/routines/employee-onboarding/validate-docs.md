# Phase 5 — Validate Documents

**Title prefix:** `[HR-VALIDATE-DOCS]`
**Created by:** `process-reply.md` Step 10 Branch A (when at least one reply had attachments).
**Creates next:**
- `[HR-REQUEST-RESUB]` (if discrepancies found OR identity check failed OR photo mismatch detected)
- `[HR-COMPLETE-SUB]` (if all mandatory documents present AND identity check is `pass` or `warning` AND no photo mismatch)

---

## No-leak header

**TOOL RULE LINE 1:** This phase MUST invoke the document-validator skill at `agents/hr/skills/document-validator.md`. Before any validation check it MUST call `outlook_read_attachment` on EVERY non-archive attachment (see `_shared.md § §9.1` — mandatory in Phase 5). It MUST NOT use `outlook_read_attachment` for any upload (see `_shared.md § §9.2`). It uses `sharepoint_read_file` / `sharepoint_write_file` for run-state and case-tracker, `outlook_send_email` for photo-mismatch alerts, `teams_send_channel_message` non-blocking, and Paperclip API.

**STATE:** Read `run_state_path` from this issue description. Append a new entry to `run_state.validate_docs.rounds[]` before creating the next child.

**CREATES NEXT:** Exactly one of `[HR-REQUEST-RESUB]` or `[HR-COMPLETE-SUB]`.

**DO NOT:**
- Re-upload attachments to `01_Raw_Submissions/`. Phase 4 (`process-reply.md`) did that.
- Upload to `02_Verified_Documents/`. That is Phase 7+8 auto-upload (`complete-submission.md` Step) or Phase 9 fallback.
- Send the resubmission email. That is Phase 6 (`request-resubmission.md`).
- Send the human verification request. That is Phase 7+8 (`complete-submission.md`).
- Re-classify the reply. Phase 4 already did that — `process-reply.md` decided this round was `complete` or `partial` and routed here.
- Skip the `outlook_read_attachment` step. Every PDF/image MUST be read before any check. Filename and size alone are NOT validation.

---

## References

- Conventions: `routines/employee-onboarding/_shared.md`
- Templates: `routines/employee-onboarding/_email-templates.md`
- Validator skill: `agents/hr/skills/document-validator.md`

---

## Step 1 — Load run-state.json and this issue's description

```
sharepoint_read_file path="{run_state_path}"
→ Parse JSON. Validate schema_version == 1.
→ IF file missing → blocked comment on this issue + parent_issue_id, STOP.
```

Read issue description for `round_index` (set by `process-reply.md` Step 10 Branch A).

Extract — **read paths from run-state top-level, do NOT recompute:**
```
payload                = run_state.payload
employee_full_name     = payload.employee_full_name
employee_email         = payload.employee_email
employee_type          = payload.employee_type
date_of_joining        = payload.date_of_joining
date_of_birth          = payload.date_of_birth        ← may be null
permanent_address      = payload.permanent_address    ← may be null
temporary_address      = payload.temporary_address    ← may be null
human_in_loop_email    = payload.human_in_loop_email
recruiter_or_hr_name   = payload.recruiter_or_hr_name
case_tracker_path      = run_state.case_tracker_path  ← top-level
base_folder            = run_state.base_folder        ← top-level
case_id                = run_state.case_id
parent_issue_id        = run_state.parent_issue_id
```

Find the round that matches `round_index` in `run_state.process_reply.rounds[]`:
```
this_round = first(r in run_state.process_reply.rounds where r.round == round_index)
```

**CRITICAL — multi-round aggregation:** validation MUST see EVERY attachment from EVERY prior round, not only this round's uploads. Otherwise Phase 5 re-flags prior-round docs as missing on each subsequent round and Phase 7+8 only uploads the last round's docs.

Build the aggregated input:
```
attachments_to_validate = []
archive_files_skipped   = []

FOR each r in run_state.process_reply.rounds where r.round <= round_index:
  FOR each u in r.raw_uploads:
    tag = { ...u, source_round: r.round }
    IF u.transferred == true:
      attachments_to_validate.append(tag)
    ELSE IF u.reason starts with "archive":
      archive_files_skipped.append(tag)
```

Each entry now carries `source_round` (the process_reply round that uploaded it). Phase 5 Step 6c uses this to mark per-attachment `source` correctly.

**Dedup:** if same `filename` appears in multiple rounds (resubmission), KEEP only the entry with the LATEST `source_round`. Older copies stay in `01_Raw_Submissions/` for audit but are not re-validated.

**Guard:** if `attachments_to_validate` is empty AND `archive_files_skipped` is empty → blocked comment "Phase 5 invoked for case with no transferred attachments across any round." Phase Tracker row 5 → `blocked`. STOP.

---

## Step 2 — Flip Phase Tracker row 5 → in_progress

Update row 5 in `case-tracker.md`:
```
| 5 | Validate documents | validate-docs.md | in_progress | {now} | — | {PAPERCLIP_TASK_ID} | Round {round_index} — validating {N} attachments |
```
Write the file. On retry failure: notify human, audit-log escalated, STOP.

---

## Step 3 — MANDATORY: invoke document-validator skill

Before any other validation step, read and execute the FULL document-validator skill at `agents/hr/skills/document-validator.md`. Execute its steps in order: Step 1 → Step 2 → Step 3 → Step 3b → Step 3c → Step 3d → Step 3e → Step 4 → Step 5 → Step 6.

**Caller inputs to pass to the skill:**

```
messageIds            = this_round.messageIds_processed
attachments_to_validate = this_round.raw_uploads filtered to transferred == true
employee_full_name    = {employee_full_name}
employee_email        = {employee_email}
employee_type         = {employee_type}
date_of_joining       = {date_of_joining}
date_of_birth         = {date_of_birth, omit field entirely if null}
permanent_address     = {permanent_address, omit if null}
temporary_address     = {temporary_address, omit if null}
```

**Skill return shape (RAW — from `document-validator.md` Step 4):**

The skill returns these field names (do NOT rename them inside the skill):
```json
{
  "checklist":          [ { "doc_label": "...", "required": true|false, "present": true|false, "source_file": "...", "issues": [...], "flags": ["BLOCK"|"WARN"|...] }, ... ],     // ARRAY
  "mismatch_flags":     ["..."],
  "identity_checks":    { "name_matches_candidate": "pass|warning|fail|skip", "dob_matches": "pass|warning|fail|skip", "name_consistent": "pass|warning|fail|skip" },
  "validation_summary": { "total": N, "present": N, "block_count": N, "warn_count": N, "decision": "proceed|provisional|blocked" }
}
```

Store as `raw_validator_result`.

### Step 3 mapping — translate skill schema to Phase 5 internal schema

The skill returns a different shape than this phase consumes. Apply this MAPPING explicitly to produce `validator_result`:

| Skill field | Phase 5 field | Translation |
|---|---|---|
| `raw_validator_result.checklist` (ARRAY of `{doc_label, ...}`) | `validator_result.checklist` (OBJECT keyed by `doc_label`) | `for item in array: object[item.doc_label] = item` |
| `raw_validator_result.identity_checks.name_matches_candidate` | `validator_result.identity_checks.name_match` | rename |
| `raw_validator_result.identity_checks.dob_matches` | `validator_result.identity_checks.dob_match` | rename |
| `raw_validator_result.identity_checks.name_consistent` | `validator_result.identity_checks.name_consistency` | rename |
| `raw_validator_result.identity_checks` (consolidated) | `validator_result.validation_summary.identity_check_outcome` | derive ONLY from identity_checks fields, NOT from block_count: `fail` if any of (name_matches_candidate / dob_matches / name_consistent) == "fail"; ELSE `warning` if any == "warning"; ELSE `pass` (treat `skip` as pass — DOB not provided is a skip, not a fail). **Do NOT use block_count here — block_count tracks doc-level blocks (corrupt files, wrong types), which is a separate signal.** |
| `raw_validator_result.validation_summary.decision` (`proceed|provisional|blocked`) | `validator_result.decision` (`all_present_clean|discrepancies`) | `proceed → all_present_clean`; `provisional → discrepancies`; `blocked → discrepancies` |
| `raw_validator_result.mismatch_flags` | `validator_result.mismatch_flags` | copy verbatim |
| `raw_validator_result.validation_summary.total` / `present` | `validator_result.validation_summary.total` / `present` | copy verbatim |
| (derived) `validator_result.validation_summary.issues_count` | sum of issues across checklist array items | `sum(len(item.issues) for item in checklist array)` |

**After mapping, `validator_result` has the shape:**
```json
{
  "checklist":          { "<doc_label>": { "required": true|false, "present": true|false, "source_file": "...", "issues": [...], "flags": ["BLOCK"|"WARN"|...] }, ... },
  "mismatch_flags":     ["..."],
  "identity_checks":    { "name_match": "pass|warning|fail|skip", "dob_match": "pass|warning|fail|skip", "name_consistency": "pass|warning|fail|skip" },
  "validation_summary": { "total": N, "present": N, "issues_count": N, "identity_check_outcome": "pass|warning|fail" },
  "decision":           "all_present_clean | discrepancies"
}
```

All downstream steps (Step 6, 7a, 7b, 7d, 8b, 9) read `validator_result`, NOT `raw_validator_result`.

**Failure modes for the skill itself:**
- Skill returns malformed JSON or missing fields required for the mapping above → notify human (subject `HR Alert: document-validator skill returned malformed result — {employee_full_name}`), Phase Tracker row 5 → `blocked`, audit-log escalated. STOP.
- Skill explicitly returns an error / cannot proceed → same as above.
- Mapping fails (e.g. `checklist` is not an array, or `validation_summary` is missing) → same as above.

---

## Step 4 — MANDATORY: outlook_read_attachment on every non-archive attachment (defensive re-read)

This step is a DEFENSIVE RE-READ. The skill at `agents/hr/skills/document-validator.md` SHOULD already call `outlook_read_attachment` on every attachment internally, but this phase file MUST NOT trust that assumption — future edits to the skill could remove or shortcut the call. Always perform the read explicitly here, regardless of what the skill did.

**Do NOT delete this step even if it feels redundant.**

For each `attachment` in `attachments_to_validate`:

```
outlook_read_attachment
  messageId    = "{attachment.messageId}"
  attachmentId = "{attachment.attachmentId}"
```

Handling by content type:
- Image (`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`): inspect visually (multimodal).
- PDF: use returned `extractedText`. If the response contains `SCANNED_PDF_NO_TEXT`, that PDF is scanned-image with no text layer — add to discrepancy list with note `scanned PDF, request candidate re-send as JPG/PNG`.
- DOCX: use returned `extractedText`.

Log a one-line entry per file in `validator_result.read_log[]` (or a local list): `"Read {filename} — {contentType} — {extractedLength or 'visual'}"`.

For each archive file in `archive_files_skipped`: add to discrepancy list with note `archive file ({filename}) — candidate must re-send unzipped`. Do NOT call `outlook_read_attachment` on archives.

If ANY attachment that should be read fails the read call → add to discrepancy list with note `cannot read attachment {filename} — request re-send`.

---

## Step 5 — MANDATORY: photo consistency check

Collect every photo across attachments:
- Photo on Aadhaar card
- Passport-size photo (if a separate attachment)
- Photo on passport (if submitted)
- Any other identity document with a photo

If `count(photos) >= 2`:
- Compare visually. Do all photos appear to be the same person? Apparent face-shape, gender, age range, distinctive features.
- If apparent mismatch (clearly different face):
  - Add to local accumulator `photo_mismatch_set` (a list scoped to this phase wake) with note `photo_identity_mismatch: {doc_a_name} vs {doc_b_name}`.
  - `outlook_send_email` using `_email-templates.md § §PHOTO_MISMATCH_HUMAN` to `{human_in_loop_email}`.
  - `outlook_send_email` using `_email-templates.md § §PHOTO_MISMATCH_CANDIDATE` to `{employee_email}` (CC `{recruiter_or_hr_email}`).
  - Set local flag `photo_override_decision = "discrepancies"` — applied in Step 6 (merge).
  - **DO NOT write an audit-log row here.** The single decision row in Step 8b (written AFTER Step 6 has merged everything and Step 8a has emitted the `under_automated_review` row) carries `event = discrepancy_found` and includes the photo-mismatch reason. Writing a row in Step 5 would produce out-of-order status transitions.

If `count(photos) < 2`: skip the comparison; record `photo_check = "insufficient_photos_for_comparison"` in the round.

Never include the actual photo content or any ID digits in any email, comment, or audit-log entry.

---

## Step 6 — Build final discrepancy_list (merged) + derive per-attachment `verified` flag

### 6a — Merge discrepancy sources

Merge into `final_discrepancy_list`:
- The skill's discrepancy items (from `validator_result.mismatch_flags` and per-checklist `issues[]` for items with `present == false` or non-empty `issues` array).
- Archive-file entries from Step 4.
- Photo-mismatch entries from `photo_mismatch_set` (Step 5).
- Identity-check failures from `validator_result.identity_checks` (any field with value `fail`).
- Scanned-PDF entries from Step 4.

For each merged item, also build `documents_involved: [{filename1}, {filename2}, ...]` — the list of attachment filenames the discrepancy points to. This drives per-attachment `verified` derivation below.

De-duplicate by note text. The merged list is `final_discrepancy_list`.

### 6b — Compute decision

```
decision = "discrepancies" if (
  final_discrepancy_list is non-empty
  OR validator_result.identity_checks.name_match == "fail"
  OR validator_result.identity_checks.name_consistency == "fail"
  OR photo_mismatch_set is non-empty
  OR photo_override_decision == "discrepancies"
) else "all_present_clean"
```

Write back `validator_result.decision = decision`.

### 6c — Derive `verified` flag for each attachment

For each attachment `a` in `attachments_to_validate`:
```
a.verified = TRUE if all of:
  - a.filename is NOT in any final_discrepancy_list[].documents_involved
  - a.filename is NOT in archive_files_skipped
  - outlook_read_attachment succeeded for this attachment (no `cannot read attachment` discrepancy)
  - a.filename is NOT in photo_mismatch_set (i.e. not flagged as a mismatched photo source)
ELSE a.verified = FALSE
```

Build `attachments_validated = [{filename, messageId, attachmentId, contentType, round, verified, source}, ...]`.

**`source` value per attachment:**
- If `attachment.source_round == round_index` (this Phase 5 wake's `round_index`, matching the most recent process_reply round) → `source = "this_round"`.
- Else → `source = "round_{source_round}"` (e.g. `"round_1"` when round_index=2 and attachment came from Round 1).

Phase 7+8 Step 3 Branch A handles `source == "this_round"` (messageId/attachmentId usable directly from the entry). Branch B handles `source` starting with `"round_"` AND not equal to `"this_round"` (entry still carries messageId/attachmentId — see fix in complete-submission.md Step 3 — so direct use also works; Attachment Lookup fallback is only for entries missing those fields entirely).

This `attachments_validated[]` is written to `run_state.validate_docs.rounds[N].attachments_validated` in Step 9 below.

---

## Step 7 — Update case-tracker.md (Document Tracker + Identity + Attachment Lookup)

Read `case-tracker.md`. Make these updates in a single write at the end:

### 7a — Document Tracker
For each row already in the Document Tracker, look up its match in `validator_result.checklist[doc_label]`. Compute Status using this PRECEDENCE (apply top-down — first match wins):

1. `validator_result.identity_checks.name_match == "fail"` AND this doc is named in `mismatch_flags` → **`rejected`** (identity mismatch overrides everything).
2. Doc has any flag `"BLOCK"` in `checklist[doc_label].flags` → **`rejected`**.
3. Doc filename in `photo_mismatch_set` (Step 5 / Step 6c) → **`rejected`**.
4. Doc filename in `archive_files_skipped` → **`rejected`** with note `archive — re-send unzipped`.
5. Doc has any flag `"WARN"` in `flags` OR non-empty `issues[]` array → **`received`** (present but has issues — needs candidate action or human review).
6. Doc `present == true` AND no flags AND no issues → **`verified`**.
7. Doc `present == false` (not received in any round) → **`pending`**.
8. **`uploaded`** is set LATER by Phase 9 ONLY. Do NOT write `uploaded` in this phase.

Row format:
```
| {Document} | {Required} | {status from precedence above} | {ISO submitted_at if status ∈ {received, verified, rejected}, else —} | {issues list joined by "; " or "—"} | {— for now; Phase 9 timestamps Verified column on upload} |
```

### 7b — Identity Verification
Replace existing rows with the outcomes from `validator_result.identity_checks`:
```
| Name on documents matches candidate         | {pass|warning|fail|skip} | {note} |
| DOB on documents matches provided DOB       | {pass|warning|fail|skip} | {note — write "DOB not provided — check skipped" if payload.date_of_birth was null} |
| Name consistent across all documents        | {pass|warning|fail|skip} | {note} |
```

### 7c — Attachment Lookup
Append one row per attachment validated in this round (do NOT remove existing rows — append-only):
```
| {filename} | {messageId} | {attachmentId} | {contentType} | {round_index} |
```
(Phase 4 already wrote these for raw uploads. If a row for `{filename, round_index}` is already present, do NOT duplicate. Otherwise append.)

### 7d — Status History row
Append:
```
| {now} | under_automated_review | Round {round_index}: validated {N} attachments. Present: {present_count}. Issues: {issues_count}. identity_check_outcome: {validator_result.validation_summary.identity_check_outcome}. Decision: {decision} |
```

Write the full updated case-tracker. On retry failure: notify human, audit-log escalated, STOP.

---

## Step 8 — Append audit-log rows

Two rows: one for entering automated review, one for the decision outcome.

Row 8a — automated review entered:
```
{now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|under_automated_review|under_automated_review|Round {round_index} validation started — all {N} attachments read via outlook_read_attachment|attachments={N} archives_skipped={archive_count}|{PAPERCLIP_TASK_ID}
```

Row 8b — decision:
- If `decision == "discrepancies"`:
  ```
  {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|discrepancy_found|discrepancy_found|{N} discrepancies found in round {round_index}|{first 3 discrepancy items joined by "; "}|{PAPERCLIP_TASK_ID}
  ```
- If `decision == "all_present_clean"`:
  ```
  {now}|{case_id}|{employee_email}|{employee_full_name}|{employee_type}|{human_in_loop_email}|{recruiter_or_hr_name}|complete_submission_received|complete_submission_received|All mandatory documents present and clean in round {round_index}|identity={validator_result.validation_summary.identity_check_outcome}|{PAPERCLIP_TASK_ID}
  ```

---

## Step 9 — Update run-state.json

Append to `run_state.validate_docs.rounds[]` (idempotent — overwrite an existing entry tagged with this PAPERCLIP_TASK_ID rather than appending a duplicate, mirroring process-reply.md round_index handling):

```json
{
  "round": {round_index},
  "paperclip_task_id": "{PAPERCLIP_TASK_ID}",
  "started_at": "{...}",
  "completed_at": "{ISO now}",
  "validator_result_summary": {validator_result.validation_summary},
  "identity_check_outcome": "{validator_result.validation_summary.identity_check_outcome}",
  "identity_checks_detail": {validator_result.identity_checks},
  "discrepancy_list": [{final_discrepancy_list items, each with note + documents_involved}],
  "decision": "{decision}",
  "photo_check": "{ok | mismatch | insufficient_photos_for_comparison}",
  "photo_mismatch_set": [{photo_mismatch_set items if any}],
  "attachments_validated": [
    { "filename": "...", "messageId": "...", "attachmentId": "...", "contentType": "...", "round": N, "verified": true|false, "source": "this_round" }
  ]
}
```

**`verified` flag derivation:** see Step 6c. Phase 7+8 reads `verified: true` entries to know which attachments to upload to `02_Verified_Documents/`. The `source: "this_round"` marker tells Phase 7+8 that `messageId`/`attachmentId` are usable directly without an Attachment Lookup fallback.

Top-level:
- Add `validate_docs` to `phases_complete[]` if not already there.
- If `decision == "discrepancies"` → `current_phase = "request_resubmission"`.
- If `decision == "all_present_clean"` → `current_phase = "complete_submission"`.
- `last_updated = now`.

Write per `_shared.md § §12`. On retry failure: notify human, Phase Tracker row 5 → `blocked`, STOP.

---

## Step 10 — Flip Phase Tracker row 5 → done

Update row 5:
```
| 5 | Validate documents | validate-docs.md | done | {row5.Started from Step 2} | {now} | {PAPERCLIP_TASK_ID} | Round {round_index} — decision: {decision}; {N} discrepancies, identity: {identity_check_outcome} |
```

If `decision == "all_present_clean"` AND row 6's current Status is `pending` (never run in any prior round) → flip row 6 to `skipped`:
```
| 6 | Request resubmission | request-resubmission.md | skipped | — | — | — | Round {round_index} — no discrepancies in this run; resubmission not needed |
```

**If row 6 is already `done`** (a prior round ran Phase 6) → do NOT overwrite. Per `_shared.md § §13` refined ownership rule, never overwrite another phase's `done`/`Started`/`Completed`/`Child Issue` columns. Leave row 6 as `done`. The later-round clean result is captured in row 5's Notes and Status History.

Write the file.

---

## Step 11 — Branch: create next child

### Branch X — `decision == "discrepancies"` → `[HR-REQUEST-RESUB]`

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
{
  "title": "[HR-REQUEST-RESUB] {employee_full_name} — round {round_index} resubmission",
  "description": "phase_file: routines/employee-onboarding/request-resubmission.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}\ncase_id: {case_id}\nround_index: {round_index}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
→ On retry failure: blocked comment, Phase Tracker row 5 → blocked. STOP.
→ Store id as request_resub_issue_id.
```

### Branch Y — `decision == "all_present_clean"` → `[HR-COMPLETE-SUB]`

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
{
  "title": "[HR-COMPLETE-SUB] {employee_full_name} — round {round_index} verified upload + approval",
  "description": "phase_file: routines/employee-onboarding/complete-submission.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}\ncase_id: {case_id}\nround_index: {round_index}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
→ On retry failure: blocked comment, Phase Tracker row 5 → blocked. STOP.
→ Store id as complete_sub_issue_id.
```

---

## Step 12 — Close this issue and exit

```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
{
  "body": "Phase 5 round {round_index} complete. decision={decision}. {discrepancy_count} discrepancies. identity={identity_check_outcome}. Created child: {next_issue_id}."
}

PATCH /api/issues/{PAPERCLIP_TASK_ID}
{ "status": "done", "comment": "Phase 5 round {round_index} complete. Next: {next_prefix}." }
```

Exit heartbeat. ✓

---

## Failure handling reference

| Situation | Action |
|---|---|
| `run-state.json` missing at Step 1 | Blocked comment on this issue + parent. STOP. |
| `round_index` missing from issue description | Blocked comment. STOP. |
| Round has no attachments to validate | Blocked comment "Phase 5 invoked for round with no attachments." Phase Tracker row 5 → blocked. STOP. |
| document-validator skill returns malformed result | Notify human, Phase Tracker row 5 → blocked. STOP. |
| `outlook_read_attachment` fails for a file | Add to discrepancy list as `cannot read attachment {filename}`. Continue. |
| Photo mismatch detected | Force decision to `discrepancies`; emails sent per Step 5. |
| `case-tracker.md` write fails after retry | Notify human, audit-log escalated, STOP. |
| `run-state.json` write fails after retry | Notify human, Phase Tracker row 5 → blocked. STOP. |
| Audit-log write fails after retry | Notify human, Phase Tracker row 5 → blocked. STOP. |
| Next-phase child create fails after retry | Blocked comment, Phase Tracker row 5 → blocked. STOP. |

---

## What this phase does NOT do

- Upload anything to `02_Verified_Documents/`. That is Phase 7+8 auto-upload.
- Send the resubmission email. That is Phase 6.
- Create the Paperclip approval. That is Phase 7+8.
- Send Teams `§Teams_Documents_Verified` — that is Phase 7+8 after auto-upload completes.
- Send Teams `§Teams_Documents_Incomplete` — that is Phase 6.
- Re-classify the reply (Phase 4 owns classification).
- Touch `01_Raw_Submissions/` — files were uploaded there by Phase 4 already.

---

## Status on exit

Per `_shared.md § §21`:

| Outcome | This child issue (`[HR-VALIDATE-DOCS]`) | Parent orchestrator issue |
|---|---|---|
| Clean → `[HR-COMPLETE-SUB]` created | `done` | `in_progress` (active processing) |
| Dirty → `[HR-REQUEST-RESUB]` created (discrepancies) | `done` | `in_review` (waiting for candidate resubmission) |
| Identity check fail (Phase 5 hard fail) | `blocked` | `blocked` |
| Document-validator skill returned malformed result | `blocked` | `blocked` |
| run-state or audit-log write failed | `blocked` | `blocked` |
