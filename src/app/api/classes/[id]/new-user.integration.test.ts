import { randomUUID } from "node:crypto";

import { Affiliation, BookingStatus, Role } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  userId: "",
  role: "USER" as "USER" | "COACH" | "ADMIN",
}));

vi.mock("@/lib/auth", () => ({
  getAuthFromRequest: vi.fn(async () => ({
    sub: authState.userId,
    role: authState.role,
  })),
  getAuth: vi.fn(async () => ({
    sub: authState.userId,
    role: authState.role,
  })),
}));

import { prisma } from "@/lib/prisma";
import { PATCH as UPDATE_ATTENDANCE } from "../../admin/bookings/[id]/attendance/route";
import { POST as PROMOTE_WAITLIST } from "../../admin/classes/[id]/waitlist/[entryId]/promote/route";
import { PATCH as CANCEL_BOOKING } from "../../bookings/[id]/cancel/route";
import { POST as CREATE_BOOKING } from "../../bookings/route";
import { GET as GET_CLASS } from "./route";

const describeWithDatabase =
  process.env.RUN_NEW_USER_INTEGRATION === "1" ? describe : describe.skip;

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as any;
}

describeWithDatabase("NEW USER database integration", () => {
  let coachId: string;
  let instructorId: string;
  let packId: string;
  const userIds = new Set<string>();
  const classIds = new Set<string>();

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    const suffix = randomUUID();
    const [coach, instructor, pack] = await Promise.all([
      prisma.user.create({
        data: {
          name: "NEW USER integration coach",
          email: `new-user-coach-${suffix}@example.test`,
          passwordHash: "integration-test-only",
          role: Role.COACH,
        },
        select: { id: true },
      }),
      prisma.instructor.create({
        data: { name: `NEW USER integration ${suffix}` },
        select: { id: true },
      }),
      prisma.pack.create({
        data: {
          name: `NEW USER integration ${suffix}`,
          classes: 20,
          price: 1,
          validityDays: 30,
        },
        select: { id: true },
      }),
    ]);

    coachId = coach.id;
    instructorId = instructor.id;
    packId = pack.id;
    userIds.add(coachId);
  });

  afterEach(async () => {
    const users = [...userIds];
    const classes = [...classIds];

    await prisma.tokenLedger.deleteMany({ where: { userId: { in: users } } });
    await prisma.waitlist.deleteMany({
      where: { OR: [{ userId: { in: users } }, { classId: { in: classes } }] },
    });
    await prisma.booking.deleteMany({
      where: { OR: [{ userId: { in: users } }, { classId: { in: classes } }] },
    });
    await prisma.packPurchase.deleteMany({ where: { userId: { in: users } } });
    await prisma.class.deleteMany({ where: { id: { in: classes } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.pack.deleteMany({ where: { id: packId } });
    await prisma.instructor.deleteMany({ where: { id: instructorId } });
    userIds.clear();
    classIds.clear();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createUser(affiliation: Affiliation = Affiliation.NONE) {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: {
        name: `NEW USER integration ${affiliation}`,
        email: `new-user-${suffix}@example.test`,
        passwordHash: "integration-test-only",
        affiliation,
      },
      select: { id: true },
    });
    userIds.add(user.id);

    await prisma.packPurchase.create({
      data: {
        userId: user.id,
        packId,
        classesLeft: 20,
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });

    return user;
  }

  async function createClass(options: { isCanceled?: boolean } = {}) {
    const cls = await prisma.class.create({
      data: {
        title: "NEW USER integration",
        focus: "Integration",
        date: new Date(Date.now() + (classIds.size + 1) * 86_400_000),
        durationMin: 60,
        capacity: 12,
        instructorId,
        isCanceled: options.isCanceled ?? false,
      },
      select: { id: true },
    });
    classIds.add(cls.id);
    return cls;
  }

  async function detail(classId: string) {
    authState.userId = coachId;
    authState.role = "COACH";
    const res = await GET_CLASS(
      jsonRequest(`https://example.test/api/classes/${classId}`, "GET"),
      { params: Promise.resolve({ id: classId }) }
    );
    expect(res.status).toBe(200);
    return res.json();
  }

  async function book(userId: string, classId: string) {
    authState.userId = userId;
    authState.role = "USER";
    return CREATE_BOOKING(
      jsonRequest("https://example.test/api/bookings", "POST", { classId })
    );
  }

  it("marks a booking created by the real booking transaction as NEW USER", async () => {
    const [user, cls] = await Promise.all([createUser(), createClass()]);

    const created = await book(user.id, cls.id);
    expect(created.status).toBe(201);
    const bookingId = (await created.json()).bookingId as string;

    const body = await detail(cls.id);
    expect(body.bookings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: bookingId,
          isNewUser: true,
          isFirstBooking: true,
        }),
      ])
    );

    const duplicate = await book(user.id, cls.id);
    expect(duplicate.status).toBe(409);
  });

  it("marks only the earliest of multiple future bookings before attendance", async () => {
    const user = await createUser();
    const firstClass = await createClass();
    const secondClass = await createClass();
    const first = await prisma.booking.create({
      data: {
        userId: user.id,
        classId: firstClass.id,
        status: BookingStatus.ACTIVE,
        createdAt: new Date("2026-07-01T10:00:00.000Z"),
      },
    });
    const second = await prisma.booking.create({
      data: {
        userId: user.id,
        classId: secondClass.id,
        status: BookingStatus.ACTIVE,
        createdAt: new Date("2026-07-01T11:00:00.000Z"),
      },
    });

    const [firstBody, secondBody] = await Promise.all([
      detail(firstClass.id),
      detail(secondClass.id),
    ]);

    expect(firstBody.bookings.find((item: { id: string }) => item.id === first.id))
      .toMatchObject({ isNewUser: true });
    expect(secondBody.bookings.find((item: { id: string }) => item.id === second.id))
      .toMatchObject({ isNewUser: false });
  });

  it("marks a rebooking as NEW USER after the first booking is cancelled", async () => {
    const user = await createUser();
    const firstClass = await createClass();
    const secondClass = await createClass();

    const firstCreated = await book(user.id, firstClass.id);
    expect(firstCreated.status).toBe(201);
    const firstBookingId = (await firstCreated.json()).bookingId as string;

    authState.userId = user.id;
    authState.role = "USER";
    const cancelled = await CANCEL_BOOKING(
      jsonRequest(
        `https://example.test/api/bookings/${firstBookingId}/cancel`,
        "PATCH"
      ),
      { params: Promise.resolve({ id: firstBookingId }) }
    );
    expect(cancelled.status).toBe(200);

    const rebooked = await book(user.id, secondClass.id);
    expect(rebooked.status).toBe(201);
    const rebookedId = (await rebooked.json()).bookingId as string;
    const body = await detail(secondClass.id);

    expect(body.bookings.find((item: { id: string }) => item.id === rebookedId))
      .toMatchObject({ isNewUser: true });
  });

  it("ignores otherwise active history that belongs to a cancelled class", async () => {
    const user = await createUser();
    const cancelledClass = await createClass({ isCanceled: true });
    const currentClass = await createClass();
    await prisma.booking.create({
      data: {
        userId: user.id,
        classId: cancelledClass.id,
        status: BookingStatus.ACTIVE,
        createdAt: new Date("2026-07-01T09:00:00.000Z"),
      },
    });
    const current = await prisma.booking.create({
      data: {
        userId: user.id,
        classId: currentClass.id,
        status: BookingStatus.ACTIVE,
        createdAt: new Date("2026-07-01T10:00:00.000Z"),
      },
    });

    const body = await detail(currentClass.id);

    expect(body.bookings.find((item: { id: string }) => item.id === current.id))
      .toMatchObject({ isNewUser: true });
  });

  it("keeps only the first qualifying booking marked after attendance", async () => {
    const user = await createUser(Affiliation.WELLHUB);
    const firstClass = await createClass();
    const secondClass = await createClass();
    const first = await prisma.booking.create({
      data: {
        userId: user.id,
        classId: firstClass.id,
        status: BookingStatus.ACTIVE,
        createdAt: new Date("2026-07-01T10:00:00.000Z"),
      },
    });
    const second = await prisma.booking.create({
      data: {
        userId: user.id,
        classId: secondClass.id,
        status: BookingStatus.ACTIVE,
        createdAt: new Date("2026-07-01T11:00:00.000Z"),
      },
    });

    authState.userId = coachId;
    authState.role = "COACH";
    const attendance = await UPDATE_ATTENDANCE(
      jsonRequest(
        `https://example.test/api/admin/bookings/${first.id}/attendance`,
        "PATCH",
        { attended: true }
      ),
      { params: Promise.resolve({ id: first.id }) }
    );
    expect(attendance.status).toBe(200);

    const [firstBody, secondBody] = await Promise.all([
      detail(firstClass.id),
      detail(secondClass.id),
    ]);
    expect(firstBody.bookings.find((item: { id: string }) => item.id === first.id))
      .toMatchObject({ attended: true, isNewUser: true });
    expect(secondBody.bookings.find((item: { id: string }) => item.id === second.id))
      .toMatchObject({ isNewUser: false });
  });

  it("classifies a first booking created by waitlist promotion and preserves guests", async () => {
    const user = await createUser(Affiliation.TOTALPASS);
    const cls = await createClass();
    const entry = await prisma.waitlist.create({
      data: { userId: user.id, classId: cls.id, position: 1 },
    });
    await prisma.booking.create({
      data: {
        classId: cls.id,
        guestName: "Integration guest",
        status: BookingStatus.ACTIVE,
      },
    });

    authState.userId = coachId;
    authState.role = "COACH";
    const promoted = await PROMOTE_WAITLIST(
      jsonRequest(
        `https://example.test/api/admin/classes/${cls.id}/waitlist/${entry.id}/promote`,
        "POST"
      ),
      { params: Promise.resolve({ id: cls.id, entryId: entry.id }) }
    );
    expect(promoted.status).toBe(200);
    const promotedBookingId = (await promoted.json()).bookingId as string;

    const body = await detail(cls.id);
    expect(body.bookings.find((item: { id: string }) => item.id === promotedBookingId))
      .toMatchObject({ isNewUser: true });
    expect(body.bookings.find((item: { guestName?: string }) => item.guestName))
      .toMatchObject({ isNewUser: false });
  });
});
