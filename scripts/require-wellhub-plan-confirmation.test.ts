import { describe, expect, it, vi } from "vitest";

import {
  parseCommandArgs,
  resolveDatabaseTarget,
  runCampaignCommand,
} from "./require-wellhub-plan-confirmation.mjs";

type FakeUser = {
  id: string;
  affiliation: "WELLHUB" | "TOTALPASS" | "NONE";
  role: "USER" | "COACH" | "ADMIN";
  bookingBlocked: boolean;
  wellhubPlan: string | null;
  authVersion: number;
  wellhubPlanConfirmationRequired: boolean;
  wellhubPlanConfirmationCampaign: string | null;
};

function fakePrisma(initialUsers: FakeUser[]) {
  const users = initialUsers.map((user) => ({ ...user }));
  const records: Array<{
    campaign: string;
    userId: string;
    status: "PENDING" | "COMPLETED";
  }> = [];
  const credits = new Map(users.map((user) => [user.id, 7]));

  const matchesUser = (user: FakeUser, where: any) =>
    (!where?.affiliation || user.affiliation === where.affiliation) &&
    (!where?.id || user.id === where.id);

  const confirmation = {
    count: vi.fn(async ({ where }: any) =>
      records.filter((record) => {
        const user = users.find((item) => item.id === record.userId)!;
        return (
          record.campaign === where.campaign &&
          (!where.status || record.status === where.status) &&
          matchesUser(user, where.user)
        );
      }).length
    ),
    findMany: vi.fn(async ({ where }: any) =>
      records
        .filter(
          (record) =>
            record.campaign === where.campaign &&
            where.userId.in.includes(record.userId)
        )
        .map((record) => ({ userId: record.userId }))
    ),
    createMany: vi.fn(async ({ data }: any) => {
      for (const row of data) {
        if (
          !records.some(
            (record) =>
              record.campaign === row.campaign &&
              record.userId === row.userId
          )
        ) {
          records.push({
            campaign: row.campaign,
            userId: row.userId,
            status: row.status,
          });
        }
      }
      return { count: data.length };
    }),
  };

  const user = {
    count: vi.fn(async ({ where }: any) =>
      users.filter((item) => matchesUser(item, where)).length
    ),
    findMany: vi.fn(async ({ where, take, cursor, skip }: any) => {
      const sorted = users
        .filter((item) => matchesUser(item, where))
        .sort((a, b) => a.id.localeCompare(b.id));
      const start = cursor
        ? sorted.findIndex((item) => item.id === cursor.id) + (skip ?? 0)
        : 0;
      return sorted.slice(start, start + take).map(({ id }) => ({ id }));
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const item of users) {
        if (
          !where.id.in.includes(item.id) ||
          item.affiliation !== where.affiliation ||
          (item.wellhubPlanConfirmationCampaign ===
            where.NOT.wellhubPlanConfirmationCampaign &&
            item.wellhubPlanConfirmationRequired ===
              where.NOT.wellhubPlanConfirmationRequired)
        ) {
          continue;
        }
        item.wellhubPlanConfirmationRequired =
          data.wellhubPlanConfirmationRequired;
        item.wellhubPlanConfirmationCampaign =
          data.wellhubPlanConfirmationCampaign;
        item.authVersion += data.authVersion.increment;
        count += 1;
      }
      return { count };
    }),
  };

  const prisma = {
    user,
    wellhubPlanConfirmation: confirmation,
    $transaction: vi.fn(async (callback: any) =>
      callback({ user, wellhubPlanConfirmation: confirmation })
    ),
  };

  return { prisma: prisma as any, users, records, credits };
}

const applicableUsers: FakeUser[] = [
  {
    id: "admin_wellhub",
    affiliation: "WELLHUB",
    role: "ADMIN",
    bookingBlocked: true,
    wellhubPlan: "PLATINUM",
    authVersion: 2,
    wellhubPlanConfirmationRequired: false,
    wellhubPlanConfirmationCampaign: null,
  },
  {
    id: "user_wellhub",
    affiliation: "WELLHUB",
    role: "USER",
    bookingBlocked: false,
    wellhubPlan: null,
    authVersion: 0,
    wellhubPlanConfirmationRequired: false,
    wellhubPlanConfirmationCampaign: null,
  },
  {
    id: "user_totalpass",
    affiliation: "TOTALPASS",
    role: "USER",
    bookingBlocked: false,
    wellhubPlan: null,
    authVersion: 0,
    wellhubPlanConfirmationRequired: false,
    wellhubPlanConfirmationCampaign: null,
  },
  {
    id: "user_none",
    affiliation: "NONE",
    role: "USER",
    bookingBlocked: false,
    wellhubPlan: null,
    authVersion: 0,
    wellhubPlanConfirmationRequired: false,
    wellhubPlanConfirmationCampaign: null,
  },
];

describe("WellHub reconfirmation campaign command", () => {
  it("defaults to a non-mutating aggregate-only dry run", async () => {
    const { prisma, users, records, credits } = fakePrisma(applicableUsers);
    const before = structuredClone(users);
    const beforeCredits = [...credits];
    const summary = await runCampaignCommand(prisma, {
      target: "dev",
      campaign: "campaign-2026-01",
      apply: false,
    });

    expect(summary).toMatchObject({
      eligibleUsers: 2,
      wouldFlag: 2,
      newlyFlagged: 0,
      sessionsInvalidated: 0,
      excludedDeletedOrAnonymized: 0,
    });
    expect(users).toEqual(before);
    expect([...credits]).toEqual(beforeCredits);
    expect(records).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(JSON.stringify(summary)).not.toContain("postgresql://");
  });

  it("flags every persisted WellHub user without role or booking-block exemptions", async () => {
    const { prisma, users, credits } = fakePrisma(applicableUsers);
    const plansBefore = users.map(({ id, wellhubPlan }) => ({ id, wellhubPlan }));
    const creditsBefore = [...credits];
    const summary = await runCampaignCommand(prisma, {
      target: "dev",
      campaign: "campaign-2026-01",
      apply: true,
      batchSize: 1,
    });

    expect(summary.newlyFlagged).toBe(2);
    expect(summary.sessionsInvalidated).toBe(2);
    expect(
      users.filter((user) => user.wellhubPlanConfirmationRequired).map((user) => user.id)
    ).toEqual(["admin_wellhub", "user_wellhub"]);
    expect(users.find((user) => user.id === "admin_wellhub")).toMatchObject({
      bookingBlocked: true,
      authVersion: 3,
    });
    expect(users.map(({ id, wellhubPlan }) => ({ id, wellhubPlan }))).toEqual(
      plansBefore
    );
    expect([...credits]).toEqual(creditsBefore);
  });

  it("is idempotent for one campaign and permits a later campaign", async () => {
    const { prisma, users } = fakePrisma(applicableUsers);
    const base = { target: "uat", apply: true, batchSize: 100 };
    await runCampaignCommand(prisma, {
      ...base,
      campaign: "campaign-2026-01",
    });
    const versions = users.map((user) => user.authVersion);
    const rerun = await runCampaignCommand(prisma, {
      ...base,
      campaign: "campaign-2026-01",
    });
    expect(rerun.newlyFlagged).toBe(0);
    expect(rerun.alreadyFlaggedForCampaign).toBe(2);
    expect(users.map((user) => user.authVersion)).toEqual(versions);

    const next = await runCampaignCommand(prisma, {
      ...base,
      campaign: "campaign-2026-02",
    });
    expect(next.newlyFlagged).toBe(2);
    expect(users.map((user) => user.authVersion)).toEqual(
      versions.map((version, index) => version + (index < 2 ? 1 : 0))
    );
  });

  it("keeps a failed batch rerunnable and reports the safe aggregate failure", async () => {
    const { prisma, users } = fakePrisma(applicableUsers);
    prisma.$transaction.mockRejectedValueOnce(new Error("simulated"));
    const summary = await runCampaignCommand(prisma, {
      target: "dev",
      campaign: "campaign-failure",
      apply: true,
      batchSize: 1,
    });
    expect(summary.failed).toBe(1);
    expect(summary.newlyFlagged).toBe(1);
    expect(
      users.filter((user) => user.wellhubPlanConfirmationRequired)
    ).toHaveLength(1);
  });
});

describe("WellHub command target guards", () => {
  it("rejects missing/unknown targets and malformed campaigns", () => {
    expect(() => parseCommandArgs(["--campaign=valid-campaign"])).toThrow(
      "--target"
    );
    expect(() =>
      parseCommandArgs(["--target=staging", "--campaign=valid-campaign"])
    ).toThrow("--target");
    expect(() =>
      parseCommandArgs(["--target=dev", "--campaign=x"])
    ).toThrow("--campaign");
  });

  it("requires apply and the exact production acknowledgement", () => {
    expect(() =>
      parseCommandArgs(["--target=prod", "--campaign=valid-campaign"])
    ).toThrow("Production requires");
    expect(() =>
      parseCommandArgs([
        "--target=prod",
        "--campaign=valid-campaign",
        "--apply",
        "--confirm-production=wrong",
      ])
    ).toThrow("Production requires");
    expect(
      parseCommandArgs([
        "--target=prod",
        "--campaign=valid-campaign",
        "--apply",
        "--confirm-production=REQUIRE_WELLHUB_PLAN_CONFIRMATION",
      ]).target
    ).toBe("prod");
  });

  it("rejects configured target swaps and production-looking non-prod databases", () => {
    const swappedFiles = new Map([
      [".env.dev.local", "DATABASE_URL_DEV_BRANCH=postgresql://u:p@uat.example/neondb"],
      [".env.uat.local", "DATABASE_URL_UAT_BRANCH=postgresql://u:p@uat.example/neondb"],
    ]);
    const io = (files: Map<string, string>) => ({
      fileExists: ((path: unknown) =>
        [...files.keys()].some((name) => String(path).endsWith(name))) as any,
      readFile: ((path: unknown) =>
        [...files].find(([name]) => String(path).endsWith(name))?.[1] ?? "") as any,
    });
    expect(() =>
      resolveDatabaseTarget({ target: "dev", cwd: "C:/repo", ...io(swappedFiles) })
    ).toThrow("matches the configured UAT");

    const prodLike = new Map([
      [".env.dev.local", "DATABASE_URL_DEV_BRANCH=postgresql://u:p@wave-prod.example/main"],
    ]);
    expect(() =>
      resolveDatabaseTarget({ target: "dev", cwd: "C:/repo", ...io(prodLike) })
    ).toThrow("production-like");
  });
});
