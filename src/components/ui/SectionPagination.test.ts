import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SectionPagination } from "./SectionPagination";

describe("SectionPagination", () => {
  it.each([0, 1])("hides controls for %s total pages", (totalPages) => {
    const html = renderToStaticMarkup(
      createElement(SectionPagination, {
        page: 1,
        totalPages,
        label: "próximas clases",
        onPageChange: vi.fn(),
      })
    );

    expect(html).toBe("");
  });

  it("renders accessible controls and disables previous on page one", () => {
    const html = renderToStaticMarkup(
      createElement(SectionPagination, {
        page: 1,
        totalPages: 2,
        label: "historial de clases",
        onPageChange: vi.fn(),
      })
    );

    expect(html).toContain('aria-label="Paginación de historial de clases"');
    expect(html).toContain("Página 1 de 2");
    expect(html).toMatch(/disabled=""[^>]*>Anterior/);
    expect(html).not.toMatch(/disabled=""[^>]*>Siguiente/);
  });

  it("disables both controls while a section is loading", () => {
    const html = renderToStaticMarkup(
      createElement(SectionPagination, {
        page: 2,
        totalPages: 3,
        isLoading: true,
        label: "paquetes comprados",
        onPageChange: vi.fn(),
      })
    );

    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
