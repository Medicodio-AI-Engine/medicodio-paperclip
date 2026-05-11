# Publish — Post to medicodio.ai (Phase 6)

⛔ **HARD STOP RULE: This phase does ONE thing — publish to medicodio.ai + create [BLOG-AUDIT] child + close self. After Step 8, EXIT IMMEDIATELY. Do not close the parent. Do not send emails. Audit phase closes the parent.**

**BOUNDARY LINE 1:** Only publish after confirmed approval — check run-state.json status is "publish_queued".
**BOUNDARY LINE 2:** Portable Text conversion done via `scripts/md-to-portable-text.js` — do NOT attempt to construct PT blocks manually.
**BOUNDARY LINE 3:** Save publishResponseId from API response — required for audit log.
**STATE:** Reads run-state.json + draft.md. POSTs to /api/blog/push. Writes `publish` section. Creates `[BLOG-AUDIT]` child.

---

## Step 1 — Load state and validate

```
run_state_path = extract from issue description
parent_issue_id = extract from issue description

sharepoint_read_file path="{run_state_path}"
→ extract: topic, slug, primaryKeyword, runFolder, seoScore, wordCount, approverEmail, seoCheck.scorecard_path, phases.publish, schema_json

→ IF phases.publish == "done":
   post comment "Idempotency: publish already completed in prior run. Creating [BLOG-AUDIT] child and exiting."
   Go to Step 8.

→ IF status ≠ "publish_queued":
   post blocked "run-state.json status is '{status}', expected 'publish_queued'. Do not publish without approval."
   STOP.
```

## Step 2 — Read draft and extract frontmatter

```
sharepoint_read_file path="{runFolder}/draft.md"
→ store as draft_content
```

Parse frontmatter:
```
seoTitle = value of `seoTitle:` line (≤60 chars — if >60 chars, truncate at last word boundary)
seoDescription = value of `seoDescription:` line (≤160 chars — if >160 chars, truncate at last word boundary preserving full sentence where possible)
mainImage = value of `mainImage:` line (optional, set after Tier 3 ships) — name must match existing Sanity field `mainImage` on the medicodio.ai backend
```

Strip frontmatter (lines between `---` markers) from draft_content. Keep only the markdown body.

## Step 2.5 — Resolve schema_json placeholders

The skill produced `schema_json` with `{placeholder}` fields that depend on publish-time data. Resolve them now.

**Canonical URL shape (IMPORTANT — discovered from medicodio.ai backend audit 2026-05-11):**
The live site routes blog posts at `/resources/blog/<slug>`, NOT `/blog/<slug>`. The `/blog/*` namespace is a redirect stub. Always use `/resources/blog/<slug>` for canonical URLs sent to the publish API and embedded in schema.

```
canonical_url = "https://medicodio.ai/resources/blog/{slug}"
organization_name = "Medicodio"
organization_url  = "https://medicodio.ai"
logo_url          = "https://medicodio.ai/medicodio-logo.png"
image_url         = mainImage if present, else "https://medicodio.ai/og-default.png"
```

**Null safety:** if `schema_json` is missing from run-state (e.g., earlier phase skipped or crashed), set `schema_resolved = null` and skip the rest of Step 2.5. Server falls back to its own BlogPosting generation. Do NOT block — schema is optional.

Parse `schema_json` (string → object). Replace placeholders defensively (each nested key may be absent on first run):

```
schema = JSON.parse(schema_json)
schema.url = canonical_url

schema.mainEntityOfPage = schema.mainEntityOfPage || { "@type": "WebPage" }
schema.mainEntityOfPage["@id"] = canonical_url

schema.image = schema.image || { "@type": "ImageObject" }
schema.image.url = image_url

schema.author = schema.author || { "@type": "Organization" }
schema.author.name = organization_name
schema.author.url = organization_url

schema.publisher = schema.publisher || { "@type": "Organization" }
schema.publisher.name = organization_name
schema.publisher.logo = schema.publisher.logo || { "@type": "ImageObject" }
schema.publisher.logo.url = logo_url
```

If any required field still contains `{placeholder}` after resolution, post warning comment but continue (do not block). Save resolved schema back to memory as `schema_resolved`.

Validate: `JSON.stringify(schema_resolved)` must produce valid JSON. If parse fails, set `schema_resolved = null`, post warning "Schema JSON-LD invalid after resolution: {error}. Publishing without pipeline schema; server fallback active." Continue — do not block.

## Step 3 — Convert markdown to Portable Text

Write the draft body to a temp file and run the converter.

**CRITICAL: Do NOT use `echo` or shell variable interpolation to write the file — draft content contains special characters that break shell quoting.**

Use the Write tool (or equivalent file-writing tool) to write the draft body to:
`/tmp/blog-draft-{PAPERCLIP_RUN_ID}.md`

Do not use bash heredoc or `echo` for this step.

```bash
# Run converter (script lives at agents/seo-content-writer/scripts/ from repo root)
node agents/seo-content-writer/scripts/md-to-portable-text.js /tmp/blog-draft-$PAPERCLIP_RUN_ID.md
# Output: JSON array of Portable Text blocks
```

Capture stdout as `blogcontent` (JSON array). If the script exits non-zero or outputs invalid JSON: post blocked "md-to-portable-text.js failed: {stderr}". STOP.

## Step 4 — POST to /api/blog/push

```
fetch POST https://medicodio.ai/api/blog/push
Headers:
  x-blog-secret: {BLOG_PUSH_SECRET}
  Content-Type: application/json
Body (omit any field whose value is null/undefined — server handles missing fields):
{
  "title": "{seoTitle}",
  "description": "{seoDescription}",
  "blogcontent": {blogcontent array},
  "schema": {schema_resolved},                  // OMIT if null — server falls back to generating BlogPosting
  "canonicalUrl": "{canonical_url}",
  "mainImage": "{image_url}",                   // in-post hero
  "featuredImage": "{social_card_url}",         // OG/Twitter override (Tier 3+; null until then — OMIT)
  "primaryKeyword": "{primaryKeyword}",
  "categoryIds": [{categoryIds from current Sanity workflow}]
}
→ IF response status ≠ 200/201: post blocked "Blog push failed: {status} {body}". STOP.
→ capture response body → publishResponse
→ extract publishResponseId (check response for id, _id, postId, or documentId field)
```

**Note on field compatibility (audit 2026-05-11):**
- `mainImage` matches the existing Sanity schema field on medicodio.ai backend — no aliasing needed.
- `schema` field: currently the server already injects `BlogPosting` JSON-LD generated from post data (Tier 6.1 partial). The pipeline-sent `schema` field (when Tier 6.1 finishes) will REPLACE the server-generated version, allowing the pipeline to control all fields including pre-resolved image, canonical, keywords. Until then, the server falls back to its own generation.
- `canonicalUrl`, `primaryKeyword` are new fields — server ignores unknown fields today. After Tier 6.1 ships, they drive `<link rel=canonical>` and `<meta name=keywords>` respectively.
- If schema needs to include multiple block types (e.g. BlogPosting + FAQPage), use `@graph` array:
  ```json
  { "@context": "https://schema.org", "@graph": [ {BlogPosting...}, {FAQPage...} ] }
  ```
  The skill currently generates a single BlogPosting object — multi-block extension lands when FAQ/HowTo schema is added in Tier 6.6 or in the [BLOG-IMAGES]/[BLOG-FAQ] phases later.

## Step 5 — Save portable-text.json

```
sharepoint_write_file
  path="{runFolder}/portable-text.json"
  content="{JSON.stringify(blogcontent)}"
```

## Step 6 — Write publish.md log

```
sharepoint_write_file
  path="{runFolder}/logs/publish.md"
  content:
---
# Publish Log — {topic}
**Published at:** {ISO now}
**Approver:** {approverEmail}
**API response:** {HTTP status}
**publishResponseId:** {id}
**Canonical URL:** {canonical_url}
**SEO score at publish:** {seoScore}/100
**GEO score at publish:** {geo_score}/100
**Content quality at publish:** {content_quality_score}/100
**Word count:** {wordCount}
**Title:** {seoTitle}
**Description:** {seoDescription}
**Main image (in-post hero):** {image_url}
**Featured image (social override):** {social_card_url or "none — using mainImage fallback"}
**Schema JSON-LD sent:** {true if schema_resolved was non-null in request body, else "false — server fallback active"}

## Schema JSON-LD (resolved)
```json
{schema_resolved}
```
---
```

## Step 7 — Update run-state.json

```
sharepoint_read_file path="{run_state_path}"
→ update:
  publishedAt = now ISO
  publishResponseId = "{id}"
  status = "published"
  "publish": {
    "status": "complete",
    "completed_at": "{ISO}",
    "publish_response_id": "{id}",
    "api_status": "{HTTP status}"
  },
  "phases.publish": "done"
sharepoint_write_file path="{run_state_path}" content="{updated JSON}"
```

## Step 8 — Create [BLOG-AUDIT] child and close

```
POST /api/companies/{PAPERCLIP_COMPANY_ID}/issues
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{
  "title": "[BLOG-AUDIT] {topic}",
  "description": "phase_file: routines/bi-weekly-blog-post/audit.md\nrun_state_path: {run_state_path}\nparent_issue_id: {parent_issue_id}",
  "assigneeAgentId": "{PAPERCLIP_AGENT_ID}",
  "parentId": "{parent_issue_id}",
  "status": "todo",
  "priority": "high"
}
```

```
PATCH /api/issues/{PAPERCLIP_TASK_ID}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done", "comment": "Published. Response ID: {publishResponseId}. [BLOG-AUDIT] created." }
```
