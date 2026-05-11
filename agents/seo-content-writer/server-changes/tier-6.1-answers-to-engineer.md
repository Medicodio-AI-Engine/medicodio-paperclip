# Answers to engineer questions — Tier 6.1

Reply block for the medicodio.ai backend engineer. User (Karthik) to relay. Each answer maps to engineer's numbered question.

---

## Answer 1 — Spec file location

The full spec is in the **paperclip** repo (not medicodio.ai-website repo) at:

```
agents/seo-content-writer/server-changes/tier-6.1-schema-injection.md
```

Copy-paste the contents into a comment on the PR or share the GitHub URL once paperclip is pushed. The spec is now also updated with audit findings (Stack confirmed, path map, URL shape correction) — re-pull before cutting code.

If you need it inline right now, ask Karthik for the markdown — it's ~150 lines.

---

## Answer 2 — `schema` field shape

**Single object today. Array (`@graph`) supported for forward-compat.**

Currently the pipeline generates a single `BlogPosting` JSON-LD object per post:

```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "...",
  ...
}
```

In future tiers (3 = images + FAQ; 5 = HowTo for numbered steps), the pipeline will send multiple block types using `@graph`:

```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "BlogPosting", ... },
    { "@type": "FAQPage", ... },
    { "@type": "HowTo", ... }
  ]
}
```

**Sanity schema recommendation:**
```ts
defineField({
  name: 'schema',
  type: 'object',     // or 'text' with JSON-stringified value if simpler
  title: 'JSON-LD schema (BlogPosting or @graph)',
  description: 'Pipeline-generated JSON-LD. If null, server falls back to generating BlogPosting from post fields.',
  options: { collapsible: true, collapsed: true }
})
```

If `object` type in Sanity is painful (Sanity doesn't love free-form JSON), use `text` and store as a JSON string. Render-side parses with `JSON.parse(post.schema)` and outputs one `<script type="application/ld+json">` tag.

**Validation at API:**
```ts
if (body.schema) {
  if (typeof body.schema !== 'object') return Response.json({ error: 'schema must be object' }, { status: 400 });
  if (body.schema['@context'] !== 'https://schema.org') return Response.json({ error: 'schema @context must be https://schema.org' }, { status: 400 });
  const hasValidType = body.schema['@type'] === 'BlogPosting' || Array.isArray(body.schema['@graph']);
  if (!hasValidType) return Response.json({ error: 'schema must have @type=BlogPosting or @graph array' }, { status: 400 });
}
```

**Render-side:**
```tsx
{post.schema && (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{
      __html: JSON.stringify(post.schema).replace(/</g, '\\u003c')
    }}
  />
)}
```

When `post.schema` is null, fall back to existing server-side BlogPosting generation (don't break old posts).

---

## Answer 3 — `featuredImage` vs `mainImage`

**Use `mainImage`. Existing field. No migration needed.**

The paperclip-side spec originally used `featuredImage` — that was the pipeline's naming. After your audit revealed Sanity already has `mainImage`, the pipeline has been updated (2026-05-11) to send `mainImage` instead. No new Sanity field. No migration. Old posts unaffected.

`pushBlogDraft()` already whitelists `mainImage` per your note — just confirm it accepts a CDN URL string (not only a Sanity asset reference). Acceptance shape:

```ts
body.mainImage = "https://cdn.medicodio.ai/..." // or a Sanity asset reference
```

If `mainImage` currently requires a Sanity asset object, two options:
- **A:** server resolves the URL to an asset (downloads + uploads to Sanity asset store) before persisting
- **B:** accept the URL string directly, store as-is, render uses `<img src={post.mainImage}>` not Sanity's `<Image>` component

Option B is simpler and what the pipeline expects. Pipeline will host images on `cdn.medicodio.ai` (Tier 3.3 — `/api/blog/images` upload endpoint, separate PR). Until Tier 3 ships, `mainImage` will be null/undefined and server can fall back to default OG image.

---

## Answer 4 — Google Indexing API service account

**Needs new provisioning. Steps:**

1. Go to Google Cloud Console → create new project (or use existing medicodio project) → enable **Indexing API**.
2. Create a service account: `medicodio-indexing@<project>.iam.gserviceaccount.com`. Generate JSON key.
3. In Search Console (https://search.google.com/search-console), go to your medicodio.ai property → Users and permissions → Add the service account email as a **Owner** (Indexing API requires Owner, not just User).
4. Store JSON key contents in Vercel env as `GOOGLE_INDEXING_SA_KEY` (the whole JSON, base64-encoded if env value size limits are hit).
5. Use `google-auth-library` package to authenticate calls:
   ```ts
   import { GoogleAuth } from 'google-auth-library';
   const auth = new GoogleAuth({
     credentials: JSON.parse(Buffer.from(process.env.GOOGLE_INDEXING_SA_KEY, 'base64').toString()),
     scopes: ['https://www.googleapis.com/auth/indexing']
   });
   const client = await auth.getClient();
   await client.request({
     url: 'https://indexing.googleapis.com/v3/urlNotifications:publish',
     method: 'POST',
     data: { url: canonicalUrl, type: 'URL_UPDATED' }
   });
   ```
6. Also call Bing IndexNow (free, no auth needed beyond a key file at `/indexnow-<key>.txt`):
   ```ts
   await fetch(`https://api.indexnow.org/indexnow?url=${encodeURIComponent(canonicalUrl)}&key=${process.env.INDEXNOW_KEY}`);
   ```
   Generate a random 32-char hex string as the key, host the matching file at `https://medicodio.ai/<key>.txt` containing just the key value. Free, instant Bing/Yandex indexing.

If service-account provisioning is a blocker for the PR, ship 6.7 in a follow-up PR. 6.1/6.3/6.4/6.5/6.6 are independent and self-contained.

---

## Answer 5 — Bundle vs split

**Bundle preferred. All items touch overlapping files.**

Files all touched:
- `blogPosts.ts` (Sanity schema)
- `blogApi.js` / `pushBlogDraft()` (push helper)
- `src/app/api/blog/push/route.ts` (API route)
- `src/app/resources/blog/[...index]/page.tsx` (page render)
- `src/utils/metadata.ts` (generateMetadata)
- `src/app/sitemap.xml/route.ts` (sitemap, for Tier 6.4)
- New: `src/app/llms.txt/route.ts` (Tier 6.3)

Conflicting changes if split into 6 PRs. Single PR is faster + lower review burden.

**Suggested PR breakdown if you must split:**
- **PR-A (bundle: 6.1 + 6.3 + 6.4 + 6.5 + 6.6 FAQ + 6.6 HowTo)** — schema, OG, sitemap, llms.txt. ~1 day.
- **PR-B (6.7 Indexing API)** — separate because needs service account provisioning. ~1.5h after creds.

Either approach fine. Pick whichever fits your review process.

---

## Green light + delivery

Once you have these 5 answers + the updated spec, you're unblocked. Cut the PR, deploy to staging, publish a test post from the agent pipeline (Karthik will coordinate from the Paperclip side — `[BLOG-ORCHESTRATOR]` issue with a topic).

Validate against the checklist in the spec (Rich Results Test, Twitter Card Validator, LinkedIn Inspector, Schema.org validator, OpenGraph debugger, canonical link present, old posts still render).

If anything in the answers above contradicts a constraint on your side (e.g. `mainImage` must remain a Sanity asset ref), flag it back — pipeline can adapt.

Questions or blockers → ping karthik.r@medicodio.ai.
