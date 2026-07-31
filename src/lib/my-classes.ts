export type ChronologicalBooking = {
  id: string;
  status: string;
  class: {
    date: string;
    durationMin: number;
  };
};

export function compareChronologicalBookings(
  a: ChronologicalBooking,
  b: ChronologicalBooking
) {
  const dateOrder =
    new Date(a.class.date).getTime() - new Date(b.class.date).getTime();

  return dateOrder || a.id.localeCompare(b.id);
}

export function partitionMyClassesBookings<T extends ChronologicalBooking>(
  bookings: readonly T[],
  now: Date
) {
  const upcoming: T[] = [];
  const history: T[] = [];

  for (const booking of bookings) {
    const startsAt = new Date(booking.class.date);
    const endsAt = new Date(
      startsAt.getTime() + booking.class.durationMin * 60_000
    );

    if (endsAt >= now && booking.status !== "CANCELED") {
      upcoming.push(booking);
    } else {
      history.push(booking);
    }
  }

  return {
    upcoming: upcoming.sort(compareChronologicalBookings),
    history: history.sort(compareChronologicalBookings),
  };
}
