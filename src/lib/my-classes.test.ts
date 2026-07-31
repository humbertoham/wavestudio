import { describe, expect, it } from "vitest";

import { partitionMyClassesBookings } from "./my-classes";

type FixtureBooking = {
  id: string;
  status: "ACTIVE" | "CANCELED";
  attended: boolean;
  class: {
    date: string;
    durationMin: number;
  };
};

function booking(
  id: string,
  date: string,
  options: Partial<Pick<FixtureBooking, "status" | "attended">> = {}
): FixtureBooking {
  return {
    id,
    status: options.status ?? "ACTIVE",
    attended: options.attended ?? false,
    class: { date, durationMin: 60 },
  };
}

describe("partitionMyClassesBookings", () => {
  const now = new Date("2026-07-30T18:00:00.000Z");

  it("orders history from the oldest class date to the newest", () => {
    const result = partitionMyClassesBookings(
      [
        booking("newest", "2026-07-29T16:00:00.000Z"),
        booking("oldest", "2026-07-10T16:00:00.000Z"),
        booking("middle", "2026-07-20T16:00:00.000Z"),
      ],
      now
    );

    expect(result.history.map(({ id }) => id)).toEqual([
      "oldest",
      "middle",
      "newest",
    ]);
  });

  it("uses the booking id as a deterministic tie-breaker", () => {
    const result = partitionMyClassesBookings(
      [
        booking("booking-z", "2026-07-20T16:00:00.000Z"),
        booking("booking-a", "2026-07-20T16:00:00.000Z"),
      ],
      now
    );

    expect(result.history.map(({ id }) => id)).toEqual([
      "booking-a",
      "booking-z",
    ]);
  });

  it("orders upcoming classes oldest to newest with a deterministic tie-breaker", () => {
    const result = partitionMyClassesBookings(
      [
        booking("future-later", "2026-08-20T16:00:00.000Z"),
        booking("future-same-z", "2026-08-10T16:00:00.000Z"),
        booking("future-earlier", "2026-08-05T16:00:00.000Z"),
        booking("future-same-a", "2026-08-10T16:00:00.000Z"),
      ],
      now
    );

    expect(result.upcoming.map(({ id }) => id)).toEqual([
      "future-earlier",
      "future-same-a",
      "future-same-z",
      "future-later",
    ]);
  });

  it("preserves status sections, every record, and the original array", () => {
    const source = [
      booking("future-later", "2026-08-20T16:00:00.000Z"),
      booking("future-earlier", "2026-08-10T16:00:00.000Z"),
      booking("canceled-future", "2026-08-05T16:00:00.000Z", {
        status: "CANCELED",
      }),
      booking("attended-past", "2026-07-15T16:00:00.000Z", {
        attended: true,
      }),
    ];
    const originalIds = source.map(({ id }) => id);

    const result = partitionMyClassesBookings(source, now);

    expect(result.upcoming.map(({ id }) => id)).toEqual([
      "future-earlier",
      "future-later",
    ]);
    expect(result.history.map(({ id }) => id)).toEqual([
      "attended-past",
      "canceled-future",
    ]);
    expect(result.upcoming.length + result.history.length).toBe(source.length);
    expect(source.map(({ id }) => id)).toEqual(originalIds);
  });
});
