import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const booking = {
    count: vi.fn(),
    deleteMany: vi.fn(),
  };
  const waitlist = {
    count: vi.fn(),
    deleteMany: vi.fn(),
  };
  const classDelegate = {
    findUnique: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  };
  const tokenLedger = {
    deleteMany: vi.fn(),
  };
  const tx = {
    booking,
    waitlist,
    class: classDelegate,
    tokenLedger,
  };

  return {
    getAuthFromRequest: vi.fn(),
    tx,
    prisma: {
      user: {
        findUnique: vi.fn(),
      },
      booking,
      waitlist,
      class: classDelegate,
      tokenLedger,
      $transaction: vi.fn(),
    },
  };
});

vi.mock("@/lib/auth", () => ({
  getAuthFromRequest: mocks.getAuthFromRequest,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { DELETE } from "./route";

function req() {
  return new Request("https://example.test/api/admin/classes/class_1", {
    method: "DELETE",
  }) as any;
}

function ctx(id = "class_1") {
  return { params: Promise.resolve({ id }) };
}

function retryableError(code: "P2003" | "P2034" = "P2034") {
  return new Prisma.PrismaClientKnownRequestError("concurrent class change", {
    code,
    clientVersion: "test",
  });
}

describe("DELETE /api/admin/classes/[id]", () => {
  beforeEach(() => {
    mocks.getAuthFromRequest.mockResolvedValue({ sub: "admin_1" });
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "admin_1",
      role: "ADMIN",
      email: "admin@example.test",
      name: "Admin",
    });
    mocks.tx.class.findUnique.mockResolvedValue({ id: "class_1" });
    mocks.tx.booking.count.mockResolvedValue(0);
    mocks.tx.waitlist.count.mockResolvedValue(0);
    mocks.tx.class.delete.mockResolvedValue({ id: "class_1" });
    mocks.tx.class.update.mockResolvedValue({
      id: "class_1",
      isCanceled: true,
    });
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("hard-deletes a class with no bookings and no waitlist", async () => {
    const res = await DELETE(req(), ctx());

    await expect(res.json()).resolves.toEqual({
      ok: true,
      hardDeleted: true,
      archived: false,
    });
    expect(res.status).toBe(200);
    expect(mocks.tx.class.delete).toHaveBeenCalledWith({
      where: { id: "class_1" },
    });
    expect(mocks.tx.class.update).not.toHaveBeenCalled();
  });

  it("archives a class with only cancelled bookings and preserves its history", async () => {
    mocks.tx.booking.count.mockImplementation(async ({ where }) =>
      typeof where.status === "object" ? 2 : 0
    );

    const res = await DELETE(req(), ctx());

    await expect(res.json()).resolves.toEqual({
      ok: true,
      hardDeleted: false,
      archived: true,
      preservedInactiveBookingCount: 2,
    });
    expect(res.status).toBe(200);
    expect(mocks.tx.booking.count).toHaveBeenNthCalledWith(1, {
      where: { classId: "class_1", status: "ACTIVE" },
    });
    expect(mocks.tx.booking.count).toHaveBeenNthCalledWith(2, {
      where: { classId: "class_1", status: { not: "ACTIVE" } },
    });
    expect(mocks.tx.class.update).toHaveBeenCalledWith({
      where: { id: "class_1" },
      data: { isCanceled: true },
    });
    expect(mocks.tx.class.delete).not.toHaveBeenCalled();
    expect(mocks.tx.booking.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.tokenLedger.deleteMany).not.toHaveBeenCalled();
  });

  it("does not count a previously removed waitlist entry as active", async () => {
    const res = await DELETE(req(), ctx());

    expect(res.status).toBe(200);
    expect(mocks.tx.waitlist.count).toHaveBeenCalledWith({
      where: { classId: "class_1" },
    });
    expect(mocks.tx.waitlist.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.class.delete).toHaveBeenCalled();
  });

  it("returns 409 and leaves the class present when an active booking exists", async () => {
    mocks.tx.booking.count.mockResolvedValue(1);

    const res = await DELETE(req(), ctx());

    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      code: "CLASS_HAS_ACTIVE_DEPENDENCIES",
      details: { activeBookingCount: 1, activeWaitlistCount: 0 },
    });
    expect(res.status).toBe(409);
    expect(mocks.tx.class.delete).not.toHaveBeenCalled();
    expect(mocks.tx.class.update).not.toHaveBeenCalled();
  });

  it("returns 409 and leaves the class present when an active waitlist row exists", async () => {
    mocks.tx.waitlist.count.mockResolvedValue(1);

    const res = await DELETE(req(), ctx());

    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      code: "CLASS_HAS_ACTIVE_DEPENDENCIES",
      details: { activeBookingCount: 0, activeWaitlistCount: 1 },
    });
    expect(res.status).toBe(409);
    expect(mocks.tx.class.delete).not.toHaveBeenCalled();
    expect(mocks.tx.class.update).not.toHaveBeenCalled();
  });

  it("blocks on the active booking even when cancelled bookings also exist", async () => {
    mocks.tx.booking.count.mockResolvedValue(1);

    const res = await DELETE(req(), ctx());

    expect(res.status).toBe(409);
    expect(mocks.tx.booking.count).toHaveBeenCalledTimes(1);
    expect(mocks.tx.class.delete).not.toHaveBeenCalled();
    expect(mocks.tx.class.update).not.toHaveBeenCalled();
  });

  it("preserves attendance and cancellation audit data while archiving", async () => {
    mocks.tx.booking.count.mockImplementation(async ({ where }) =>
      typeof where.status === "object" ? 1 : 0
    );

    const res = await DELETE(req(), ctx());

    expect(res.status).toBe(200);
    expect(mocks.tx.class.update).toHaveBeenCalledWith({
      where: { id: "class_1" },
      data: { isCanceled: true },
    });
    expect(mocks.tx.booking.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.tokenLedger.deleteMany).not.toHaveBeenCalled();
  });

  it("does not leave a partial deletion when the transaction fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.tx.booking.count.mockImplementation(async ({ where }) =>
      typeof where.status === "object" ? 1 : 0
    );
    mocks.tx.class.update.mockRejectedValue(new Error("database unavailable"));

    const res = await DELETE(req(), ctx());

    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      code: "UNEXPECTED_ERROR",
    });
    expect(res.status).toBe(500);
    expect(mocks.tx.class.delete).not.toHaveBeenCalled();
    expect(mocks.tx.booking.deleteMany).not.toHaveBeenCalled();
  });

  it("rechecks dependencies after a concurrent booking/delete conflict", async () => {
    mocks.prisma.$transaction
      .mockRejectedValueOnce(retryableError())
      .mockImplementationOnce(
        async (callback: (tx: typeof mocks.tx) => unknown) => {
          mocks.tx.booking.count.mockResolvedValue(1);
          return callback(mocks.tx);
        }
      );

    const res = await DELETE(req(), ctx());

    await expect(res.json()).resolves.toMatchObject({
      code: "CLASS_HAS_ACTIVE_DEPENDENCIES",
      details: { activeBookingCount: 1 },
    });
    expect(res.status).toBe(409);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.tx.class.delete).not.toHaveBeenCalled();
  });

  it("returns a stable conflict after repeated concurrent changes", async () => {
    mocks.prisma.$transaction.mockRejectedValue(retryableError("P2003"));

    const res = await DELETE(req(), ctx());

    await expect(res.json()).resolves.toMatchObject({
      code: "CLASS_DELETE_CONFLICT",
    });
    expect(res.status).toBe(409);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it("returns 404 when the class no longer exists", async () => {
    mocks.tx.class.findUnique.mockResolvedValue(null);

    const res = await DELETE(req(), ctx());

    await expect(res.json()).resolves.toMatchObject({
      code: "CLASS_NOT_FOUND",
    });
    expect(res.status).toBe(404);
  });

  it.each(["USER", "COACH"])(
    "does not allow a %s to delete a class",
    async (role) => {
      mocks.prisma.user.findUnique.mockResolvedValue({
        id: "user_1",
        role,
        email: "user@example.test",
        name: "User",
      });

      const res = await DELETE(req(), ctx());

      expect(res.status).toBe(401);
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  it("requires an authenticated administrator", async () => {
    mocks.getAuthFromRequest.mockResolvedValue(null);

    const res = await DELETE(req(), ctx());

    expect(res.status).toBe(401);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("runs the dependency check and mutation in one serializable transaction", async () => {
    const res = await DELETE(req(), ctx());

    expect(res.status).toBe(200);
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  });
});
