import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    booking: {
      count: vi.fn(),
    },
    waitlist: {
      count: vi.fn(),
    },
    class: {
      delete: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getAuthFromRequest: mocks.getAuthFromRequest,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { DELETE } from "./route";

function req() {
  return new Request("https://example.test/api/admin/classes/class_1") as any;
}

function ctx(id = "class_1") {
  return { params: Promise.resolve({ id }) };
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("blocks deletion when active bookings exist", async () => {
    mocks.prisma.booking.count.mockResolvedValue(1);
    mocks.prisma.waitlist.count.mockResolvedValue(0);

    const res = await DELETE(req(), ctx());

    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      code: "CLASS_HAS_DEPENDENCIES",
      details: { bookings: 1, waitlist: 0 },
    });
    expect(res.status).toBe(409);
    expect(mocks.prisma.class.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.class.update).not.toHaveBeenCalled();
  });

  it("blocks deletion when waitlist entries exist", async () => {
    mocks.prisma.booking.count.mockResolvedValue(0);
    mocks.prisma.waitlist.count.mockResolvedValue(2);

    const res = await DELETE(req(), ctx());

    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      code: "CLASS_HAS_DEPENDENCIES",
      details: { bookings: 0, waitlist: 2 },
    });
    expect(res.status).toBe(409);
    expect(mocks.prisma.class.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.class.update).not.toHaveBeenCalled();
  });

  it("hard-deletes a class when no active bookings or waitlist entries exist", async () => {
    mocks.prisma.booking.count.mockResolvedValue(0);
    mocks.prisma.waitlist.count.mockResolvedValue(0);
    mocks.prisma.class.delete.mockResolvedValue({ id: "class_1" });

    const res = await DELETE(req(), ctx());

    await expect(res.json()).resolves.toEqual({
      ok: true,
      hardDeleted: true,
    });
    expect(res.status).toBe(200);
    expect(mocks.prisma.class.delete).toHaveBeenCalledWith({
      where: { id: "class_1" },
    });
    expect(mocks.prisma.class.update).not.toHaveBeenCalled();
  });
});
