import { describe, expect, it } from "vitest";
import { adminTokenOk, readTokenOk, scopeConfigured, tokenMatches } from "./tokenAuth";

/**
 * Scoped owner tokens (Phase 2 A4 / audit S-10). The matrix that matters:
 * dormant (no new env vars) behavior is byte-for-byte today's; activation
 * (ADMIN_TOKEN set) is what closes the leaked-link hole.
 */
const dormant = { CRON_SECRET: "cron-secret" };
const activated = { CRON_SECRET: "cron-secret", OWNER_READ_TOKEN: "read-token", ADMIN_TOKEN: "admin-token" };

describe("tokenMatches", () => {
  it("matches only exact equality, and never matches nothing", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abc", "abd")).toBe(false);
    expect(tokenMatches("abc", "abcd")).toBe(false);
    expect(tokenMatches("", "abc")).toBe(false);
    expect(tokenMatches(null, "abc")).toBe(false);
    expect(tokenMatches("abc", undefined)).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
  });
});

describe("read scope", () => {
  it("dormant: the cron secret is the read token, as today", () => {
    expect(readTokenOk("cron-secret", dormant)).toBe(true);
    expect(readTokenOk("wrong", dormant)).toBe(false);
  });
  it("activated: read token works AND saved cron-secret links keep working", () => {
    expect(readTokenOk("read-token", activated)).toBe(true);
    expect(readTokenOk("cron-secret", activated)).toBe(true);
    expect(readTokenOk("admin-token", activated)).toBe(false);
    expect(readTokenOk(null, activated)).toBe(false);
  });
});

describe("admin scope", () => {
  it("dormant: the cron secret authorizes admin via query and bearer, as today", () => {
    expect(adminTokenOk("cron-secret", "query", dormant)).toBe(true);
    expect(adminTokenOk("cron-secret", "bearer", dormant)).toBe(true);
    expect(adminTokenOk("wrong", "query", dormant)).toBe(false);
  });
  it("activated: the admin token works via both channels", () => {
    expect(adminTokenOk("admin-token", "query", activated)).toBe(true);
    expect(adminTokenOk("admin-token", "bearer", activated)).toBe(true);
  });
  it("activated: a leaked cron-secret URL no longer fires destructive routes, but automation's bearer still works", () => {
    expect(adminTokenOk("cron-secret", "query", activated)).toBe(false);
    expect(adminTokenOk("cron-secret", "bearer", activated)).toBe(true);
    expect(adminTokenOk("read-token", "query", activated)).toBe(false);
    expect(adminTokenOk("read-token", "bearer", activated)).toBe(false);
  });
});

describe("scopeConfigured (fail-closed gates)", () => {
  it("nothing set: nothing is configured", () => {
    expect(scopeConfigured("read", {})).toBe(false);
    expect(scopeConfigured("admin", {})).toBe(false);
    expect(scopeConfigured("cron", {})).toBe(false);
  });
  it("either the dedicated token or the legacy secret configures its scope", () => {
    expect(scopeConfigured("read", { OWNER_READ_TOKEN: "x" })).toBe(true);
    expect(scopeConfigured("admin", { ADMIN_TOKEN: "x" })).toBe(true);
    expect(scopeConfigured("cron", { CRON_SECRET: "x" })).toBe(true);
    expect(scopeConfigured("cron", { ADMIN_TOKEN: "x" })).toBe(false);
  });
});
