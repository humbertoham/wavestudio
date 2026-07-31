import { describe, expect, it } from "vitest";

import {
  getPaginationWindow,
  parseMyClassesPage,
  updatePaginationSearchParams,
} from "./my-classes-pagination";

function pagesFor<T>(records: readonly T[]) {
  const totalPages = getPaginationWindow(records.length, 1).totalPages;

  return Array.from({ length: totalPages }, (_, index) => {
    const window = getPaginationWindow(records.length, index + 1);
    return records.slice(window.skip, window.skip + window.take);
  });
}

describe("my classes pagination", () => {
  it("returns no items and zero pages for an empty section", () => {
    const window = getPaginationWindow(0, 1);

    expect(window).toEqual({
      page: 1,
      pageSize: 5,
      totalItems: 0,
      totalPages: 0,
      skip: 0,
      take: 5,
    });
    expect(pagesFor([])).toEqual([]);
  });

  it("keeps exactly five records on one page", () => {
    const records = [1, 2, 3, 4, 5];

    expect(pagesFor(records)).toEqual([records]);
    expect(getPaginationWindow(records.length, 1).totalPages).toBe(1);
  });

  it("splits six records into pages of five and one", () => {
    expect(pagesFor([1, 2, 3, 4, 5, 6])).toEqual([
      [1, 2, 3, 4, 5],
      [6],
    ]);
  });

  it("splits twelve ordered records without duplicates or omissions", () => {
    const records = Array.from({ length: 12 }, (_, index) => index + 1);
    const pages = pagesFor(records);

    expect(pages.map((page) => page.length)).toEqual([5, 5, 2]);
    expect(pages.flat()).toEqual(records);
    expect(new Set(pages.flat()).size).toBe(records.length);
  });

  it.each([null, "", "0", "-1", "1.5", "abc"])(
    "defaults invalid page %s to one",
    (value) => {
      expect(parseMyClassesPage(value)).toBe(1);
    }
  );

  it("normalizes an excessively high page to the final available page", () => {
    expect(getPaginationWindow(12, 999_999)).toMatchObject({
      page: 3,
      totalPages: 3,
      skip: 10,
      take: 5,
    });
  });

  it("updates one section while preserving other pages and query parameters", () => {
    const updated = updatePaginationSearchParams(
      "upcomingPage=2&historyPage=3&packagesPage=4&tab=summary",
      "historyPage",
      5
    );
    const params = new URLSearchParams(updated);

    expect(params.get("upcomingPage")).toBe("2");
    expect(params.get("historyPage")).toBe("5");
    expect(params.get("packagesPage")).toBe("4");
    expect(params.get("tab")).toBe("summary");
  });

  it("removes only the selected section parameter when returning to page one", () => {
    const updated = updatePaginationSearchParams(
      "upcomingPage=2&historyPage=3&packagesPage=4",
      "historyPage",
      1
    );
    const params = new URLSearchParams(updated);

    expect(params.get("upcomingPage")).toBe("2");
    expect(params.has("historyPage")).toBe(false);
    expect(params.get("packagesPage")).toBe("4");
  });
});
