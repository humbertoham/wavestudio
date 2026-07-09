import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    class: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getAuthFromRequest: mocks.getAuthFromRequest,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { GET } from "./route";

function req() {
  return new Request("https://example.test/api/classes/class_1") as any;
}

function ctx(id = "class_1") {
  return { params: Promise.resolve({ id }) };
}

function authUser(role: "USER" | "COACH" | "ADMIN") {
  return {
    id: `${role.toLowerCase()}_1`,
    role,
    email: `${role.toLowerCase()}@example.test`,
    name: role,
  };
}

function classPayload() {
  return {
    id: "class_1",
    title: "Strength",
    focus: "Full body",
    date: new Date("2026-06-23T23:00:00.000Z"),
    durationMin: 60,
    capacity: 12,
    isCanceled: false,
    instructor: { id: "instructor_1", name: "Coach" },
    bookings: [],
    waitlist: [],
  };
}

describe("GET /api/classes/[id]", () => {
  beforeEach(() => {
    mocks.getAuthFromRequest.mockResolvedValue({ sub: "actor_1" });
    mocks.prisma.class.findUnique.mockResolvedValue(classPayload());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("allows admins to load class-management detail", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(authUser("ADMIN"));

    const res = await GET(req(), ctx());

    expect(res.status).toBe(200);
    expect(mocks.prisma.class.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "class_1" } })
    );
  });

  it("allows coaches to load class-management detail", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(authUser("COACH"));

    const res = await GET(req(), ctx());

    expect(res.status).toBe(200);
    expect(mocks.prisma.class.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "class_1" } })
    );
  });

  it("blocks regular users from class-management detail", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(authUser("USER"));

    const res = await GET(req(), ctx());

    await expect(res.json()).resolves.toMatchObject({
      error: "FORBIDDEN",
    });
    expect(res.status).toBe(403);
    expect(mocks.prisma.class.findUnique).not.toHaveBeenCalled();
  });
});
