# HR-Onboarding/config.md — SharePoint Config File

> **Instructions:** Upload this file to SharePoint at:
> `HR-Onboarding/config.md`
> on site: `https://medicodio.sharepoint.com/sites/MedicodioMarketing`
>
> The HR agent reads this file on startup as a fallback for env vars.

---

## Routine IDs

```
ONBOARDING_ROUTINE_ID: ddedecdb-871a-4ad1-980b-5935a2ecda75
```

---

## SharePoint Paths

```
SHAREPOINT_BASE_PATH: HR-Onboarding
AUDIT_LOG_PATH: HR-Onboarding/audit-log.csv
```

---

## Default HR Contact

```
DEFAULT_HR_NAME: HR Contact Name
DEFAULT_HR_EMAIL: hr@example.com
DEFAULT_HUMAN_IN_LOOP_EMAIL: hr-reviewer@example.com
PRIMARY_HUMAN_IN_LOOP_EMAIL: hr-reviewer@example.com
```

`PRIMARY_HUMAN_IN_LOOP_EMAIL` is the fallback inbox for orphan-email alerts emitted by `email-heartbeat.md` STEP 2.5b Case C (sweep found a message whose conversationId / sender matches no active case). Set to the same address as `DEFAULT_HUMAN_IN_LOOP_EMAIL` unless you have a dedicated triage mailbox.

---

## Monitored Mailboxes

```
MONITORED_MAILBOXES:
  - hr@example.com
```

The heartbeat (`email-heartbeat.md` STEP 2 + STEP 2.5) polls each mailbox in this list. Every onboarding case's `run_state.send_initial.inbox_used` MUST appear here, otherwise replies to that case go undetected. Add additional addresses if your org sends onboarding mail from more than one inbox (e.g. a dedicated HR-automation mailbox separate from the recruiter mailbox).

Do NOT hardcode mailbox addresses inside `email-heartbeat.md` or `send-initial.md`. Read this list at runtime.

---

## Nudge Timing (hours)

```
NUDGE_1_THRESHOLD_HOURS: 24
NUDGE_2_THRESHOLD_HOURS: 48
STALL_THRESHOLD_HOURS: 72
```

---

## Notes

- All values here are fallbacks. Env vars take precedence.
- Update `ONBOARDING_ROUTINE_ID` if the routine is redeployed.
- This file is read by the agent via `sharepoint_read_file path="HR-Onboarding/config.md"`.
