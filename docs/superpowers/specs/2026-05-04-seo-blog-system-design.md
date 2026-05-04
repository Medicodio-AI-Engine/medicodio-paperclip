# SEO Blog System — Design Spec
**Date:** 2026-05-04
**Goal:** Rank #1 for "AI Medical Coding" across Google, Bing, and AI search engines via automated bi-weekly blog publishing to medicodio.ai.

---

## Overview

A dedicated Paperclip agent (`seo-content-writer`) runs every 15 days. The routine fires with a blog **topic/content brief in the issue description**. The agent researches SEO keywords for that topic, writes a 1800–2500 word post, scores it against the keyword cluster, sends it for human email review, iterates on feedback via email replies, then publishes to medicodio.ai.

A separate **email-monitor routine** (cron, every 6 hours) watches the inbox for replies to previously sent approval emails. When a reply arrives, it creates the appropriate sub-issue (`[BLOG-REVISE]` or `[BLOG-PUBLISH]`) under the parent issue to continue the pipeline.

Everything is structured as an **orchestrator + sub-issues** pattern — identical to `marketing-specialist/` with `event-outreach`.

---

## Agent Structure

**Location:** `agents/seo-content-writer/`

Mirrors `agents/marketing-specialist/` exactly:

```
agents/seo-content-writer/
├── AGENTS.md                              ← agent identity + general rules
├── mcp.json                               ← MCP server config
└── routines/
    ├── bi-weekly-blog-post.md             ← orchestrator routine (15-day cron)
    ├── email-monitor.md                   ← reply-check routine (6-hour cron)
    └── phases/
        ├── research.md                    ← [BLOG-RESEARCH] phase
        ├── write.md                       ← [BLOG-WRITE] phase
        ├── seo-check.md                   ← [BLOG-SEO-CHECK] phase
        ├── email.md                       ← [BLOG-EMAIL] phase
        ├── revise.md                      ← [BLOG-REVISE] phase (on change request)
        ├── publish.md                     ← [BLOG-PUBLISH] phase (on approval)
        └── audit.md                       ← [BLOG-AUDIT] phase (final)
```

**Phase routing — MANDATORY:** When assigned any `[BLOG-*]` issue, read the mapped phase file first:

| Title prefix | Read this file |
|---|---|
| `[BLOG-ORCHESTRATOR]` | `routines/bi-weekly-blog-post.md` |
| `[BLOG-RESEARCH]` | `routines/phases/research.md` |
| `[BLOG-WRITE]` | `routines/phases/write.md` |
| `[BLOG-SEO-CHECK]` | `routines/phases/seo-check.md` |
| `[BLOG-EMAIL]` | `routines/phases/email.md` |
| `[BLOG-REVISE]` | `routines/phases/revise.md` |
| `[BLOG-PUBLISH]` | `routines/phases/publish.md` |
| `[BLOG-AUDIT]` | `routines/phases/audit.md` |

---

## MCP Servers

| Server | Purpose |
|--------|---------|
| sharepoint | Primary file system — all drafts, logs, state |
| outlook | Send approval emails, monitor replies |
| duckduckgo | SERP research, keyword discovery |
| fetch | Fetch top-ranking competitor pages |
| playwright | Fallback when fetch returns empty (JS-rendered pages) |
| teams | Wired in mcp.json, not used in current routines |

---

## Env Vars (injected by Paperclip)

```
SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET
SHAREPOINT_SITE_URL
OUTLOOK_TENANT_ID, OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET
OUTLOOK_MAILBOX=karthik.r@medicodio.ai
BLOG_PUSH_SECRET               ← value: secretmarketingblogtoken (store in Paperclip secrets)
TEAMS_MARKETING_TEAM_ID
TEAMS_MARKETING_CHANNEL_ID
PAPERCLIP_AGENT_ID, PAPERCLIP_COMPANY_ID, PAPERCLIP_RUN_ID, PAPERCLIP_TASK_ID
```

---

## SharePoint Structure

**Site:** `https://medicodio.sharepoint.com/sites/MedicodioMarketing`

**config.md tracks:**
- keyword cluster (canonical list)
- posted topics log (to avoid duplicates)
- `activeRunFolder` — path to current in-progress run folder. Set by `[BLOG-ORCHESTRATOR]`, cleared by `[BLOG-AUDIT]`. Email monitor reads this to locate `run-state.json` without scanning all run folders.

```
SEO-Content-Writer/
├── config.md                              ← keyword cluster, posted log, activeRunFolder
└── agents/
    └── seo-blogs/
        └── runs/
            └── {YYYY-MM-DD}-{slug}/
                ├── run-state.json         ← shared state across all phases
                ├── draft.md               ← raw markdown post (updated in place by revise/seo-check)
                ├── portable-text.json     ← PT payload written at publish time
                └── logs/
                    ├── research.md
                    ├── write.md
                    ├── seo-check.md
                    ├── email.md
                    ├── revise-{n}.md      ← one per revision cycle
                    ├── publish.md
                    └── audit.md
```

### run-state.json schema

```json
{
  "runDate": "2026-05-04",
  "slug": "ai-medical-coding-guide",
  "topic": "What Is AI Medical Coding: The Complete 2026 Guide",
  "contentBrief": "...",
  "primaryKeyword": "AI medical coding",
  "targetPersona": "RCM Director",
  "category": "medical_coding",
  "approverEmail": "Jessica.Miller@medicodio.ai",
  "status": "awaiting_reply",
  "conversationId": "AAQkADFh...",
  "messageId": "AAMkADFh...",
  "lastCheckedAt": "2026-05-04T12:00:00Z",
  "revisionCount": 0,
  "maxRevisions": 3,
  "seoScore": 78,
  "wordCount": 2143,
  "publishedAt": null,
  "publishResponseId": null,
  "parentIssueId": "...",
  "phases": {
    "research": "done",
    "write": "done",
    "seo_check": "done",
    "email": "done",
    "publish": "pending",
    "audit": "pending"
  }
}
```

---

## Keyword Cluster

Canonical list lives in `SEO-Content-Writer/config.md`. Agent reads this before every SEO check.

### Primary
- AI medical coding
- AI medical billing
- automated medical coding
- medical coding automation
- AI powered medical coding

### Secondary
- computer-assisted coding, autonomous medical coding, NLP medical coding
- machine learning medical coding, AI ICD-10 coding, CPT code automation
- AI revenue cycle management

### Long-tail
- AI medical coding software 2026, how does AI medical coding work
- best AI medical coding software, AI medical coding accuracy
- AI vs human medical coders, ICD-10 automation artificial intelligence
- AI medical coding ROI, HIPAA compliant AI coding
- AI coding for emergency department, autonomous coding denial reduction

---

## Orchestrator Routine — `bi-weekly-blog-post`

**Trigger:** Every 15 days (`0 0 */15 * *`)
**Concurrency:** `skip_if_active`
**Catch-up:** `skip_missed`

**Topic comes from the issue description.** When the routine fires, the issue description contains the blog topic brief (title, angle, any specific talking points). The orchestrator reads this and bootstraps the run.

```
1. GET /api/agents/me → get IDs
2. GET /api/agents/me/inbox-lite → find routine execution issue
3. POST /api/issues/{issueId}/checkout
4. Read issue description → extract topic, title, content brief
5. sharepoint_read_file "SEO-Content-Writer/config.md"
   → check posted log — if this topic already posted, comment + set done, STOP
   → load keyword cluster
6. Derive slug from title (lowercase, hyphen-separated)
7. Create run folder path: SEO-Content-Writer/agents/seo-blogs/runs/{YYYY-MM-DD}-{slug}
8. sharepoint_write_file run-state.json with initial values
9. Update config.md: set activeRunFolder = "{run folder path}"
10. Create child issue [BLOG-RESEARCH]:
    POST /api/companies/{companyId}/issues
    {
      "title": "[BLOG-RESEARCH] {topic}",
      "parentId": "{parentIssueId}",
      "assigneeAgentId": "{my-agent-id}",
      "status": "todo",
      "description": "Run folder: {path}\nPrimary keyword: {kw}\nContent brief: {brief}"
    }
11. PATCH parent issue → in_progress, comment with run folder path + child issue link
```

---

## Pipeline — Phase Flow

```
[BLOG-ORCHESTRATOR] (routine execution issue)
        │  creates child:
        ▼
[BLOG-RESEARCH]
  - SERP: duckduckgo top 10 for primary KW + 3 related queries
  - fetch top 3 competitor pages, extract headings + word counts + gaps
  - identify People Also Ask questions to target
  - write research.md log
  - update run-state.json phases.research = "done"
  - create [BLOG-WRITE] child, close self
        │
        ▼
[BLOG-WRITE]
  - write 1800-2500 word post from research findings
  - follow required post structure (H1→H2→H3, TOC, FAQ, CTA)
  - include internal link to https://medicodio.ai/
  - include 2-3 credible external authority citations
  - save draft.md to SharePoint run folder
  - write write.md log (word count, sections, keywords used)
  - create [BLOG-SEO-CHECK] child, close self
        │
        ▼
[BLOG-SEO-CHECK]
  - load keyword cluster from config.md
  - scan draft.md: score each keyword 1-10
    (presence, density, H1/H2 placement, intro/conclusion coverage)
  - compute overall score /100
  - auto-fix keywords scoring <5: rewrite that section in draft.md
  - if overall score <70: rewrite weakest 2 sections, recompute
  - save updated draft.md back to SharePoint
  - save seo-check.md scorecard
  - update run-state.json seoScore, wordCount
  - create [BLOG-EMAIL] child, close self
        │
        ▼
[BLOG-EMAIL]
  - determine category from run-state.json → route to approver
  - send from karthik.r@medicodio.ai, CC naveen@medicodio.ai
  - email body: title, target keyword, SEO scorecard table, SharePoint draft link
  - store conversationId + messageId + lastCheckedAt in run-state.json
  - set run-state.json status = "awaiting_reply"
  - update config.md activeRunFolder (already set, confirm it's correct)
  - set parent issue → in_review
  - PATCH self → done
  (pipeline pauses here — email-monitor takes over)
        │
        │ ← email-monitor cron fires every 6h
        │   reads config.md activeRunFolder → run-state.json
        │   outlook_list_messages filtered by conversationId + after lastCheckedAt
        │
        ├── reply = changes requested
        │       email-monitor creates [BLOG-REVISE] child under parent issue
        │               ▼
        │       [BLOG-REVISE]
        │         - read reply content from Outlook (full message body)
        │         - parse requested changes
        │         - apply changes to draft.md
        │         - re-run SEO check inline (abbreviated, not full child issue)
        │         - save updated draft.md
        │         - write revise-{n}.md log
        │         - increment run-state.json revisionCount
        │         - if revisionCount >= maxRevisions (3):
        │             set parent → blocked
        │             email karthik.r@medicodio.ai with revision history
        │             PATCH self → done, STOP
        │         - reply to same Outlook thread with updated draft link + new SEO score
        │         - set run-state.json status = "awaiting_reply"
        │         - update lastCheckedAt
        │         - PATCH self → done (pipeline pauses again for email-monitor)
        │
        └── reply = approved
                email-monitor creates [BLOG-PUBLISH] child under parent issue
                        ▼
                [BLOG-PUBLISH]
                  - read draft.md from SharePoint run folder
                  - run: node scripts/md-to-portable-text.js → portable-text.json
                  - POST to https://medicodio.ai/api/blog/push
                    headers: x-blog-secret: $BLOG_PUSH_SECRET
                    body: { title, description, blogcontent }
                  - save publishResponseId from response to run-state.json
                  - set run-state.json status = "published", publishedAt = now
                  - write publish.md log
                  - create [BLOG-AUDIT] child, close self
                        │
                        ▼
                [BLOG-AUDIT]
                  - write audit.md: topic, keyword, SEO score, word count,
                    revision count, approver, publish time, publishResponseId
                  - update config.md: mark topic as posted, clear activeRunFolder
                  - PATCH parent issue → done with final summary comment
                  - PATCH self → done
```

---

## Email Monitor Routine — `email-monitor`

**Trigger:** Every 6 hours (`0 */6 * * *`)
**Concurrency:** `skip_if_active`
**Purpose:** Watch for email replies to approval emails sent by `[BLOG-EMAIL]`. Create the next sub-issue under the parent to continue the pipeline.

```
1. GET /api/agents/me → get IDs
2. GET /api/agents/me/inbox-lite → find routine execution issue
3. POST checkout
4. sharepoint_read_file "SEO-Content-Writer/config.md"
   → read activeRunFolder
   → if empty: PATCH issue → done, exit (no active run)
5. sharepoint_read_file "{activeRunFolder}/run-state.json"
   → if status ≠ "awaiting_reply": PATCH issue → done, exit
6. outlook_list_messages
   → filter: conversationId = run-state.json.conversationId
   → filter: receivedDateTime > run-state.json.lastCheckedAt
7. Update run-state.json lastCheckedAt = now (always, even if no reply)
8. If no new messages: PATCH issue → done, exit
9. Read each new reply: outlook_read_email messageId="{id}"
10. Skip if: out-of-office, auto-reply, no substantive body, ambiguous single word
11. Classify reply:
    APPROVED if body contains any of:
      "approved", "looks good", "go ahead", "publish it", "send it",
      "LGTM", "good to go", "yes publish", "publish", "approved ✓"
    CHANGES if: any substantive text that is not an approval signal
12. If APPROVED:
    - Create [BLOG-PUBLISH] child under parentIssueId
    - Set run-state.json status = "publish_queued"
    - PATCH email-monitor issue → done
13. If CHANGES:
    - Create [BLOG-REVISE] child under parentIssueId with reply messageId in description
    - Set run-state.json status = "revision_queued"
    - PATCH email-monitor issue → done
```

---

## Email Routing

**From:** `karthik.r@medicodio.ai`
**CC always:** `naveen@medicodio.ai`

| Category | Route to | Trigger keywords |
|----------|---------|-----------------|
| `medical_coding` | `Jessica.Miller@medicodio.ai` | medical coding, ICD-10, CPT, coding accuracy, autonomous coding, computer-assisted coding, HIM, denial reduction |
| `services` / other | `McGurk.Amanda@medicodio.ai` | RCM, billing, revenue cycle, AI services, general medicodio |

Category is set from the topic queue / issue description in `[BLOG-ORCHESTRATOR]`. Re-evaluated in `[BLOG-REVISE]` if topic shifts.

---

## Blog Post Structure

Every post must follow this structure exactly:

```markdown
---
seoTitle:        ← ≤60 chars, contains primary keyword
seoDescription:  ← ≤160 chars, contains primary keyword + value prop
publishedAt:     ← ISO date
---

# [H1 — contains primary keyword]
[Hook: 2-3 sentences. Pain point → promise. No fluff.]

## Table of Contents

## [H2: What Is / The Problem]        ~200 words
## [H2: How It Works / The Solution]  ~300 words
## [H2: Key Benefits / Data]          ~250 words (3-5 stats, cited with links)
## [H2: Real-World Use Case]          ~300 words (health system / physician group scenario)
## [H2: How MediCodio AI Does This]   ~200 words (natural product mention, not salesy)
## [H2: FAQ]                          3-5 questions (targets PAA + featured snippets)
## [H2: Key Takeaways]                5 bullets, scannable, contains primary KW
## Get Started with AI Medical Coding ← CTA, links to https://medicodio.ai/
```

---

## SEO Scorecard Format

Saved to `seo-check.md`, included verbatim in approval email:

```markdown
## SEO Scorecard — {post title}

| Keyword                    | Score | Notes                          |
|----------------------------|-------|--------------------------------|
| AI medical coding          |  9/10 | H1, intro, 4x body, conclusion |
| automated medical coding   |  7/10 | H2, 2x body                    |
| CPT code automation        |  4/10 | ⚠️ 1x body only — needs H2    |

**Overall SEO Score: 76/100**
**Status: PASS** (threshold: 70/100)

### Auto-fixed keywords:
- Rewrote "How It Works" H2 to include "CPT code automation" in subheading
```

---

## Helper Script — `scripts/md-to-portable-text.js`

Converts markdown to Sanity Portable Text. Matches the n8n converter logic exactly:
- Headings → `style: h1–h6`
- Unordered/ordered lists → `listItem: bullet/number`, nested level detection
- Blockquotes → `style: blockquote`
- Inline marks: bold (`**`), italic (`*`), bold+italic (`***`), strikethrough (`~~`), code (`` ` ``), links `[text](url)`, bare URLs
- Paragraphs → `style: normal`, consecutive lines merged

```bash
node scripts/md-to-portable-text.js path/to/draft.md
# outputs JSON array to stdout
```

POST payload to `/api/blog/push`:
```json
{
  "title": "...",
  "description": "...",
  "blogcontent": [ /* portable text array */ ]
}
```

---

## Publish Endpoint

```
POST https://medicodio.ai/api/blog/push
x-blog-secret: ${BLOG_PUSH_SECRET}
Content-Type: application/json
```

Slug is **auto-derived server-side** from title — do not send in payload.

---

## Revision Safety

- Max 3 revision cycles (`maxRevisions: 3`)
- On 4th change request: set parent → `blocked`, email `karthik.r@medicodio.ai` with full revision history (all `revise-{n}.md` contents)
- Reviewer can reset by replying `"start over"` → email-monitor creates `[BLOG-WRITE]` child (skips research, uses existing research.md), resets revisionCount to 0

---

## Files to Create

| File | Purpose |
|------|---------|
| `agents/seo-content-writer/AGENTS.md` | Agent identity, SharePoint rules, phase routing table, email/env rules |
| `agents/seo-content-writer/mcp.json` | MCP server config (sharepoint, outlook, duckduckgo, fetch, playwright, teams) |
| `agents/seo-content-writer/routines/bi-weekly-blog-post.md` | Orchestrator routine — reads issue description, bootstraps run, creates [BLOG-RESEARCH] |
| `agents/seo-content-writer/routines/email-monitor.md` | 6-hour cron — checks inbox replies, creates [BLOG-REVISE] or [BLOG-PUBLISH] |
| `agents/seo-content-writer/routines/phases/research.md` | SERP research phase |
| `agents/seo-content-writer/routines/phases/write.md` | Blog writing phase |
| `agents/seo-content-writer/routines/phases/seo-check.md` | Keyword scoring + auto-fix phase |
| `agents/seo-content-writer/routines/phases/email.md` | Approval email phase |
| `agents/seo-content-writer/routines/phases/revise.md` | Revision phase (on change request) |
| `agents/seo-content-writer/routines/phases/publish.md` | Publish to /api/blog/push phase |
| `agents/seo-content-writer/routines/phases/audit.md` | Final audit log + close parent phase |
| `scripts/md-to-portable-text.js` | Markdown → Portable Text converter |

---

## Open Items (verify before first run)

- [ ] Confirm `OUTLOOK_MAILBOX=karthik.r@medicodio.ai` works with existing Outlook MCP tenant credentials
- [ ] Add `BLOG_PUSH_SECRET` to Paperclip agent env secrets
- [ ] Verify `/api/blog/push` response shape to confirm what field to save as `publishResponseId`
- [ ] Register `seo-content-writer` agent in Paperclip UI
- [ ] Set `bi-weekly-blog-post` routine schedule: `0 0 */15 * *`
- [ ] Set `email-monitor` routine schedule: `0 */6 * * *`
