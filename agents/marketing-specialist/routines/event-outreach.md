# Event Outreach — Orchestrator

**Trigger:** Manual — create a Paperclip issue with `event_slug: {slug}` in the description.
**Concurrency:** `skip_if_active` — one event run at a time.
**Role:** Bootstrap pipeline only. Read config, write run-state.json, create first child issue. EXIT.
**DO NOT:** Execute any phase logic. Do not run Hunter, send emails, or read Excel here.

---

## Phase Routing (child issues)

When assigned an issue whose title starts with one of these prefixes, read the mapped file FIRST before any other action:

| Title prefix | Phase file |
|---|---|
| `[EO-ORCHESTRATOR]` | `routines/event-outreach.md` (this file) |
| `[EO-PRE-CHECK-A]` | `routines/event-outreach/pre-check-a.md` |
| `[EO-PRE-CHECK-B]` | `routines/event-outreach/pre-check-b.md` |
| `[EO-BATCH-LOADER]` | `routines/event-outreach/batch-loader.md` |
| `[EO-ENRICHER]` | `routines/event-outreach/enricher.md` |
| `[EO-SENDER]` | `routines/event-outreach/sender.md` |
| `[EO-AUDITOR]` | `routines/event-outreach/auditor.md` |

**If your current issue title starts with any `[EO-*]` prefix other than `[EO-ORCHESTRATOR]`:**
Read the mapped phase file immediately. Follow only that file. Do not read this file further.

---

## Orchestrator Steps (parent issue only)

### Step 1 — Read event_slug

Scan issue description for a line starting with `event_slug:` — extract the slug value.
If not found: post blocked comment `"event_slug missing from issue description. Add: event_slug: asca-samba-2026"`. STOP.

### Step 2 — Read and validate config

```
sharepoint_read_file
  path="Marketing-Specialist/event-outreach/{event_slug}/config.md"
→ IF file missing: post blocked "config.md not found at
  Marketing-Specialist/event-outreach/{event_slug}/config.md". STOP.
```

Parse all `key: value` pairs. Required keys — if any missing, post blocked comment listing them and STOP:

```
event_name, event_slug, event_dates, event_location, booth_number,
event_website, attendee_file, attendee_sheet, batch_size, min_send_pct, send_mode,
outlook_user, review_email, email_subject, email_body_file
```

### Step 3 — Write initial run-state.json

```
run_id      = "{event_slug}-{YYYY-MM-DDTHH:MM:SSZ}"
run_id_safe = run_id with T→- and :→- (e.g. asca-samba-2026-2026-05-03-10-05-00)
run_state_path = "Marketing-Specialist/event-outreach/{event_slug}/run-state-{run_id_safe}.json"

sharepoint_write_file path="{run_state_path}" content:
{
  "schema_version": 1,
  "event_slug": "{event_slug}",
  "parent_issue_id": "{PAPERCLIP_TASK_ID}",
  "run_id": "{run_id}",
  "run_id_safe": "{run_id_safe}",
  "run_state_path": "{run_state_path}",
  "pipeline_status": "running",
  "created_at": "{ISO now}",
  "config": {
    "event_name": "...",
    "event_slug": "...",
    "event_dates": "...",
    "event_location": "...",
    "booth_number": "...",
    "event_website": "...",
    "attendee_file": "...",
    "attendee_sheet": "...",
    "batch_size": N,
    "min_send_pct": N,
    "send_mode": "...",
    "outlook_user": "...",
    "review_email": "...",
    "email_subject": "...",
    "email_body_file": "..."
  },
  "phases_complete": [],
  "current_phase": "pre_check_a",
  "last_updated": "{ISO now}"
}
```

IF write fails: post blocked comment `"Cannot write run-state.json to {run_state_path}. Check SharePoint permissions."`. STOP.

### Step 4 — Post config loaded comment

```
POST /api/issues/{PAPERCLIP_TASK_ID}/comments
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "body": "Config loaded. Event: {event_name} | File: {attendee_file} | Batch: {batch_size} | Mode: {send_mode}\nPipeline bootstrapping — creating pre-check child issue now."
}
```

Teams notification (non-blocking):
```
teams_send_channel_message
  teamId=$TEAMS_MARKETING_TEAM_ID channelId=$TEAMS_MARKETING_CHANNEL_ID
  content: "🟢 Event Outreach Started — {event_name} | {event_dates} | {event_location} | Batch: {batch_size} | Mode: {send_mode}"
IF fails → add "⚠️ Teams notification failed: {error}" to comment and continue.
```

### Step 5 — Create first child issue and exit

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[EO-PRE-CHECK-A] Event Outreach — Pre-Check A — {event_slug}",
  "description": "phase_file: routines/event-outreach/pre-check-a.md\nrun_state_path: {run_state_path}\nparent_issue_id: {PAPERCLIP_TASK_ID}\nevent_slug: {event_slug}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{PAPERCLIP_TASK_ID}",
  "status": "todo",
  "priority": "high"
}
→ IF creation fails: retry once. If still fails: post blocked "Failed to create first child issue: {error}". STOP.
→ store returned issue ID as pre_check_a_issue_id
```

**Do not execute any further phase logic.** The pipeline continues in subsequent heartbeats via child issues.

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "comment": "Pipeline bootstrapped. Pre-Check A child: {pre_check_a_issue_id}. Awaiting phase completions."
}
```

Exit heartbeat. ✓

---

## Canonical Field Inference Rules (used by batch-loader on first run)

For building column-map.md when headers are auto-detected:

| Canonical field | Match any of these (case-insensitive, partial ok) |
|---|---|
| `first_name` | first name, firstname, fname, given name, first |
| `last_name` | last name, lastname, lname, surname, family name, last |
| `email` | email, e-mail, email address, work email, contact email |
| `company` | company, organization, organisation, org_name, institution, facility, practice, hospital, center, clinic |
| `domain` | domain, website, url, web, site |
| `title` | title, job title, jobtitle, position, role, designation |
| `prior_delivery_status` | email_delivery_status, delivery_status, mail_delivery_status, send_status |
| `name_prefix` | prefix, salutation, honorific, mr, dr |
| `middle_name` | middle name, middlename, middle initial |

Required: `first_name`, `last_name`, `company`. Optional: all others.

---

## Error Handling Reference

| Situation | Action |
|---|---|
| `config.md` missing | Block parent issue, STOP |
| Required config key missing | Block parent issue listing keys, STOP |
| `run-state.json` write fails | Block parent issue, STOP |
| First child issue creation fails | Block parent issue with API error, STOP |
| Any phase's run-state write fails | That phase blocks itself + parent, does not create next child |
| Any phase's child creation fails | That phase blocks itself, human re-creates next child manually |
| `run-state.json` missing at phase start | That phase blocks itself with explicit path message |
