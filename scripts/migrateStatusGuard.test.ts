import { describe, it, expect } from "vitest";
import { isMigrationFailed } from "./migrateStatusGuard";

const NHL = "20261109200100_nhl_team_pair_constraint";
const OTHER = "20261110093000_some_other_migration";

const FAILED_SECTION = `
The following migration(s) have failed:
${NHL}

During development, if you want to resolve this, run:
`;

describe("isMigrationFailed", () => {
  it("is true when the named migration is listed in the failed section", () => {
    expect(isMigrationFailed(FAILED_SECTION, NHL)).toBe(true);
  });

  it("is false for a different failed migration, even when the named one appears elsewhere in the output", () => {
    const status = `
The following migration(s) have been applied:
${NHL}

The following migration(s) have failed:
${OTHER}
`;
    expect(isMigrationFailed(status, NHL)).toBe(false);
    expect(isMigrationFailed(status, OTHER)).toBe(true);
  });

  it("is false when nothing has failed", () => {
    expect(isMigrationFailed("Database schema is up to date!\n", NHL)).toBe(false);
  });

  it("is true when one line carries both the name and a failed state", () => {
    expect(isMigrationFailed(`Migration ${NHL} failed to apply.\n`, NHL)).toBe(true);
  });

  it("matches a bulleted entry in the failed section", () => {
    expect(
      isMigrationFailed(`The following migration(s) have failed:\n- ${NHL}\n`, NHL),
    ).toBe(true);
  });

  it("is false with an empty migration name", () => {
    expect(isMigrationFailed(FAILED_SECTION, "")).toBe(false);
  });
});
