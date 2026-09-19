import { describe, it, expect } from "vitest";
import { resyncDraft } from "./lineFieldSync";

describe("resyncDraft", () => {
  it("does not resync while the committed value is unchanged — normal typing is never overwritten before blur", () => {
    // Typing only ever changes the field's own local draft, never the
    // committed `value` prop — so every render during an in-progress edit
    // calls this with value === syncedValue, and it must be a no-op.
    expect(resyncDraft(5, 5)).toBeNull();
    expect(resyncDraft(null, null)).toBeNull();
    expect(resyncDraft(-3.5, -3.5)).toBeNull();
  });

  it("resyncs to blank when Clear sets the committed value to null", () => {
    expect(resyncDraft(null, 5)).toEqual({ draft: "", syncedValue: null });
  });

  it("resyncs to the restored value when localStorage hydration or a cross-tab update changes it", () => {
    // e.g. server snapshot was null, then the client's useSyncExternalStore
    // re-reads real localStorage after mount and finds a stored -3.5 spread.
    expect(resyncDraft(-3.5, null)).toEqual({ draft: "-3.5", syncedValue: -3.5 });
  });

  it("resyncs correctly through an explicit 0 (a valid pick'em spread, not 'empty')", () => {
    expect(resyncDraft(0, null)).toEqual({ draft: "0", syncedValue: 0 });
    expect(resyncDraft(null, 0)).toEqual({ draft: "", syncedValue: null });
  });

  it("treats two different non-null committed values as a real external change", () => {
    expect(resyncDraft(7, -3.5)).toEqual({ draft: "7", syncedValue: 7 });
  });
});
