import { Affiliation, Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { WellhubCheckinEvent } from "@/lib/wellhub/parser";

export type StoredWellhubCheckinStatus =
  | "RECEIVED"
  | "AUTHORIZED"
  | "REJECTED"
  | "ERROR";

export type StoredWellhubCheckin = {
  id: string;
  externalEventId: string;
  matchedUserId: string | null;
  status: StoredWellhubCheckinStatus;
};

export type CreateCheckinResult =
  | { kind: "created"; record: StoredWellhubCheckin }
  | { kind: "duplicate"; record: StoredWellhubCheckin };

export interface WellhubCheckinStore {
  findMatchedUserId(email?: string): Promise<string | null>;
  createReceived(
    event: WellhubCheckinEvent,
    matchedUserId: string | null
  ): Promise<CreateCheckinResult>;
  claimErrored(id: string): Promise<StoredWellhubCheckin | null>;
  markAuthorized(id: string, validatedAt: Date): Promise<void>;
  markRejected(id: string, code: string, reason: string): Promise<void>;
  markError(id: string, code: string, reason: string): Promise<void>;
}

function isUniqueConstraintError(error: unknown) {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002") ||
    (Boolean(error) &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "P2002")
  );
}

const selectRecord = {
  id: true,
  externalEventId: true,
  matchedUserId: true,
  status: true,
} as const;

export function createPrismaWellhubCheckinStore(
  client: PrismaClient = prisma
): WellhubCheckinStore {
  return {
    async findMatchedUserId(email) {
      if (!email) return null;

      const user = await client.user.findUnique({
        where: { email: email.trim().toLowerCase() },
        select: { id: true, affiliation: true },
      });

      return user?.affiliation === Affiliation.WELLHUB ? user.id : null;
    },

    async createReceived(event, matchedUserId) {
      try {
        const record = await client.wellhubCheckin.create({
          data: {
            externalEventId: event.externalEventId,
            externalUserId: event.externalUserId,
            externalGymId: event.externalGymId,
            externalProductId: event.externalProductId,
            eventTimestamp: event.eventTimestamp,
            matchedUserId,
          },
          select: selectRecord,
        });

        return { kind: "created", record };
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;

        const existing = await client.wellhubCheckin.findUnique({
          where: { externalEventId: event.externalEventId },
          select: selectRecord,
        });
        if (!existing) throw error;

        return { kind: "duplicate", record: existing };
      }
    },

    async claimErrored(id) {
      const claimed = await client.wellhubCheckin.updateMany({
        where: { id, status: "ERROR" },
        data: {
          status: "RECEIVED",
          failureCode: null,
          failureReason: null,
        },
      });
      if (claimed.count !== 1) return null;

      return client.wellhubCheckin.findUnique({
        where: { id },
        select: selectRecord,
      });
    },

    async markAuthorized(id, validatedAt) {
      await client.wellhubCheckin.updateMany({
        where: { id, status: "RECEIVED" },
        data: {
          status: "AUTHORIZED",
          validatedAt,
          failureCode: null,
          failureReason: null,
        },
      });
    },

    async markRejected(id, code, reason) {
      await client.wellhubCheckin.updateMany({
        where: { id, status: "RECEIVED" },
        data: {
          status: "REJECTED",
          failureCode: code.slice(0, 120),
          failureReason: reason.slice(0, 300),
        },
      });
    },

    async markError(id, code, reason) {
      await client.wellhubCheckin.updateMany({
        where: { id, status: "RECEIVED" },
        data: {
          status: "ERROR",
          failureCode: code.slice(0, 120),
          failureReason: reason.slice(0, 300),
        },
      });
    },
  };
}
