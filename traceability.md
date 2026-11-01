# Traceability

## 2026-10-31 — Init + borrador funcional
- Decisiones: Next.js 16 en Vercel; solo email, sin OTP; el plano muestra la mesa, no el asiento.
- Privacidad: almacén `{HMAC(email) → mesa}` con pepper en el servidor; lookup solo en servidor; una única respuesta `not_found` + latencia mínima de 250 ms + límite de peticiones por IP; logs JSON sin datos personales; caducidad automática con `EXPIREAT` en Redis.
- CSP con nonce mediante `proxy.ts` → `cacheComponents`/PPR desactivado (incompatible según la documentación oficial).
- El build avisaba de que el tracing de Turbopack metía todo el proyecto en el bundle (lo que habría incluido `data/private`). Corregido con `turbopackIgnore`, `outputFileTracingExcludes` y `.vercelignore`.
- Plano supuesto: 10 filas × 5 mesas en vertical (legible en móvil) con ruta desde la entrada.
- Generador sintético determinista: 500 asistentes, 5 empresas, dominios `.example`, sorteo simulado.
- Verificado: typecheck, lint y build limpios; E2E con curl (encontrado, desconocido, dominio ajeno, malformado, payload enorme, 429 a la 11.ª petición) y capturas en móvil (390 px).

## 2026-11-01 — Suite de tests
- Vitest 5: 37 tests en 4 ficheros (lib, import, servicio de lookup, integración con el handler `/api/lookup`).
- Refactor para poder testear: inyección de dependencias en `lookupTable`; parseo/validación del CSV extraído a `src/server/seating-import.ts`.
- `@types/node` alineado a ^24 (el scaffold traía ^20 y chocaba con el peer de Vitest; el runtime es Node 24).
- Validado con mutation testing manual: saltarse la lectura del almacén y registrar el email en logs hacen fallar el test correspondiente.

## 2026-11-01 — Producción + QR
- Desplegado en https://mesas-cena-espublico.vercel.app. Verificado en producción: cabeceras de seguridad, CSP con nonce sin violaciones en navegador, rutas privadas 404. `/api/lookup` devuelve 500 genérico: faltan variables de producción/Redis o redeploy (pendiente de Ricardo).
- `scripts/generate-qr.ts` (solo URLs https, corrección de errores H). QR en `print/`, decodificado con jsQR → URL correcta (versión 5).

## 2026-11-01 — Import verificado con rollback
- Riesgo: un import a Redis con el pepper de `.env.local` (desarrollo) "funciona", pero deja producción respondiendo `not_found` a todo sin ningún aviso.
- Solución: `publishSeating` (store inyectado) hace swap atómico conservando `seating:previous`, verifica E2E contra el despliegue real (`createHttpVerifier`, 3 probes del CSV, mensajes sin emails) y hace rollback automático si falla. `APP_URL`/`--verify-url` es obligatorio para redis (solo https, o http en localhost).
- Bug encontrado con los tests: en Zod 4 los `refine` se ejecutan aunque `z.url()` haya fallado → `new URL()` lanzaba. Corregido con `URL.canParse`.
- 59 tests. Mutation testing: quitar la restauración hace fallar 2 tests. Pendiente: probar contra el Redis real cuando estén las credenciales en `.env.local`.

## 2026-11-01 — Credenciales Redis con prefijo
- Producción respondía 500: la base estaba conectada con el *Custom Prefix* `KV_REST_API_TOKEN` (Vercel no deja dejarlo vacío) → las variables se llamaban `KV_REST_API_TOKEN_KV_REST_API_URL`… y `Redis.fromEnv()` no las encontraba.
- Solución: `resolveRedisCredentials` (estándar → Upstash → una única pareja con prefijo; si hay ambigüedad, error) + cliente explícito `new Redis({url, token})` en runtime y en el script. Logs con nombres de variables, nunca valores.
- `lookup.failed` ahora incluye `invalidEnv`, y `serverEnv()` informa de todas las variables inválidas en una sola pasada.
- Verificado contra el Upstash real (PING) con nombres estándar y con prefijo. 69 tests.

## 2026-11-01 — Producción operativa
- Causa final del 500: `SEATING_STORE=memory` en Vercel (el runtime lo rechaza en producción a propósito). También se recreó `EMAIL_HMAC_PEPPER` (salía como "Needs Attention"). Tras redeploy: `200 not_found` uniforme (Redis vacío).
- Lección: los cambios de variables necesitan redeploy, y el diagnóstico más rápido es `lookup.failed.invalidEnv` en los Runtime Logs.
- Región: el ajuste del panel no se aplicaba (seguía `iad1`) → `fra1` fijada en `vercel.ts` (`@vercel/config`).
