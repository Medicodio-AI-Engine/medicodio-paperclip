# Marketing Specialist — Routines

## Registered Routines

| Routine | Schedule | File |
|---------|----------|------|
| Event Outreach | Manual (per event) | [event-outreach.md](event-outreach.md) |

---

## Setup: Register a routine in Paperclip

Run once as board operator after the marketing-specialist agent exists in your company.

### Step 1 — Get required IDs

```bash
# List agents → get marketing-specialist agent ID
pnpm paperclipai agent list

# List projects → get project ID to assign routine to
pnpm paperclipai company list
```

Or via API:
```bash
curl http://localhost:3100/api/companies/{companyId}/agents \
  -H "Authorization: Bearer {token}"
```

### Step 2 — Create the routine

```bash
curl -X POST http://localhost:3100/api/companies/{companyId}/routines \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "title": "{Routine Title}",
    "description": "Read agents/marketing-specialist/routines/{routine-file}.md and follow every step.",
    "assigneeAgentId": "{marketingSpecialistAgentId}",
    "projectId": "{projectId}",
    "priority": "medium",
    "status": "active",
    "concurrencyPolicy": "skip_if_active",
    "catchUpPolicy": "skip_missed"
  }'
```

Save the returned `routineId`.

### Step 3 — Add schedule trigger

Cron expression in UTC. IST → UTC: subtract 5h 30m.

```bash
curl -X POST http://localhost:3100/api/routines/{routineId}/triggers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "kind": "schedule",
    "cronExpression": "30 17 * * *",
    "timezone": "UTC",
    "label": "{schedule label}"
  }'
```

### Step 4 — Test with manual run

```bash
curl -X POST http://localhost:3100/api/routines/{routineId}/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{"source": "manual", "idempotencyKey": "test-run-001"}'
```

---

## Modifying the schedule

```bash
curl -X PATCH http://localhost:3100/api/routine-triggers/{triggerId} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{"cronExpression": "30 3 * * *"}'
```

IST to UTC: subtract 5 hours 30 minutes.

## Pausing / resuming

```bash
# Pause
curl -X PATCH http://localhost:3100/api/routines/{routineId} \
  -d '{"status": "paused"}'

# Resume
curl -X PATCH http://localhost:3100/api/routines/{routineId} \
  -d '{"status": "active"}'

# Archive (retire permanently)
curl -X PATCH http://localhost:3100/api/routines/{routineId} \
  -d '{"status": "archived"}'
```
