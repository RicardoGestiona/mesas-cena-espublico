# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Objetivo

Web para la cena de empresa de un grupo de empresas (~500 comensales, mesas de 10 asignadas por sorteo). En la puerta solo hay **un QR** que abre la web; el asistente introduce **su email corporativo** y ve **su número de mesa resaltado en el plano de sala** (nunca el asiento). Empresa tecnológica: la arquitectura y la privacidad deben ser impecables.

Producción: https://mesas-cena-espublico.vercel.app (Vercel, deploy automático desde `main` de `RicardoGestiona/mesas-cena-espublico`).

Región de funciones: `fra1`, fijada en `vercel.ts` (prevalece sobre el panel). Upstash en `eu-central-1`.

Stack: Next.js 16 (App Router, Turbopack) en Vercel · TypeScript estricto · Zod 4 · Tailwind 4 · Upstash Redis (vía Vercel Marketplace) en producción.

UI: shadcn/ui (`components.json`, estilo `radix-nova`, componentes en `src/components/ui/`, añadir con `npx shadcn@latest add <c>`). Estética Apple: fuente del sistema (SF Pro) con Geist como alternativa, un único acento systemBlue y tokens en `globals.css`. El modo oscuro sigue a `prefers-color-scheme` (variante `dark` por media query, no hay clase `.dark`). Antes de añadir un componente Radix, comprueba que no ponga `style` en línea (CSP). Resultado en horizontal (`landscape:`): compañeros a la izquierda y plano a la derecha, en una sola pantalla y sin scroll. El plano se dimensiona por su altura con `aspect-[460/832]`, que debe coincidir con el viewBox de `floor-plan.tsx`. La variante `short-landscape:` (horizontal con altura ≤ 520 px, es decir, un móvil girado) compacta la lista en dos columnas.

**Next.js 16 tiene cambios incompatibles con versiones anteriores** (`proxy.ts` sustituye a middleware, `LayoutProps` generado, etc.). Antes de escribir código Next, consulta `node_modules/next/dist/docs/` (ver `AGENTS.md`).

## Comandos

```bash
npm run dev                 # dev server (SEATING_STORE=memory)
npm run typecheck           # next typegen && tsc --noEmit (typegen is required for LayoutProps)
npm run lint
npm run build
npm run qr -- --url https://mesas-cena-espublico.vercel.app   # entrance QR -> print/ (SVG + 2048px PNG, ECC H)
npm test                    # vitest run (all suites)
npx vitest run tests/lookup.test.ts            # single file
npx vitest run -t "rate-limits per client IP"  # single test by name
npm run seating:synthetic   # 500 synthetic attendees + simulated draw -> data/private/attendees.synthetic.csv
npm run seating:import -- --input <csv> --target memory
npm run seating:import -- --input <csv> --target redis --secrets-file .env.production.local \
  --expires-at 2026-12-20T23:59:00+01:00   # verifies against APP_URL
```

Los scripts leen `.env.local` (ver `.env.example`), que contiene el pepper de **DESARROLLO**. Para importar a Redis es obligatorio `--secrets-file` con los valores de producción. Ese fichero tiene prioridad sobre `.env.local` y debe definir él mismo `EMAIL_HMAC_PEPPER` y `ALLOWED_EMAIL_DOMAINS`. **Nunca pases secretos en la línea de comandos**, porque quedan en el historial de la shell. El fichero se crea fuera del historial (editor o gestor de contraseñas), queda gitignored por `.env.*` y se borra después del import. Las variables *Sensitive* de Vercel se descargan vacías con `vercel env pull`. Si el pepper no coincide, la verificación E2E lo detecta (`not_found`) y hace rollback.

## Tests (`tests/`, Vitest)

- Los invariantes de privacidad están cubiertos por tests: un único `not_found` byte a byte, una sola lectura del almacén en todos los casos, latencia mínima, límite de peticiones por IP, logs sin email/hash/IP, el import no deja texto en claro y fallo seguro (error genérico) si no hay almacén. **Un cambio que rompa uno de estos tests rompe un requisito; no relajar el test.**
- `tests/api-lookup.test.ts` es de integración sobre el handler real: usa `vi.stubEnv` y `vi.resetModules()` para reconstruir los singletons (`serverEnv`, repositorio y rate limiter) en cada test.
- `server-only` se sustituye por un stub vacío en `vitest.config.mts`. `lookupTable` admite inyectar `LookupDeps`; la lógica de importación vive en `src/server/seating-import.ts` (sin I/O) y `scripts/import-seating.ts` es solo la CLI.

## Decisiones de producto

- Solo se pide email, sin verificación (OTP descartado): ver la mesa de otra persona no se considera sensible.
- Cláusula informativa (RGPD art. 13) visible bajo el email, con la casilla «He leído la información sobre protección de datos». La base jurídica es el interés legítimo, no el consentimiento, así que no se guarda ninguna prueba. El texto y los datos del responsable están en `src/lib/privacy-notice.ts`, y `tests/privacy-notice.test.ts` impide desplegar placeholders. La API exige `privacyNoticeAccepted: true` (`src/lib/lookup-request.ts`, el contrato que comparten la UI, la ruta y el verificador del import); si falta, devuelve el `not_found` uniforme.
- Plano supuesto (pendiente del plano real): sala rectangular vertical, escenario arriba, entrada abajo, 10 filas × 5 mesas, numeradas por filas desde el escenario y de izquierda a derecha. La configuración está en `src/lib/venue.ts`; el SVG en `src/components/floor-plan.tsx` dibuja la ruta entrada → pasillo → mesa.

## Requisitos de privacidad (invariantes, no negociables)

1. **La respuesta solo contiene `{status, table, tablemates: [{name, company}]}`.** Los compañeros se proyectan explícitamente a nombre y empresa, sin la propia persona. Nunca emails ni hashes. **Riesgo aceptado por Ricardo (2026-11-01):** sin verificar el email, quien adivine emails corporativos puede sacar nombres y empresas de los asistentes. No añadir más campos personales sin volver a decidirlo.
2. **No se guardan emails en claro:** la clave es `HMAC-SHA256(normalizeEmail(email), EMAIL_HMAC_PEPPER)` y el valor `{table, tablemates}`, precalculado al importar (una sola lectura por consulta). Si se rota el pepper, hay que volver a importar.
3. **La consulta se hace siempre en el servidor:** ni las asignaciones ni los hashes llegan nunca al cliente.
4. **Anti-enumeración:** formato inválido, dominio no permitido y email desconocido devuelven el mismo `not_found`; en todos los casos se calcula el hash y se lee del almacén, y la respuesta tarda como mínimo 250 ms (`MIN_RESPONSE_MS`). Límite de peticiones por IP (`RATE_LIMIT_PER_MINUTE`).
5. **Logs sin datos personales:** nunca registrar el email, el hash ni la IP. Usar solo `src/server/logger.ts` (JSON).
6. **Los datos de origen nunca se despliegan:** el CSV y `data/` están en `.gitignore` y `.vercelignore` y en `outputFileTracingExcludes`. El repositorio en memoria lee el fichero con `turbopackIgnore` para que el tracing no lo meta en el bundle. En Redis, el hash caduca con `EXPIREAT` (borrado automático tras el evento; `--expires-at` es obligatorio).
7. CSP con nonce por petición (`src/proxy.ts`). Por eso `cacheComponents`/PPR está **desactivado**, ya que es incompatible con los nonces, y la página usa `await connection()`. No usar el atributo `style` en línea: CSP lo bloquea en producción, así que van clases en `globals.css`. El resto de cabeceras están en `next.config.ts`.

## Arquitectura

Recorrido del dato: `CSV (local)` → `scripts/import-seating.ts` (valida todo o nada: emails, dominios, mesas 1..50, duplicados, capacidad ≤10 y nombres/empresas; descarta los emails) → `src/server/seating-publish.ts`: `seating:staging` con TTL → `MULTI` (`seating`→`seating:previous`, `staging`→`seating`) → verificación E2E contra `APP_URL/api/lookup` con 3 asistentes del CSV (`seating-verify.ts`) → si va bien, se borra `previous`; si falla, se restaura `previous` (o se borra todo si no había) y el script sale con error → `POST /api/lookup` (`src/app/api/lookup/route.ts`: límite de peticiones → Zod (`LookupRequestSchema`) → `src/server/lookup.ts`) → `src/components/seat-finder.tsx` (valida la respuesta con Zod) → `FloorPlan`.

- `src/lib/`: código común a cliente, servidor y scripts (`normalizeEmail` es la **única** normalización; si el import y la consulta usaran normalizaciones distintas, las búsquedas fallarían sin dar error).
- `src/server/`: los módulos de ejecución importan `server-only`. `env-schema.ts`, `seating-format.ts`, `seating-import.ts`, `seating-publish.ts`, `seating-verify.ts` y `crypto.ts` no lo importan porque también los usan los scripts de `tsx`. No importar módulos con `server-only` desde `scripts/`.
- `SeatingRepository` y `RateLimiter` tienen implementación `redis` (Upstash) y `memory` (solo dev). `serverEnv()` rechaza `memory` en producción.
- **Mínimo privilegio en Redis.** El runtime solo lee `RUNTIME_REDIS_URL`, `RUNTIME_REDIS_SEATING_TOKEN` y `RUNTIME_REDIS_RATELIMIT_TOKEN`, que son dos usuarios ACL de la misma base. `redisClient(env, "seating")` solo puede hacer `HGET` sobre `seating`. `redisClient(env, "ratelimit")` solo puede ejecutar el Lua del limitador sobre `rl:lookup:*`. Upstash tiene ACL al nivel de Redis 6, sin `%R~`, y por eso hay dos usuarios: con uno solo, `PEXPIRE` también alcanzaría `seating`. **No hay vuelta atrás a las credenciales admin.** Si se cambia `SEATING_HASH_KEY` o el prefijo `rl:lookup`, hay que regenerar los usuarios. Las credenciales **admin** (solo scripts) se resuelven en `src/server/redis-credentials.ts`: primero `KV_REST_API_*`, después `UPSTASH_REDIS_REST_*` y por último **una única** pareja `<P>_KV_REST_API_URL`/`<P>_KV_REST_API_TOKEN`. Esto es así porque el *Custom Prefix* de Vercel no puede quedar vacío. Si hay varias parejas con prefijo, se rechazan por ambiguas en lugar de elegir una. No volver a `Redis.fromEnv()`.

## Formato del CSV del sorteo

UTF-8, separado por comas, sin comillas, con cabecera. Columnas obligatorias: `email`, `table`, `first_name`, `last_name`, `company` (se rechazan valores vacíos, de más de 120 caracteres o con caracteres de control o bidi). El resto se ignora. Los datos sintéticos usan dominios ficticios `.example` (RFC 2606).

## Pendiente

Provisionar Upstash Redis en Vercel · plano real de la sala · dominios reales del grupo · fecha de caducidad.

Los cambios de variables de entorno en Vercel solo se aplican tras un Redeploy. Al cambiar credenciales, primero se despliega el código que lee las nuevas y después se retiran las antiguas. El estado operativo (límites vigentes, calendario del evento, cuentas) está en `CLAUDE.local.md`.
