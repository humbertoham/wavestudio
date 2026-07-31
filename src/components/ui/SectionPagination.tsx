type SectionPaginationProps = {
  page: number;
  totalPages: number;
  isLoading?: boolean;
  label: string;
  onPageChange: (page: number) => void;
};

export function SectionPagination({
  page,
  totalPages,
  isLoading = false,
  label,
  onPageChange,
}: SectionPaginationProps) {
  if (totalPages <= 1) return null;

  const previousDisabled = isLoading || page <= 1;
  const nextDisabled = isLoading || page >= totalPages;

  return (
    <nav
      className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row"
      aria-label={`Paginación de ${label}`}
    >
      <button
        type="button"
        className="btn-outline h-10 min-w-28 px-4 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={previousDisabled}
        aria-label={`Página anterior de ${label}`}
        onClick={() => onPageChange(page - 1)}
      >
        Anterior
      </button>

      <span className="min-w-32 text-center text-sm" aria-live="polite">
        Página {page} de {totalPages}
      </span>

      <button
        type="button"
        className="btn-outline h-10 min-w-28 px-4 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={nextDisabled}
        aria-label={`Página siguiente de ${label}`}
        onClick={() => onPageChange(page + 1)}
      >
        Siguiente
      </button>
    </nav>
  );
}
