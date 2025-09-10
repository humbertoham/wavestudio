import Link from "next/link";

// Si usas el App Router, coloca este archivo en: app/(legal)/terminos/page.tsx
// Esta versión NO usa componentes de shadcn/ui; solo HTML semántico + Tailwind.

export const metadata = {
  title: "Términos y Condiciones | WAVE",
  description: "Lee los Términos y Condiciones de uso del sitio y servicios WAVE.",
};

const UPDATED_AT = "10 de septiembre de 2025";

const sections = [
  {
    id: "aceptacion",
    title: "1. Aceptación de los Términos",
    content: (
      <>
        <p>
          Al acceder o usar nuestro sitio web, app y servicios relacionados (colectivamente, "Servicios"), aceptas estos Términos y Condiciones. Si no estás de acuerdo, por favor no uses los Servicios.
        </p>
      </>
    ),
  },
  {
    id: "registro",
    title: "2. Cuentas y Registro",
    content: (
      <>
        <p>
          Para reservar y administrar clases puedes necesitar una cuenta. Debes proporcionar información veraz y mantenerla actualizada. Eres responsable de la seguridad de tus credenciales y de toda actividad que ocurra en tu cuenta.
        </p>
      </>
    ),
  },
  {
    id: "reservas",
    title: "3. Reservas, Cancelaciones y No Show",
    content: (
      <>
        <p>
          Las reservas están sujetas a disponibilidad. Las políticas de cancelación y no show pueden incluir ventanas de tiempo límite y cargos. Los detalles más recientes estarán visibles durante el flujo de reserva.
        </p>
      </>
    ),
  },
  {
    id: "pagos",
    title: "4. Pagos y Facturación",
    content: (
      <>
        <p>
          Mostramos precios en moneda local e incluyen impuestos aplicables salvo indicación en contrario. Los pagos se procesan mediante pasarelas de terceros. Al pagar, autorizas los cargos correspondientes de tu método de pago.
        </p>
      </>
    ),
  },
  {
    id: "packs",
    title: "5. Paquetes y Vigencias",
    content: (
      <>
        <p>
          Los paquetes de clases tienen una vigencia específica y no son transferibles salvo que se indique lo contrario. Las condiciones de uso (vencimiento, extensión, y restricciones) se muestran al momento de la compra.
        </p>
      </>
    ),
  },
  {
    id: "conducta",
    title: "6. Conducta del Usuario",
    content: (
      <>
        <p>
          Te comprometes a usar los Servicios de forma lícita y respetuosa. Está prohibido el abuso, fraude, scraping no autorizado y cualquier actividad que comprometa la integridad de los Servicios o de otros usuarios.
        </p>
      </>
    ),
  },
  {
    id: "propiedad",
    title: "7. Propiedad Intelectual",
    content: (
      <>
        <p>
          Todo el contenido, marcas y materiales del sitio son propiedad de WAVE o de sus licenciantes y están protegidos por leyes de propiedad intelectual. No se otorga ninguna licencia salvo lo expresamente permitido.
        </p>
      </>
    ),
  },
  {
    id: "privacidad",
    title: "8. Privacidad",
    content: (
      <>
        <p>
          Tratamos tus datos conforme a nuestro Aviso de Privacidad. Al usar los Servicios, consientes el tratamiento de tus datos según dicho aviso.
        </p>
        <p>
          Consulta: <Link href="/privacidad" className="underline underline-offset-4">Aviso de Privacidad</Link>.
        </p>
      </>
    ),
  },
  {
    id: "limitacion",
    title: "9. Limitación de Responsabilidad",
    content: (
      <>
        <p>
          En la medida máxima permitida por la ley, WAVE no será responsable por daños indirectos, incidentales, especiales o consecuentes derivados del uso o imposibilidad de uso de los Servicios.
        </p>
      </>
    ),
  },
  {
    id: "modificaciones",
    title: "10. Modificaciones a los Términos",
    content: (
      <>
        <p>
          Podemos actualizar estos Términos para reflejar cambios legales o mejoras de los Servicios. Publicaremos la versión vigente y la fecha de actualización. El uso continuo implica aceptación de los cambios.
        </p>
      </>
    ),
  },
  {
    id: "contacto",
    title: "11. Contacto",
    content: (
      <>
        <p>
          Si tienes dudas sobre estos Términos, escríbenos a <a href="mailto:wwavestudio@outlook.com" className="underline underline-offset-4">wwavestudio@outlook.com</a>.
        </p>
      </>
    ),
  },
];

export default function TerminosPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Términos y Condiciones</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Última actualización:</span>
            <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs bg-neutral-50 dark:bg-neutral-900/40">
              {UPDATED_AT}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Índice lateral */}
        <aside className="lg:col-span-4 xl:col-span-3">
          <div className="rounded-2xl border shadow-sm sticky top-24">
            <div className="p-5">
              <h2 className="text-base font-semibold">Contenido</h2>
            </div>
            <div className="px-5 pb-5">
              <nav className="space-y-1">
                {sections.map((s) => (
                  <Link
                    key={s.id}
                    href={`#${s.id}`}
                    className="block rounded-xl px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
                  >
                    {s.title}
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        </aside>

        {/* Contenido principal */}
        <section className="lg:col-span-8 xl:col-span-9 space-y-6">
          {/* Intro */}
          <div className="rounded-2xl border shadow-sm">
            <div className="p-6 space-y-4 text-sm text-muted-foreground">
              <p>
                Bienvenido/a a WAVE Studio. Estos Términos rigen el uso del sitio, la app y los servicios relacionados. Te recomendamos leerlos con atención.
              </p>
              <p>
                Al continuar usando nuestros Servicios, aceptas estas condiciones.
              </p>
            </div>
          </div>

          {/* Secciones en acordeón (details/summary nativos) */}
          <div className="rounded-2xl border shadow-sm">
            <div className="p-5">
              <h2 className="text-base font-semibold">Detalles</h2>
            </div>
            <hr className="border-t" />
            <div className="p-2">
              <ul className="divide-y">
                {sections.map((s) => (
                  <li key={s.id} id={s.id} className="">
                    <details className="group">
                      <summary className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left text-base font-medium hover:bg-neutral-50 dark:hover:bg-neutral-900/40 rounded-xl">
                        <span>{s.title}</span>
                        <svg
                          className="h-4 w-4 transition-transform group-open:rotate-180"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <path d="M12 15.5 5 8.5l1.4-1.4L12 12.7l5.6-5.6L19 8.5z" />
                        </svg>
                      </summary>
                      <div className="px-4 pb-4 pt-2 text-sm text-muted-foreground space-y-3">
                        {s.content}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Nota legal */}
          <div className="rounded-2xl border shadow-sm">
            <div className="p-6 text-xs text-muted-foreground space-y-3">
              <p>
                Esta página es informativa y no sustituye el asesoramiento legal. En caso de conflicto entre esta versión y contratos específicos firmados con WAVE, prevalecerán los contratos.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
