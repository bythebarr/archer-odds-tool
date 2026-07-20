import { describe, it, expect } from "vitest";
import { SERVER_PLAN, PERM, overwritesFor } from "./serverPlan";

const VIEW = PERM.VIEW_CHANNEL;
const SEND = PERM.SEND_MESSAGES;
const EVERYONE = "guild-id";
const roleId = (name: string) => `role:${name}`;

describe("SERVER_PLAN integrity", () => {
  it("has unique role names", () => {
    const names = SERVER_PLAN.roles.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has globally-unique channel names", () => {
    const chans = SERVER_PLAN.categories.flatMap((c) => c.channels.map((ch) => ch.name));
    expect(new Set(chans).size).toBe(chans.length);
  });

  it("every pinned message fits Discord's 2000-char cap", () => {
    // The provisioner posts each pinned entry as ONE message; Discord rejects
    // anything longer, and a rejected pin fails provisioning mid-run.
    for (const cat of SERVER_PLAN.categories) {
      for (const ch of cat.channels) {
        for (const [i, msg] of (ch.pinned ?? []).entries()) {
          expect(msg.length, `#${ch.name} pin ${i + 1} is ${msg.length} chars`).toBeLessThanOrEqual(2000);
        }
      }
    }
  });

  it("only uses known visibilities, and every gated category resolves to defined roles", () => {
    const roleNames = new Set(SERVER_PLAN.roles.map((r) => r.name));
    for (const cat of SERVER_PLAN.categories) {
      expect(["public", "premium", "staff"]).toContain(cat.visibility);
    }
    // Premium/Mod/Archer are referenced by the overwrite logic — ensure they exist.
    for (const needed of ["Premium", "Mod", "Archer"]) {
      expect(roleNames.has(needed)).toBe(true);
    }
  });
});

describe("overwritesFor", () => {
  it("public + writable = no overwrites (everyone sees and posts)", () => {
    expect(overwritesFor("public", false, EVERYONE, roleId)).toEqual([]);
  });

  it("premium hides from @everyone and grants view to the paid+staff roles", () => {
    const ows = overwritesFor("premium", false, EVERYONE, roleId);
    const everyone = ows.find((o) => o.id === EVERYONE)!;
    expect(everyone.deny).toBe(VIEW); // hidden
    const premium = ows.find((o) => o.id === "role:Premium")!;
    expect(premium.allow).toBe(VIEW);
    expect(ows.map((o) => o.id)).toEqual(
      expect.arrayContaining([EVERYONE, "role:Premium", "role:Mod", "role:Archer"])
    );
  });

  it("read-only public channel denies @everyone SEND but lets staff post", () => {
    const ows = overwritesFor("public", true, EVERYONE, roleId);
    const everyone = ows.find((o) => o.id === EVERYONE)!;
    expect(everyone.deny).toBe(SEND);
    expect(ows.find((o) => o.id === "role:Archer")!.allow).toBe(SEND);
  });

  it("read-only premium channel composes view-gate AND post-lock on @everyone", () => {
    const ows = overwritesFor("premium", true, EVERYONE, roleId);
    const everyone = ows.find((o) => o.id === EVERYONE)!;
    // deny should carry BOTH bits (VIEW 1024 | SEND 2048 = 3072)
    expect(everyone.deny).toBe(String(Number(VIEW) | Number(SEND)));
  });

  it("staff is visible only to Mod and Archer", () => {
    const ows = overwritesFor("staff", false, EVERYONE, roleId);
    const viewers = ows.filter((o) => o.allow === VIEW).map((o) => o.id);
    expect(viewers.sort()).toEqual(["role:Archer", "role:Mod"]);
  });
});
