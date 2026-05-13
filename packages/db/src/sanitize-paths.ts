/**
 * Strips developer-specific absolute filesystem paths from any string before it
 * lands in the database, so the shared Azure Postgres does not accumulate
 * per-machine paths (which break portability and leak usernames).
 *
 * Replacements (longest-prefix first):
 *   /Users/<u>/Downloads/medicodio-paperclip   → <REPO>
 *   /Users/<u>/medicodio-paperclip             → <REPO>
 *   /Users/<u>/paperclip/paperclip             → <REPO>   (legacy repo layout)
 *   /home/<u>/medicodio-paperclip              → <REPO>
 *   /Users/<u>                                 → <HOME>
 *   /home/<u>                                  → <HOME>
 *
 * Drizzle + postgres.js call this on every outgoing string parameter (including
 * the JSON-encoded form of jsonb columns), so the guard applies to every write.
 */

const SEGMENT = "[A-Za-z0-9._-]+";

const REPO_PATTERNS: RegExp[] = [
  new RegExp(`/Users/${SEGMENT}/Downloads/medicodio-paperclip`, "g"),
  new RegExp(`/Users/${SEGMENT}/medicodio-paperclip`, "g"),
  new RegExp(`/Users/${SEGMENT}/paperclip/paperclip`, "g"),
  new RegExp(`/home/${SEGMENT}/medicodio-paperclip`, "g"),
];

const HOME_PATTERNS: RegExp[] = [
  new RegExp(`/Users/${SEGMENT}`, "g"),
  new RegExp(`/home/${SEGMENT}`, "g"),
];

const FAST_CHECK = /\/Users\/|\/home\//;

export function sanitizeAbsolutePaths(value: string): string {
  if (!FAST_CHECK.test(value)) return value;
  let out = value;
  for (const re of REPO_PATTERNS) out = out.replace(re, "<REPO>");
  for (const re of HOME_PATTERNS) out = out.replace(re, "<HOME>");
  return out;
}

export function containsAbsolutePath(value: string): boolean {
  return FAST_CHECK.test(value);
}
