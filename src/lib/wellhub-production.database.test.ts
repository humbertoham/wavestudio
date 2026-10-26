/** Real PostgreSQL + signed HTTP webhook + strict mocked provider. Never uses a live provider. */
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasources: { db: { url: process.env.WAVE_RELEASE_TEST_DATABASE_URL ?? "postgresql://unused:unused@127.0.0.1:55432/wave_monthly_production_validation" } } }) };
});
vi.mock("@/lib/auth", () => ({ getAuth: async () => actor.id ? { sub: actor.id } : null, getAuthFromRequest: async () => actor.id ? { sub: actor.id } : null, requireAdmin: async () => { const { prisma } = await import("@/lib/prisma"); const user = actor.id ? await prisma.user.findUnique({ where: { id: actor.id } }) : null; if (user?.role !== "ADMIN") throw new Error("FORBIDDEN"); return { sub: user.id, role: user.role }; } }));

import { prisma } from "@/lib/prisma";
import { POST as webhook, GET as webhookGet } from "@/app/api/integrations/wellhub/webhook/route";
import { POST as book } from "@/app/api/bookings/route";
import { PATCH as cancel } from "@/app/api/bookings/[id]/cancel/route";
import { DELETE as adminCancel } from "@/app/api/admin/bookings/[id]/route";
import { POST as adminBook } from "@/app/api/admin/booking/route";
import { GET as classDetails } from "@/app/api/classes/[id]/route";
import { syncWellhubClassSafely, syncFutureWellhubClasses } from "@/lib/wellhub/booking/sync";
import { notifyWellhubBookingCanceledByWaveSafely, reconcilePendingWellhubBookingConfirmations } from "@/lib/wellhub/booking/service";
import { computeWellhubSignature } from "@/lib/wellhub/signature";
import { getUnlimitedEligibility, grantPackagePurchase, packageSnapshot } from "@/lib/monthly-unlimited";
import { createBookingWithCreditCheck } from "@/lib/class-booking";

const optIn = Boolean(process.env.WAVE_RELEASE_TEST_DATABASE_URL);
const prefix = `wh_${randomUUID().replaceAll("-", "")}`;
const secret = "synthetic-wellhub-signing-only";
let sequence = 0;
const id = () => `${prefix}_${++sequence}`;
const ctx = (value: string) => ({ params: Promise.resolve({ id: value }) });
const request = (url: string, body?: unknown, method = "POST") => new NextRequest(`https://fixture.example.invalid${url}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const unpack = async (response: Response) => ({ status: response.status, body: await response.json() });

let member: any, instructor: any, cls: any;
const calls: Array<{ method: string; path: string; body: any }> = [];
let failDecision = false, checkinExpired = false;
let classSeq = 8000, slotSeq = 9000;
const provider = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  // Any unexpected/production network target fails inside the mock; no network fallback exists.
  expect(url.origin).toBe("https://apitesting.partners.gympass.com");
  const method = init?.method ?? "GET", path = url.pathname;
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  calls.push({ method, path, body });
  if (path === "/access/v1/validate") return checkinExpired
    ? new Response(JSON.stringify({ errors: [{ key: "EXPIRED_CHECKIN", message: "Expired synthetic check-in" }] }), { status: 400 })
    : new Response(null, { status: 200 });
  if (path.includes("/bookings/")) return failDecision
    ? new Response("unavailable", { status: 503 }) : new Response(null, { status: 204 });
  if (method === "GET") return Response.json(path.endsWith("/slots") ? { results: [] } : { classes: [] });
  if (method === "POST") return path.endsWith("/slots")
    ? Response.json({ results: [{ id: ++slotSeq }] }, { status: 201 })
    : Response.json({ classes: [{ id: ++classSeq }] }, { status: 201 });
  return new Response(null, { status: 204 });
});

function bookingPayload(number = id(), kind = "booking-requested", email = member.email, user = "1000000000003", eventId = id()) {
  return { event_type: kind, event_data: { event_id: eventId, timestamp: Date.now(), user: { unique_token: user, name: "Synthetic partner member", email }, slot: { gym_id: 129, class_id: Number(cls.wellhubClassId), id: Number(cls.wellhubSlotId), booking_number: number } } };
}
async function deliver(payload: unknown, valid = true) {
  const raw = JSON.stringify(payload);
  return unpack(await webhook(new Request("https://fixture.example.invalid/api/integrations/wellhub/webhook", { method: "POST", headers: { "content-type": "application/json", "X-Gympass-Signature": valid ? computeWellhubSignature(raw, secret) : "0".repeat(40) }, body: raw })));
}
async function mappedClass(capacity = 4) {
  const row = await prisma.class.create({ data: { id: id(), title: "Isolated Wellhub class", focus: "Synthetic", date: new Date(Date.now() + 7 * 86400000), durationMin: 50, capacity, instructorId: instructor.id, payrollRateSnapshot: 250, payrollRateEffectiveAt: new Date() } });
  expect(await syncWellhubClassSafely(row.id)).toMatchObject({ kind: "synced" });
  return prisma.class.findUniqueOrThrow({ where: { id: row.id } });
}
async function standard(owner = member, credits = 8) {
  const pack = await prisma.pack.create({ data: { id: id(), name: "Synthetic standard", classes: credits, price: 800, validityDays: 30 } });
  return prisma.$transaction(tx => grantPackagePurchase(tx, { userId: owner.id, packId: pack.id, snapshot: packageSnapshot(pack), now: new Date() }));
}
async function unlimited(owner = member) {
  const date = new Date(Date.now() + 7 * 86400000);
  const terms = new Intl.DateTimeFormat("en-US", { timeZone: "America/Monterrey", month: "numeric", year: "numeric" }).formatToParts(date);
  const month = Number(terms.find(x => x.type === "month")!.value), year = Number(terms.find(x => x.type === "year")!.value);
  const pack = await prisma.pack.create({ data: { id: id(), name: "Synthetic monthly", type: "MONTHLY_UNLIMITED", unlimitedMonth: month, unlimitedYear: year, classes: 0, price: 1200, validityDays: 0 } });
  return prisma.$transaction(tx => grantPackagePurchase(tx, { userId: owner.id, packId: pack.id, snapshot: packageSnapshot(pack), now: new Date() }));
}
async function protectedState() {
  const [users, purchases, ledger, usage, payments, payroll] = await Promise.all([
    prisma.user.findMany({ where: { id: { startsWith: prefix } }, orderBy: { id: "asc" } }),
    prisma.packPurchase.findMany({ where: { userId: { startsWith: prefix } }, orderBy: { id: "asc" } }),
    prisma.tokenLedger.findMany({ where: { userId: { startsWith: prefix } }, orderBy: { id: "asc" } }),
    prisma.unlimitedUsage.findMany({ where: { userId: { startsWith: prefix } }, orderBy: { id: "asc" } }),
    prisma.payment.findMany({ where: { userId: { startsWith: prefix } }, orderBy: { id: "asc" } }),
    prisma.accountingAudit.findMany({ where: { instructorId: instructor.id }, orderBy: { id: "asc" } }),
  ]);
  return JSON.stringify({ users, purchases, ledger, usage, payments, payroll });
}

describe.skipIf(!optIn)("isolated Wellhub production-lineage E2E", () => {
  beforeAll(async () => {
    const url = new URL(process.env.WAVE_RELEASE_TEST_DATABASE_URL!);
    expect(["127.0.0.1", "localhost"]).toContain(url.hostname);
    expect(url.pathname).toBe("/wave_monthly_production_validation");
    instructor = await prisma.instructor.create({ data: { id: id(), name: "Synthetic Wellhub coach", payrollRate: 275 } });
    await prisma.accountingAudit.create({ data: { id: id(), type: "INSTRUCTOR_RATE_CHANGED", instructorId: instructor.id, instructorName: instructor.name, previousRate: 250, newRate: 275 } });
  });
  beforeEach(async () => {
    calls.length = 0; failDecision = false; checkinExpired = false;
    vi.stubGlobal("fetch", provider);
    for (const [key, value] of Object.entries({ APP_ENV: "development", VERCEL_ENV: "development", WELLHUB_CHECKIN_ENABLED: "true", WELLHUB_BOOKING_ENABLED: "true", WELLHUB_API_BASE_URL: "https://apitesting.partners.gympass.com/access/v1", WELLHUB_BOOKING_API_BASE_URL: "https://apitesting.partners.gympass.com/booking/v1", WELLHUB_API_TOKEN: "synthetic-provider-only", WELLHUB_GYM_ID: "129", WELLHUB_BOOKING_PRODUCT_ID: "100003", WELLHUB_WEBHOOK_SECRET: secret })) vi.stubEnv(key, value);
    member = await prisma.user.create({ data: { id: id(), name: "Synthetic Wellhub member", email: `${id()}@example.invalid`, passwordHash: "not-a-login", affiliation: "WELLHUB", role: "USER" } });
    await prisma.payment.create({ data: { id: id(), provider: "MERCADOPAGO", status: "APPROVED", amount: 800, userId: member.id, mpPaymentId: id(), mpRaw: { synthetic: true } } });
    actor.id = member.id;
    cls = await mappedClass();
    calls.length = 0;
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); actor.id = ""; });
  afterAll(async () => {
    // The entire verified disposable container is destroyed by the harness. No broad DELETE is needed.
    await prisma.$disconnect();
  });

  it("creates a class and slot once, preserves payroll, and updates occupancy without categories", async () => {
    const row = await mappedClass();
    expect(calls.filter(c => c.method === "POST")).toHaveLength(2);
    expect(calls.find(c => c.path.endsWith("/classes") && c.method === "POST")!.body.classes[0]).toMatchObject({ product_id: 100003, bookable: true });
    expect(calls.some(c => JSON.stringify(c.body).includes("categories"))).toBe(false);
    await syncWellhubClassSafely(row.id);
    expect(calls.filter(c => c.method === "POST")).toHaveLength(2);
    expect((await prisma.class.findUniqueOrThrow({ where: { id: row.id } })).payrollRateSnapshot?.toString()).toBe("250");
  });

  it("accepts a signed booking, keeps WAVE credits/monthly/payments/payroll unchanged, and deduplicates replay", async () => {
    await standard(); await unlimited();
    const before = await protectedState();
    const payload = bookingPayload();
    expect(await deliver(payload)).toMatchObject({ status: 200, body: { result: "RESERVED" } });
    const row = await prisma.booking.findUniqueOrThrow({ where: { wellhubBookingNumber: payload.event_data.slot.booking_number } });
    expect(row).toMatchObject({ userId: member.id, source: "WELLHUB", entitlementType: "WELLHUB", quantity: 1, packPurchaseId: null });
    expect(calls.find(c => c.method === "PATCH" && c.path.includes("/slots/"))!.body.total_booked).toBe(1);
    expect(await deliver(payload)).toMatchObject({ status: 200, body: { duplicate: true } });
    expect(await deliver({ ...payload, event_data: { ...payload.event_data, event_id: id(), timestamp: Date.now() + 1000 } })).toMatchObject({ status: 200, body: { duplicate: true } });
    expect(await prisma.booking.count({ where: { wellhubBookingNumber: payload.event_data.slot.booking_number } })).toBe(1);
    expect(await protectedState()).toBe(before);
    expect(await prisma.$transaction(tx => getUnlimitedEligibility(tx, member.id, cls.date, new Date()))).toMatchObject({ purchase: { type: "MONTHLY_UNLIMITED" } });
  });

  it.each(["booking-canceled", "booking-late-canceled"])("%s releases capacity once without a credit refund or unlimited claim", async kind => {
    await standard(); await unlimited(); const before = await protectedState();
    const payload = bookingPayload(); await deliver(payload);
    const cancellation = { ...payload, event_type: kind, event_data: { ...payload.event_data, event_id: id() } };
    expect(await deliver(cancellation)).toMatchObject({ status: 200, body: { result: kind === "booking-canceled" ? "CANCELED" : "LATE_CANCELED" } });
    expect(await deliver(cancellation)).toMatchObject({ status: 200, body: { duplicate: true } });
    const row = await prisma.booking.findUniqueOrThrow({ where: { wellhubBookingNumber: payload.event_data.slot.booking_number } });
    expect(row).toMatchObject({ status: "CANCELED", refundToken: false });
    expect(await protectedState()).toBe(before);
    expect(calls.filter(c => c.path.includes("/slots/")).at(-1)!.body.total_booked).toBe(0);
  });

  it("promotes a regular credit waitlist after Wellhub cancellation through MAIN's unchanged helper", async () => {
    const other = await prisma.user.create({ data: { id: id(), name: "Synthetic isolated member", email: `${id()}@example.invalid`, passwordHash: "not-a-login" } });
    await standard(other); const payload = bookingPayload(); await deliver(payload);
    await prisma.waitlist.create({ data: { classId: cls.id, userId: other.id, position: 1 } });
    expect(await deliver({ ...payload, event_type: "booking-canceled", event_data: { ...payload.event_data, event_id: id() } })).toMatchObject({ status: 200 });
    const promoted = await prisma.booking.findFirstOrThrow({ where: { userId: other.id, classId: cls.id, status: "ACTIVE" } });
    expect(promoted).toMatchObject({ source: "WAVE", entitlementType: "CREDITS" });
    expect(await prisma.tokenLedger.count({ where: { bookingId: promoted.id, reason: "BOOKING_DEBIT" } })).toBe(1);
    expect(await prisma.waitlist.count({ where: { classId: cls.id } })).toBe(0);
  });


  it.each(["TOTALPASS", "NONE"] as const)("provider bookings do not attach to or alter a %s account with the same email", async affiliation => {
    await prisma.user.update({ where: { id: member.id }, data: { affiliation } });
    await standard(); await unlimited(); const before = await protectedState();
    const payload = bookingPayload(); expect(await deliver(payload)).toMatchObject({ status: 200, body: { result: "RESERVED" } });
    expect(await prisma.booking.findUnique({ where: { wellhubBookingNumber: payload.event_data.slot.booking_number } })).toMatchObject({ userId: null, entitlementType: "WELLHUB", packPurchaseId: null });
    expect(await protectedState()).toBe(before);
  });

  it("counts multi-seat WAVE/guest reservations when deciding external capacity", async () => {
    await prisma.class.update({ where: { id: cls.id }, data: { capacity: 3 } });
    await prisma.booking.create({ data: { classId: cls.id, guestName: "Synthetic multi-seat guest", quantity: 2, entitlementType: "ADMIN_GUEST" } });
    expect(await deliver(bookingPayload())).toMatchObject({ status: 200, body: { result: "RESERVED" } });
    expect(await deliver(bookingPayload(id(), "booking-requested", "other@example.invalid", "1000000000005"))).toMatchObject({ status: 200, body: { result: "REJECTED", code: "CLASS_IS_FULL" } });
    expect((await prisma.booking.aggregate({ where: { classId: cls.id, status: "ACTIVE" }, _sum: { quantity: true } }))._sum.quantity).toBe(3);
  });

  it("Wellhub cancellation can promote a legitimate WAVE monthly waitlist booking without charging the external member", async () => {
    const other = await prisma.user.create({ data: { id: id(), name: "Synthetic isolated member", email: id()+"@example.invalid", passwordHash: "not-a-login" } });
    await unlimited(other); const payload = bookingPayload(); await deliver(payload);
    await prisma.waitlist.create({ data: { classId: cls.id, userId: other.id, position: 1 } });
    await deliver({ ...payload, event_type: "booking-canceled", event_data: { ...payload.event_data, event_id: id() } });
    expect(await prisma.booking.findFirst({ where: { classId: cls.id, userId: other.id } })).toMatchObject({ source: "WAVE", entitlementType: "MONTHLY_UNLIMITED" });
    expect(await prisma.unlimitedUsage.count({ where: { userId: other.id } })).toBe(1);
    expect(await prisma.unlimitedUsage.count({ where: { userId: member.id } })).toBe(0);
    expect(await prisma.tokenLedger.count({ where: { userId: member.id } })).toBe(0);
  });

  it("keeps the final seat safe against concurrent WAVE-credit and Wellhub booking attempts", async () => {
    await standard(); await prisma.class.update({ where: { id: cls.id }, data: { capacity: 1 } });
    const wave = prisma.$transaction(tx => createBookingWithCreditCheck(tx, { classId: cls.id, userId: member.id }), { isolationLevel: "Serializable" }).catch(() => null);
    const partner = deliver(bookingPayload(id(), "booking-requested", "unmatched@example.invalid", "1000000000004"));
    await Promise.all([wave, partner]);
    const active = await prisma.booking.aggregate({ where: { classId: cls.id, status: "ACTIVE" }, _sum: { quantity: true } });
    expect(active._sum.quantity).toBe(1);
    expect(await prisma.unlimitedUsage.count({ where: { userId: member.id } })).toBe(0);
  });

  it("rejects a new booking for an already started class and handles replay without resurrecting a canceled booking", async () => {
    const payload = bookingPayload(); await deliver(payload);
    await deliver({ ...payload, event_type: "booking-canceled", event_data: { ...payload.event_data, event_id: id() } });
    expect(await deliver(payload)).toMatchObject({ status: 200, body: { duplicate: true } });
    await prisma.class.update({ where: { id: cls.id }, data: { date: new Date(Date.now() - 1000) } });
    expect(await deliver(bookingPayload())).toMatchObject({ status: 200, body: { result: "REJECTED" } });
    expect(await prisma.booking.count({ where: { classId: cls.id, status: "ACTIVE" } })).toBe(0);
  });

  it("reconciles a provider failure after the local booking commits without charging credits or duplicating", async () => {
    await standard(); const before = await protectedState(); failDecision = true;
    const payload = bookingPayload();
    expect(await deliver(payload)).toMatchObject({ status: 503 });
    expect(await prisma.booking.findUnique({ where: { wellhubBookingNumber: payload.event_data.slot.booking_number } })).toMatchObject({ wellhubState: "CONFIRMATION_ERROR" });
    failDecision = false;
    expect(await deliver(payload)).toMatchObject({ status: 200, body: { result: "RESERVED" } });
    expect(await prisma.booking.count({ where: { wellhubBookingNumber: payload.event_data.slot.booking_number } })).toBe(1);
    expect(await protectedState()).toBe(before);
  });

  it("invalid signatures perform no persistence or outbound request", async () => {
    const before = await protectedState(); const events = await prisma.wellhubBookingEvent.count();
    expect(await deliver(bookingPayload(), false)).toMatchObject({ status: 401 });
    expect(await prisma.wellhubBookingEvent.count()).toBe(events);
    expect(await protectedState()).toBe(before); expect(calls).toHaveLength(0);
  });

  it("disabled flags make signed/invalid webhooks, sync and reconciliation inert without provider calls", async () => {
    vi.stubEnv("APP_ENV", "production"); vi.stubEnv("WELLHUB_CHECKIN_ENABLED", "false"); vi.stubEnv("WELLHUB_BOOKING_ENABLED", "false");
    const before = await protectedState(); const counts = [await prisma.booking.count(), await prisma.wellhubBookingEvent.count(), await prisma.wellhubCheckin.count()];
    const classBefore = await prisma.class.findUnique({ where: { id: cls.id } });
    expect(await deliver(bookingPayload(), false)).toMatchObject({ status: 200, body: { result: "DISABLED" } });
    expect(await syncWellhubClassSafely(cls.id)).toMatchObject({ kind: "skipped" });
    expect(await notifyWellhubBookingCanceledByWaveSafely("does-not-exist")).toMatchObject({ kind: "skipped" });
    await expect(syncFutureWellhubClasses()).rejects.toThrow("WELLHUB_BOOKING_DISABLED");
    await expect(reconcilePendingWellhubBookingConfirmations()).rejects.toThrow("WELLHUB_BOOKING_DISABLED");
    expect(await unpack(webhookGet())).toMatchObject({ status: 405 });
    expect([await prisma.booking.count(), await prisma.wellhubBookingEvent.count(), await prisma.wellhubCheckin.count()]).toEqual(counts);
    expect(await prisma.class.findUnique({ where: { id: cls.id } })).toEqual(classBefore);
    expect(await protectedState()).toBe(before); expect(calls).toHaveLength(0);
  });

  it("check-in validation deduplicates and records provider expiry without creating bookings or changing entitlements", async () => {
    await standard(); await unlimited(); const before = await protectedState();
    const payload = { event_type: "checkin", event_data: { user: { unique_token: "1000000000003", email: member.email }, gym: { id: 129, product: { id: 100003 } }, timestamp: Math.floor(Date.now() / 1000) } };
    expect(await deliver(payload)).toMatchObject({ status: 200, body: { result: "AUTHORIZED" } });
    expect(await deliver(payload)).toMatchObject({ status: 200, body: { duplicate: true } });
    checkinExpired = true;
    expect(await deliver({ ...payload, event_data: { ...payload.event_data, timestamp: payload.event_data.timestamp - 3600 } })).toMatchObject({ status: 200, body: { result: "REJECTED" } });
    expect(await prisma.wellhubCheckin.count({ where: { matchedUserId: member.id } })).toBe(2);
    expect(await prisma.booking.count({ where: { userId: member.id } })).toBe(0);
    expect(await protectedState()).toBe(before);
  });


  it("failed local transactions can be retried rather than remaining PROCESSING forever", async () => {
    const payload = bookingPayload();
    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("synthetic database failure"));
    expect(await deliver(payload)).toMatchObject({ status: 503 });
    spy.mockRestore();
    expect(await prisma.wellhubBookingEvent.findUnique({ where: { externalEventId: payload.event_data.event_id } })).toMatchObject({ result: "ERROR" });
    expect(await deliver(payload)).toMatchObject({ status: 200, body: { result: "RESERVED" } });
    expect(await prisma.booking.count({ where: { wellhubBookingNumber: payload.event_data.slot.booking_number } })).toBe(1);
  });

  it("a signed check-in for another gym never queries or mutates provider/business state", async () => {
    const before = await protectedState(), count = await prisma.wellhubCheckin.count();
    expect(await deliver({ event_type: "checkin", event_data: { user: { unique_token: "1000000000003" }, gym: { id: 999, product: { id: 2 } }, timestamp: Math.floor(Date.now()/1000) } })).toMatchObject({ status: 200, body: { result: "ERROR", retryable: false } });
    expect(await prisma.wellhubCheckin.count()).toBe(count);
    expect(await protectedState()).toBe(before); expect(calls).toHaveLength(0);
  });

  it("normal booking/cancellation keeps MAIN credit behavior with integration disabled", async () => {
    vi.stubEnv("WELLHUB_BOOKING_ENABLED", "false"); vi.stubEnv("WELLHUB_CHECKIN_ENABLED", "false");
    await standard();
    const result = await unpack(await book(request("/api/bookings", { classId: cls.id })));
    expect(result.status).toBe(201);
    const row = await prisma.booking.findFirstOrThrow({ where: { classId: cls.id, userId: member.id } });
    expect(row).toMatchObject({ source: "WAVE", entitlementType: "CREDITS" });
    expect((await unpack(await cancel(request(`/api/bookings/${row.id}/cancel`, {}, "PATCH"), ctx(row.id)))).status).toBe(200);
    expect(await prisma.tokenLedger.count({ where: { bookingId: row.id, reason: "CANCEL_REFUND" } })).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("ADMIN can cancel a Wellhub booking without credits/unlimited changes and USER cannot use admin APIs", async () => {
    await standard(); await unlimited(); const payload = bookingPayload(); await deliver(payload);
    const row = await prisma.booking.findUniqueOrThrow({ where: { wellhubBookingNumber: payload.event_data.slot.booking_number } });
    const denied = await adminCancel(request(`/api/admin/bookings/${row.id}`, undefined, "DELETE"), ctx(row.id));
    expect(denied?.status).toBe(403);
    const administrator = await prisma.user.create({ data: { id: id(), name: "Synthetic isolated member", email: `${id()}@example.invalid`, passwordHash: "not-a-login", role: "ADMIN" } });
    actor.id = administrator.id; const before = await protectedState();
    expect((await adminCancel(request(`/api/admin/bookings/${row.id}`, undefined, "DELETE"), ctx(row.id)))?.status).toBe(200);
    expect(await protectedState()).toBe(before);
    expect(await prisma.booking.findUnique({ where: { id: row.id } })).toMatchObject({ wellhubState: "CANCELED_BY_WAVE" });
  });

  it("COACH class detail hides payroll and provider references while preserving source attribution", async () => {
    await deliver(bookingPayload());
    const coach = await prisma.user.create({ data: { id: id(), name: "Synthetic isolated member", email: `${id()}@example.invalid`, passwordHash: "not-a-login", role: "COACH" } });
    actor.id = coach.id;
    const result = await unpack(await classDetails(request(`/api/classes/${cls.id}`, undefined, "GET"), ctx(cls.id)));
    expect(result.status).toBe(200);
    expect(result.body).not.toHaveProperty("payrollRateSnapshot");
    expect(result.body).not.toHaveProperty("wellhubClassId");
    expect(result.body.bookings[0]).toMatchObject({ source: "WELLHUB", entitlementType: "WELLHUB" });
    expect(result.body.bookings[0]).not.toHaveProperty("wellhubBookingNumber");
    expect((await adminBook(request("/api/admin/booking", { classId: cls.id, userId: member.id }))).status).toBe(403);
  });
});
