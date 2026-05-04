# Enricher — Hunter Email Enrichment (PHASE 2)

**TOOL RULE LINE 1:** Domain discovery = `WebSearch` (Claude Code built-in). NOT `duckduckgo_web_search`.
  WebSearch has no rate limit and needs no MCP dependency.
  `duckduckgo_web_search` is the FALLBACK — only if WebSearch returns zero results or errors.

**ANTI-HALLUCINATION LINE 7:** Every row gets its own independent WebSearch call.
  NEVER reuse a domain resolved for another row. "I know this domain from row X" = INVALID.
  Each row in `need_email_rows[]` is treated as if it is the only row. No exceptions.
  The domain field in each row object is the ONLY valid prior-domain source for that row.

**STATE:** Reads `batch_loader.need_email_rows[]` from run-state.json. Writes `enricher` section.
**CREATES NEXT:** `[EO-SENDER]` child issue.
**DO NOT:** Send emails. Read Excel for batch data — all row data is in run-state.json.

---

## Step 1 — Load state

```
sharepoint_read_file path="{run_state_path from issue description}"
→ IF missing: post blocked "run-state.json not found at {path}." STOP.
→ extract: batch_loader.need_email_rows[], event_slug, parent_issue_id, run_state_path
→ IF need_email_rows is empty: skip to Step 4 immediately
```

## Step 2 — Check Hunter credit balance

```
hunter_account_info
→ store: search_credits_remaining, verify_credits_remaining
→ IF search_credits_remaining = 0: post warning comment. Mark all need_email rows as
  pc_status="email_not_found", pc_notes="Hunter credits exhausted". Write to Excel.
  Skip to Step 4.
```

Post comment: `Hunter budget: {search_credits_remaining} search / {verify_credits_remaining} verify credits.`

## Step 3 — Enrich each row in need_email_rows[]

For EACH row — execute ALL 4 ROW-STEPS in strict order. Never skip a row-step.
**Repeat anti-hallucination check before each row:** "Row {excel_row}: domain is {row.domain or 'null'}. Running WebSearch independently now."
**After completing all 4 ROW-STEPS for a row — immediately write row result to run-state.json checkpoint (see ROW-STEP-D note).**

---

### ROW-STEP-A — Domain Discovery

**IF row.domain is non-empty:** resolved_domain = row.domain. Skip WebSearch. Go to ROW-STEP-B.

**ELSE — run WebSearch (BUILT-IN, NOT DDG):**
```
WebSearch query: '"{company}" official website'
→ take hostname from first non-aggregator result URL
→ strip www. and path → keep registrable domain + TLD → resolved_domain

TLD handling:
  - Simple TLD: careers.stripe.com → stripe.com
  - Two-part TLD (co.uk, com.au, gov.in, net.in, org.uk, co.nz, etc.):
    subdomain.company.co.uk → company.co.uk (keep both TLD parts)
  - When in doubt: keep the last TWO domain segments before the TLD

REJECT the result and try next URL if resolved_domain matches any of:
  linkedin.com, crunchbase.com, bloomberg.com, zoominfo.com, glassdoor.com,
  indeed.com, facebook.com, twitter.com, x.com, instagram.com, wikipedia.org,
  yelp.com, yellowpages.com, dnb.com, hoovers.com
  → these are aggregators, not the company's own domain — Hunter will return garbage

→ IF valid domain found → ROW-STEP-B
```

**FALLBACK (only if WebSearch returns no results or all results are aggregators):**
```
duckduckgo_web_search query='"{company}" official website' count=5
→ take hostname from first non-aggregator result URL → strip subdomains → resolved_domain
→ apply same TLD and reject rules as above
→ IF domain found → ROW-STEP-B
```

**IF both fail or all results are aggregator domains:**
```
→ pc_status = "domain_not_found"
→ pc_notes = "WebSearch and DDG both returned no usable results — domain unknown"
→ pc_email_source = "none", pc_hunter_method = "none"
→ write to Excel NOW:
    sharepoint_excel_write_range
      filePath="Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}"
      sheetName="{config.attendee_sheet}"
      address="{pc_status_col}{row}:{pc_notes_col}{row}"
→ add to failed_rows[], SKIP this row — do not proceed to ROW-STEP-B
→ checkpoint: append { excel_row, pc_status: "domain_not_found" } to enricher.enriched_rows_partial[] in run-state.json
```

---

### ROW-STEP-B — Hunter Email Finder (1 search credit)

```
hunter_find_email
  domain="{resolved_domain}"
  first_name="{row.first_name}"   ← NO middle_name, NO name_prefix
  last_name="{row.last_name}"
```

**IF email returned:**
```
→ resolved_email = email
→ pc_email_source = "hunter"          ← ALWAYS exactly "hunter" — never "hunter_email_finder"
→ pc_hunter_method = "email_finder"
→ pc_hunter_confidence = score
→ SKIP ROW-STEP-C → proceed to ROW-STEP-D
```

**IF no email returned:** proceed to ROW-STEP-C (NEVER mark email_not_found here — ROW-STEP-C must run first).

---

### ROW-STEP-C — Pattern Guess via Hunter Domain Search (1 search credit)

```
hunter_search_domain domain="{resolved_domain}" limit=10
→ inspect pattern field in response
```

Build candidate list (max 2, try in order):
1. `{hunter_pattern_result}@{resolved_domain}` if Hunter returned a pattern, ELSE `{first_name}.{last_name}@{resolved_domain}`
2. `{first_name[0]}{last_name}@{resolved_domain}` (e.g. jsmith@domain.com)

For each candidate — `hunter_verify_email email="{candidate}"`:

| status | action |
|--------|--------|
| valid | pc_email_risk="deliverable" → resolved_email=candidate → STOP, ROW-STEP-D |
| accept_all | pc_email_risk="risky" → resolved_email=candidate → STOP, ROW-STEP-D |
| unknown | pc_email_risk="unknown" → resolved_email=candidate → STOP, ROW-STEP-D |
| webmail | pc_email_risk="risky" → resolved_email=candidate → STOP, ROW-STEP-D |
| invalid / disposable | discard, try next candidate |

**IF both candidates invalid/disposable:**
```
→ pc_status = "email_not_found"
→ pc_notes = "tried: {cand1}={result1}, {cand2}={result2}"
→ pc_email_source = "none", pc_hunter_method = "none"
→ write to Excel NOW:
    sharepoint_excel_write_range
      filePath="Marketing-Specialist/event-outreach/{event_slug}/{config.attendee_file}"
      sheetName="{config.attendee_sheet}"
      address="{pc_status_col}{row}:{pc_notes_col}{row}"
→ add to failed_rows[]. SKIP ROW-STEP-D.
→ checkpoint: append { excel_row, pc_status: "email_not_found" } to enricher.enriched_rows_partial[] in run-state.json
```

**On first passing candidate:**
```
→ pc_email_source = "guessed"
→ pc_hunter_method = "domain_pattern" (if Hunter pattern used) or "pattern_fallback"
→ proceed to ROW-STEP-D (skip verify — already done above)
```

---

### ROW-STEP-D — Hunter Email Verifier (ROW-STEP-B results only — skip if email from ROW-STEP-C)

```
hunter_verify_email email="{resolved_email}"
```

| status | pc_email_risk | action |
|--------|--------------|--------|
| valid | deliverable | proceed to send |
| accept_all | risky | proceed |
| unknown | unknown | proceed |
| webmail | risky | proceed |
| invalid | undeliverable | pc_status="email_not_found", pc_notes="undeliverable per Hunter verify". Write to Excel (with filePath+sheetName). Add to failed_rows[]. |
| disposable | undeliverable | same as invalid |
| error / timeout | unknown | proceed |

**After ROW-STEP-D completes (success or failure) — checkpoint write:**
```
Append this row's result to enricher.enriched_rows_partial[] in run-state.json:
  { excel_row, resolved_email (or null), pc_email_source, pc_hunter_method,
    pc_hunter_confidence (or null), pc_email_risk (or null), pc_status }

sharepoint_write_file path="{run_state_path}" content="{updated JSON with partial array}"
```
This checkpoint ensures partial progress survives a mid-batch heartbeat timeout. On restart,
check enriched_rows_partial[] and skip already-processed rows.

---

## Step 4 — Build result arrays and update run-state.json

Build `enriched_rows[]` from all rows that reached ROW-STEP-D with a resolved_email.
Build `failed_rows[]` from all rows that were stopped at ROW-STEP-A, ROW-STEP-C, or ROW-STEP-D.

Hunter enrichment stats:
- hunter_found_count = rows where pc_hunter_method = "email_finder"
- guessed_count = rows where pc_email_source = "guessed"
- not_found_count = rows where pc_status = "email_not_found"
- domain_not_found_count = rows where pc_status = "domain_not_found"

Append `enricher` section to run_state:

```json
"enricher": {
  "status": "complete",
  "completed_at": "{ISO}",
  "hunter_found_count": N,
  "guessed_count": N,
  "not_found_count": N,
  "domain_not_found_count": N,
  "enriched_rows": [ ...{ excel_row, resolved_email, pc_email_source, pc_hunter_confidence, pc_hunter_method, pc_email_risk } ],
  "failed_rows": [ ...{ excel_row, pc_status, pc_notes } ]
}
```

```
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
→ IF fails: retry once (3s). If still fails: post blocked on this + parent. STOP.
```

Post comment:
```
Hunter enrichment complete.
Email Finder (hunter): {hunter_found} | Pattern guess (guessed): {guessed}
Not found: {not_found} | Domain not found: {domain_not_found}
Deliverable: {del} | Risky: {risky} | Undeliverable: {undel}
Credits remaining: ~{search_credits_remaining}
```

Teams notification (non-blocking):
```
teams_send_channel_message teamId=$TEAMS_MARKETING_TEAM_ID channelId=$TEAMS_MARKETING_CHANNEL_ID
content: "🔍 Email Enrichment Complete — {event_name} | Hunter: {hunter_found} | Guessed: {guessed} | Not found: {not_found}"
IF fails → add "⚠️ Teams notification failed: {error}" to comment and continue.
```

## Step 5 — Create next child issue and close

```
POST /api/companies/{companyId}/issues
{
  "title": "[EO-SENDER] Event Outreach — Sender — {event_slug}",
  "description": "phase_file: routines/event-outreach/sender.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}\nevent_slug: {event_slug}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
```

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
{ "status": "done", "comment": "Enrichment complete. [EO-SENDER] created." }
```
