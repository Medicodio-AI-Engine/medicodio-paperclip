import { describe, expect, it } from "vitest";
import { containsAbsolutePath, sanitizeAbsolutePaths } from "./sanitize-paths.js";

describe("sanitizeAbsolutePaths", () => {
  it("returns the input untouched when no abs path is present", () => {
    expect(sanitizeAbsolutePaths("hello world")).toBe("hello world");
    expect(sanitizeAbsolutePaths("/var/log/app.log")).toBe("/var/log/app.log");
    expect(sanitizeAbsolutePaths("")).toBe("");
  });

  it("replaces a per-user repo path with <REPO>", () => {
    expect(sanitizeAbsolutePaths("/Users/karthikkhatavkar/medicodio-paperclip")).toBe("<REPO>");
    expect(sanitizeAbsolutePaths("/Users/karthikkhatavkar/medicodio-paperclip/skills/foo")).toBe("<REPO>/skills/foo");
  });

  it("handles the legacy `/paperclip/paperclip/` layout", () => {
    expect(sanitizeAbsolutePaths("/Users/karthikkhatavkar/paperclip/paperclip/agents/ceo")).toBe("<REPO>/agents/ceo");
  });

  it("handles the Downloads-prefix layout used by one contributor", () => {
    expect(sanitizeAbsolutePaths("/Users/muarlis/Downloads/medicodio-paperclip/skills/paperclip")).toBe("<REPO>/skills/paperclip");
  });

  it("handles /home/<u>/medicodio-paperclip on Linux", () => {
    expect(sanitizeAbsolutePaths("/home/runner/medicodio-paperclip/dist/server.js")).toBe("<REPO>/dist/server.js");
  });

  it("falls back to <HOME> for non-repo paths under /Users or /home", () => {
    expect(sanitizeAbsolutePaths("/Users/karthikkhatavkar/.paperclip/instances/default")).toBe("<HOME>/.paperclip/instances/default");
    expect(sanitizeAbsolutePaths("/Users/karthikkhatavkar/.local/bin/claude")).toBe("<HOME>/.local/bin/claude");
    expect(sanitizeAbsolutePaths("/home/agent/.claude")).toBe("<HOME>/.claude");
  });

  it("replaces multiple occurrences in one string", () => {
    const input =
      "cp /Users/dotta/medicodio-paperclip/README.md /Users/dotta/.paperclip/cache/README.md";
    expect(sanitizeAbsolutePaths(input)).toBe("cp <REPO>/README.md <HOME>/.paperclip/cache/README.md");
  });

  it("works inside a JSON-encoded string (as drizzle passes for jsonb columns)", () => {
    const json = JSON.stringify({
      cwd: "/Users/karthikkhatavkar/medicodio-paperclip",
      home: "/Users/karthikkhatavkar",
    });
    expect(sanitizeAbsolutePaths(json)).toBe(
      JSON.stringify({ cwd: "<REPO>", home: "<HOME>" }),
    );
  });

  it("does not mangle unrelated strings beginning with /home or /Users in mid-token", () => {
    expect(sanitizeAbsolutePaths("see /UsersGuide.md for details")).toBe("see /UsersGuide.md for details");
    expect(sanitizeAbsolutePaths("path-/home-team/")).toBe("path-/home-team/");
  });
});

describe("containsAbsolutePath", () => {
  it("detects /Users/", () => {
    expect(containsAbsolutePath("/Users/foo")).toBe(true);
  });
  it("detects /home/", () => {
    expect(containsAbsolutePath("/home/foo")).toBe(true);
  });
  it("returns false for innocent strings", () => {
    expect(containsAbsolutePath("hello")).toBe(false);
    expect(containsAbsolutePath("/etc/passwd")).toBe(false);
  });
});
