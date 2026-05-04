# Routine: Monthly Competitor Deep Dive

**Schedule:** 1st Monday of each month 08:00 IST (`30 2 1-7 * 1` UTC)
**Concurrency:** `skip_if_active`
**Output:** SharePoint deep-dive report + Teams notification + CMO Paperclip issue (priority: high)

---

## BEFORE ANYTHING: Checkout

```
POST /api/issues/$PAPERCLIP_TASK_ID/checkout
Headers: Authorization: Bearer $PAPERCLIP_API_KEY, X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "agentId": "$PAPERCLIP_AGENT_ID", "expectedStatuses": ["todo", "in_progress"] }
```

If 409 → stop. Do not proceed.

---

## Overview

Two phases:
- **Phase 1** — Full competitor sweep (same as weekly but 30-day content lookback)
- **Phase 2** — Deep dive additions (architecture, segment map, matrix, threats, trends, recs)

**CRITICAL execution rules:**
- Do NOT run Step 7 (CMO issue creation) from weekly routine during Phase 1
- Do NOT run Step 8 (mark issue done) from weekly routine during Phase 1
- Only run Phase 6 (issue creation) and Phase 7 (mark done) after Phase 2 is fully complete
- Report saves to monthly path, not weekly path

---

## Phase 1 — Full Competitor Sweep (30-day lookback)

Execute Steps 0–6 from `weekly-competitor-sweep.md` with these overrides:

| Override | Value |
|---|---|
| Content lookback | 30 days — use `30_DAYS_AGO` not `7_DAYS_AGO` |
| Report save path | `CMO/Competitive/monthly/{YYYY-MM}-deepdive.md` |
| `REPORT_URL` | From `sharepoint_get_file_info path="CMO/Competitive/monthly/{YYYY-MM}-deepdive.md"` |
| config.md `last_run_type` | `monthly` |
| config.md `last_report_path` | `CMO/Competitive/monthly/{YYYY-MM}-deepdive.md` |

Compute:
- `YYYY_MM` = current year-month (e.g. `2026-05`)
- `30_DAYS_AGO` = today minus 30 days in `YYYY-MM-DD`

**After Step 6 (Teams post for Phase 1): do NOT proceed to Step 7 or Step 8. Go to Phase 2.**

---

## Phase 2 — Deep Dive Additions

Append all sections below to the monthly report. Run in order.

---

### Section A — Technical Architecture Analysis

For each of the 9 competitors:

```
duckduckgo_search query="{Company} engineering blog AI architecture LLM medical coding how it works"
duckduckgo_search query="{Company} machine learning NLP clinical job description tech stack 2026"
duckduckgo_search query="{Company} patent research paper arxiv clinical NLP autonomous coding"
fetch url="https://{domain}/blog"
fetch url="https://{domain}/technology"
```

For each company write:
```markdown
### {Company} — Technical Architecture
- **Training approach:** [General LLM fine-tuned / purpose-built / hybrid / Not found publicly]
- **Data sources:** [inferred from public statements]
- **Accuracy methodology:** [how they measure and report accuracy]
- **Human-in-loop:** [where humans are in their workflow]
- **Integration model:** [EHR API / document upload / ambient capture / Not found publicly]
- **Sources:** [URLs]
```

---

### Section B — Customer Segment Map

For each competitor:
```
duckduckgo_search query="{Company} customers hospital health system physician group payer RCM size 2026"
duckduckgo_search query="{Company} named customers case study enterprise mid-market 2026"
fetch url="https://{domain}/customers"
```

Then produce:

```markdown
## Customer Segment Map

| Segment | Leaders | Challengers | No Presence |
|---------|---------|-------------|-------------|
| Large health systems (500+ beds) | | | |
| Mid-market hospitals (100-500 beds) | | | |
| Physician group practices | | | |
| Payers / risk adjustment | | | |
| RCM outsourcing companies | | | |
| Critical access / rural | | | |
| Emergency medicine specific | | | |

**Open segment for MediCodio:** [clearest underserved segment based on evidence]
**Rationale:** [why this segment is open]
```

---

### Section C — Competitive Positioning Matrix

Use `?` where data not publicly available. Never guess.

```markdown
## Competitive Positioning Matrix

| Dimension | MediCodio | CodaMetrix | Fathom | AGS Health | Optum | Sully.ai | CorroHealth | AKASA | Apixio | Nym |
|-----------|-----------|------------|--------|------------|-------|----------|-------------|-------|--------|-----|
| Primary specialty | | | | | | | | | | |
| Autonomy level (1-5) | | | | | | | | | | |
| Market segment | | | | | | | | | | |
| Key EHR integrations | | | | | | | | | | |
| Pricing model | | | | | | | | | | |
| Est. customer count | | | | | | | | | | |
| Key differentiator | | | | | | | | | | |
| Known weakness | | | | | | | | | | |
| HIPAA/SOC2 | | | | | | | | | | |
```

---

### Section D — Threat Assessment

```
duckduckgo_search query="MediCodio competitors alternatives AI medical coding denial reduction 2026"
duckduckgo_search query="AI medical coding companies denial rates small mid-size practices 2026"
duckduckgo_search query="AI autonomous medical coding market direction enterprise mid-market 2026"
```

```markdown
## Threat Assessment

### Tier 1 — Direct threats
- **[Company]:** [why] | [recent move increasing threat]

### Tier 2 — Adjacent threats (moving toward our space)
- **[Company]:** [current position] → [convergence signals]

### Tier 3 — Low threat today
- **[Company]:** [why low threat] | [watch signals]

### Strategic implication
[1-2 sentences on what this means for MediCodio over next 6 months]
```

---

### Section E — Industry Trend Analysis

```
duckduckgo_search query="AI medical coding trends 2026 autonomous RCM revenue cycle direction"
duckduckgo_search query="medical coding automation market HIMSS CMS policy 2026"
duckduckgo_search query="AI medical coding industry report forecast 2026 2027"
```

Write 3-5 trends:

```markdown
## Industry Trend Analysis

### Trend 1: [Title]
**What is happening:** [evidence with sources]
**Timeline:** [when mainstream]
**Implication for MediCodio:** [specific impact]

### Trend 2: ...
```

---

### Section F — Strategic Recommendations for CMO

Based on ALL intelligence this month. 3-5 concrete recommendations.

```markdown
## Strategic Recommendations — {YYYY_MM}

### Rec 1: [Action title]
**Based on:** [specific finding — cite company and evidence]
**Action:** [concrete action — specific, not vague]
**Timeline:** [immediate / this quarter / next quarter]
**Outcome:** [what this achieves]

### Rec 2: ...
```

---

## Phase 3 — Finalize and Save Monthly Report

Append all Phase 2 sections to the report from Phase 1:

```
sharepoint_write_file
  path="CMO/Competitive/monthly/{YYYY_MM}-deepdive.md"
  content="{full report: Phase 1 company profiles + Phase 2 deep dive sections}"
```

Get real webUrl:
```
sharepoint_get_file_info path="CMO/Competitive/monthly/{YYYY_MM}-deepdive.md"
```

Store as `MONTHLY_REPORT_URL`. Use this in Teams and issue — never a hardcoded URL.

---

## Phase 4 — Update config.md

```
sharepoint_write_file
  path="CMO/Competitive/config.md"
  content="# Competitive Intel Config

last_run_date: {TODAY}
last_run_type: monthly
last_report_path: CMO/Competitive/monthly/{YYYY_MM}-deepdive.md
cmo_agent_id: {CMO_AGENT_ID}
ceo_agent_id: {CEO_AGENT_ID}

## Competitors
1. CodaMetrix (CMX) — codametrix.com
2. Fathom — fathomhealth.com
3. AGS Health — agshealth.com
4. Optum (Integrity One) — optum.com
5. Sully.ai — sully.ai
6. CorroHealth (PULSE) — corrohealth.com
7. AKASA — akasa.com
8. Apixio — apixio.com
9. Nym Health — nymhealth.com
10. MediCodio (self) — medicodio.ai
"
```

---

## Phase 5 — Post to Teams

```
teams_send_channel_message(
  teamId    = $TEAMS_MARKETING_TEAM_ID,
  channelId = $TEAMS_MARKETING_CHANNEL_ID,
  content   = "📊 **Monthly Strategic Intel — {YYYY_MM}**

🎯 **Top threats this month:**
{Tier 1 threat bullets from Section D}

💡 **Recommendations for CMO:**
{rec 1 — one line}
{rec 2 — one line}
{rec 3 — one line}

📊 **Biggest market shift:** {most important trend from Section E}

📁 [Full deep-dive report]({MONTHLY_REPORT_URL})"
)
```

---

## Phase 6 — Create High-Priority CMO Issue

Use `CMO_AGENT_ID` from config. If not cached, resolve: `GET /api/companies/$PAPERCLIP_COMPANY_ID/agents`.

```
POST $PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues
Headers: Authorization: Bearer $PAPERCLIP_API_KEY, X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
Content-Type: application/json

{
  "title": "Monthly Strategic Review Ready — {YYYY_MM}",
  "assigneeAgentId": "{CMO_AGENT_ID}",
  "priority": "high",
  "status": "todo",
  "description": "## Monthly competitive deep-dive is ready\n\n**Month:** {YYYY_MM}\n**Report:** [View in SharePoint]({MONTHLY_REPORT_URL})\n\n### Top threats\n{Tier 1 bullets}\n\n### Recommended actions\n{rec bullets}\n\n**Action needed:** Review recommendations and decide which to action. Escalate to CEO if budget or positioning changes required."
}
```

---

## Phase 7 — Mark own issue done

```
PATCH $PAPERCLIP_API_URL/api/issues/$PAPERCLIP_TASK_ID
Headers: Authorization: Bearer $PAPERCLIP_API_KEY, X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
Content-Type: application/json

{
  "status": "done",
  "comment": "Monthly deep-dive complete for {YYYY_MM}.\n\n- Report: CMO/Competitive/monthly/{YYYY_MM}-deepdive.md\n- CMO issue created (priority: high)\n- Teams notified\n- Any skipped sections: {list or 'none'}"
}
```

---

## Error Handling

| Situation | Action |
|---|---|
| 409 on checkout | Stop immediately. Do not proceed. |
| fetch returns empty | Retry with `browser_navigate` + `browser_snapshot` |
| DuckDuckGo no results | Try more specific query, log "limited data" in that section |
| Apify actor 404 | Skip, use DuckDuckGo fallback, note "Apify unavailable" in report |
| Apify timeout `-32000` | `get-actor-output runId="<runId>"` to recover |
| SharePoint write fails | Retry once. If still fails: PATCH issue to `blocked` with reason, stop |
| Teams fails | Log in issue comment, continue |
| CMO agent not found | Assign to CEO as fallback |
| Budget at 80% in Phase 1 | Complete Steps 4–6 (save report, Teams), skip Phase 2, proceed to Phase 6–7 with note |
| Budget at 80% in Phase 2 | Complete sections done, skip remaining Phase 2, proceed to Phase 3–7 with note |
