# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Objetivo

Web para la cena de empresa de un grupo de empresas (~500 comensales, mesas de 10 asignadas por sorteo). En la puerta solo hay **un QR** que abre la web; el asistente introduce **su email corporativo** y ve **su número de mesa resaltado en el plano de sala** (nunca el asiento). Empresa tecnológica: la arquitectura y la privacidad deben ser impecables.

Stack: Next.js 16 (App Router, Turbopack) en Vercel · TypeScript estricto · Zod 4 · Tailwind 4 · Upstash Redis (vía Vercel Marketplace) en producción.

**Next.js 16 tiene cambios incompatibles con versiones anteriores** (`proxy.ts` sustituye a middleware, `LayoutProps` generado, etc.). Antes de escribir código Next, consulta `node_modules/next/dist/docs/` (ver `AGENTS.md`).

## Comandos

```bash
npm run dev                 # dev server (SEATING_STORE=memory)
npm run typecheck           # next typegen && tsc --noEmit (typegen is required for LayoutProps)
npm run lint
npm run build
npm test                    # vitest run (all suites)
npx vitest run tests/lookup.test.ts            # single file
npx vitest run -t "rate-limits per client IP"  # single test by name
npm run seating:synthetic   # 500 synthetic attendees + simulated draw -> data/private/attendees.synthetic.csv
npm run seating:import -- --input <csv> --target memory
npm run seating:import -- --input <csv> --target redis --expires-at 2026-12-20T23:59:00+01:00
```

Los scripts leen `.env.local` (ver `.env.example`).

## Tests (`tests/`, Vitest)

- Los invariantes de privacidad están cubiertos por tests: un único `not_found` byte a byte, una sola lectura del almacén en todos los casos, latencia mínima, límite de peticiones por IP, logs sin email/hash/IP, el import no deja texto en claro y fallo seguro (error genérico) si no hay almacén. **Un cambio que rompa uno de estos tests rompe un requisito; no relajar el test.**
- `tests/api-lookup.test.ts` es de integración sobre el handler real: usa `vi.stubEnv` y `vi.resetModules()` para reconstruir los singletons (`serverEnv`, repositorio y rate limiter) en cada test.
- `server-only` se sustituye por un stub vacío en `vitest.config.mts`. `lookupTable` admite inyectar `LookupDeps`; la lógica de importación vive en `src/server/seating-import.ts` (sin I/O) y `scripts/import-seating.ts` es solo la CLI.

## Decisiones de producto

- Solo se pide email, sin verificación (OTP descartado): ver la mesa de otra persona no se considera sensible.
- Plano supuesto (pendiente del plano real): sala rectangular vertical, escenario arriba, entrada abajo, 10 filas × 5 mesas, numeradas por filas desde el escenario y de izquierda a derecha. La configuración está en `src/lib/venue.ts`; el SVG en `src/components/floor-plan.tsx` dibuja la ruta entrada → pasillo → mesa.

## Requisitos de privacidad (invariantes, no negociables)

1. **La respuesta solo contiene `{status, table}`.** Nunca devolver nombres, compañeros de mesa ni otros datos personales.
2. **No se guardan emails en claro:** solo `HMAC-SHA256(normalizeEmail(email), EMAIL_HMAC_PEPPER)`. Si se rota el pepper, hay que volver a importar.
3. **La consulta se hace siempre en el servidor:** ni las asignaciones ni los hashes llegan nunca al cliente.
4. **Anti-enumeración:** formato inválido, dominio no permitido y email desconocido devuelven el mismo `not_found`; en todos los casos se calcula el hash y se lee del almacén, y la respuesta tarda como mínimo 250 ms (`MIN_RESPONSE_MS`). Límite de peticiones por IP (`RATE_LIMIT_PER_MINUTE`).
5. **Logs sin datos personales:** nunca registrar el email, el hash ni la IP. Usar solo `src/server/logger.ts` (JSON).
6. **Los datos de origen nunca se despliegan:** el CSV y `data/` están en `.gitignore` y `.vercelignore` y en `outputFileTracingExcludes`. El repositorio en memoria lee el fichero con `turbopackIgnore` para que el tracing no lo meta en el bundle. En Redis, el hash caduca con `EXPIREAT` (borrado automático tras el evento; `--expires-at` es obligatorio).
7. CSP con nonce por petición (`src/proxy.ts`). Por eso `cacheComponents`/PPR está **desactivado**, ya que es incompatible con los nonces, y la página usa `await connection()`. No usar el atributo `style` en línea: CSP lo bloquea en producción, así que van clases en `globals.css`. El resto de cabeceras están en `next.config.ts`.

## Arquitectura

Recorrido del dato: `CSV (local)` → `scripts/import-seating.ts` (valida todo o nada: emails, dominios, mesas 1..50, duplicados y capacidad ≤10; descarta todas las columnas salvo email/table) → `seating:staging` → `RENAME` atómico a `seating` → `POST /api/lookup` (`src/app/api/lookup/route.ts`: límite de peticiones → Zod → `src/server/lookup.ts`) → `src/components/seat-finder.tsx` (valida la respuesta con Zod) → `FloorPlan`.

- `src/lib/`: código común a cliente, servidor y scripts (`normalizeEmail` es la **única** normalización; si el import y la consulta usaran normalizaciones distintas, las búsquedas fallarían sin dar error).
- `src/server/`: los módulos de ejecución importan `server-only`. `env-schema.ts`, `seating-format.ts`, `seating-import.ts` y `crypto.ts` no lo importan porque también los usan los scripts de `tsx`. No importar módulos con `server-only` desde `scripts/`.
- `SeatingRepository` y `RateLimiter` tienen implementación `redis` (Upstash, `Redis.fromEnv()` lee `KV_REST_API_*` o `UPSTASH_REDIS_REST_*`) y `memory` (solo dev). `serverEnv()` rechaza `memory` en producción.

## Formato del CSV del sorteo

UTF-8, separado por comas, sin comillas, con cabecera. Columnas obligatorias: `email`, `table`. Las demás (`first_name,last_name,company`…) se ignoran. Los datos sintéticos usan dominios ficticios `.example` (RFC 2606).

## Pendiente

Provisionar Upstash Redis en Vercel · plano real de la sala · dominios reales del grupo · fecha de caducidad · generar el QR con la URL de producción.
