import { randomUUID } from "node:crypto";

import { BookingStatus, Role, TokenReason } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  getAuthFromRequest: vi.fn(async () => ({ sub: authState.userId })),
  getAuth: vi.fn(async () => null),
  requireAdmin: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { GET as GET_PUBLIC_CLASSES } from "@/app/api/classes/route";
import {
  DELETE as DELETE_FROM_DETAIL,
  GET as GET_CLASS_DETAIL,
} from "@/app/api/classes/[id]/route";
import { DELETE } from "./route";

const describeWithDatabase =
  process.env.RUN_CLASS_DELETION_INTEGRATION === "1" ? describe : describe.skip;

function req(classId: string) {
  return new Request(`https://example.test/api/admin/classes/${classId}`, {
    method: "DELETE",
  }) as any;
}

function ctx(classId: string) {
  return { params: Promise.resolve({ id: classId }) };
}

describeWithDatabase("class deletion database integration", () => {
  let userId: string;
  let instructorId: string;
  const classIds = new Set<string>();

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    const suffix = randomUUID();
    const [user, instructor] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Class deletion integration admin",
          email: `class-delete-${suffix}@example.test`,
          passwordHash: "integration-test-only",
          role: Role.ADMIN,
        },
        select: { id: true },
      }),
      prisma.instructor.create({
        data: { name: `Class deletion integration ${suffix}` },
        select: { id: true },
      }),
    ]);

    userId = user.id;
    instructorId = instructor.id;
    authState.userId = userId;
  });

  afterEach(async () => {
    const ids = [...classIds];

    await prisma.tokenLedger.deleteMany({ where: { userId } });
    await prisma.waitlist.deleteMany({ where: { classId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { classId: { in: ids } } });
    await prisma.class.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.instructor.deleteMany({ where: { id: instructorId } });
    classIds.clear();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createClass() {
    const cls = await prisma.class.create({
      data: {
        title: "Class deletion integration",
        focus: "Integration",
        date: new Date(Date.now() + 86_400_000),
        durationMin: 60,
        capacity: 8,
        instructorId,
      },
      select: { id: true },
    });
    classIds.add(cls.id);
    return cls;
  }

  it("physically deletes a class with no dependencies", async () => {
    const cls = await createClass();

    const res = await DELETE(req(cls.id), ctx(cls.id));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      hardDeleted: true,
      archived: false,
    });
    await expect(
      prisma.class.findUnique({ where: { id: cls.id } })
    ).resolves.toBeNull();

    const calendar = await GET_PUBLIC_CLASSES(
      new Request("https://example.test/api/classes")
    );
    expect((await calendar.json()).some((item: { id: string }) => item.id === cls.id)).toBe(false);
  });

  it("archives cancelled booking history without erasing attendance or audit rows", async () => {
    const cls = await createClass();
    const booking = await prisma.booking.create({
      data: {
        classId: cls.id,
        userId,
        status: BookingStatus.CANCELED,
        canceledAt: new Date(),
        attended: true,
        refundToken: true,
      },
      select: { id: true },
    });
    const ledger = await prisma.tokenLedger.create({
      data: {
        userId,
        bookingId: booking.id,
        delta: 1,
        reason: TokenReason.CANCEL_REFUND,
      },
      select: { id: true },
    });

    const res = await DELETE(req(cls.id), ctx(cls.id));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      archived: true,
      preservedInactiveBookingCount: 1,
    });
    await expect(
      prisma.class.findUnique({ where: { id: cls.id } })
    ).resolves.toMatchObject({ isCanceled: false, deletedAt: expect.any(Date) });
    await expect(
      prisma.booking.findUnique({ where: { id: booking.id } })
    ).resolves.toMatchObject({
      status: BookingStatus.CANCELED,
      attended: true,
      refundToken: true,
    });
    await expect(
      prisma.tokenLedger.findUnique({ where: { id: ledger.id } })
    ).resolves.toMatchObject({ bookingId: booking.id });

    const calendar = await GET_PUBLIC_CLASSES(
      new Request("https://example.test/api/classes")
    );
    expect((await calendar.json()).some((item: { id: string }) => item.id === cls.id)).toBe(false);

    const detail = await GET_CLASS_DETAIL(req(cls.id), ctx(cls.id));
    expect(detail.status).toBe(404);
  });

  it("uses the same deletion service from the coach class-detail flow", async () => {
    const cls = await createClass();
    await prisma.user.update({
      where: { id: userId },
      data: { role: Role.COACH },
    });

    const response = await DELETE_FROM_DETAIL(
      new Request(`https://example.test/api/classes/${cls.id}`, {
        method: "DELETE",
      }) as any,
      ctx(cls.id)
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      hardDeleted: true,
    });
    await expect(
      prisma.class.findUnique({ where: { id: cls.id } })
    ).resolves.toBeNull();
  });

  it("blocks an active booking but ignores removed waitlist history", async () => {
    const cls = await createClass();
    await prisma.booking.create({
      data: {
        classId: cls.id,
        userId,
        status: BookingStatus.ACTIVE,
      },
    });
    const removedEntry = await prisma.waitlist.create({
      data: {
        classId: cls.id,
        userId,
        position: 1,
      },
      select: { id: true },
    });
    await prisma.waitlist.delete({ where: { id: removedEntry.id } });

    const res = await DELETE(req(cls.id), ctx(cls.id));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      code: "CLASS_HAS_ACTIVE_DEPENDENCIES",
      details: { activeBookingCount: 1, activeWaitlistCount: 0 },
    });
    await expect(
      prisma.class.findUnique({ where: { id: cls.id } })
    ).resolves.not.toBeNull();
  });

  it("blocks an existing waitlist row", async () => {
    const cls = await createClass();
    await prisma.waitlist.create({
      data: {
        classId: cls.id,
        userId,
        position: 1,
      },
    });

    const res = await DELETE(req(cls.id), ctx(cls.id));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      code: "CLASS_HAS_ACTIVE_DEPENDENCIES",
      details: { activeBookingCount: 0, activeWaitlistCount: 1 },
    });
    await expect(
      prisma.class.findUnique({ where: { id: cls.id } })
    ).resolves.not.toBeNull();
  });

  it("never leaves an orphan during a concurrent booking/delete attempt", async () => {
    const cls = await createClass();

    const [deleteResult, bookingResult] = await Promise.allSettled([
      DELETE(req(cls.id), ctx(cls.id)),
      prisma.booking.create({
        data: {
          classId: cls.id,
          guestName: "Concurrent integration guest",
          status: BookingStatus.ACTIVE,
        },
      }),
    ]);

    expect(deleteResult.status).toBe("fulfilled");

    const [classAfter, bookingCount] = await Promise.all([
      prisma.class.findUnique({ where: { id: cls.id } }),
      prisma.booking.count({ where: { classId: cls.id } }),
    ]);

    if (bookingResult.status === "fulfilled") {
      expect(classAfter).not.toBeNull();
      expect(bookingCount).toBe(1);
      expect((deleteResult as PromiseFulfilledResult<Response>).value.status).toBe(409);
    } else {
      expect(classAfter).toBeNull();
      expect(bookingCount).toBe(0);
    }
  });
});
