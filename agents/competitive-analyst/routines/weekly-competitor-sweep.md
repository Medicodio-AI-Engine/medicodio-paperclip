# Routine: Weekly Competitor Sweep

**Schedule:** Every Monday 08:00 IST (`30 2 8-31 * 1` UTC — weeks 2-4, never 1st Monday)
**Concurrency:** `skip_if_active`
**Output:** SharePoint report + Teams notification + CMO Paperclip issue

---

## BEFORE ANYTHING: Checkout

```
POST /api/issues/$PAPERCLIP_TASK_ID/checkout
Headers: Authorization: Bearer $PAPERCLIP_API_KEY, X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "agentId": "$PAPERCLIP_AGENT_ID", "expectedStatuses": ["todo", "in_progress"] }
```

If 409 → another agent owns this. Stop immediately. Do not proceed.

---

## Step 0 — Orientation and Delta Setup

```
sharepoint_read_file path="CMO/Competitive/config.md"
```

**If file does not exist (first run):**
- Set `IS_FIRST_RUN = true`
- All delta sections will say `"First run — no prior data"`
- Continue to Step 1, create config.md at end (Step 5)

**If file exists:**
- Set `IS_FIRST_RUN = false`
- Note `last_run_date`, `last_report_path`, `cmo_agent_id` from config
- Read prior report:
  ```
  sharepoint_read_file path="{last_report_path}"
  ```
- Store per-company facts in memory as "prior state" for delta
- If prior report read fails → treat as first run for delta only

Compute and store:
- `TODAY` = current date `YYYY-MM-DD`
- `WEEK` = ISO week `YYYY-Www` (e.g. `2026-W19`)

---

## Step 1 — Research Each Competitor

Process all 9 competitors in order. For each, run subsections A–K.

**Competitors:**
1. CodaMetrix (CMX) — `codametrix.com`
2. Fathom — `fathomhealth.com`
3. AGS Health — `agshealth.com`
4. Optum Integrity One — `optum.com`
5. Sully.ai — `sully.ai`
6. CorroHealth PULSE — `corrohealth.com`
7. AKASA — `akasa.com`
8. Apixio — `apixio.com`
9. Nym Health — `nymhealth.com`

Replace `{Company}` and `{domain}` with the actual values for each.

---

### A. Positioning — homepage and pricing

```
fetch url="https://{domain}"
fetch url="https://{domain}/pricing"
```

If fetch returns empty or blocked:
```
browser_navigate url="https://{domain}"
browser_snapshot
```

Extract: tagline, value prop, target buyer, specialty focus, key claims, pricing tiers.

---

### B. Technical differentiation

```
duckduckgo_search query="{Company} AI medical coding LLM technology autonomous approach 2026"
duckduckgo_search query="{Company} engineering blog technical NLP clinical coding"
fetch url="https://{domain}/about"
fetch url="https://{domain}/technology"
```

Extract: autonomous vs CAC, LLM claims, accuracy stats, EHR integrations.

---

### C. Customer intelligence

```
duckduckgo_search query="{Company} customers case study health system hospital named 2025 2026"
duckduckgo_search query="{Company} reviews site:g2.com OR site:capterra.com OR site:klasresearch.com"
fetch url="https://{domain}/customers"
fetch url="https://{domain}/case-studies"
```

If customer page empty:
```
browser_navigate url="https://{domain}/customers"
browser_snapshot
```

Extract: estimated count, named customers, market segment, customer type, specialty, geography, sentiment themes, churn signals.

---

### D. GTM signals

```
duckduckgo_search query="{Company} partnership integration announcement EHR 2026"
duckduckgo_search query="{Company} HIMSS conference certification SOC2 HIPAA 2026"
```

---

### E. Content published this week

```
duckduckgo_search query="{Company} blog case study whitepaper site:{domain} 2026"
duckduckgo_search query="{Company} new article published content marketing 2026"
fetch url="https://{domain}/blog"
```

Note any content published recently. If page lists dates, note which are within last 7 days.

---

### F. Hiring signals

```
duckduckgo_search query="{Company} jobs hiring VP engineer sales 2026 site:linkedin.com OR site:greenhouse.io OR site:lever.co OR site:indeed.com"
duckduckgo_search query="{Company} is hiring open roles 2026"
```

Optionally Apify for structured job data (async):
```
apify_call_actor actorId="apify/indeed-scraper" input={"query": "{Company}", "maxItems": 10} async=true
get-actor-output runId="<runId from response>" limit=10
```
If Apify 404s or errors: skip, continue with DuckDuckGo results.

---

### G. Pricing signals

```
fetch url="https://{domain}/pricing"
duckduckgo_search query="{Company} pricing model cost per chart subscription 2026"
```

---

### H. Funding and news

```
duckduckgo_search query="{Company} funding round acquisition news press release 2026"
duckduckgo_search query="{Company} raises series investment 2025 2026"
fetch url="https://{domain}/news"
fetch url="https://{domain}/press"
```

---

### I. Executive moves

```
duckduckgo_search query="{Company} hires VP Chief executive joins 2026 linkedin"
duckduckgo_search query="{Company} new executive departure leadership 2026"
```

---

### J. Product releases

```
duckduckgo_search query="{Company} new feature product launch release announcement 2026"
fetch url="https://{domain}/changelog"
fetch url="https://{domain}/updates"
fetch url="https://{domain}/releases"
```

---

### K. Delta vs prior report

Compare each section to prior state from Step 0.

- **If `IS_FIRST_RUN = true`**: write `"First run — no prior data for comparison"` in all delta fields
- **If `IS_FIRST_RUN = false`**: compare and rate:
  - 🔴 High: funding, new named customer, new product module, VP hire, new specialty
  - 🟡 Medium: new blog posts, minor GTM signal, job posting increase
  - ⚪ No change: nothing meaningful vs prior week

Write one-line implication for MediCodio per 🔴 item.

---

## Step 2 — Self-Monitor: MediCodio

```
duckduckgo_search query="MediCodio AI medical coding 2026"
duckduckgo_search query="MediCodio reviews site:g2.com OR site:capterra.com"
duckduckgo_search query="MediCodio alternative competitor comparison"
duckduckgo_search query="MediCodio site:healthcareitnews.com OR site:beckershospitalreview.com OR site:himss.org"
duckduckgo_search query="AI medical coding denial reduction autonomous"
```

Last query: check if MediCodio appears in results alongside competitors.

Collect: web mentions, competitor references, review sentiment, trade press, SEO presence.

---

## Step 3 — Compile Report

Build full markdown using this exact structure:

```markdown
# Competitive Intelligence — Week {WEEK}
Generated: {TODAY} | Agent: competitive-analyst

## Executive Summary
[3-5 bullets — highest signal items. First run: note it is baseline data collection.]

## Delta This Week
| Company | Signal | What Changed | Implication for MediCodio |
|---------|--------|--------------|--------------------------|
| CodaMetrix | 🔴/🟡/⚪ | [change or "First run — baseline"] | [implication or "—"] |
[all 9 rows]

## Company Profiles

### 1. CodaMetrix (CMX)
**Sources:** [list all URLs and search queries used]

#### Positioning
[findings]

#### Technical Differentiation
[findings]

#### Customer Intelligence
- Estimated customers: [number or "Not found publicly"]
- Named customers: [list or "Not found publicly"]
- Market segment: [enterprise/mid-market/SMB]
- Customer type: [hospitals/groups/payers/RCM]
- Specialty focus: [specialties]
- Geographic focus: [regions or "Not found publicly"]
- Sentiment summary: [themes or "No public reviews found"]
- Churn signals: [findings or "None detected"]

#### GTM Signals
[findings or "None detected"]

#### Content This Week
[list of recent content or "No new content detected"]

#### Hiring Signals
[open roles, seniority, direction or "No open roles found"]

#### Pricing Signals
[findings or "No public pricing"]

#### Funding & News
[findings or "No news this week"]

#### Executive Moves
[findings or "No changes detected"]

#### Product Releases
[findings or "No releases this week"]

#### Delta
Signal: 🔴/🟡/⚪
Changed: [what changed, or "First run — baseline established"]
Implication: [one line, or "—"]

---
[Repeat for all 9 competitors]
---

## Self-Monitor: MediCodio
### Web Mentions This Week
### Competitor References to Us
### Customer Sentiment
### SEO Presence
### Press / Trade Mentions
```

---

## Step 4 — Save to SharePoint

```
sharepoint_write_file path="CMO/Competitive/weekly/{WEEK}-report.md" content="{full report}"
```

Get real webUrl:
```
sharepoint_get_file_info path="CMO/Competitive/weekly/{WEEK}-report.md"
```

Store `webUrl` as `REPORT_URL` — use in Teams and Paperclip issue. Never hardcode.

---

## Step 5 — Update config.md

Resolve CMO agent ID if not already in config:
```
GET $PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/agents
Headers: Authorization: Bearer $PAPERCLIP_API_KEY
```
Find agent with `name = "cmo"`. Store as `CMO_AGENT_ID`.
If not found: find agent with `name = "ceo"` as `CEO_AGENT_ID` for fallback.

```
sharepoint_write_file path="CMO/Competitive/config.md" content="# Competitive Intel Config

last_run_date: {TODAY}
last_run_type: weekly
last_report_path: CMO/Competitive/weekly/{WEEK}-report.md
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

## Step 6 — Post to Teams

```
teams_send_channel_message(
  teamId    = $TEAMS_MARKETING_TEAM_ID,
  channelId = $TEAMS_MARKETING_CHANNEL_ID,
  content   = "📊 **Competitive Intel — Week {WEEK}**

🔴 **High signal this week:**
{bullet per 🔴 item, or '• None this week'}

🟡 **Medium:**
{bullet per 🟡 item, or '• None'}

⚪ **No notable activity:** {comma list of ⚪ companies}

👁️ **MediCodio:** {N} web mentions, {N} reviews found

📁 [Full report]({REPORT_URL})"
)
```

If Teams fails: log in issue comment, continue.

---

## Step 7 — Create Paperclip Issue for CMO

```
POST $PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues
Headers: Authorization: Bearer $PAPERCLIP_API_KEY, X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
Content-Type: application/json

{
  "title": "Weekly Competitive Intel Ready — {WEEK}",
  "assigneeAgentId": "{CMO_AGENT_ID}",
  "priority": "medium",
  "status": "todo",
  "description": "## Weekly competitive intelligence report is ready\n\n**Week:** {WEEK}\n**Report:** [View in SharePoint]({REPORT_URL})\n\n### Top signals this week\n{top 3 delta bullets}\n\n**Action needed:** Review report and decide on positioning or campaign adjustments."
}
```

If CMO agent not found: use `CEO_AGENT_ID` as fallback.

---

## Step 8 — Mark own issue done

```
PATCH $PAPERCLIP_API_URL/api/issues/$PAPERCLIP_TASK_ID
Headers: Authorization: Bearer $PAPERCLIP_API_KEY, X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
Content-Type: application/json

{
  "status": "done",
  "comment": "Weekly sweep complete — {WEEK}.\n\n- Report: CMO/Competitive/weekly/{WEEK}-report.md\n- CMO issue created\n- Teams notified\n- Skipped (budget): {list or 'none'}"
}
```

---

## Error Handling

| Situation | Action |
|---|---|
| 409 on checkout | Stop. Do not proceed. |
| fetch returns empty | Retry with `browser_navigate` + `browser_snapshot` |
| DuckDuckGo returns no results | Try more specific query, log "limited data" in that section |
| Apify actor 404 | Skip, use DuckDuckGo fallback, note in report |
| Apify timeout `-32000` | `get-actor-output runId="<runId>"` to recover |
| SharePoint write fails | Retry once. If still fails: PATCH to `blocked` with reason, stop |
| Teams fails | Log in issue comment, continue |
| CMO agent not found | Assign to CEO as fallback |
| Budget at 80% | Skip remaining companies, write "Skipped — budget" in their sections, proceed to Steps 4–8 |
