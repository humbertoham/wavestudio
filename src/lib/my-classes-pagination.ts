export const MY_CLASSES_PAGE_SIZE = 5;
export const MAX_MY_CLASSES_PAGE = 1_000_000;

export type PaginatedResponse<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type PaginationWindow = Omit<PaginatedResponse<never>, "items"> & {
  skip: number;
  take: number;
};

export function parseMyClassesPage(value: string | null | undefined) {
  if (value == null || value.trim() === "") return 1;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;

  return Math.min(parsed, MAX_MY_CLASSES_PAGE);
}

export function getPaginationWindow(
  totalItems: number,
  requestedPage: number
): PaginationWindow {
  const safeTotal = Number.isFinite(totalItems)
    ? Math.max(0, Math.floor(totalItems))
    : 0;
  const totalPages = Math.ceil(safeTotal / MY_CLASSES_PAGE_SIZE);
  const parsedPage = parseMyClassesPage(String(requestedPage));
  const page = totalPages === 0 ? 1 : Math.min(parsedPage, totalPages);

  return {
    page,
    pageSize: MY_CLASSES_PAGE_SIZE,
    totalItems: safeTotal,
    totalPages,
    skip: (page - 1) * MY_CLASSES_PAGE_SIZE,
    take: MY_CLASSES_PAGE_SIZE,
  };
}

export function updatePaginationSearchParams(
  current: string | URLSearchParams,
  key: string,
  page: number
) {
  const params = new URLSearchParams(current.toString());
  const parsedPage = parseMyClassesPage(String(page));

  if (parsedPage === 1) {
    params.delete(key);
  } else {
    params.set(key, String(parsedPage));
  }

  return params.toString();
}
