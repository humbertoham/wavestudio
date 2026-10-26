/** Opt-in release integration suite; only the explicitly named disposable localhost database is allowed. */
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Prisma, type Pack, type User } from "@prisma/client";
import { NextRequest } from "next/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  actor: "",
  paymentGet: vi.fn(),
  preferenceCreate: vi.fn(),
}));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return {
    prisma: new PrismaClient({
      datasources: {
        db: {
          url:
            process.env.WAVE_RELEASE_TEST_DATABASE_URL ??
            "postgresql://unused:unused@127.0.0.1:55432/wave_monthly_production_validation",
        },
      },
    }),
  };
});
vi.mock("@/lib/auth", () => ({
  getAuth: async () => (mocks.actor ? { sub: mocks.actor } : null),
  getAuthFromRequest: async () => (mocks.actor ? { sub: mocks.actor } : null),
}));
vi.mock("mercadopago", () => ({
  MercadoPagoConfig: class {},
  Preference: class {
    create = mocks.preferenceCreate;
  },
  Payment: class {
    get = mocks.paymentGet;
  },
  MerchantOrder: class {},
}));

import { prisma } from "@/lib/prisma";
import { POST as wellhubStub } from "@/app/api/integrations/wellhub/webhook/route";
import { GET as revenueReport } from "@/app/api/admin/revenue/route";
import { GET as payrollReport } from "@/app/api/admin/accounting/payroll/route";
import {
  grantPackagePurchase,
  isBookingTransactionConflict,
  packageSnapshot,
  revokeUnlimitedPurchase,
} from "@/lib/monthly-unlimited";
import { createBookingWithCreditCheck } from "@/lib/class-booking";
import { POST as book } from "@/app/api/bookings/route";
import { PATCH as cancel } from "@/app/api/bookings/[id]/cancel/route";
import { DELETE as adminCancel } from "@/app/api/admin/bookings/[id]/route";
import { POST as joinWaitlist } from "@/app/api/classes/[id]/waitlist/route";
import { POST as addUser } from "@/app/api/admin/classes/[id]/add-user/route";
import { POST as addGuest } from "@/app/api/admin/classes/[id]/add-guest/route";
import { POST as promote } from "@/app/api/admin/classes/[id]/waitlist/[entryId]/promote/route";
import { POST as createPack } from "@/app/api/admin/packs/route";
import { PATCH as editPack } from "@/app/api/admin/packs/[id]/route";
import { POST as checkout } from "@/app/api/checkout-links/route";
import { POST as webhook } from "@/app/api/webhooks/mercadopago/route";
import { GET as getPacks } from "@/app/api/users/me/packs/route";
import { GET as getBookings } from "@/app/api/users/me/bookings/route";
import { POST as manualPurchase } from "@/app/api/admin/manual-purchases/route";
import { POST as assignPack } from "@/app/api/admin/users/[id]/packs/route";
import { POST as pausePack } from "@/app/api/admin/users/[id]/packs/[purchaseId]/pause/route";
import { PUT as updateClass } from "@/app/api/admin/classes/[id]/route";
import { GET as getUnlimitedSummary } from "@/app/api/users/me/unlimited/route";
import { GET as purchasedPackages } from "@/app/api/admin/purchased-packages/route";
import { POST as revokePack } from "@/app/api/admin/users/[id]/packs/[purchaseId]/revoke/route";
import { GET as userDetails } from "@/app/api/admin/users/[id]/details/route";
import { revokeAdminUnlimited } from "@/lib/admin-unlimited-revocation";
import { promoteWaitlistForReleasedSeats } from "@/lib/waitlist-promotion";

const run = `monthly_release_${randomUUID().replaceAll("-", "")}`;
const ids = {
  users: [] as string[],
  packs: [] as string[],
  classes: [] as string[],
  instructors: [] as string[],
  deliveries: [] as string[],
};
const optIn = Boolean(process.env.WAVE_RELEASE_TEST_DATABASE_URL);
let user: User;
let pack: Pack;
let instructorId: string;
const req = (path: string, body?: unknown, method = "POST") =>
  new NextRequest(`https://release.example.invalid${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (r: Response) => ({
  status: r.status,
  body: await r.json(),
});

async function createUser(role: "USER" | "COACH" | "ADMIN" = "USER") {
  const id = `${run}_${randomUUID()}`;
  ids.users.push(id);
  return prisma.user.create({
    data: {
      id,
      role,
      name: "Disposable release integration fixture",
      email: `${id}@example.invalid`,
      passwordHash: "not-a-login-hash",
    },
  });
}
async function ownUnlimited(owner = user, p = pack) {
  return prisma.$transaction((tx) =>
    grantPackagePurchase(tx, {
      userId: owner.id,
      packId: p.id,
      snapshot: packageSnapshot(p),
      now: new Date("2026-09-25T12:00:00Z"),
    }),
  );
}
async function credits(
  amount: number,
  owner = user,
  expiry = "2026-12-01T06:00:00Z",
) {
  const id = `${run}_${randomUUID()}`;
  ids.packs.push(id);
  const standard = await prisma.pack.create({
    data: { id, name: id, classes: amount, validityDays: 90, price: 500 },
  });
  return prisma.$transaction(async (tx) => {
    const purchase = await grantPackagePurchase(tx, {
      userId: owner.id,
      packId: id,
      snapshot: packageSnapshot(standard),
    });
    return tx.packPurchase.update({
      where: { id: purchase.id },
      data: { expiresAt: new Date(expiry) },
    });
  });
}
async function session(
  iso = "2026-10-10T13:00:00Z",
  capacity = 12,
  creditCost = 1,
) {
  const id = `${run}_${randomUUID()}`;
  ids.classes.push(id);
  return prisma.class.create({
    data: {
      id,
      title: id,
      focus: "Test",
      date: new Date(iso),
      capacity,
      creditCost,
      instructorId,
      durationMin: 50,
    },
  });
}
async function reserve(classId: string, quantity = 1) {
  return json(await book(req("/api/bookings", { classId, quantity })));
}
async function serialReserve(owner: string, classId: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        (tx) => createBookingWithCreditCheck(tx, { userId: owner, classId }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      if (isBookingTransactionConflict(e) && attempt < 4) continue;
      throw e;
    }
  }
}
function signedRequest(paymentId: string, valid = true) {
  const ts = String(Date.now()),
    requestId = `${run}_${randomUUID()}`;
  ids.deliveries.push(requestId);
  const signature = createHmac("sha256", "automated-test-signing-key")
    .update(`id:${paymentId};request-id:${requestId};ts:${ts};`)
    .digest("hex");
  return new Request(
    `https://release.example.invalid/api/webhooks/mercadopago?type=payment&data.id=${paymentId}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
        "x-signature": `ts=${ts},v1=${valid ? signature : "0".repeat(64)}`,
      },
      body: JSON.stringify({ type: "payment", data: { id: paymentId } }),
    },
  );
}
async function pendingPayment() {
  const r = await json(
    await checkout(req("/api/checkout-links", { packId: pack.id })),
  );
  expect(r.status).toBe(200);
  const payment = await prisma.payment.findFirstOrThrow({
    where: { userId: user.id },
    include: { checkoutLink: true },
  });
  return payment;
}
async function callback(
  payment: Awaited<ReturnType<typeof pendingPayment>>,
  status: string,
  valid = true,
  overrides = {},
) {
  const id = payment.mpPaymentId ?? `${run}_${payment.id}`;
  mocks.paymentGet.mockResolvedValue({
    id,
    status,
    transaction_amount: 1500,
    currency_id: "MXN",
    external_reference: payment.mpExternalRef,
    preference_id: payment.mpPreferenceId,
    ...overrides,
  });
  return json(await webhook(signedRequest(id, valid)));
}

describe.skipIf(!optIn)(
  "monthly unlimited: real disposable MAIN-based PostgreSQL and API routes",
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.WAVE_RELEASE_TEST_DATABASE_URL!);
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/wave_monthly_production_validation" ||
        process.env.NODE_ENV !== "test"
      )
        throw new Error("UNSAFE_RELEASE_TEST_DATABASE_TARGET");
      expect(
        (
          await prisma.$queryRaw<
            { name: string }[]
          >`SELECT current_database() AS name`
        )[0].name,
      ).toBe("wave_monthly_production_validation");
      const instructor = await prisma.instructor.create({
        data: { name: run },
      });
      instructorId = instructor.id;
      ids.instructors.push(instructor.id);
    });
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
      vi.stubEnv("MP_ACCESS_TOKEN", "TEST-automated-provider-only");
      vi.stubEnv("MP_WEBHOOK_SECRET", "automated-test-signing-key");
      vi.stubEnv("ALLOW_SANDBOX", "1");
      vi.stubEnv("APP_BASE_URL", "https://release.example.invalid");
      user = await createUser();
      mocks.actor = user.id;
      const id = `${run}_${randomUUID()}`;
      ids.packs.push(id);
      pack = await prisma.pack.create({
        data: {
          id,
          name: id,
          type: "MONTHLY_UNLIMITED",
          unlimitedMonth: 10,
          unlimitedYear: 2026,
          classes: 0,
          validityDays: 0,
          price: 1500,
        },
      });
      mocks.preferenceCreate.mockImplementation(async () => ({
        id: randomUUID(),
        live_mode: false,
        init_point: "https://sandbox.mercadopago.com/automated-test",
      }));
    });
    afterEach(() => {
      mocks.actor = "";
      vi.useRealTimers();
      vi.unstubAllEnvs();
    });
    afterAll(async () => {
      await prisma.unlimitedUsage.deleteMany({
        where: { userId: { in: ids.users } },
      });
      await prisma.tokenLedger.deleteMany({
        where: { userId: { in: ids.users } },
      });
      await prisma.waitlist.deleteMany({
        where: { classId: { in: ids.classes } },
      });
      await prisma.booking.deleteMany({
        where: { classId: { in: ids.classes } },
      });
      await prisma.packPurchase.deleteMany({
        where: { userId: { in: ids.users } },
      });
      await prisma.checkoutLink.deleteMany({
        where: { userId: { in: ids.users } },
      });
      await prisma.payment.deleteMany({ where: { userId: { in: ids.users } } });
      await prisma.bookingBlockLog.deleteMany({
        where: { userId: { in: ids.users } },
      });
      await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
      await prisma.class.deleteMany({ where: { id: { in: ids.classes } } });
      await prisma.instructor.deleteMany({
        where: { id: { in: ids.instructors } },
      });
      await prisma.pack.deleteMany({ where: { id: { in: ids.packs } } });
      await prisma.webhookLog.deleteMany({
        where: { deliveryId: { in: ids.deliveries } },
      });
      await prisma.$disconnect();
    });

    const revoke = async (purchaseId: string, reason: unknown = "Solicitud del usuario", ownerId = user.id) => json(await revokePack(
      req("/revoke", { reason }), { params: Promise.resolve({ id: ownerId, purchaseId }) },
    ));

    it.each(["manual", "purchased"])("ADMIN revokes %s access with immutable audit and preserves all financial and booking history", async source => {
      let purchase;
      if (source === "purchased") {
        await callback(await pendingPayment(), "approved");
        purchase = await prisma.packPurchase.findFirstOrThrow({ where: { userId: user.id } });
      } else {
        mocks.actor = (await createUser("ADMIN")).id;
        const grant = await json(await assignPack(req("/assign", { packId: pack.id }), ctx(user.id)));
        purchase = await prisma.packPurchase.findUniqueOrThrow({ where: { id: grant.body.purchase.id } });
      }
      mocks.actor = user.id;
      const cls = await session();
      const booking = await reserve(cls.id);
      expect(booking.status).toBe(201);
      const beforeBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.body.bookingId } });
      const beforeUsage = await prisma.unlimitedUsage.findUniqueOrThrow({ where: { bookingId: beforeBooking.id } });
      const regular = await credits(3);
      const payments = await prisma.payment.findMany({ where: { userId: user.id } });
      const positiveCredits = await prisma.tokenLedger.findMany({ where: { userId: user.id, delta: { not: 0 } } });
      const actor = await createUser("ADMIN");
      mocks.actor = actor.id;
      expect(await revoke(purchase.id, "  Solicitud explícita  ")).toMatchObject({ status: 200, body: { ok: true, alreadyRevoked: false } });
      const revoked = await prisma.packPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
      expect(revoked).toMatchObject({ revokedAt: new Date(), revocationReason: "Solicitud explícita", classesLeft: 0,
        nameSnapshot: purchase.nameSnapshot, priceSnapshot: purchase.priceSnapshot, paymentId: purchase.paymentId });
      expect(await prisma.booking.findUnique({ where: { id: beforeBooking.id } })).toEqual(beforeBooking);
      expect(await prisma.unlimitedUsage.findUnique({ where: { id: beforeUsage.id } })).toEqual(beforeUsage);
      expect(await prisma.packPurchase.findUnique({ where: { id: regular.id } })).toEqual(regular);
      expect(await prisma.payment.findMany({ where: { userId: user.id } })).toEqual(payments);
      expect(await prisma.tokenLedger.findMany({ where: { userId: user.id, delta: { not: 0 } } })).toEqual(positiveCredits);
      const audit = await prisma.tokenLedger.findUniqueOrThrow({ where: { idempotencyKey: `admin-unlimited-revocation:${purchase.id}` } });
      expect(audit).toMatchObject({ delta: 0, userId: user.id, packPurchaseId: purchase.id,
        metadata: { source: "ADMIN", action: "UNLIMITED_REVOCATION", actorUserId: actor.id, reason: "Solicitud explícita", revokedAt: new Date().toISOString() } });
      const details = await json(await userDetails(req("/details", undefined, "GET"), ctx(user.id)));
      expect(details.body.purchases.find((p: { id: string }) => p.id === purchase.id)).toMatchObject({
        canRevoke: false, paidEntitlement: source === "purchased", origin: source === "purchased" ? "MERCADOPAGO" : "ADMIN",
        revocationAudit: { metadata: { actorUserId: actor.id, reason: "Solicitud explícita" } },
      });
      mocks.actor = user.id;
      expect((await json(await getPacks(req("/packs", undefined, "GET")))).body.items.find((p: { id: string }) => p.id === purchase.id)).toMatchObject({ revokedAt: new Date().toISOString() });
      expect((await json(await getUnlimitedSummary(req("/summary", undefined, "GET")))).body.purchases).toEqual([
        expect.objectContaining({ id: purchase.id, available: false }),
      ]);
      // A valid regular package remains usable after revocation.
      expect(await reserve((await session("2026-10-11T13:00:00Z")).id)).toMatchObject({ status: 201, body: { debitedCredits: 1 } });
    });

    it.each(["USER", "COACH", "anonymous"])("denies %s direct API revocation", async role => {
      const purchase = await ownUnlimited();
      mocks.actor = role === "anonymous" ? "" : (await createUser(role as "USER" | "COACH")).id;
      expect(await revoke(purchase.id)).toMatchObject({ status: role === "anonymous" ? 401 : 403, body: { code: role === "anonymous" ? "UNAUTHORIZED" : "FORBIDDEN" } });
      expect((await prisma.packPurchase.findUniqueOrThrow({ where: { id: purchase.id } })).revokedAt).toBeNull();
    });

    it.each([null, "", "  ", "x".repeat(1001), 12])("requires a bounded nonempty reason: %j", async reason => {
      const purchase = await ownUnlimited();
      mocks.actor = (await createUser("ADMIN")).id;
      expect(await revoke(purchase.id, reason)).toMatchObject({ status: 400, body: { code: "INVALID_REVOCATION_REASON" } });
      expect((await prisma.packPurchase.findUniqueOrThrow({ where: { id: purchase.id } })).revokedAt).toBeNull();
    });

    it("rejects mismatched ownership, standard entitlements, expired entitlements and client audit injection", async () => {
      const purchase = await ownUnlimited();
      const standard = await credits(4);
      const expired = await ownUnlimited(user, { ...pack, unlimitedMonth: 8 });
      const other = await createUser();
      mocks.actor = (await createUser("ADMIN")).id;
      expect(await revoke(purchase.id, "Reason", other.id)).toMatchObject({ status: 404, body: { code: "ENTITLEMENT_NOT_FOUND" } });
      expect(await revoke(standard.id)).toMatchObject({ status: 409, body: { code: "NOT_UNLIMITED_ENTITLEMENT" } });
      expect(await revoke(expired.id)).toMatchObject({ status: 409, body: { code: "UNLIMITED_NOT_ACTIVE" } });
      expect((await revokePack(req("/revoke", { reason: "Reason", actorUserId: other.id }), { params: Promise.resolve({ id: user.id, purchaseId: purchase.id }) })).status).toBe(400);
      expect(await prisma.packPurchase.findUnique({ where: { id: standard.id } })).toEqual(standard);
    });

    it("service independently verifies the persisted ADMIN role", async () => {
      const purchase = await ownUnlimited();
      await expect(prisma.$transaction(tx => revokeAdminUnlimited(tx, { userId: user.id, purchaseId: purchase.id, actorUserId: user.id, reason: "Reason" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("serializes duplicate revocations, preserving the first actor, reason and timestamp", async () => {
      const purchase = await ownUnlimited();
      mocks.actor = (await createUser("ADMIN")).id;
      const results = await Promise.all([revoke(purchase.id, "First"), revoke(purchase.id, "Second")]);
      expect(results.map(r => r.status)).toEqual([200, 200]);
      expect(results.filter(r => !r.body.alreadyRevoked)).toHaveLength(1);
      const before = await prisma.packPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
      expect((await revoke(purchase.id, "Replacement")).body.alreadyRevoked).toBe(true);
      expect(await prisma.packPurchase.findUnique({ where: { id: purchase.id } })).toEqual(before);
      expect(await prisma.tokenLedger.count({ where: { idempotencyKey: `admin-unlimited-revocation:${purchase.id}` } })).toBe(1);
    });

    it("revoked access cannot book, while another month remains eligible", async () => {
      const october = await ownUnlimited();
      await ownUnlimited(user, { ...pack, unlimitedMonth: 11 });
      mocks.actor = (await createUser("ADMIN")).id;
      expect((await revoke(october.id)).status).toBe(200);
      mocks.actor = user.id;
      expect(await reserve((await session()).id)).toMatchObject({ status: 402, body: { code: "UNLIMITED_ENTITLEMENT_REVOKED", error: expect.stringContaining("revocado") } });
      expect((await reserve((await session("2026-11-10T13:00:00Z")).id)).status).toBe(201);
    });

    it("same-month remaining grants do not restore consumed daily allowances", async () => {
      const first = await ownUnlimited();
      const second = await ownUnlimited();
      const booking = await reserve((await session()).id);
      const used = await prisma.unlimitedUsage.findUniqueOrThrow({ where: { bookingId: booking.body.bookingId } });
      mocks.actor = (await createUser("ADMIN")).id;
      await revoke(used.purchaseId);
      mocks.actor = user.id;
      expect(await reserve((await session("2026-10-10T16:00:00Z")).id)).toMatchObject({ status: 402, body: { code: "UNLIMITED_DAILY_LIMIT" } });
      const next = await reserve((await session("2026-10-11T16:00:00Z")).id);
      expect(next.status).toBe(201);
      expect((await prisma.unlimitedUsage.findUniqueOrThrow({ where: { bookingId: next.body.bookingId } })).purchaseId).toBe(used.purchaseId === first.id ? second.id : first.id);
    });

    it.each([true, false])("cancellation after revocation retains revocation and early/late usage rules: onTime=%s", async onTime => {
      const purchase = await ownUnlimited();
      const cls = await session();
      const booking = await reserve(cls.id);
      mocks.actor = (await createUser("ADMIN")).id;
      await revoke(purchase.id);
      mocks.actor = user.id;
      vi.setSystemTime(new Date(cls.date.getTime() - (onTime ? 5 * 3600_000 : 60_000)));
      expect((await cancel(req("/cancel", undefined, "PATCH"), ctx(booking.body.bookingId))).status).toBe(200);
      expect((await prisma.packPurchase.findUniqueOrThrow({ where: { id: purchase.id } })).revokedAt).not.toBeNull();
      const usage = await prisma.unlimitedUsage.findUniqueOrThrow({ where: { bookingId: booking.body.bookingId } });
      expect(!!usage.releasedAt).toBe(onTime);
      expect(await reserve((await session("2026-10-11T13:00:00Z")).id)).toMatchObject({ status: 402, body: { code: "UNLIMITED_ENTITLEMENT_REVOKED" } });
      expect(await prisma.tokenLedger.count({ where: { userId: user.id, delta: { not: 0 } } })).toBe(0);
    });

    it("waitlist promotion cannot bypass revoked access", async () => {
      const purchase = await ownUnlimited();
      const cls = await session();
      const entry = await prisma.waitlist.create({ data: { userId: user.id, classId: cls.id, position: 1 } });
      mocks.actor = (await createUser("ADMIN")).id;
      await revoke(purchase.id);
      const response = await promote(req("/promote"), { params: Promise.resolve({ id: cls.id, entryId: entry.id }) });
      expect(response.status).toBe(409);
      expect(await prisma.booking.count({ where: { userId: user.id, classId: cls.id } })).toBe(0);
      expect(await prisma.waitlist.findUnique({ where: { id: entry.id } })).not.toBeNull();
    });

    it("a stale SERIALIZABLE booking cannot commit after revocation completes", async () => {
      const purchase = await ownUnlimited();
      const cls = await session();
      const actor = await createUser("ADMIN");
      let ready!: () => void;
      let resume!: () => void;
      const snapshotReady = new Promise<void>(r => { ready = r; });
      const resumeBooking = new Promise<void>(r => { resume = r; });
      const stale = prisma.$transaction(async tx => {
        await tx.packPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
        ready();
        await resumeBooking;
        return createBookingWithCreditCheck(tx, { userId: user.id, classId: cls.id });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
      // Attach rejection before releasing the barrier to avoid unhandled errors.
      const outcome = stale.then(value => ({ value, error: null }), error => ({ value: null, error }));
      await snapshotReady;
      try {
        await prisma.$transaction(tx => revokeAdminUnlimited(tx, { userId: user.id, purchaseId: purchase.id, actorUserId: actor.id, reason: "Concurrent revocation" }));
      } finally { resume(); }
      const result = await outcome;
      expect(result.value).toBeNull();
      expect(isBookingTransactionConflict(result.error)).toBe(true);
      expect(await prisma.booking.count({ where: { userId: user.id, classId: cls.id } })).toBe(0);
      expect(await prisma.unlimitedUsage.count({ where: { purchaseId: purchase.id } })).toBe(0);
      expect(await reserve(cls.id)).toMatchObject({ status: 402, body: { code: "UNLIMITED_ENTITLEMENT_REVOKED" } });
    });

    it("automatic waitlist promotion skips revoked access and promotes the next eligible account", async () => {
      const purchase = await ownUnlimited();
      const other = await createUser();
      await credits(1, other);
      const cls = await session(undefined, 1);
      await prisma.waitlist.createMany({ data: [
        { userId: user.id, classId: cls.id, position: 1 },
        { userId: other.id, classId: cls.id, position: 2 },
      ] });
      mocks.actor = (await createUser("ADMIN")).id;
      await revoke(purchase.id);
      expect(await prisma.$transaction(tx => promoteWaitlistForReleasedSeats(tx, { classId: cls.id, seatsReleased: 1 }), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })).toBe(1);
      expect(await prisma.booking.findMany({ where: { classId: cls.id }, select: { userId: true, entitlementType: true } })).toEqual([
        { userId: other.id, entitlementType: "CREDITS" },
      ]);
      expect(await prisma.waitlist.count({ where: { classId: cls.id, userId: user.id } })).toBe(1);
    });

    it("a booking holds the entitlement row lock through commit and survives subsequent revocation", async () => {
      const purchase = await ownUnlimited();
      const cls = await session();
      const actor = await createUser("ADMIN");
      let ready!: () => void;
      let resume!: () => void;
      const bookingReady = new Promise<void>(r => { ready = r; });
      const resumeBooking = new Promise<void>(r => { resume = r; });
      const pendingBooking = prisma.$transaction(async tx => {
        const booking = await createBookingWithCreditCheck(tx, { userId: user.id, classId: cls.id });
        ready();
        await resumeBooking;
        return booking;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
      await bookingReady;
      try {
        // NOWAIT proves the booking owns the row lock while uncommitted.
        await expect(prisma.$transaction(tx => tx.$queryRaw`
          SELECT "id" FROM "PackPurchase" WHERE "id" = ${purchase.id} FOR UPDATE NOWAIT
        `)).rejects.toMatchObject({ code: "P2010", meta: { code: "55P03" } });
      } finally { resume(); }
      const booking = await pendingBooking;
      await prisma.$transaction(tx => revokeAdminUnlimited(tx, { userId: user.id, purchaseId: purchase.id, actorUserId: actor.id, reason: "After booking" }));
      expect(await prisma.booking.findUnique({ where: { id: booking.id } })).toMatchObject({ status: "ACTIVE", packPurchaseId: purchase.id });
      expect(await prisma.unlimitedUsage.findUnique({ where: { bookingId: booking.id } })).toMatchObject({ releasedAt: null });
      expect(await reserve((await session("2026-10-11T13:00:00Z")).id)).toMatchObject({ status: 402, body: { code: "UNLIMITED_ENTITLEMENT_REVOKED" } });
    });

    it("buys in September, books October ahead, adds no credits, and occupies one seat", async () => {
      const purchase = await ownUnlimited();
      const cls = await session();
      const r = await reserve(cls.id);
      expect(r).toMatchObject({ status: 201, body: { debitedCredits: 0 } });
      expect(
        await prisma.tokenLedger.count({ where: { userId: user.id } }),
      ).toBe(0);
      expect(
        await prisma.packPurchase.findUnique({ where: { id: purchase.id } }),
      ).toMatchObject({ classesLeft: 0, unlimitedMonth: 10 });
      expect(
        await prisma.booking.findUnique({ where: { id: r.body.bookingId } }),
      ).toMatchObject({
        quantity: 1,
        entitlementType: "MONTHLY_UNLIMITED",
        packPurchaseId: purchase.id,
      });
    });
    it.each(["2026-09-30T13:00:00Z", "2026-11-01T13:00:00Z"])(
      "rejects wrong-month class %s without credits",
      async (iso) => {
        await ownUnlimited();
        const cls = await session(iso);
        expect(await reserve(cls.id)).toMatchObject({
          status: 402,
          body: { code: "UNLIMITED_MONTH_MISMATCH" },
        });
      },
    );
    it.each(["2026-10-01T06:00:00Z", "2026-11-01T05:59:59Z"])(
      "accepts local month boundary %s",
      async (iso) => {
        await ownUnlimited();
        expect((await reserve((await session(iso)).id)).status).toBe(201);
      },
    );
    it("enforces daily history across same-day classes and allows another day", async () => {
      await ownUnlimited();
      expect((await reserve((await session()).id)).status).toBe(201);
      expect(
        await reserve((await session("2026-10-10T23:00:00Z")).id),
      ).toMatchObject({ status: 402, body: { code: "UNLIMITED_DAILY_LIMIT" } });
      expect(
        (await reserve((await session("2026-10-11T13:00:00Z")).id)).status,
      ).toBe(201);
    });
    it("rejects two unlimited seats without separate credits", async () => {
      await ownUnlimited();
      expect(await reserve((await session()).id, 2)).toMatchObject({
        status: 402,
        body: { code: "UNLIMITED_SEAT_LIMIT" },
      });
      expect(
        await prisma.unlimitedUsage.count({ where: { userId: user.id } }),
      ).toBe(0);
    });
    it("unlimited takes priority; additional seats debit only normal credits", async () => {
      await ownUnlimited();
      const regular = await credits(6);
      const r = await reserve((await session(undefined, 12, 3)).id, 2);
      expect(r).toMatchObject({ status: 201, body: { debitedCredits: 3 } });
      expect(
        await prisma.packPurchase.findUnique({ where: { id: regular.id } }),
      ).toMatchObject({ classesLeft: 3 });
      expect(
        await prisma.booking.findUnique({ where: { id: r.body.bookingId } }),
      ).toMatchObject({
        quantity: 2,
        entitlementType: "MIXED",
        guestName: null,
      });
    });
    it.each(["2026-10-10T23:00:00Z", "2026-11-01T13:00:00Z"])(
      "falls back to paid credits when unlimited is ineligible %s",
      async (iso) => {
        await ownUnlimited();
        await credits(3);
        await reserve((await session()).id);
        expect(await reserve((await session(iso)).id)).toMatchObject({
          status: 201,
          body: { debitedCredits: 1 },
        });
      },
    );
    it("ignores expired standard credits and keeps earliest-expiry credit priority", async () => {
      await ownUnlimited();
      const expired = await credits(9, user, "2026-09-24T06:00:00Z");
      const later = await credits(2),
        earliest = await credits(1, user, "2026-10-01T06:00:00Z");
      const outside = await session("2026-09-30T13:00:00Z", 12, 2);
      expect((await reserve(outside.id)).status).toBe(201);
      expect(
        await prisma.packPurchase.findUnique({ where: { id: expired.id } }),
      ).toMatchObject({ classesLeft: 9 });
      expect(
        await prisma.packPurchase.findUnique({ where: { id: earliest.id } }),
      ).toMatchObject({ classesLeft: 0 });
      expect(
        await prisma.packPurchase.findUnique({ where: { id: later.id } }),
      ).toMatchObject({ classesLeft: 1 });
    });
    it("does not multiply allowance for duplicate purchased entitlements", async () => {
      await ownUnlimited();
      await ownUnlimited();
      await reserve((await session()).id);
      expect(
        (await reserve((await session("2026-10-10T23:00:00Z")).id)).body.code,
      ).toBe("UNLIMITED_DAILY_LIMIT");
    });
    it("atomically allows only one simultaneous unlimited class for the same user/day", async () => {
      await ownUnlimited();
      const a = await session(),
        b = await session("2026-10-10T23:00:00Z");
      const results = await Promise.allSettled([
        serialReserve(user.id, a.id),
        serialReserve(user.id, b.id),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { code: "UNLIMITED_DAILY_LIMIT" },
      });
      expect(
        await prisma.unlimitedUsage.count({
          where: { userId: user.id, releasedAt: null },
        }),
      ).toBe(1);
      expect(
        await prisma.booking.count({
          where: { userId: user.id, status: "ACTIVE" },
        }),
      ).toBe(1);
    });
    it("prevents concurrent final-seat overselling between two unlimited users", async () => {
      const other = await createUser();
      await ownUnlimited();
      await ownUnlimited(other);
      const cls = await session(undefined, 1);
      const results = await Promise.allSettled([
        serialReserve(user.id, cls.id),
        serialReserve(other.id, cls.id),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { code: "CLASS_FULL" },
      });
      expect(
        (
          await prisma.booking.aggregate({
            where: { classId: cls.id, status: "ACTIVE" },
            _sum: { quantity: true },
          })
        )._sum.quantity,
      ).toBe(1);
    });
    it("keeps different users' daily allowances independent", async () => {
      const other = await createUser();
      await ownUnlimited();
      await ownUnlimited(other);
      const cls = await session();
      expect(
        (
          await Promise.allSettled([
            serialReserve(user.id, cls.id),
            serialReserve(other.id, cls.id),
          ])
        ).filter((r) => r.status === "fulfilled"),
      ).toHaveLength(2);
    });
    it.each([
      [241, true],
      [240, true],
      [239, false],
    ])(
      "cancellation %i minutes before respects the four-hour boundary",
      async (minutes, restores) => {
        await ownUnlimited();
        const cls = await session();
        const r = await reserve(cls.id);
        vi.setSystemTime(new Date(cls.date.getTime() - minutes * 60_000));
        const canceled = await json(
          await cancel(
            req("/cancel", undefined, "PATCH"),
            ctx(r.body.bookingId),
          ),
        );
        expect(canceled).toMatchObject({
          status: 200,
          body: { lateCancel: !restores, refundedCredits: 0 },
        });
        expect(
          (
            await prisma.unlimitedUsage.findUniqueOrThrow({
              where: { bookingId: r.body.bookingId },
            })
          ).releasedAt !== null,
        ).toBe(restores);
        expect(
          await prisma.tokenLedger.count({ where: { userId: user.id } }),
        ).toBe(0);
        const retry = await json(
          await cancel(
            req("/cancel", undefined, "PATCH"),
            ctx(r.body.bookingId),
          ),
        );
        expect(retry.status).toBe(409);
        const second = await reserve(
          (await session("2026-10-10T23:00:00Z")).id,
        );
        expect(second.status).toBe(restores ? 201 : 402);
        if (!restores) expect(second.body.code).toBe("UNLIMITED_DAILY_LIMIT");
      },
    );
    it("prevents cancellation after start without releasing a daily claim", async () => {
      await ownUnlimited();
      const cls = await session();
      const r = await reserve(cls.id);
      vi.setSystemTime(cls.date);
      expect(
        (
          await json(
            await cancel(
              req("/cancel", undefined, "PATCH"),
              ctx(r.body.bookingId),
            ),
          )
        ).body.code,
      ).toBe("CLASS_ALREADY_STARTED");
      expect(
        (
          await prisma.unlimitedUsage.findUniqueOrThrow({
            where: { bookingId: r.body.bookingId },
          })
        ).releasedAt,
      ).toBeNull();
    });
    it("concurrent mixed cancellation refunds regular credits exactly once", async () => {
      await ownUnlimited();
      const regular = await credits(3);
      const r = await reserve((await session()).id, 2);
      const results = await Promise.all([
        cancel(req("/cancel", undefined, "PATCH"), ctx(r.body.bookingId)),
        cancel(req("/cancel", undefined, "PATCH"), ctx(r.body.bookingId)),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(
        await prisma.packPurchase.findUnique({ where: { id: regular.id } }),
      ).toMatchObject({ classesLeft: 3 });
      expect(
        await prisma.tokenLedger.count({
          where: { bookingId: r.body.bookingId, reason: "CANCEL_REFUND" },
        }),
      ).toBe(1);
    });
    it("waitlist joining does not consume allowance; cancellation promotes atomically", async () => {
      await ownUnlimited();
      const other = await createUser();
      await ownUnlimited(other);
      const cls = await session(undefined, 1);
      const r = await reserve(cls.id);
      mocks.actor = other.id;
      expect(
        (await json(await joinWaitlist(req("/waitlist"), ctx(cls.id)))).status,
      ).toBe(200);
      expect(
        await prisma.unlimitedUsage.count({ where: { userId: other.id } }),
      ).toBe(0);
      mocks.actor = user.id;
      expect(
        (
          await cancel(
            req("/cancel", undefined, "PATCH"),
            ctx(r.body.bookingId),
          )
        ).status,
      ).toBe(200);
      expect(
        await prisma.booking.findFirst({
          where: { userId: other.id, classId: cls.id, status: "ACTIVE" },
        }),
      ).toMatchObject({ entitlementType: "MONTHLY_UNLIMITED" });
      expect(await prisma.waitlist.count({ where: { classId: cls.id } })).toBe(
        0,
      );
    });
    it("waitlist skips consumed unlimited users and promotes the next eligible account", async () => {
      const holder = await createUser(),
        next = await createUser();
      await ownUnlimited();
      await ownUnlimited(holder);
      await ownUnlimited(next);
      const full = await session(undefined, 1),
        alternate = await session("2026-10-10T23:00:00Z");
      const occupied = await serialReserve(holder.id, full.id);
      await serialReserve(user.id, alternate.id);
      await prisma.waitlist.createMany({
        data: [
          { userId: user.id, classId: full.id, position: 1 },
          { userId: next.id, classId: full.id, position: 2 },
        ],
      });
      mocks.actor = holder.id;
      await cancel(req("/cancel", undefined, "PATCH"), ctx(occupied!.id));
      expect(
        await prisma.booking.findFirst({
          where: { userId: next.id, classId: full.id, status: "ACTIVE" },
        }),
      ).not.toBeNull();
      expect(
        await prisma.waitlist.count({
          where: { userId: user.id, classId: full.id },
        }),
      ).toBe(1);
    });
    it("coach booking and promotion use unlimited; guests do not consume it", async () => {
      await ownUnlimited();
      const coach = await createUser("COACH");
      mocks.actor = coach.id;
      const cls = await session();
      expect(
        (
          await json(
            await addUser(req("/admin/add", { userId: user.id }), ctx(cls.id)),
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await json(
            await addGuest(
              req("/admin/guest", { name: "Test guest" }),
              ctx(cls.id),
            ),
          )
        ).status,
      ).toBe(200);
      expect(
        await prisma.booking.findFirst({
          where: { classId: cls.id, userId: null },
        }),
      ).toMatchObject({ entitlementType: "ADMIN_GUEST" });
      const tomorrow = await session("2026-10-11T13:00:00Z");
      const entry = await prisma.waitlist.create({
        data: { classId: tomorrow.id, userId: user.id, position: 1 },
      });
      expect(
        (
          await json(
            await promote(req("/admin/promote"), {
              params: Promise.resolve({ id: tomorrow.id, entryId: entry.id }),
            }),
          )
        ).status,
      ).toBe(200);
      expect(
        await prisma.unlimitedUsage.count({ where: { userId: user.id } }),
      ).toBe(2);
    });
    it("admin cancellation preserves spent unlimited allowance when late", async () => {
      await ownUnlimited();
      const cls = await session();
      const r = await reserve(cls.id);
      const admin = await createUser("ADMIN");
      mocks.actor = admin.id;
      vi.setSystemTime(new Date(cls.date.getTime() - 60_000));
      expect(
        (
          await adminCancel(
            req("/admin/cancel", undefined, "DELETE"),
            ctx(r.body.bookingId),
          )
        )?.status,
      ).toBe(200);
      expect(
        (
          await prisma.unlimitedUsage.findUniqueOrThrow({
            where: { bookingId: r.body.bookingId },
          })
        ).releasedAt,
      ).toBeNull();
    });
    it("admin-only package create/edit validation preserves purchased terms", async () => {
      const payload = {
        name: `${run}_admin`,
        type: "MONTHLY_UNLIMITED",
        unlimitedMonth: 10,
        unlimitedYear: 2026,
        price: 1500,
      };
      expect((await createPack(req("/admin/packs", payload))).status).toBe(401);
      const admin = await createUser("ADMIN");
      mocks.actor = admin.id;
      expect(
        (
          await createPack(
            req("/admin/packs", { ...payload, unlimitedMonth: null }),
          )
        ).status,
      ).toBe(400);
      const created = await json(
        await createPack(req("/admin/packs", payload)),
      );
      expect(created.status).toBe(201);
      ids.packs.push(created.body.item.id);
      const bought = await ownUnlimited(user, created.body.item);
      const edited = await editPack(
        req(
          "/admin/packs",
          {
            name: `${run}_edited`,
            type: "STANDARD",
            classes: 3,
            validityDays: 30,
          },
          "PATCH",
        ),
        ctx(created.body.item.id),
      );
      expect(edited.status).toBe(200);
      expect(
        await prisma.packPurchase.findUnique({ where: { id: bought.id } }),
      ).toMatchObject({
        type: "MONTHLY_UNLIMITED",
        unlimitedMonth: 10,
        unlimitedYear: 2026,
        nameSnapshot: payload.name,
        classesLeft: 0,
      });
    });
    it("manual admin sales and assignments grant audited unlimited purchases without payments or credits", async () => {
      const admin = await createUser("ADMIN");
      mocks.actor = admin.id;
      const first = await json(
        await manualPurchase(
          req("/manual", {
            userId: user.id,
            packId: pack.id,
            note: "Automated DEV fixture",
          }),
        ),
      );
      expect(first).toMatchObject({ status: 201, body: { classesLeft: 0 } });
      const other = await createUser();
      expect(
        (await assignPack(req("/assign", { packId: pack.id }), ctx(other.id)))
          .status,
      ).toBe(200);
      expect(await prisma.tokenLedger.count({ where: {
        userId: { in: [user.id, other.id] }, delta: { not: 0 },
      } })).toBe(0);
      expect(
        await prisma.payment.count({
          where: { userId: { in: [user.id, other.id] }, status: "APPROVED" },
        }),
      ).toBe(0);
    });
    describe("manual unlimited assignment", () => {
      let admin: User;
      const assign = (packId = pack.id, key?: string) => {
        const request = req("/assign", { packId });
        if (key) request.headers.set("Idempotency-Key", key);
        return assignPack(request, ctx(user.id)).then(json);
      };
      beforeEach(async () => {
        admin = await createUser("ADMIN");
        mocks.actor = admin.id;
      });
      it("grants with immutable terms, actor audit, no payment/revenue/credit, and appears in mis-clases", async () => {
        const assigned = await assign();
        expect(assigned).toMatchObject({ status: 200, body: { ok: true, purchase: { type: "MONTHLY_UNLIMITED", classes: 0 } } });
        const purchase = await prisma.packPurchase.findUniqueOrThrow({ where: { id: assigned.body.purchase.id } });
        expect(purchase).toMatchObject({ paymentId: null, classesLeft: 0, nameSnapshot: pack.name, priceSnapshot: 1500, unlimitedMonth: 10, unlimitedYear: 2026 });
        expect(await prisma.payment.count({ where: { userId: user.id } })).toBe(0);
        expect(await prisma.tokenLedger.findMany({ where: { packPurchaseId: purchase.id } })).toEqual([
          expect.objectContaining({ delta: 0, reason: "ADMIN_ADJUST", userId: user.id, createdAt: expect.any(Date), metadata: expect.objectContaining({ source: "ADMIN", action: "PACKAGE_ASSIGNMENT", actorUserId: admin.id, packId: pack.id }) }),
        ]);
        const report = await json(await purchasedPackages(req("/api/admin/purchased-packages", undefined, "GET")));
        expect(report.body.items.find((p: { id: string }) => p.id === purchase.id)).toMatchObject({ amountPaid: 0, assignmentSource: "ADMIN", paymentStatus: null, paymentProvider: null });
        mocks.actor = user.id;
        const dashboard = await json(await getPacks(req("/api/users/me/packs", undefined, "GET")));
        expect(dashboard.body.items).toEqual([expect.objectContaining({ id: purchase.id, type: "MONTHLY_UNLIMITED", unlimitedMonth: 10, unlimitedYear: 2026 })]);
      });
      it.each(["USER", "COACH"] as const)("rejects %s without granting anything", async role => {
        mocks.actor = (await createUser(role)).id;
        expect((await assign()).status).toBe(403);
        expect(await prisma.packPurchase.count({ where: { userId: user.id } })).toBe(0);
      });
      it("rejects an unauthenticated request", async () => {
        mocks.actor = "";
        expect((await assign()).status).toBe(401);
      });
      it("preserves standard manual assignment and deduplicates its request", async () => {
        const standard = await credits(3, await createUser());
        const key = randomUUID();
        const first = await assign(standard.packId, key);
        const retry = await assign(standard.packId, key);
        expect(first.status).toBe(200);
        expect(retry.body.purchase.id).toBe(first.body.purchase.id);
        expect(await prisma.packPurchase.count({ where: { userId: user.id } })).toBe(1);
        expect(await prisma.tokenLedger.aggregate({ where: { userId: user.id }, _sum: { delta: true } })).toMatchObject({ _sum: { delta: 3 } });
        expect(await prisma.payment.findFirst({ where: { userId: user.id } })).toMatchObject({ provider: "ADMIN", status: "APPROVED", amount: 500 });
      });
      it("preserves the separate standard manual-sale endpoint including nullable notes", async () => {
        const standard = await credits(3, await createUser());
        const response = await json(await manualPurchase(req("/manual", { userId: user.id, packId: standard.packId, note: null })));
        expect(response).toMatchObject({ status: 201, body: { amount: 500, classesLeft: 3 } });
        expect(await prisma.payment.findUnique({ where: { id: response.body.paymentId } })).toMatchObject({ provider: "MERCADOPAGO", status: "APPROVED", amount: 500, mpExternalRef: "ADMIN_MANUAL" });
      });
      it.each(["USER", "COACH"] as const)("also rejects %s at the alternate manual endpoint", async role => {
        mocks.actor = (await createUser(role)).id;
        expect((await manualPurchase(req("/manual", { userId: user.id, packId: pack.id }))).status).toBe(403);
        expect(await prisma.packPurchase.count({ where: { userId: user.id } })).toBe(0);
      });
      it("replays the same request and rejects concurrent distinct requests for the same month", async () => {
        const key = randomUUID();
        const [first, retry] = await Promise.all([assign(pack.id, key), assign(pack.id, key)]);
        expect([first.status, retry.status]).toEqual([200, 200]);
        expect(retry.body.purchase.id).toBe(first.body.purchase.id);
        const duplicate = await assign();
        expect(duplicate).toMatchObject({ status: 409, body: { code: "UNLIMITED_MONTH_ALREADY_PURCHASED", message: expect.stringContaining("mes") } });
        expect(await prisma.packPurchase.count({ where: { userId: user.id } })).toBe(1);
      });
      it("allows only one grant when distinct requests race", async () => {
        const results = await Promise.all([assign(), assign()]);
        expect(results.map(r => r.status).sort()).toEqual([200, 409]);
        expect(await prisma.packPurchase.count({ where: { userId: user.id } })).toBe(1);
      });
      it("cannot reuse a request key with another package", async () => {
        const key = randomUUID();
        await assign(pack.id, key);
        const standard = await credits(2, await createUser());
        expect((await assign(standard.packId, key)).status).toBe(409);
      });
      it("reports pending checkout and expired month conflicts in Spanish without granting", async () => {
        mocks.actor = user.id;
        const payment = await pendingPayment();
        mocks.actor = admin.id;
        expect(await assign()).toMatchObject({ status: 409, body: { message: expect.any(String) } });
        await prisma.payment.update({ where: { id: payment.id }, data: { status: "CANCELED" } });
        vi.setSystemTime(new Date("2026-11-01T06:00:00Z"));
        expect(await assign()).toMatchObject({ status: 409, body: { code: "UNLIMITED_NOT_ACTIVE", message: expect.any(String) } });
        expect(await prisma.packPurchase.count({ where: { userId: user.id } })).toBe(0);
      });
      it("validates malformed payloads and missing users/packages", async () => {
        expect((await json(await assignPack(req("/assign", null), ctx(user.id)))).status).toBe(400);
        expect((await assign("missing-pack")).status).toBe(404);
        expect((await json(await assignPack(req("/assign", { packId: pack.id }), ctx("missing-user")))).status).toBe(404);
      });
      it("books ahead, prefers unlimited, preserves credits, restores early cancellation, and enforces month/day", async () => {
        await assign();
        mocks.actor = user.id;
        const first = await session();
        const second = await session("2026-10-10T18:00:00Z");
        const outside = await session("2026-11-10T18:00:00Z");
        const booked = await reserve(first.id);
        expect(booked).toMatchObject({ status: 201, body: { debitedCredits: 0 } });
        expect((await reserve(second.id)).body.code).toBe("UNLIMITED_DAILY_LIMIT");
        expect((await reserve(outside.id)).body.code).toBe("UNLIMITED_MONTH_MISMATCH");
        expect((await cancel(req("/cancel", {}, "PATCH"), ctx(booked.body.bookingId))).status).toBe(200);
        expect((await reserve(second.id)).status).toBe(201);
        await credits(3);
        const nextDay = await session("2026-10-11T18:00:00Z");
        expect((await reserve(nextDay.id)).body.debitedCredits).toBe(0);
        expect((await reserve(outside.id)).body.debitedCredits).toBe(1);
        expect(await prisma.tokenLedger.aggregate({ where: { userId: user.id }, _sum: { delta: true } })).toMatchObject({ _sum: { delta: 2 } });
      });
      it("late cancellation keeps the daily allowance consumed", async () => {
        await assign();
        mocks.actor = user.id;
        const first = await session();
        const second = await session("2026-10-10T18:00:00Z");
        const booked = await reserve(first.id);
        vi.setSystemTime(new Date("2026-10-10T10:00:00Z"));
        expect((await cancel(req("/cancel", {}, "PATCH"), ctx(booked.body.bookingId))).status).toBe(200);
        expect((await reserve(second.id)).body.code).toBe("UNLIMITED_DAILY_LIMIT");
      });
      it("keeps capacity protection when two manually assigned users race for the final seat", async () => {
        await assign();
        const other = await createUser();
        expect((await assignPack(req("/assign", { packId: pack.id }), ctx(other.id))).status).toBe(200);
        const cls = await session(undefined, 1);
        const results = await Promise.allSettled([serialReserve(user.id, cls.id), serialReserve(other.id, cls.id)]);
        expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
        expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "CLASS_FULL" } });
        expect(await prisma.booking.count({ where: { classId: cls.id, status: "ACTIVE" } })).toBe(1);
        expect(await prisma.unlimitedUsage.count({ where: { booking: { classId: cls.id } } })).toBe(1);
      });
    });
    it("partial standard package edits preserve legacy descriptions and unrelated fields", async () => {
      const standard = await credits(3);
      const admin = await createUser("ADMIN");
      mocks.actor = admin.id;
      await prisma.pack.update({
        where: { id: standard.packId },
        data: { description: { legacy: "retained" } },
      });
      const updated = await json(
        await editPack(
          req("/edit", { price: 550 }, "PATCH"),
          ctx(standard.packId),
        ),
      );
      expect(updated).toMatchObject({
        status: 200,
        body: {
          item: {
            type: "STANDARD",
            classes: 3,
            validityDays: 90,
            price: 550,
            description: { legacy: "retained" },
          },
        },
      });
    });
    it("does not pause or extend a purchased calendar month", async () => {
      const purchased = await ownUnlimited();
      const admin = await createUser("ADMIN");
      mocks.actor = admin.id;
      expect(
        (
          await json(
            await pausePack(req("/pause", { days: 5 }), {
              params: Promise.resolve({
                id: user.id,
                purchaseId: purchased.id,
              }),
            }),
          )
        ).body.code,
      ).toBe("UNLIMITED_CANNOT_PAUSE");
      expect(
        (
          await prisma.packPurchase.findUniqueOrThrow({
            where: { id: purchased.id },
          })
        ).expiresAt,
      ).toEqual(purchased.expiresAt);
    });
    it("database protects immutable purchase and payment snapshots", async () => {
      const purchased = await ownUnlimited();
      const payment = await prisma.payment.create({
        data: {
          provider: "ADMIN",
          status: "APPROVED",
          userId: user.id,
          amount: 1500,
          packSnapshot: packageSnapshot(pack),
        },
      });
      await expect(
        prisma.packPurchase.update({
          where: { id: purchased.id },
          data: { unlimitedMonth: 11 },
        }),
      ).rejects.toThrow("PURCHASE_SNAPSHOT_IMMUTABLE");
      await expect(
        prisma.payment.update({
          where: { id: payment.id },
          data: { packSnapshot: {} },
        }),
      ).rejects.toThrow("PAYMENT_PACKAGE_SNAPSHOT_IMMUTABLE");
    });
    it("backfills legacy labels using the historical payment amount", async () => {
      const standard = await credits(3);
      const paid = await prisma.payment.create({
        data: {
          provider: "ADMIN",
          status: "APPROVED",
          userId: user.id,
          amount: 400,
        },
      });
      const legacy = await prisma.packPurchase.create({
        data: {
          userId: user.id,
          packId: standard.packId,
          paymentId: paid.id,
          classesLeft: 3,
          expiresAt: new Date("2026-12-01T06:00:00Z"),
        },
      });
      await prisma.$executeRawUnsafe(
        readFileSync(
          "prisma/migrations/20261011020000_snapshot_existing_purchase_labels/migration.sql",
          "utf8",
        ),
      );
      expect(
        await prisma.packPurchase.findUnique({ where: { id: legacy.id } }),
      ).toMatchObject({
        type: "STANDARD",
        nameSnapshot: expect.any(String),
        priceSnapshot: 400,
        classesLeft: 3,
      });
    });
    it("refuses rescheduling an unreleased claim to another class day", async () => {
      await ownUnlimited();
      const cls = await session();
      await reserve(cls.id);
      const admin = await createUser("ADMIN");
      mocks.actor = admin.id;
      expect(
        (
          await json(
            await updateClass(
              req("/class", { date: "2026-11-01T07:00:00" }, "PUT"),
              ctx(cls.id),
            ),
          )
        ).body.code,
      ).toBe("CLASS_HAS_UNLIMITED_USAGE");
      expect(
        (await prisma.class.findUniqueOrThrow({ where: { id: cls.id } })).date,
      ).toEqual(cls.date);
    });
    it.each(["pending", "rejected", "cancelled"])(
      "payment %s grants no entitlement",
      async (status) => {
        const payment = await pendingPayment();
        expect((await callback(payment, status)).status).toBe(200);
        expect(
          await prisma.packPurchase.count({ where: { userId: user.id } }),
        ).toBe(0);
      },
    );
    it("real signed approved callback grants once, even after catalog editing", async () => {
      const payment = await pendingPayment();
      await prisma.pack.update({
        where: { id: pack.id },
        data: { name: `${run}_edited`, unlimitedMonth: 11, price: 999 },
      });
      expect((await callback(payment, "approved")).status).toBe(200);
      const first = await prisma.packPurchase.findUniqueOrThrow({
        where: { paymentId: payment.id },
      });
      expect(first).toMatchObject({
        type: "MONTHLY_UNLIMITED",
        unlimitedMonth: 10,
        unlimitedYear: 2026,
        nameSnapshot: pack.name,
        priceSnapshot: 1500,
        classesLeft: 0,
      });
      expect((await callback(payment, "approved")).status).toBe(200);
      expect(
        await prisma.packPurchase.count({ where: { userId: user.id } }),
      ).toBe(1);
      expect(
        await prisma.tokenLedger.count({ where: { userId: user.id } }),
      ).toBe(0);
    });
    it("simultaneous signed approved callbacks grant exactly once", async () => {
      const payment = await pendingPayment();
      expect(
        (
          await Promise.all([
            callback(payment, "approved"),
            callback(payment, "approved"),
          ])
        ).map((r) => r.status),
      ).toEqual([200, 200]);
      expect(
        await prisma.packPurchase.count({ where: { paymentId: payment.id } }),
      ).toBe(1);
    });
    it("a refund of a pending payment cannot later grant free access", async () => {
      const payment = await pendingPayment();
      await callback(payment, "refunded");
      await callback(payment, "approved");
      expect(
        await prisma.packPurchase.count({ where: { paymentId: payment.id } }),
      ).toBe(0);
    });
    it("a confirmed partial refund also revokes monthly access", async () => {
      const payment = await pendingPayment();
      await callback(payment, "approved");
      await callback(payment, "approved", true, {
        transaction_amount_refunded: 100,
      });
      expect(
        await prisma.packPurchase.findUnique({
          where: { paymentId: payment.id },
        }),
      ).toMatchObject({
        revokedAt: expect.any(Date),
        revocationReason: "REFUND",
      });
    });
    it("the purchase grant service refuses pending local payments", async () => {
      const payment = await pendingPayment();
      await expect(
        prisma.$transaction((tx) =>
          grantPackagePurchase(tx, {
            userId: user.id,
            packId: pack.id,
            paymentId: payment.id,
            snapshot: packageSnapshot(pack),
          }),
        ),
      ).rejects.toThrow("PACKAGE_PAYMENT_NOT_APPROVED");
      expect(
        await prisma.packPurchase.count({ where: { paymentId: payment.id } }),
      ).toBe(0);
    });
    it("a chargeback after an already processed refund still blocks the account", async () => {
      const payment = await pendingPayment();
      await callback(payment, "approved");
      await callback(payment, "refunded");
      await callback(payment, "charged_back");
      expect(
        await prisma.user.findUnique({ where: { id: user.id } }),
      ).toMatchObject({ bookingBlocked: true });
      expect(
        await prisma.packPurchase.findUnique({
          where: { paymentId: payment.id },
        }),
      ).toMatchObject({
        revokedAt: expect.any(Date),
        revocationReason: "CHARGEBACK",
      });
    });
    it.each(["refunded", "charged_back"])("signed %s after ADMIN revocation still reverses a mixed booking exactly once", async status => {
      const payment = await pendingPayment();
      expect((await callback(payment, "approved")).status).toBe(200);
      const purchase = await prisma.packPurchase.findUniqueOrThrow({ where: { paymentId: payment.id } });
      const regular = await credits(3);
      const booking = await reserve((await session()).id, 2);
      expect(booking).toMatchObject({ status: 201, body: { debitedCredits: 1 } });
      const beforeBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.body.bookingId } });
      expect(beforeBooking.entitlementType).toBe("MIXED");
      mocks.actor = (await createUser("ADMIN")).id;
      // The literal reason deliberately resembles a provider event. Audit origin,
      // rather than free-form text, must distinguish admin and provider actions.
      expect((await revoke(purchase.id, "REFUND")).status).toBe(200);
      const adminRevoked = await prisma.packPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
      const adminAudit = await prisma.tokenLedger.findUniqueOrThrow({ where: { idempotencyKey: "admin-unlimited-revocation:" + purchase.id } });
      expect(await prisma.booking.findUnique({ where: { id: beforeBooking.id } })).toEqual(beforeBooking);
      expect((await prisma.packPurchase.findUniqueOrThrow({ where: { id: regular.id } })).classesLeft).toBe(2);
      vi.setSystemTime(new Date(Date.now() + 60_000));
      expect((await callback(payment, status)).status).toBe(200);
      expect(await prisma.booking.findUnique({ where: { id: beforeBooking.id } })).toMatchObject({ status: "CANCELED", refundToken: true });
      expect((await prisma.packPurchase.findUniqueOrThrow({ where: { id: regular.id } })).classesLeft).toBe(3);
      expect(await prisma.unlimitedUsage.findUnique({ where: { bookingId: beforeBooking.id } })).toMatchObject({ releasedAt: expect.any(Date), releaseReason: "PAYMENT_REVERSAL" });
      expect(await prisma.packPurchase.findUnique({ where: { id: purchase.id } })).toEqual(adminRevoked);
      expect(await prisma.tokenLedger.findUnique({ where: { id: adminAudit.id } })).toEqual(adminAudit);
      expect(await prisma.tokenLedger.findMany({ where: { bookingId: beforeBooking.id, reason: "CANCEL_REFUND" } })).toEqual([expect.objectContaining({ delta: 1, packPurchaseId: regular.id })]);
      expect(await prisma.tokenLedger.findUnique({ where: { idempotencyKey: "monthly-payment-reversal:" + purchase.id } })).toMatchObject({ delta: 0, reason: "ADMIN_ADJUST", packPurchaseId: purchase.id });
      const ledgerAfter = await prisma.tokenLedger.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } });
      const blockLogsAfter = await prisma.bookingBlockLog.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } });
      vi.setSystemTime(new Date(Date.now() + 60_000));
      expect((await callback(payment, status)).status).toBe(200);
      expect(await prisma.tokenLedger.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } })).toEqual(ledgerAfter);
      expect(await prisma.bookingBlockLog.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } })).toEqual(blockLogsAfter);
      expect(await prisma.packPurchase.findUnique({ where: { id: purchase.id } })).toEqual(adminRevoked);
      expect(await prisma.user.findUnique({ where: { id: user.id } })).toMatchObject({ bookingBlocked: status === "charged_back" });
    });
    it("standard signed payments, booking debit and early refund keep the original behavior", async () => {
      await prisma.pack.update({
        where: { id: pack.id },
        data: {
          type: "STANDARD",
          classes: 5,
          validityDays: 30,
          unlimitedMonth: null,
          unlimitedYear: null,
        },
      });
      const payment = await pendingPayment();
      await callback(payment, "approved");
      const purchased = await prisma.packPurchase.findUniqueOrThrow({
        where: { paymentId: payment.id },
      });
      expect(purchased).toMatchObject({ type: "STANDARD", classesLeft: 5 });
      const booking = await reserve((await session()).id);
      expect(booking.body.debitedCredits).toBe(1);
      await cancel(
        req("/cancel", undefined, "PATCH"),
        ctx(booking.body.bookingId),
      );
      expect(
        (
          await prisma.packPurchase.findUniqueOrThrow({
            where: { id: purchased.id },
          })
        ).classesLeft,
      ).toBe(5);
      expect(
        await prisma.unlimitedUsage.count({ where: { userId: user.id } }),
      ).toBe(0);
    });
    it.each(["refunded"])(
      "standard unused credits are revoked once after %s",
      async (status) => {
        await prisma.pack.update({
          where: { id: pack.id },
          data: {
            type: "STANDARD",
            classes: 5,
            validityDays: 30,
            unlimitedMonth: null,
            unlimitedYear: null,
          },
        });
        const payment = await pendingPayment();
        await callback(payment, "approved");
        expect((await callback(payment, status)).status).toBe(200);
        expect((await callback(payment, status)).status).toBe(200);
        const purchased = await prisma.packPurchase.findUniqueOrThrow({
          where: { paymentId: payment.id },
        });
        expect(purchased.classesLeft).toBe(0);
        const balance = await prisma.tokenLedger.aggregate({
          where: { packPurchaseId: purchased.id },
          _sum: { delta: true },
        });
        expect(balance._sum.delta).toBe(0);
        expect(
          (await prisma.checkoutLink.findUniqueOrThrow({
            where: { paymentId: payment.id },
          })).status,
        ).toBe("CANCELED");
        expect((await reserve((await session()).id)).status).toBe(402);
      },
    );
    it("the Wellhub webhook stays inert with both feature flags disabled", async () => {
      const response = await json(await wellhubStub(req("/api/integrations/wellhub/webhook", { event: "booking" })));
      expect(response).toMatchObject({ status: 200, body: { ok: true, result: "DISABLED" } });
      expect(await prisma.booking.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.packPurchase.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.payment.count({ where: { userId: user.id } })).toBe(0);
    });
    it("manual unlimited access and booking preserve production revenue and payroll reports", async () => {
      const admin = await createUser("ADMIN");
      const cls = await session();
      await prisma.class.update({ where: { id: cls.id }, data: { payrollRateSnapshot: 250, payrollRateEffectiveAt: new Date() } });
      mocks.actor = admin.id;
      const revenue = () => revenueReport(req("/api/admin/revenue?month=2026-10", undefined, "GET")).then(json);
      const payroll = () => payrollReport(req("/api/admin/accounting/payroll?month=2026-10", undefined, "GET")).then(json);
      const beforeRevenue = await revenue();
      const beforePayroll = await payroll();
      expect(beforeRevenue.status).toBe(200);
      expect(beforePayroll.status).toBe(200);
      const assigned = await json(await assignPack(req("/assign", { packId: pack.id }), ctx(user.id)));
      expect(assigned.status).toBe(200);
      mocks.actor = user.id;
      expect((await reserve(cls.id)).status).toBe(201);
      mocks.actor = admin.id;
      expect((await revoke(assigned.body.purchase.id)).status).toBe(200);
      expect(await revenue()).toEqual(beforeRevenue);
      expect(await payroll()).toEqual(beforePayroll);
    });
    it("rejects spoofed webhook signatures before contacting the provider", async () => {
      const payment = await pendingPayment();
      const r = await callback(payment, "approved", false);
      expect(r.status).toBe(401);
      expect(mocks.paymentGet).not.toHaveBeenCalled();
      expect(
        await prisma.packPurchase.count({ where: { userId: user.id } }),
      ).toBe(0);
    });
    it.each([
      { transaction_amount: 1 },
      { currency_id: "USD" },
      { external_reference: "untrusted|reference" },
    ])("does not grant mismatched payment terms %j", async (override) => {
      const payment = await pendingPayment();
      expect((await callback(payment, "approved", true, override)).status).toBe(
        409,
      );
      expect(
        await prisma.packPurchase.count({ where: { userId: user.id } }),
      ).toBe(0);
    });
    it("serializes duplicate monthly checkouts and blocks another package for the same month", async () => {
      const attempts = await Promise.all([
        checkout(req("/checkout", { packId: pack.id })),
        checkout(req("/checkout", { packId: pack.id })),
      ]);
      expect(attempts.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await prisma.payment.count({ where: { userId: user.id } })).toBe(
        1,
      );
      await ownUnlimited();
      expect(
        (await checkout(req("/checkout", { packId: pack.id }))).status,
      ).toBe(409);
    });
    it.each(["refunded", "charged_back"])(
      "%s revokes future access, preserves history, and never grants again",
      async (status) => {
        const payment = await pendingPayment();
        await callback(payment, "approved");
        const cls = await session();
        const r = await reserve(cls.id);
        expect((await callback(payment, status)).status).toBe(200);
        const purchased = await prisma.packPurchase.findUniqueOrThrow({
          where: { paymentId: payment.id },
        });
        expect(purchased.revokedAt).not.toBeNull();
        expect(purchased.classesLeft).toBe(0);
        expect(
          await prisma.booking.findUnique({ where: { id: r.body.bookingId } }),
        ).toMatchObject({ status: "CANCELED" });
        expect(
          await prisma.tokenLedger.count({ where: { userId: user.id } }),
        ).toBe(0);
        expect((await callback(payment, "approved")).status).toBe(200);
        expect(
          await prisma.packPurchase.count({ where: { userId: user.id } }),
        ).toBe(1);
        expect(
          await prisma.user.findUnique({ where: { id: user.id } }),
        ).toMatchObject({ bookingBlocked: status === "charged_back" });
      },
    );
    it("refund after spent usage blocks for admin review and retains the consumed claim", async () => {
      const payment = await pendingPayment();
      await callback(payment, "approved");
      const cls = await session();
      const r = await reserve(cls.id);
      vi.setSystemTime(new Date(cls.date.getTime() - 60_000));
      await cancel(req("/cancel", undefined, "PATCH"), ctx(r.body.bookingId));
      expect((await callback(payment, "refunded")).body.debt).toBe(true);
      expect(
        await prisma.user.findUnique({ where: { id: user.id } }),
      ).toMatchObject({ bookingBlocked: true });
      expect(
        (
          await prisma.unlimitedUsage.findUniqueOrThrow({
            where: { bookingId: r.body.bookingId },
          })
        ).releasedAt,
      ).toBeNull();
    });
    it("mixed future payment reversal refunds only actual standard-credit debits", async () => {
      const unlimited = await ownUnlimited();
      const regular = await credits(3);
      const r = await reserve((await session()).id, 2);
      await prisma.$transaction(
        (tx) => revokeUnlimitedPurchase(tx, unlimited.id, "REFUND"),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      expect(
        await prisma.packPurchase.findUnique({ where: { id: regular.id } }),
      ).toMatchObject({ classesLeft: 3 });
      expect(
        await prisma.tokenLedger.count({
          where: { bookingId: r.body.bookingId, reason: "CANCEL_REFUND" },
        }),
      ).toBe(1);
    });
    it("dashboard retains chronological pagination and labels unlimited bookings", async () => {
      await ownUnlimited();
      await reserve((await session()).id);
      const history = await json(
        await getPacks(req("/api/users/me/packs", undefined, "GET")),
      );
      expect(history.body).toMatchObject({
        page: 1,
        totalItems: 1,
        items: [
          { type: "MONTHLY_UNLIMITED", classesLeft: 0, unlimitedMonth: 10 },
        ],
      });
      const bookings = await json(
        await getBookings(
          req("/api/users/me/bookings?section=upcoming", undefined, "GET"),
        ),
      );
      expect(bookings.body.items[0].entitlementType).toBe("MONTHLY_UNLIMITED");
    });
    it("unlimited summary is private and contains only the authenticated account's claims", async () => {
      await ownUnlimited();
      await reserve((await session()).id);
      const summary = await json(
        await getUnlimitedSummary(
          req("/api/users/me/unlimited", undefined, "GET"),
        ),
      );
      expect(summary.body).toMatchObject({
        purchases: [{ month: 10, year: 2026, available: true }],
        consumedDates: ["2026-10-10"],
      });
      mocks.actor = (await createUser()).id;
      expect(
        (
          await json(
            await getUnlimitedSummary(
              req("/api/users/me/unlimited", undefined, "GET"),
            ),
          )
        ).body,
      ).toEqual({ purchases: [], consumedDates: [] });
      mocks.actor = "";
      expect(
        (
          await getUnlimitedSummary(
            req("/api/users/me/unlimited", undefined, "GET"),
          )
        ).status,
      ).toBe(401);
    });
    it("keeps ownership, blocking, duplicates, corporate quantities, and capacity protections", async () => {
      await ownUnlimited();
      const cls = await session(undefined, 1);
      const r = await reserve(cls.id);
      expect((await reserve(cls.id)).status).toBe(409);
      const other = await createUser();
      mocks.actor = other.id;
      expect(
        (
          await cancel(
            req("/cancel", undefined, "PATCH"),
            ctx(r.body.bookingId),
          )
        ).status,
      ).toBe(403);
      await prisma.user.update({
        where: { id: other.id },
        data: { bookingBlocked: true },
      });
      expect((await reserve((await session()).id)).status).toBe(403);
      await prisma.user.update({
        where: { id: other.id },
        data: { bookingBlocked: false, affiliation: "TOTALPASS" },
      });
      expect((await reserve((await session()).id, 2)).status).toBe(403);
      mocks.actor = "";
      expect((await reserve((await session()).id)).status).toBe(401);
    });
  },
);
