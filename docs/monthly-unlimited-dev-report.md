# Paquete Ilimitado Mensual — informe de DEV

## Implementation Verdict

**PARTIAL — BLOCKER de entorno remoto.** La implementación está terminada y validada en PostgreSQL real, local y aislado de desarrollo. Falta aplicar las migraciones en la base remota de `dev`: la conexión de `DATABASE_URL_DEV_BRANCH` en `.env.dev.local` no permite ni `SELECT 1`. No se hicieron escrituras en esa base. El push queda pendiente para evitar publicar código que consulta columnas aún ausentes en el entorno remoto.

Se trabajó en el worktree existente `wavestudio-wellhub-readiness`, rama `dev`. No se modificaron `main`, `uat`, bases remotas, configuración de Vercel ni credenciales de producción. No hay suscripciones ni cobros recurrentes.

## Existing Architecture

Los paquetes originales contienen una cantidad fija de clases y días de vigencia. `PackPurchase.classesLeft` es el saldo operativo; `TokenLedger` registra concesiones, consumos por compra y devoluciones. Las reservas pueden ocupar varios lugares (`Booking.quantity`), cada uno con el `Class.creditCost` correspondiente. El consumo utiliza primero las compras que vencen antes. Las transacciones serializables y la unicidad parcial de reserva activa protegen saldo y cupo.

Mercado Pago crea un pago pendiente y un enlace de checkout. El webhook valida HMAC, consulta el pago al proveedor y concede la compra una sola vez por el identificador único de pago. La cancelación del usuario devuelve los débitos originales si faltan al menos cuatro horas; la tardía libera cupo sin devolver el beneficio consumido. Wellhub tiene reservas externas independientes; TotalPass y los beneficios corporativos usan compras y créditos internos.

## New Package Model

`PackType` distingue `STANDARD` y `MONTHLY_UNLIMITED`, con `STANDARD` como valor inicial para datos existentes. El ilimitado contiene mes/año y usa cero en las columnas obligatorias antiguas de clases y días, para conservar compatibilidad de almacenamiento. No se crea saldo ni una fila de crédito por el ilimitado.

La compra conserva tipo, mes/año, nombre y precio independientes del catálogo. `Payment.packSnapshot` conserva las condiciones antes del checkout, separado del payload mutable del proveedor. Los triggers impiden cambiar snapshots ya registrados. También se capturan nombres actuales de compras antiguas y su importe histórico de pago cuando está disponible; no se pueden reconstruir nombres que ya hubieran cambiado antes de esta migración.

## Admin UI

Crear y editar paquetes incluye **Tipo de paquete**, con **Paquete de clases** e **Ilimitado mensual**. El ilimitado muestra mes y año obligatorios y oculta cantidad de clases y vigencia en días. Se mantienen precio, etiqueta, descripción y publicación. Los endpoints verifican el rol ADMIN contra la base. Coach conserva acceso a administración de clases y reservas, sin recibir permisos para administrar paquetes.

Las ediciones parciales conservan campos no enviados, incluidas descripciones JSON antiguas. Cambiar el catálogo no cambia compras ni pagos pendientes anteriores. Las compras ilimitadas se identifican en las tablas administrativas; no admiten pausa ni extensión del mes.

## Purchase Flow

1. Usuario autenticado elige un paquete disponible.
2. El servidor valida el catálogo y crea snapshot, pago y enlace.
3. Para ilimitados, un bloqueo transaccional por cuenta rechaza otra compra activa o checkout pendiente del mismo mes, incluso de otro paquete del catálogo. La reserva de un checkout pendiente dura 30 minutos.
4. Mercado Pago recibe la preferencia del flujo existente.
5. El webhook firmado consulta al proveedor. Para el ilimitado verifica importe, moneda y referencia contra el pago local.
6. Solo `APPROVED` permite conceder la compra. El servicio compartido también comprueba estado, propietario, importe y moneda del pago local.
7. La clave única `PackPurchase.paymentId` impide una segunda concesión. Pendiente, rechazado y cancelado no conceden acceso.

Las ventas manuales y asignaciones existentes de ADMIN usan el mismo servicio y conservan su pago auditado. No se añadió ningún endpoint de aprobación simulada.

## Calendar Eligibility

Se usa `America/Monterrey`, la zona ya configurada para vigencias y renovaciones del negocio. La fecha local de inicio de la **clase** define el mes y el día del beneficio. Comprar en septiembre permite reservar octubre inmediatamente; la acción de reserva no tiene que ocurrir durante octubre.

La vigencia termina al inicio local del siguiente mes. Las pruebas incluyen primer/último instante, febrero, año bisiesto y diciembre/enero. Una sesión con un uso ilimitado no liberado no puede trasladarse a otro día: se debe crear otra sesión. El cambio de hora dentro del mismo día sigue disponible.

## Booking Priority

La selección en el servicio común es: ilimitado elegible, después créditos vigentes según el orden existente, después error. El segundo evento del mismo día o una clase fuera del mes puede reservarse con créditos suficientes. Los créditos expirados o pausados permanecen excluidos. El saldo de créditos mostrado no incorpora el ilimitado.

## Daily and Seat Limits

`UnlimitedUsage` identifica usuario, compra, reserva y fecha local. Su índice único parcial `(userId, serviceDate) WHERE releasedAt IS NULL` impide consumir dos beneficios diarios, incluso con compras repetidas o solicitudes simultáneas. La reserva y el uso se crean en la misma transacción serializable, con reintentos por conflictos conocidos.

El ilimitado cubre un lugar. WAVE ya admite `quantity > 1`, por lo que los lugares adicionales pueden pagarse con créditos y la reserva se identifica como `MIXED`. Se conservan cupo, duplicados y la restricción corporativa de un lugar; no se crean invitados adicionales.

## Cancellation

La definición existente se conserva: `floor(minutos restantes) < 240` es cancelación tardía. A 240 minutos se restaura el día. La temprana marca el uso liberado y devuelve únicamente los débitos de créditos existentes. La tardía conserva el uso consumido y libera el lugar. Después del inicio, el usuario no puede cancelar.

La transición condicional de ACTIVE a CANCELED impide devolución doble. La cancelación temprana mantiene la promoción FIFO de lista de espera. ADMIN/coach respetan el límite de cuatro horas para el beneficio ilimitado; la devolución administrativa de reservas estándar conserva su conducta anterior.

## User Dashboard

`/mis-clases` muestra nombre comprado, mes, rango de fechas, una clase diaria y estados Vigente, Próximamente, Finalizado o Revocado. Las reservas indican ilimitado, mixto, créditos, Wellhub o invitado. Se mantienen orden cronológico y paginación.

`/precios` distingue el producto mensual y explica compra anticipada. `/clases` muestra el beneficio y permite confirmar sin saldo artificial. El servidor vuelve a validar toda reserva. El resumen privado de ilimitados solo contiene compras y fechas consumidas del usuario autenticado.

## Database

| Modelo | Cambio |
| --- | --- |
| Pack | Tipo y mes/año opcionales |
| PackPurchase | Tipo, mes/año, snapshots de nombre/precio, revocación y motivo |
| Payment | Snapshot JSON de condiciones de paquete |
| Booking | Entitlement separado de source: créditos, ilimitado, mixto, Wellhub, invitado |
| UnlimitedUsage | Compra y reserva con FK restrictiva, fecha local, liberación y motivo |

Migraciones nuevas, sin modificar migraciones anteriores:

- `20261011000000_add_monthly_unlimited_packages`: modelos, defaults, checks, índices y unicidad diaria parcial.
- `20261011010000_guard_unlimited_purchase_history`: snapshots inmutables, protección de día de clase y validación de propiedad/mes/atribución del uso.
- `20261011020000_snapshot_existing_purchase_labels`: captura de etiquetas antiguas e importe histórico disponible.

Las 25 migraciones del repositorio se aplicaron desde cero en PostgreSQL 16 local aislado. Prisma no detectó diferencias entre esquema y base de validación. Ninguna migración se aplicó a Neon DEV, UAT o producción.

## Payment Safety

Refund y chargeback revocan el ilimitado y cancelan sus reservas futuras, restaurando solamente créditos realmente debitados en reservas mixtas. Se conserva el historial. Uso pasado o cancelación tardía provoca el bloqueo existente para revisión administrativa. Chargeback bloquea incluso sin uso y también después de un refund anterior. Un refund parcial confirmado revoca el ilimitado. No se calcula deuda con créditos ficticios ni se fija una nueva tarifa por disputa; el equipo debe revisar el caso utilizando el bloqueo administrativo existente.

Los tests sustituyen el SDK del proveedor, conservando la validación HMAC real del endpoint y el servicio real de concesión. Usan fixtures efímeros sin contraseñas utilizables, necesarios para probar FKs, roles y concurrencia. No hay seeds de usuarios ni simulador accesible por HTTP.

`npm run test:monthly:dev` exige rama `dev`, crea su propio contenedor de PostgreSQL publicado solo en localhost, elimina credenciales de proveedores heredadas del proceso, aplica migraciones y ejecuta las pruebas. Verifica nombre/etiqueta del contenedor antes de detenerlo. `--full` activa además las suites existentes de integración y ejecuta archivos secuencialmente.

## Test Results

El SHA final del commit se consigna en la respuesta de entrega. Validación final:

| Verificación | Resultado |
| --- | --- |
| Tests enfocados | 87 aprobados: 31 unitarios y 56 de API/base real, 2 archivos |
| Suite completa | 542 aprobados en 76 archivos, sin fallos ni pruebas omitidas |
| Migraciones | 25 aplicadas desde cero; 3 nuevas |
| Prisma generate / validate | PASS |
| Diferencia esquema/base local | Vacía |
| TypeScript `tsc --noEmit` | PASS |
| Build estilo producción | PASS |
| `git diff --check` | PASS |
| Escaneo de secretos | Sin secretos reales en 49 archivos nuevos/modificados |
| Neon DEV remoto / QA visual | Pendientes por conexión inaccesible |

Comandos reproducibles, desde `dev` con Docker funcionando:

```powershell
npm.cmd run test:monthly:dev
npm.cmd run test:monthly:dev -- --full
npx.cmd prisma generate
npx.cmd prisma validate
npx.cmd tsc --noEmit
npm.cmd run build
git diff --check
```

Prisma y build requieren configurar el datasource local aislado y valores ficticios de las variables obligatorias. No usar `.env.prod.local`. El runner de tests se encarga de aislar el datasource y las credenciales de pruebas automáticamente.

Las pruebas enfocadas cubren configuración, fronteras, snapshots, prioridad, varios lugares, cancelación, lista de espera, admin/coach, privacidad, callbacks firmados, fraude de importe/referencia, duplicados, refunds, chargebacks, migraciones y carreras reales. La suite completa incluye regresiones existentes de Wellhub, TotalPass, autenticación, paquetes, pagos, challenge y eliminación con historia.

Se observaron conflictos de serialización al ejecutar todas las suites de base en paralelo. El runner ejecuta archivos secuencialmente, manteniendo las carreras concurrentes dentro de cada test. El build inicial concurrente con tests falló por bloqueo del DLL de Prisma en Windows; los comandos se repitieron en orden y pasaron. Dos aserciones nuevas esperaban HTTP 400 para falta de créditos; se corrigieron a HTTP 402, conservando el contrato existente. `npm ci --ignore-scripts` encontró una dependencia opcional ausente en el lock existente; la instalación normal funcionó sin cambiar dependencias ni lock. El build conserva un aviso del paquete baseline-browser-mapping sobre sus datos antiguos.

El escaneo revisó todos los archivos modificados/nuevos buscando llaves privadas, URLs de base con credenciales y formatos de tokens de proveedores. No encontró secretos reales. Se retiró el registro de prefijo de token de Mercado Pago del checkout. La prueba remota de DEV se limitó a conexión de lectura y registró únicamente el resultado sanitizado.

## Manual QA

Pendiente de ejecutar en el DEV remoto después de restablecer y migrar su base. No se declara una sesión de navegador manual como realizada.

1. Confirmar rama `dev`, identidad de la base DEV y ambos flags Wellhub deshabilitados. Aplicar las migraciones mediante el comando existente `npm run db:migrate:dev`, con `.env.dev.local` configurado localmente en ese worktree. Verificar estado de migraciones antes del push.
2. Con un ADMIN existente de DEV, crear **Ilimitado Octubre 2026**, mes 10, año 2026, precio 1500 MXN, descripción **Una clase al día durante octubre**. Comprobar que cantidad y días se ocultan y que mes/año son obligatorios.
3. Ejecutar `npm run test:monthly:dev` para reproducir compra del 25 de septiembre, callback firmado simulado y reserva anticipada de octubre. No cambiar el reloj del equipo ni crear un endpoint de aprobación.
4. Para QA visual sin cobro, usar la asignación/venta manual ADMIN existente de DEV, que registra un pago auditado, o un checkout sandbox ya confirmado por el operador. Nunca introducir un token de producción para esta prueba.
5. Abrir `/precios` y `/mis-clases`: comprobar nombre, 1500 MXN, mes, fechas y una clase diaria; saldo normal sigue en cero. El estado depende de la fecha real del QA.
6. Crear sesiones de octubre en dos horarios del mismo día y otra al día siguiente, más una de noviembre. Reservar la primera de octubre: éxito y un lugar ocupado. Segundo horario: `UNLIMITED_DAILY_LIMIT`. Día siguiente: éxito. Noviembre sin créditos: `UNLIMITED_MONTH_MISMATCH`.
7. Solicitar dos lugares sin créditos por API: `UNLIMITED_SEAT_LIMIT`, sin reserva ni uso parcial. Con tres créditos normales, reservar dos lugares de una clase de costo 1: un lugar ilimitado, uno debitado, saldo normal 2.
8. Comprar/asignar tres créditos normales a otra cuenta DEV de QA. La primera reserva elegible usa cero créditos; una segunda clase del mismo día usa un crédito; otra fuera del mes puede usar créditos válidos. Expirados o pausados no cuentan.
9. Cancelar una reserva a más de cuatro horas: liberar cupo y poder reservar otro horario de ese día, sin crear crédito. Para probar tardía manualmente, usar una sesión del mes actual que empiece en menos de cuatro horas: cancelar libera cupo, pero otro horario del día conserva `UNLIMITED_DAILY_LIMIT`. El caso exacto 240 minutos y septiembre/octubre se verifica automáticamente con reloj controlado.
10. Repetir cancelación y comprobar que no hay devolución adicional. En una clase de cupo 1, confirmar promoción de un ilimitado en lista de espera; apuntarse a la lista no consume día. Un candidato con día consumido se omite sin borrar su entrada.
11. Editar nombre, precio, tipo y mes del catálogo: la compra y pago anteriores conservan octubre y sus condiciones. Intentar pausar o trasladar la sesión a otro día: error explícito.
12. Ejecutar `npm run test:monthly:dev -- --full` para callbacks duplicados/concurrentes, refund, refund parcial, chargeback, uso pasado y carreras por el último lugar. Verificar en los tests que solo una solicitud obtiene el último cupo y solo un uso diario queda consumido.
13. Comprobar con COACH la reserva manual, invitado y promoción; comprobar que USER/COACH no administran paquetes. Revisar reservas mixtas e historia en admin.
14. Revisar páginas en móvil y escritorio. No promover a UAT/main ni habilitar integraciones de producción.

Si octubre de 2026 ya pasó al ejecutar QA, usar un mes futuro para la prueba visual; las pruebas automáticas conservan exactamente septiembre/octubre de 2026.

## Regression

Wellhub Booking conserva source externo y sincronización de cupo; solo se añade atribución explícita, sin consumo de ilimitado. Check-in, afiliaciones, renovaciones y TotalPass conservan sus servicios existentes. Los créditos estándar, invitados, guardas de roles y firma Mercado Pago tienen cobertura de regresión. La reversión `charged_back` se reconoce como refund para reutilizar la protección existente de créditos estándar. Ninguna prueba hizo solicitudes a Wellhub ni cobros reales.

## Git

Inicio local de `dev`: `e1fccbceb6e3db023219c6c37c209e6a04d9e97e`.

Inicio de `origin/dev`: `7d08c66f4d74f493dfefcd4d58d51212a68ad84b`.

El commit local de implementación se identifica en la respuesta final. `origin/dev` queda sin push mientras la base remota sea inaccesible. La rama ya contenía un commit local previo de Wellhub al iniciar este trabajo; no se hizo cherry-pick ni merge.

`main` y `origin/main`: `a9b85f3c2c3f7114bd5a7fe9867e86b90a39b0b7`. `uat` y `origin/uat`: `af161a20b4c6fecd3c67a4a06e1b27f7a3ef433b`. No se modificaron esas ramas ni producción.

## Risks / Decisions

- Bloqueador: conexión Neon DEV inaccesible. No publicar antes de aplicar y verificar migraciones allí.
- Mixed usa la cantidad de lugares ya admitida por WAVE: uno ilimitado y el resto con créditos reales.
- Compras duplicadas nunca agregan cupo diario; si un checkout antiguo se paga después de vencer su reserva local, se conserva la conciliación y la unicidad diaria global sigue vigente.
- Un refund parcial también revoca el mes. Uso ya consumido y chargebacks requieren revisión ADMIN con el mecanismo de bloqueo existente.
- No se extiende ni pausa un mes calendario. Una sesión con uso histórico consumido no cambia de día.
- La validación en PostgreSQL local real está realizada; validación y QA visual del entorno remoto permanecen pendientes. No hay promoción más allá de DEV.
