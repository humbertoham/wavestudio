import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

const WEBHOOK_URL = "https://wave.test/api/integrations/wellhub/webhook";

function post(body: string) {
  return POST(
    new Request(WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })
  );
}

describe("/api/integrations/wellhub/webhook production stub", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns a sanitized 503 without database or external API activity", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected external request"));
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];

    const response = post(
      JSON.stringify({
        event: "checkin",
        user: { email: "private@example.test" },
      })
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "WELLHUB_NOT_CONFIGURED",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  it.each(["{}", "not-json", JSON.stringify({ arbitrary: [1, 2, 3] })])(
    "returns the same disabled response regardless of payload: %s",
    async (body) => {
      const response = post(body);

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        code: "WELLHUB_NOT_CONFIGURED",
      });
    }
  );

  it("rejects GET with the repository-standard unsupported method status", async () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "METHOD_NOT_ALLOWED",
    });
  });

  it("has no database, Wellhub implementation, or network dependency", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./route.ts", import.meta.url)),
      "utf8"
    );
    const importedModules = Array.from(
      source.matchAll(/^import[\s\S]*?from\s+["']([^"']+)["'];/gm),
      (match) => match[1]
    );

    expect(importedModules).toEqual(["next/server"]);
    expect(source).not.toMatch(/prisma|@\/lib\/wellhub|fetch\s*\(|console\./i);
  });
});
