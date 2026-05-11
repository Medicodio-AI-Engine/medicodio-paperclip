# Alignment with engineer's Tier 6 implementation plan

**Date:** 2026-05-11
**Status:** Reviewed engineer plan, confirmed direction, resolved 5 open field-shape questions, added Tier 7 (blog tracker) column alignment.

---

## Overall verdict

Engineer plan is **green to ship**. Single working day to staging is realistic. No major contradictions with paperclip-side pipeline. Three direction reversals on prior briefs (noted inline) — these are improvements over what the earlier paperclip brief proposed.

The **biggest new win** is Tier 7 (blog tracker auto-export). This **eliminates the manual CSV upload** the paperclip pipeline was waiting on for internal link map bootstrapping. With Tier 7 syncing to SharePoint, seo-check.md Step 4c.1 reads a CSV that's always fresh — no manual content team work, no stale data.

---

## Field-shape answers (Q1-Q5 from engineer)

### Q1 — `schema` field: JSON object or stringified text?

**Answer: JSON object.** Sanity field type = `object` (with `options: { collapsible: true }` so the Sanity Studio UI doesn't drown editors in a giant JSON blob).

**Validation in push route:** lightweight — fail fast, don't pretend to be a schema validator.

```ts
if (body.schema) {
  if (typeof body.schema !== 'object' || Array.isArray(body.schema)) {
    return Response.json({ error: 'schema must be an object' }, { status: 400 });
  }
  if (body.schema['@context'] !== 'https://schema.org') {
    return Response.json({ error: 'schema @context must be https://schema.org' }, { status: 400 });
  }
  const validRoot =
    body.schema['@type'] === 'BlogPosting' ||
    Array.isArray(body.schema['@graph']);
  if (!validRoot) {
    return Response.json({
      error: 'schema must have @type=BlogPosting (single) or @graph (multi-block array)'
    }, { status: 400 });
  }
}
```

Pipeline guarantees valid `BlogPosting` JSON-LD via the `seo-content-analysis` skill Part 3. Multi-block `@graph` lands once FAQ schema is wired (later phase). No deeper validation needed.

### Q2 — `featuredImage`: new field or rename `mainImage`?

**REVERSAL of prior brief: keep both as separate fields.**

| Field | Purpose | Use |
|---|---|---|
| `mainImage` | In-post hero (existing) | Shown at top of blog post body. Existing posts have this. |
| `featuredImage` | Social card override (NEW) | Used for `og:image` + `twitter:image` + JSON-LD `image`. Falls back to `mainImage` if null. |

**Why both:** Marketing wants distinct treatment. The hero in-post can be a large editorial image; the social card needs a tighter, branded preview that performs at 1200x630. Forcing one image to do both jobs hurts both surfaces.

**Migration:** zero impact. `featuredImage` is nullable. Existing posts ship without it; OG falls back to `mainImage`. New posts (and Tier 3 image-gen runs) populate both.

**Paperclip side:** `publish.md` Step 4 API body now sends both fields when available:
```json
{
  "mainImage": "https://cdn.medicodio.ai/in-post-hero.jpg",
  "featuredImage": "https://cdn.medicodio.ai/social-card-1200x630.jpg"
}
```
Both are nullable.

### Q3 — `faq` array: include in this PR or defer?

**Defer to follow-up PR.** Pipeline does not generate structured FAQ data yet (Tier 2/3 work in paperclip). Shipping the Sanity field now would mean it sits empty for weeks.

**Two paths when FAQ ships:**

1. **Preferred — separate `faq` field on Sanity:** array of `{question, answer}`. Server generates FAQPage JSON-LD from it. Easier for the Sanity Studio editor to inspect/edit, easier for the blog renderer to display as an accordion.

2. **Fallback — `@graph` in `schema` field:** pipeline emits FAQPage block inside the `schema.@graph` array. Server passes through as-is, renders as one JSON-LD `<script>` tag. No Sanity Studio visibility — admins can't audit/edit FAQ without modifying the schema blob.

Recommend **Option 1** when FAQ ships. Wait on this until the paperclip pipeline produces structured FAQ output (Tier 2.2 writer phase, probably). I'll ping when ready.

### Q4 — Google Indexing API: gray area go/no-go?

**GO, behind a flag.** Engineer's instinct is correct.

- Google's official docs say `JobPosting` / `BroadcastEvent` only. In practice, Indexing API works for any URL and the major SEO operators (HubSpot, Webflow, Shopify) ping all content. No documented penalties. The downside is "Google could turn it off" — but Bing IndexNow covers that risk for us.
- Flag name: `GOOGLE_INDEXING_API_ENABLED=true` in Vercel env. Default off. Flip on after staging validation. Easy rollback.
- Monitor for 30 days post-launch. Watch GSC for manual actions, "request indexing" rate, organic traffic anomalies. Pull plug if anything looks off.
- If Google ever announces enforcement, kill switch already in place.

### Q5 — SharePoint sync: Microsoft Graph or manual?

**Microsoft Graph. Reuse existing Azure AD app reg.**

Paperclip already has `SHAREPOINT_CLIENT_ID`, `SHAREPOINT_CLIENT_SECRET`, `SHAREPOINT_TENANT_ID`, `SHAREPOINT_SITE_URL` in `.paperclip/.env`. Same Azure AD application can be granted Sites.ReadWrite.All for the MediCodioMarketing SharePoint site.

Steps:
1. In Azure Portal → Azure AD → App registrations → find the existing paperclip app
2. API permissions → Microsoft Graph → Sites.ReadWrite.All (application permission, admin consent required)
3. Same `tenant_id` + `client_id` + `client_secret` env vars used by the medicodio.ai backend
4. Use `@microsoft/microsoft-graph-client` package — auth via client credential flow

Or simpler if Azure cross-app sharing is awkward: medicodio.ai backend gets its own Azure AD app reg. Both apps point at the same SharePoint site.

**Upload destination:**
```
SEO-Content-Writer/data/published-posts.csv
```
This is the **exact path** seo-check.md Step 4c.1 reads. Direct overwrite each run. Single source of truth.

Optionally also upload `.xlsx` alongside for human consumption — paperclip pipeline only reads `.csv`. SEO writer can use Excel for manual filtering/sorting.

---

## Tier 7 — column alignment (this is the most important coordination item)

The paperclip pipeline (`seo-check.md` Step 4c) expects a CSV with specific columns. Engineer's tracker script should write **exactly these columns** so the pipeline can read it without translation.

### Required columns (v1, ship in this PR)

| Column | Type | Source | Purpose |
|---|---|---|---|
| `title` | string | Sanity post title | Display in scorecard logs |
| `url` | string | `${env.NEXT_PUBLIC_SITE_URL}/resources/blog/${slug}` | Direct link target for internal links |
| `slug` | string | Sanity slug.current | Map key |
| `primary_keyword` | string | Sanity `primaryKeyword` (after Tier 6.1 ships) — fallback to first keyword in `keywords[]` for old posts | Title-match resolution in Step 4c.2 |
| `categories` | string | Sanity categories joined with `, ` | Category-match resolution |
| `category_slugs` | string | Sanity category slugs joined with `, ` | Same as above, slug form |
| `summary` | string | Sanity `description` (or first 200 chars of body) | Summary fuzzy match resolution |
| `published_at` | ISO date | Sanity `publishedAt` or `_createdAt` | Sort/freshness signal |
| `word_count` | integer | computed from PT body | Decay detection |

### Optional columns (populated by paperclip pipeline, ship when available)

If `pushBlogDraft()` is later extended to accept these from the request body, the tracker can include them. Until then, leave blank/null.

| Column | Source | Status |
|---|---|---|
| `seo_score` | request body `seoScore` (paperclip pipeline `seo_check.overall_score`) | Pipeline sends in next iteration |
| `geo_score` | request body `geoScore` | Pipeline sends in next iteration |
| `content_quality_score` | request body `contentQualityScore` | Pipeline sends in next iteration |
| `ai_tone_score` | request body `aiToneScore` | Pipeline sends in next iteration |
| `forced_mentions_count` | request body `forcedMentionsCount` | Pipeline sends in next iteration |
| `internal_links_out` | request body `internalLinksInserted` | Pipeline sends in next iteration |
| `schema_present` | boolean — was `schema` field non-null in request? | Server computes at write time |
| `featured_image_set` | boolean — was `featuredImage` set? | Server computes |
| `faq_present` | boolean — was `faq` array set? | Server computes (when Q3 lands) |

### Future columns (populated by paperclip Tier 4 + Tier 5 routines later)

These will be backfilled by separate paperclip routines writing to SharePoint. Tracker script doesn't need to populate them today — just reserve the column names so the schema is stable.

| Column | Populated by | When |
|---|---|---|
| `ai_overviews_cited` | Tier 4.2 ai-mention-tracker | Week 5+ |
| `perplexity_cited` | Tier 4.2 | Week 5+ |
| `chatgpt_cited` | Tier 4.2 | Week 5+ |
| `gsc_impressions_7d` | Tier 5.3 weekly-gsc-pull | Week 7+ |
| `gsc_clicks_7d` | Tier 5.3 | Week 7+ |
| `gsc_avg_position` | Tier 5.3 | Week 7+ |
| `current_rank_primary` | Tier 5.1 daily-rank-tracker | Week 7+ |
| `backlinks_count` | Tier 4.1 backlink-prospector | Week 6+ |
| `last_refreshed_at` | Tier 5.4 BLOG-REFRESH | Week 7+ |

### CSV format spec (engineer's tracker script + paperclip reader must agree)

- UTF-8 encoding
- BOM optional — paperclip reader strips it
- First row = header (exact column names above, snake_case)
- Quote values containing commas, newlines, or double-quotes (RFC 4180)
- Empty/null values = empty string between commas (not `null` literal)
- Header column order does not matter — pipeline reads by name

### Sample row

```csv
title,url,slug,primary_keyword,categories,category_slugs,summary,published_at,word_count,seo_score,geo_score,content_quality_score,schema_present,featured_image_set,faq_present
"Payer-Specific Coding Rules with AI | MediCodio","https://medicodio.ai/resources/blog/payer-specific-coding","payer-specific-coding","payer-specific medical coding","AI Coding Accuracy","ai-coding-accuracy","How AI handles variability in payer coding rules across Medicare, Medicaid, and commercial insurers","2026-01-15T09:30:00Z",2450,,,,false,false,false
```

---

## Direction tweaks for engineer's plan

| Engineer plan item | My recommendation | Why |
|---|---|---|
| `llms.txt` Option A (static) vs Option B (dynamic) | **Option B** | AI crawlers (Perplexity, Claude, ChatGPT) use it as a navigation hint. Long-tail blog posts should be discoverable. Lazy-render the route handler, cache 1h. |
| `featuredImage` as override of `mainImage` | **Confirm both fields, both nullable** | Marketing distinction important. Migration zero impact. |
| FAQPage source | **Separate `faq` field, deferred to follow-up PR** | Cleaner. Pipeline doesn't generate FAQs yet. |
| Indexing API behind flag | **Confirm — `GOOGLE_INDEXING_API_ENABLED`** | Per Q4 answer. |
| Tracker columns | **Use spec above** | Aligns with paperclip seo-check.md Step 4c reader. |
| Tracker output destination | **SharePoint `SEO-Content-Writer/data/published-posts.csv`** | Direct match to paperclip read path. Bonus: `.xlsx` alongside for humans. |
| Auto-append on publish (follow-up PR) | **Pipeline sends extra fields (seo_score, geo_score, etc.) in API body** | Coordinated change — paperclip publish.md will be updated to send these once tracker module is ready. |

---

## What the paperclip side commits to

1. `publish.md` Step 4 will send `mainImage` AND `featuredImage` (both nullable) — DONE 2026-05-11.
2. `seo-check.md` Step 4c reads from `SEO-Content-Writer/data/published-posts.csv` — DONE 2026-05-11.
3. When engineer's auto-append-on-publish lands (follow-up PR), `publish.md` Step 4 body extends with `seoScore`, `geoScore`, `contentQualityScore`, `aiToneScore`, `forcedMentionsCount`, `internalLinksInserted` — additive, ship same time as the server change.
4. FAQ field — once paperclip writer phase generates structured FAQ output, will send via dedicated `faq: [{question, answer}]` field in publish API. Pipeline timing: Tier 2/3 (~weeks 3-5 from now).

---

## Rollout order — agree with engineer

1. **Bulk export script** (Tier 7 v1 — read-only, no risk). Ship to a SharePoint path TBD.
2. **Sanity schema additions** + push field plumbing (Tier 6.1 backend) — no rendering impact.
3. **Page injection + featuredImage override** (Tier 6.1 + Tier 6.5 deltas) — visible. Test on 1 staging post.
4. **Image sitemap** (Tier 6.4) — visible. Submit re-crawl in GSC.
5. **llms.txt route (Option B)** (Tier 6.3) — visible. Verify on Claude/Perplexity browse.
6. **Google Indexing API behind flag** (Tier 6.7) — staging on first, monitor 7 days, flip prod.
7. **Auto-append tracker on push** (Tier 7 v2, follow-up PR) — depends on step 2.
8. **FAQPage schema** (Tier 6.6) — deferred until paperclip produces structured FAQ output.

---

## Validation checklist (when PR hits staging)

Engineer + paperclip team jointly verify on a freshly published staging post:

- [ ] View source on `https://staging.medicodio.ai/resources/blog/<test-slug>` — `<script type="application/ld+json">` in `<head>` contains pipeline-sent BlogPosting fully resolved
- [ ] Google Rich Results Test on staging URL → passes BlogPosting + BreadcrumbList validation, zero errors
- [ ] LinkedIn Post Inspector → shows `featuredImage` (if set) not `mainImage`
- [ ] Twitter Card Validator → same
- [ ] Canonical link present and matches `canonicalUrl` from request body
- [ ] `<meta name=keywords content="<primaryKeyword>">` present
- [ ] `https://staging.medicodio.ai/sitemap.xml` includes `<image:image>` per blog URL
- [ ] `https://staging.medicodio.ai/llms.txt` lists recent blog posts (Option B)
- [ ] Google Indexing API call returns 200 (when flag enabled)
- [ ] Bulk tracker export script run → `published-posts.csv` lands on SharePoint at correct path
- [ ] Paperclip `[BLOG-ORCHESTRATOR]` test run → seo-check.md Step 4c reads the staging-sync'd CSV successfully (insert internal links from rich_index)
- [ ] Old posts (no `schema`, no `featuredImage`, no `canonicalUrl`) still render without errors

---

## Open coordination items remaining

| Item | Owner | When |
|---|---|---|
| Decide schema validation strictness in push route | engineer | Now — see Q1 |
| Provision Azure AD permissions for SharePoint sync | medicodio admin | Before tracker auto-sync ships |
| Provision Google Cloud service account for Indexing API | medicodio admin | Before flag flips |
| Define `summary` source for tracker — use Sanity `description` field, or first 200 chars of PT body? | engineer + paperclip | Pick before tracker script runs |
| Confirm column names snake_case (paperclip side expects) | engineer | Before tracker script ships |
| Provide staging test post — paperclip pipeline drives it via `[BLOG-ORCHESTRATOR]` | paperclip | After Tier 6 PR hits staging |

Send blockers, contradictions, or shape disagreements back. Pipeline is ready to consume whatever shape lands.
