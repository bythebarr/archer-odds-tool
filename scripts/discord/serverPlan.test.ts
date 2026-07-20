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

  it("no channel name collides with another's alias (a rename would fight itself)", () => {
    const names = new Set(SERVER_PLAN.categories.flatMap((c) => c.channels.map((ch) => ch.name)));
    for (const cat of SERVER_PLAN.categories) {
      for (const ch of cat.channels) {
        for (const alias of ch.aliases ?? []) {
          expect(names.has(alias), `alias "${alias}" is also a live channel name`).toBe(false);
        }
      }
    }
  });

  it("image-only channels are public — the AutoMod rule is pointless on a hidden one", () => {
    for (const cat of SERVER_PLAN.categories) {
      for (const ch of cat.channels) {
        if (ch.imageOnly) expect(cat.visibility).toBe("public");
      }
    }
  });

  it("claims all three reserved Community slots exactly once", () => {
    // An unclaimed slot stays on an old channel, and Discord then refuses to
    // delete that channel forever (error 50074) — which is precisely how the
    // old #rules and #mod-log survived three prune passes.
    const claimed = SERVER_PLAN.categories
      .flatMap((c) => c.channels)
      .map((ch) => ch.communityRole)
      .filter(Boolean);
    expect([...claimed].sort()).toEqual(["rules", "safety", "updates"]);
  });

  it("the ✅ screening terms fit Discord's limits (5 entries, 300 chars each)", () => {
    // Over either limit and the member-verification PATCH is rejected, which
    // silently leaves the room with NO rules gate at all.
    expect(SERVER_PLAN.screeningRules.length).toBeLessThanOrEqual(5);
    for (const rule of SERVER_PLAN.screeningRules) {
      expect(rule.length, `"${rule.slice(0, 40)}…" is ${rule.length} chars`).toBeLessThanOrEqual(300);
    }
  });

  it("the screening terms carry the leak rule — the one that gets people banned", () => {
    expect(SERVER_PLAN.screeningRules.join(" ").toLowerCase()).toContain("premium");
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
