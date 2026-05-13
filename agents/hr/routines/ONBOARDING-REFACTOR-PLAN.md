# Onboarding Routine Refactor Plan

**Owner:** Karthik R K
**Created:** 2026-05-12
**Status:** In progress

---

## Goal

Split the 1112-line `employee-onboarding.md` into one orchestrator + 9 phase files (mirroring the marketing-specialist `event-outreach` pattern). Each phase = one Paperclip child issue = one Claude wake = one self-contained file. Zero mid-run drift.

Keep `email-heartbeat.md` as a single file but extend it to poll for human-approval transitions.

---

## Why

- **Current pain:** 1112-line single file forces Claude to hold the entire pipeline in context every wake. Phase 5 (document validation) is fragile — easy to skip steps or run wrong branch when state lives only in the conversation.
- **Risk:** silent leaks — Claude resending initial emails, re-creating folders, re-uploading raw files, or misreading the discrepancy/no-discrepancy branch.
- **Pattern proven:** marketing-specialist `event-outreach` already runs cleanly with this split. Each wake reads one phase file, executes it, writes run-state.json, creates the next child issue, exits.

---

## How — Architecture

### One wake = one phase file

Title prefix on the Paperclip child issue routes to the correct file. AGENTS.md holds the routing table. Phase file starts with explicit "DO NOT" boundaries.

```
[HR-ONBOARD]        → employee-onboarding.md            (orchestrator + Phase 0)
[HR-VALIDATE-INPUTS]→ employee-onboarding/validate-inputs.md
[HR-SEND-INITIAL]   → employee-onboarding/send-initial.md
[HR-AWAIT-REPLY]    → employee-onboarding/await-reply.md
[HR-PROCESS-REPLY]  → employee-onboarding/process-reply.md  (heartbeat creates this)
[HR-VALIDATE-DOCS]  → employee-onboarding/validate-docs.md
[HR-REQUEST-RESUB]  → employee-onboarding/request-resubmission.md
[HR-COMPLETE-SUB]   → employee-onboarding/complete-submission.md
[HR-UPLOAD-SP]      → employee-onboarding/upload-sharepoint.md
[HR-CLOSE]          → employee-onboarding/close-case.md
```

### State carriers (two, complementary)

1. **`run-state.json`** — machine-readable pipeline state.
   - Path: `HR-Onboarding/{employee_full_name} - {date_of_joining}/run-state.json`
   - Holds: `case_id`, `parent_issue_id`, all payload fields, `current_phase`, `phases_complete[]`, `discrepancy_list`, `attachment_lookup`, `identity_check_outcome`, `approval_id`.
   - Every phase: read → execute → write → exit.

2. **`case-tracker.md`** — human-readable per-person tracker (already exists in SharePoint).
   - Add new **Phase Tracker** table (10 rows, one per phase).
   - Each phase file flips its own row: `pending → in_progress → done` (or `skipped` / `blocked`).
   - Status History (existing) keeps the chronological event log.

### Shared files (DRY)

- **`_shared.md`** — global conventions: audit-log format, status transition table, CSV append pattern, government-ID masking, timestamp format, `outlook_read_attachment` two-context rule, binary upload rule.
- **`_email-templates.md`** — all HTML email bodies: intern/fresher/fte/contractor/rehire initial, resubmission, completion, IT setup, all human-notification templates, all Teams notifications.

Each phase file references these by section name rather than duplicating.

### No-leak rules (every phase file header)

```
**TOOL RULE LINE 1:** {phase-specific tool constraint}
**STATE:** Read run_state_path from issue description. Update {phase} section before creating next child.
**CREATES NEXT:** [HR-NEXT-PHASE] child issue. Exit after child confirmed.
**DO NOT:** Execute any other phase logic. Do not re-send emails. Do not re-create folders. Do not re-read config.
```

Every file ends with `Exit heartbeat. ✓`.

---

## How — Decisions (locked from Q&A)

| Q | Decision |
|---|----------|
| Q1 — multi-reply loop | **Inline loop** in `process-reply.md`. Candidate normally sends one consolidated reply. Loop messageIds in one wake, dispatch to validate-docs.md after raw upload. |
| Q2 — approval wait | **Heartbeat polls Paperclip approvals.** `complete-submission.md` exits after creating approval. `email-heartbeat.md` gets a new step: detect approved approvals → create `[HR-UPLOAD-SP]` child issue. |
| Q3 — orchestrator filename | Keep `employee-onboarding.md` as orchestrator (matches event-outreach pattern, no Paperclip routine config changes). |
| Q4 — shared rules | `_shared.md` + `_email-templates.md` (DRY). Per-person phase progress goes into the existing `case-tracker.md` Phase Tracker table. |
| Q5 — email-heartbeat split | **Single file kept.** Add approval-poll step. |

---

## How — Rollout (option A: exemplar first)

Build the foundation + one phase as an exemplar, validate the pattern works, then sweep the remaining phases.

**Batch 1 — foundation + exemplar (review checkpoint after this):**
1. `employee-onboarding/_shared.md` — global conventions
2. `employee-onboarding/_email-templates.md` — all HTML templates
3. `employee-onboarding.md` — rewrite as orchestrator (Phase 0 + bootstrap run-state.json)
4. `employee-onboarding/validate-inputs.md` — Phase 1 exemplar (includes new case-tracker.md template w/ Phase Tracker)

**→ Pause. User reviews pattern. Confirm OK before continuing.**

**Batch 2 — remaining phases:**
5. `employee-onboarding/send-initial.md`
6. `employee-onboarding/await-reply.md`
7. `employee-onboarding/process-reply.md` (inline loop over messageIds)
8. `employee-onboarding/validate-docs.md` (invokes doc-validator skill)
9. `employee-onboarding/request-resubmission.md`
10. `employee-onboarding/complete-submission.md` (exits after creating approval)
11. `employee-onboarding/upload-sharepoint.md`
12. `employee-onboarding/close-case.md`

**Batch 3 — wiring:**
13. `email-heartbeat.md` — add approval-poll step + update child-issue title prefixes
14. `agents/hr/AGENTS.md` — phase routing table for all new prefixes

---

## Connected — file relationships

```
employee-onboarding.md (orchestrator, Phase 0)
        │
        ├── reads/writes ──► HR-Onboarding/{name - date}/run-state.json
        ├── creates child  ─► [HR-VALIDATE-INPUTS]
        │
        ▼
validate-inputs.md (Phase 1)
        ├── references ────► _shared.md (audit-log fmt, masking)
        ├── references ────► _email-templates.md (phone request, employee_type alert)
        ├── reads/writes ──► run-state.json, case-tracker.md (init Phase Tracker)
        ├── creates child  ─► [HR-SEND-INITIAL]
        │
        ▼
send-initial.md (Phase 2)
        ├── references ────► _email-templates.md (intern/fresher/fte/contractor/rehire initial)
        ├── reads/writes ──► run-state.json, case-tracker.md (Phase Tracker row 2)
        ├── creates child  ─► [HR-AWAIT-REPLY]
        │
        ▼
await-reply.md (Phase 3)
        ├── sets issue ────► in_review
        ├── creates child  ─► (none — heartbeat takes over)
        ├── EXIT.
        │
        ▼  (heartbeat detects reply)
process-reply.md (Phase 4 — [HR-PROCESS-REPLY] from heartbeat)
        ├── inline loop ───► foreach messageId in messageIds[]
        ├── uploads raw ──► 01_Raw_Submissions/
        ├── creates child ─► [HR-VALIDATE-DOCS]
        │
        ▼
validate-docs.md (Phase 5)
        ├── invokes skill ─► agents/hr/skills/document-validator.md
        ├── references ────► _shared.md (photo check, identity check rules)
        ├── reads/writes ──► run-state.json (discrepancy_list, identity_check_outcome)
        ├── branches:
        │   ├── if discrepancies ─► [HR-REQUEST-RESUB]
        │   └── if clean         ─► [HR-COMPLETE-SUB]
        │
        ├──► request-resubmission.md (Phase 6) ──► heartbeat re-triggers Phase 4 on next reply
        │
        └──► complete-submission.md (Phase 7+8)
                ├── auto-uploads ──► 02_Verified_Documents/
                ├── creates Paperclip approval
                ├── writes approval_id to run-state.json
                ├── EXIT (heartbeat will poll for approval)
                │
                ▼  (heartbeat detects approved approval)
                upload-sharepoint.md (Phase 9 — [HR-UPLOAD-SP] from heartbeat)
                        ├── writes exception notes (raw + verified already uploaded)
                        ├── creates child ─► [HR-CLOSE]
                        │
                        ▼
                        close-case.md (Phase 10)
                                ├── sends completion email to candidate
                                ├── sends IT setup email
                                ├── updates Paperclip issue → done
                                ├── EXIT.
```

---

## Verification — done when

- [ ] All 14 files written
- [ ] Every phase file has the no-leak header
- [ ] Every phase file ends with `Exit heartbeat. ✓`
- [ ] `_shared.md` and `_email-templates.md` are referenced (not duplicated) in every phase file
- [ ] `case-tracker.md` template includes Phase Tracker table
- [ ] `email-heartbeat.md` has approval-poll step that creates `[HR-UPLOAD-SP]` child
- [ ] `agents/hr/AGENTS.md` phase routing table lists all `[HR-*]` prefixes
- [ ] Total LOC across the new files is materially smaller than 1112 (target ~1400 across 11 files with shared blocks DRY)

---

## Out of scope

- Changes to `agents/hr/skills/document-validator.md` (unchanged — phase 5 invokes it as-is)
- Changes to `agents/hr/skills/` (unchanged)
- Changes to `intern-fte-form.md` (deleted in working tree per `git status`; not part of this refactor)
- Email-heartbeat structural split (decided to keep single file)
