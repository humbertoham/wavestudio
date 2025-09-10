import Link from "next/link";

// App Router: coloca este archivo en app/(legal)/privacidad/page.tsx
// Versión sin shadcn/ui: HTML semántico + Tailwind, consistente con el diseño del proyecto.

export const metadata = {
  title: "Aviso de Privacidad | WAVE",
  description:
    "Conoce cómo WAVE recopila, usa, comparte y protege tu información personal.",
};

const UPDATED_AT = "10 de septiembre de 2025";

const sections = [
  {
    id: "responsable",
    title: "1. Responsable del tratamiento",
    content: (
      <>
        <p>
          WAVE ("nosotros") es responsable del tratamiento de datos personales recabados a través de nuestro sitio, app y servicios ("Servicios"). Puedes contactarnos en
          {" "}
          <a
            href="mailto:hola@wave.fit"
            className="underline underline-offset-4"
          >
            hola@wave.fit
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "datos-que-recabamos",
    title: "2. Datos que recabamos",
    content: (
      <>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Identificación y contacto:</strong> nombre, correo, teléfono.
          </li>
          <li>
            <strong>Cuenta:</strong> usuario, contraseñas (hash), preferencias.
          </li>
          <li>
            <strong>Transacciones:</strong> historial de compras, paquetes, facturación.
          </li>
          <li>
            <strong>Uso del servicio:</strong> reservas, asistencias, métricas de interacción.
          </li>
          <li>
            <strong>Datos técnicos:</strong> IP, dispositivo, navegador, cookies.
          </li>
          <li>
            <strong>Opcionales/sensibles (si aplica):</strong> metas de entrenamiento, información de salud que elijas compartir para personalizar tu experiencia.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "finalidades",
    title: "3. Finalidades del tratamiento",
    content: (
      <>
        <ul className="list-disc pl-5 space-y-2">
          <li>Proveer y mejorar los Servicios (gestión de reservas, clases y soporte).</li>
          <li>Procesar pagos y facturación a través de terceros.</li>
          <li>Seguridad, prevención de fraude y cumplimiento legal.</li>
          <li>Comunicaciones transaccionales y de servicio.</li>
          <li>Marketing con tu consentimiento (puedes darte de baja en cualquier momento).</li>
        </ul>
      </>
    ),
  },
  {
    id: "fundamento",
    title: "4. Base jurídica / legitimación",
    content: (
      <>
        <p>
          Tratamos datos con base en: (a) ejecución de un contrato (cuando usas nuestros Servicios);
          (b) cumplimiento de obligaciones legales; (c) interés legítimo para seguridad, mejora y prevención de fraude; y (d) tu consentimiento para marketing o datos sensibles.
        </p>
      </>
    ),
  },
  {
    id: "compartir",
    title: "5. Con quién compartimos tus datos",
    content: (
      <>
        <p>
          Podemos compartir datos con proveedores que nos ayudan a operar (p. ej., pasarelas de pago,
          analítica, hosting, comunicaciones) bajo contratos que exigen confidencialidad y medidas de seguridad.
          También cuando la ley lo permita o exija (autoridades, prevención de fraude).
        </p>
      </>
    ),
  },
  {
    id: "transferencias",
    title: "6. Transferencias internacionales",
    content: (
      <>
        <p>
          Si transferimos datos fuera de tu país, aplicamos salvaguardas adecuadas (p. ej., cláusulas contractuales tipo) y evaluaciones de riesgo para proteger tu información.
        </p>
      </>
    ),
  },
  {
    id: "retencion",
    title: "7. Conservación de datos",
    content: (
      <>
        <p>
          Conservamos los datos solo el tiempo necesario para cumplir las finalidades descritas y obligaciones legales. Al concluir, los eliminamos o anonimizamos de forma segura.
        </p>
      </>
    ),
  },
  {
    id: "derechos",
    title: "8. Tus derechos",
    content: (
      <>
        <ul className="list-disc pl-5 space-y-2">
          <li>Acceder y obtener copia de tus datos.</li>
          <li>Rectificar información incorrecta o incompleta.</li>
          <li>Eliminar datos cuando aplique (p. ej., ya no necesarios).</li>
          <li>Oponerte u optar por no recibir marketing.</li>
          <li>Portabilidad de datos cuando corresponda.</li>
          <li>Retirar el consentimiento sin afectar el tratamiento previo.</li>
        </ul>
        <p className="mt-3">
          Puedes ejercerlos escribiendo a{ " "}
          <a
            href="mailto:hola@wave.fit"
            className="underline underline-offset-4"
          >
            hola@wave.fit
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "9. Cookies y tecnologías similares",
    content: (
      <>
        <p>
          Usamos cookies para recordar preferencias, medir uso y mejorar el sitio. Puedes gestionar cookies en la configuración de tu navegador.
        </p>
        <p>
          Consulta también nuestra{ " "}
          <Link href="/cookies" className="underline underline-offset-4">
            Política de Cookies
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: "seguridad",
    title: "10. Seguridad de la información",
    content: (
      <>
        <p>
          Implementamos medidas técnicas y organizativas razonables para proteger tus datos against acceso, uso o divulgación no autorizados. Ningún sistema es 100% seguro, pero trabajamos continuamente para mejorar.
        </p>
      </>
    ),
  },
  {
    id: "menores",
    title: "11. Menores de edad",
    content: (
      <>
        <p>
          Nuestros Servicios no están dirigidos a menores sin consentimiento verificable de sus tutores. Si detectamos datos de menores sin autorización, los eliminaremos.
        </p>
      </>
    ),
  },
  {
    id: "cambios",
    title: "12. Cambios al aviso",
    content: (
      <>
        <p>
          Podemos actualizar este Aviso para reflejar cambios legales o mejoras del servicio. Publicaremos la versión vigente y la fecha de actualización. El uso continuo implica aceptación de los cambios.
        </p>
      </>
    ),
  },
  {
    id: "contacto",
    title: "13. Contacto y quejas",
    content: (
      <>
        <p>
          Para dudas o quejas sobre privacidad, contáctanos en{ " "}
          <a
            href="mailto:wwavestudio@outlook.com"
            className="underline underline-offset-4"
          >
            wwavestudio@outlook.com
          </a>
          . Si no quedas satisfecho, puedes acudir a la autoridad de protección de datos de tu jurisdicción.
        </p>
      </>
    ),
  },
];

export default function PrivacidadPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Aviso de Privacidad</h1>
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
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className="block rounded-xl px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
                  >
                    {s.title}
                  </a>
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
                Este Aviso explica qué datos personales recabamos, cómo los usamos, con quién los compartimos y tus derechos. Lee con atención y si tienes dudas, contáctanos.
              </p>
            </div>
          </div>

          {/* Secciones con details/summary nativos */}
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

          {/* Nota */}
          <div className="rounded-2xl border shadow-sm">
            <div className="p-6 text-xs text-muted-foreground space-y-3">
              <p>
                Este documento es informativo y no constituye asesoría legal. Si existe discrepancia con contratos específicos, prevalecerán dichos contratos.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
