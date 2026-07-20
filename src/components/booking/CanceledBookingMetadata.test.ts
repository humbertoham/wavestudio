import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CanceledBookingMetadata } from "./CanceledBookingMetadata";

describe("CanceledBookingMetadata", () => {
  it("renders the full timestamp and keeps the existing penalty detail visible", () => {
    const markup = renderToStaticMarkup(
      createElement(CanceledBookingMetadata, {
        status: "CANCELED",
        canceledAt: "2026-07-20T16:35:00.000Z",
        hasPenalty: true,
      })
    );

    expect(markup).toContain(
      "Canceló el 20 de julio de 2026 a las 10:35 a. m."
    );
    expect(markup).toContain("Debe $100 de penalización");
  });

  it("omits only the timestamp when the real cancellation date is missing", () => {
    const markup = renderToStaticMarkup(
      createElement(CanceledBookingMetadata, {
        status: "CANCELED",
        canceledAt: null,
        hasPenalty: true,
      })
    );

    expect(markup).not.toContain("Canceló el");
    expect(markup).toContain("Debe $100 de penalización");
  });

  it("renders nothing for a non-cancelled booking", () => {
    const markup = renderToStaticMarkup(
      createElement(CanceledBookingMetadata, {
        status: "ACTIVE",
        canceledAt: "2026-07-20T16:35:00.000Z",
        hasPenalty: true,
      })
    );

    expect(markup).toBe("");
  });
});
