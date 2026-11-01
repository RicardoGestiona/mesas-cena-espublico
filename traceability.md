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
