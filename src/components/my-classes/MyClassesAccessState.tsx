import type { ReactNode } from "react";
import Link from "next/link";

export const MY_CLASSES_LOGIN_HREF = "/login?next=%2Fmis-clases";

type MyClassesAccessStateProps = {
  isAuthenticated: boolean;
  isLoading: boolean;
  children?: ReactNode;
};

export function MyClassesAccessState({
  isAuthenticated,
  isLoading,
  children,
}: MyClassesAccessStateProps) {
  if (isLoading) {
    return (
      <section className="section" aria-busy="true" aria-label="Cargando sesión">
        <div className="container-app">
          <div className="mx-auto max-w-3xl">
            <div className="card p-8 animate-pulse">
              <div className="h-7 w-2/3 rounded bg-muted" />
              <div className="mt-3 h-4 w-full max-w-md rounded bg-muted" />
              <div className="mt-6 h-10 w-36 rounded bg-muted" />
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!isAuthenticated) {
    return (
      <section className="section">
        <div className="container-app">
          <div className="mx-auto max-w-3xl">
            <div className="card p-6 text-center sm:p-10">
              <h1 className="font-display text-3xl font-extrabold">
                Mis clases y paquetes
              </h1>
              <p className="mt-3 text-muted-foreground">
                Debes iniciar sesión para ver tus clases y paquetes.
              </p>
              <Link
                href={MY_CLASSES_LOGIN_HREF}
                className="btn-primary mt-6 inline-flex h-11 items-center justify-center px-6"
              >
                Iniciar sesión
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return <>{children}</>;
}
