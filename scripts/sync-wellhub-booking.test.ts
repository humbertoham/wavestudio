import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Wellhub Booking sync CLI", () => {
  it("starts under the project's CommonJS tsx runtime", () => {
    const result = spawnSync(
      process.execPath,
      [
        path.resolve("node_modules/tsx/dist/cli.mjs"),
        path.resolve("scripts/sync-wellhub-booking.ts"),
        "--invalid",
      ],
      {
        cwd: path.resolve("."),
        encoding: "utf8",
        env: { ...process.env, WELLHUB_BOOKING_ENABLED: "false" },
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Usage: npm run wellhub:booking:sync -- [--dry-run]"
    );
    expect(result.stderr).not.toContain("Top-level await is currently not supported");
  });
});
