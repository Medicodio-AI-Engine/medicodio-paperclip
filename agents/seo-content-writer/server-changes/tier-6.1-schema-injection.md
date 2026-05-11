# Engineering Brief — Tier 6.1: Schema injection on /api/blog/push

**Status:** Ready to implement on medicodio.ai backend
**Blocks:** Tier 1.2 (agent-side complete — sends schema in API body; server currently ignores `schema`, `canonicalUrl`, `primaryKeyword` fields)
**Owner:** medicodio.ai backend engineering
**Estimated effort:** ~1 working day to staging (revised up from 0.5d — Sanity schema migration + Indexing API service-account provisioning eat extra time)
**Risk:** Low — additive change, no breaking modifications

---

## Audit findings (2026-05-11) — prior context

Engineer audit revealed most of Tier 6.x is already shipped. Updated delta below:

| Tier | Status | Notes |
|---|---|---|
| 6.1 — BlogPosting JSON-LD injection | **PARTIAL — server generates from post data today** | Need to switch to using pipeline-sent `schema` when present, fall back to existing server generation otherwise |
| 6.3 — `/llms.txt` | **NOT SHIPPED** | 30m–1h |
| 6.4 — Image sitemap `<image:image>` | **NOT SHIPPED** | 1–1.5h |
| 6.5 — OG/Twitter cards | **MOSTLY DONE** | ~30m to add `mainImage` override hookup |
| 6.6 — BreadcrumbList | **SHIPPED** | FAQPage conditional render still TODO (~30m) |
| 6.6 — HowTo schema | **NOT SHIPPED** | Defer until content has numbered-step patterns |
| 6.7 — Indexing API ping | **NOT SHIPPED** | 1–1.5h + needs `GOOGLE_INDEXING_SA_KEY` env in Vercel |

Bundle PR covering remaining items: ~1 working day.

---

## Stack (confirmed)

- Next.js 15.4.10 App Router + Turbopack
- React 19.1, TypeScript 5, Tailwind 4
- Sanity CMS: `sanity@4.2`, `next-sanity@10.0.6`, `@sanity/client@7.8`
- Vercel hosted, `@vercel/functions@3.5`, Upstash Redis ratelimit

## Path map (paperclip-side spec → actual medicodio.ai code)

| Spec path | Actual path |
|---|---|
| `app/blog/[slug]/page.tsx` | `src/app/resources/blog/[...index]/page.tsx` (catch-all) |
| `/blog/*` route | redirect stub at `src/app/blog/[...index]/page.tsx` |
| `/api/blog/push` route | (engineer to confirm) |
| Sanity post schema | `blogPosts.ts` (engineer-named) |
| Push helper | `pushBlogDraft()` in `blogApi.js` (engineer-named) |
| Metadata helper | `src/utils/metadata.ts` (`generateMetadata`) |

**CRITICAL URL SHAPE:** Blog canonical URLs use `/resources/blog/<slug>`, not `/blog/<slug>`. The agent pipeline has been updated 2026-05-11 to send canonicals as `https://medicodio.ai/resources/blog/<slug>`.

---

## Why

The seo-content-writer agent now generates a fully-resolved Schema.org `BlogPosting` JSON-LD block per post and sends it in the `/api/blog/push` request body as the `schema` field. The server currently ignores this field, so the structured data never reaches the rendered page. Google Rich Results, AI Overviews, and AI search engines rely heavily on JSON-LD for citation eligibility. Without server-side injection, the Tier 1 schema generation work is dead.

This is the single highest-leverage backend change to unlock structured data ranking signals.

---

## Current request body (after Tier 1.2 — agent side complete)

`POST https://medicodio.ai/api/blog/push`

Headers:
```
x-blog-secret: <BLOG_PUSH_SECRET>
Content-Type: application/json
```

Body:
```json
{
  "title": "...",
  "description": "...",
  "blogcontent": [/* Portable Text array */],
  "schema": {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": "...",
    "description": "...",
    "keywords": "...",
    "datePublished": "2026-05-11T...",
    "dateModified": "2026-05-11T...",
    "author": { "@type": "Organization", "name": "Medicodio", "url": "https://medicodio.ai" },
    "publisher": { "@type": "Organization", "name": "Medicodio", "logo": { "@type": "ImageObject", "url": "https://medicodio.ai/medicodio-logo.png" } },
    "url": "https://medicodio.ai/resources/blog/<slug>",
    "mainEntityOfPage": { "@type": "WebPage", "@id": "https://medicodio.ai/resources/blog/<slug>" },
    "image": { "@type": "ImageObject", "url": "..." }
  },
  "canonicalUrl": "https://medicodio.ai/resources/blog/<slug>",
  "mainImage": "<image url>",
  "primaryKeyword": "..."
}
```

**Field notes:**
- `schema`, `canonicalUrl`, `primaryKeyword` are NEW fields. Server should whitelist + persist them to Sanity.
- `mainImage` — uses the existing Sanity field name (aliased from prior `featuredImage` brief). No new field needed; just accept the value through `pushBlogDraft()`.
- `categoryIds` — existing — unchanged.
- When `schema` is present, server should use it INSTEAD of generating its own BlogPosting JSON-LD (this lets the pipeline control all fields including pre-resolved image + canonical). When `schema` is null/absent, fall back to existing server-side generation.

### Multi-block schema (`@graph`)

When the pipeline later sends multiple JSON-LD types (e.g. BlogPosting + FAQPage), it will use `@graph`:

```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "BlogPosting", ... },
    { "@type": "FAQPage", ... }
  ]
}
```

Server should output **one** `<script type="application/ld+json">` tag containing the whole `@graph` object. Do not split into multiple script tags.

---

## Required server changes

### 1. Accept and persist new fields

In `pushBlogDraft()` / `/api/blog/push` handler:

- Accept `schema` as a JSON object (or `null`). If object, validate `@context === 'https://schema.org'`. Accept either `@type === 'BlogPosting'` OR `@graph` array (multi-block — see Field Notes).
- Accept `canonicalUrl` as a string URL.
- Accept `primaryKeyword` as a string.
- `mainImage` — already supported. No change needed beyond ensuring `pushBlogDraft()` whitelists it explicitly (engineer noted only `title/blogcontent/description/categoryIds/mainImage` whitelisted today — confirm `mainImage` accepts a URL string, not just a Sanity image reference; if not, accept as URL and resolve to image asset).
- Persist new fields to the Sanity `blogPost` document.

### 2. Inject JSON-LD into rendered post `<head>`

In the blog post page template (the route that renders `/blog/[slug]`):

```html
<head>
  <!-- existing tags -->

  {schema && (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )}

  <!-- existing tags -->
</head>
```

The JSON-LD must be:
- Inside `<head>`, NOT `<body>`
- One `<script type="application/ld+json">` per post (do not duplicate)
- Stringified server-side (do not let React JSX-encode it; use `dangerouslySetInnerHTML` or equivalent raw injection)
- Escaped only for `</script>` sequences (use `JSON.stringify(schema).replace(/</g, '\\u003c')` as belt-and-suspenders)

### 3. Use `canonicalUrl` for canonical link tag

```html
<link rel="canonical" href={canonicalUrl} />
```

This prevents Google from picking the wrong URL variant.

### 4. Use `featuredImage` + `primaryKeyword` for OG/Twitter cards (overlaps with Tier 6.5)

If Tier 6.5 (OG/Twitter cards) is shipped in the same PR:

```html
<meta property="og:title" content={title} />
<meta property="og:description" content={description} />
<meta property="og:image" content={featuredImage} />
<meta property="og:url" content={canonicalUrl} />
<meta property="og:type" content="article" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content={title} />
<meta name="twitter:description" content={description} />
<meta name="twitter:image" content={featuredImage} />

<meta name="keywords" content={primaryKeyword} />
```

If `featuredImage` is empty/missing, fall back to a default OG image at `https://medicodio.ai/og-default.png`.

### 5. Backwards compatibility

- Existing posts that have no `schema` field stored → render without the JSON-LD script tag (do not block the page).
- Existing posts that have no `canonicalUrl` → fall back to `https://medicodio.ai/blog/<current slug>`.
- New posts MUST have `schema`. Old posts CAN have it after re-publish.

---

## Validation checklist

After deployment, verify on a freshly published post:

- [ ] View page source → confirm `<script type="application/ld+json">` present in `<head>` with full BlogPosting object.
- [ ] Run through https://search.google.com/test/rich-results → should report "BlogPosting" detected, zero errors.
- [ ] Run through https://validator.schema.org → no errors.
- [ ] Twitter Card Validator (https://cards-dev.twitter.com/validator) → correct preview (if Tier 6.5 in same PR).
- [ ] LinkedIn Post Inspector (https://www.linkedin.com/post-inspector/) → correct preview.
- [ ] OpenGraph debugger (https://www.opengraph.xyz/) → correct preview.
- [ ] `<link rel="canonical">` present and points to the public blog URL.
- [ ] Old posts (no schema) still render without errors.

---

## Rollout

1. Implement on a feature branch.
2. Deploy to staging.
3. Publish a test blog post from the seo-content-writer pipeline (will send `schema` in body).
4. Validate via the checklist above.
5. Re-run on 2-3 historical posts (manually trigger re-publish or run a migration that backfills `schema` from existing post data via `BlogPosting` template).
6. Merge to main.

---

## Related Tier 6 items in same area

Bundle into one PR if cheap:

- **Tier 6.3** — `/llms.txt` route. Auto-generate from sitemap. Lists all blog posts.
- **Tier 6.4** — `/sitemap.xml` includes `<image:image>` tags.
- **Tier 6.5** — OG/Twitter meta tags (already covered above as part of 6.1).
- **Tier 6.6** — Page-level schema beyond BlogPosting (BreadcrumbList always, FAQPage when FAQ section, HowTo when numbered steps).
- **Tier 6.7** — Indexing API ping on publish (Google Indexing API + Bing IndexNow).

All of these depend on the same `/blog/[slug]` template and `/api/blog/push` handler, so a single PR touching that surface is the most efficient delivery.

---

## Files likely touched (in medicodio.ai backend repo)

- `app/api/blog/push/route.ts` (or equivalent) — request validation, persistence
- `app/blog/[slug]/page.tsx` (or equivalent) — `<head>` rendering, JSON-LD script tag, canonical link, OG meta
- Sanity / DB schema — add `schema`, `canonicalUrl`, `featuredImage`, `primaryKeyword` fields to the blog post model
- Migration / backfill script — populate schema for historical posts

---

## Contact

For questions about the agent-side contract or what the agent sends, ping karthik.r@medicodio.ai or check `agents/seo-content-writer/routines/bi-weekly-blog-post/publish.md` Steps 2.5 and 4 in the paperclip repo.
