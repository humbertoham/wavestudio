import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    pack: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { GET } from "./route";

describe("GET /api/packs", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("only queries active and visible packs for public pricing", async () => {
    mocks.prisma.pack.findMany.mockResolvedValue([
      {
        id: "public_pack",
        name: "Public Pack",
        classes: 4,
        price: 500,
        validityDays: 30,
        classesLabel: null,
        highlight: null,
        description: ["Public"],
        oncePerUser: false,
      },
    ]);

    const res = await GET();

    await expect(res.json()).resolves.toEqual([
      {
        id: "public_pack",
        name: "Public Pack",
        classesLabel: "4 clases",
        classesCount: 4,
        price: 500,
        validity: "Vigencia de 30 días",
        validityDays: 30,
        highlight: null,
        description: ["Public"],
        oncePerUser: false,
      },
    ]);
    expect(mocks.prisma.pack.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, isVisible: true },
      })
    );
  });
});
