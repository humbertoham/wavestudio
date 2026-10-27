import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfigFromFile } from "@prisma/config";
import { Resend } from "resend";
import sharp from "sharp";

const require = createRequire(import.meta.url);

afterEach(() => vi.unstubAllGlobals());

describe("security dependency compatibility", () => {
  it("loads Prisma 6 configuration through the patched merge and Effect dependencies", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "wave-security-prisma-"));
    try {
      writeFileSync(path.join(directory, "prisma.config.ts"), `export default {
        schema: "./schema.prisma",
        migrations: { path: "./migrations" }
      };`);
      const result = await loadConfigFromFile({ configRoot: directory });
      expect(result.error).toBeUndefined();
      expect(result.config?.schema).toBe(path.join(directory, "schema.prisma"));
      expect(result.config?.migrations?.path).toBe(path.join(directory, "migrations"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves the existing Mercado Pago SDK's real UUID v4 idempotency-key contract", () => {
    // The SDK only consumes uuid.v4(); no payment/provider request is made.
    const { RestClient } = require("mercadopago/dist/utils/restClient");
    const keys = Array.from({ length: 32 }, () => RestClient.generateIdempotencyKey());
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("preserves Resend email payloads and responses without sending email", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ id: "fixture-email" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetch);
    const email = {
      from: "WAVE <sender@example.invalid>",
      to: "recipient@example.invalid",
      subject: "Isolated compatibility probe",
      text: "No delivery occurs.",
    };
    const response = await new Resend("re_synthetic_compatibility_only").emails.send(email);
    expect(response.data?.id).toBe("fixture-email");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toMatchObject(email);
  });

  it("keeps the patched image pipeline able to resize SVG input and encode AVIF", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#1275cc"/></svg>');
    const image = await sharp(svg).resize(8, 8).avif().toBuffer();
    const metadata = await sharp(image).metadata();
    expect(metadata.width).toBe(8);
    expect(metadata.height).toBe(8);
    expect(metadata.format).toBe("heif");
  });
});
