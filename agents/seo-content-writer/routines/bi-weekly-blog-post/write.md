# Write — Blog Post Authoring (Phase 2)

**BOUNDARY LINE 1:** Write from run-state.json research findings only — do NOT re-search SERP here.
**BOUNDARY LINE 2:** Draft goes to draft.md in SharePoint run folder — nowhere else.
**BOUNDARY LINE 3:** Minimum 1800 words. Do not close this phase if wordCount < 1800.
**STATE:** Reads `research` section of run-state.json. Writes `write` section. Creates `[BLOG-SEO-CHECK]` child.
**DO NOT:** Run SEO scoring. Send emails. Publish.

---

## Step 1 — Load state

```
run_state_path = extract from issue description
parent_issue_id = extract from issue description

sharepoint_read_file path="{run_state_path}"
→ IF missing: post blocked "run-state.json not found at {run_state_path}." STOP.
→ extract: topic, primaryKeyword, contentBrief, research.must_include_sections,
  research.content_gaps, research.paa_questions, research.recommended_angle,
  runFolder, approverEmail, category
```

## Step 2 — Write the blog post

Write a complete blog post following this EXACT structure:

```markdown
---
seoTitle: {≤60 chars — contains primaryKeyword}
seoDescription: {≤160 chars — contains primaryKeyword + value prop}
publishedAt: {YYYY-MM-DDT00:00:00Z}
---

# {H1 containing primaryKeyword}
{Hook: 2-3 sentences. Pain point → promise. No fluff.}

## Table of Contents
- [What Is...](#what-is)
- [How It Works](#how-it-works)
- [Key Benefits](#key-benefits)
- [Real-World Use Case](#real-world)
- [How MediCodio AI Does This](#medicodio)
- [FAQ](#faq)
- [Key Takeaways](#takeaways)

## What Is {Topic} {H2 — ~200 words}
{Define the problem or concept clearly. Use research.recommended_angle.}

## How {Topic} Works {H2 — ~300 words}
{Explain mechanism. Use numbered steps if applicable. Cover research.must_include_sections.}

## Key Benefits {H2 — ~250 words}
{3-5 bullet points backed by cited stats. Use [Source](url) inline links. Cover research.content_gaps.}

## Real-World Use Case {H2 — ~300 words}
{Concrete scenario at a health system or physician group. Named (fictional) example.}

## How MediCodio AI Does This {H2 — ~200 words}
{Natural product mention. Focus on outcomes not features. Link: https://medicodio.ai/}

## FAQ {H2}
{3-5 questions from research.paa_questions. Answer each in 2-4 sentences.}

## Key Takeaways {H2}
- {Bullet 1 — contains primaryKeyword}
- {Bullet 2}
- {Bullet 3}
- {Bullet 4}
- {Bullet 5}

## Get Started with AI Medical Coding
{50 words. CTA. Link to https://medicodio.ai/}
```

Content rules:
- Include internal link to https://medicodio.ai/ in the MediCodio section
- Include 2-3 external authority links (CMS.gov, AHIMA, MGMA, peer-reviewed sources)
- Include primaryKeyword in: H1, first 100 words, at least one H2, last paragraph
- Target audience: RCM Director / HIM Director / CFO

## Step 3 — Count words and validate

Count words in the post body (exclude frontmatter). If wordCount < 1800: expand the two shortest sections until ≥1800.

## Step 4 — Save draft.md

```
sharepoint_write_file
  path="{runFolder}/draft.md"
  content="{full post with frontmatter}"
→ IF fails: retry once. If still fails: post blocked on self + parent. STOP.
```

## Step 5 — Write write.md log

```
sharepoint_write_file
  path="{runFolder}/logs/write.md"
  content:
---
# Write Log — {topic}
**Date:** {ISO now}
**Word count:** {N}
**Primary keyword:** {primaryKeyword}
**SEO title:** {seoTitle} ({len} chars)
**SEO description:** {seoDescription} ({len} chars)

## Sections Written
| H2 | ~Words |
|----|--------|
{one row per H2}

## Keyword Usage (self-check)
- H1: {yes/no}
- Intro: {yes/no}
- H2 count: {N}
- Body count: {N}
- Conclusion: {yes/no}

## Internal/External Links
- Internal: https://medicodio.ai/ ✓
- External: {url1}, {url2}, {url3}
---
```

## Step 6 — Write write section to run-state.json

```
sharepoint_read_file path="{run_state_path}"
→ append:
"write": {
  "status": "complete",
  "completed_at": "{ISO}",
  "word_count": N,
  "seo_title": "...",
  "seo_description": "...",
  "draft_path": "{runFolder}/draft.md"
},
"wordCount": N,
"phases.write": "done"
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
→ IF fails: retry once. If still fails: post blocked on self + parent. STOP.
```

## Step 7 — Create [BLOG-SEO-CHECK] child and close

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[BLOG-SEO-CHECK] {topic}",
  "description": "phase_file: routines/bi-weekly-blog-post/seo-check.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
```

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done", "comment": "Draft written. Word count: {N}. SEO title: {seoTitle}. [BLOG-SEO-CHECK] created." }
```
