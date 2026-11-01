# Traceability

## 2026-10-31 — Init + borrador funcional
- Decisiones: Next.js 16 en Vercel; solo email, sin OTP; el plano muestra la mesa, no el asiento.
- Privacidad: almacén `{HMAC(email) → mesa}` con pepper en el servidor; lookup solo en servidor; una única respuesta `not_found` + latencia mínima de 250 ms + límite de peticiones por IP; logs JSON sin datos personales; caducidad automática con `EXPIREAT` en Redis.
- CSP con nonce mediante `proxy.ts` → `cacheComponents`/PPR desactivado (incompatible según la documentación oficial).
- El build avisaba de que el tracing de Turbopack metía todo el proyecto en el bundle (lo que habría incluido `data/private`). Corregido con `turbopackIgnore`, `outputFileTracingExcludes` y `.vercelignore`.
- Plano supuesto: 10 filas × 5 mesas en vertical (legible en móvil) con ruta desde la entrada.
- Generador sintético determinista: 500 asistentes, 5 empresas, dominios `.example`, sorteo simulado.
- Verificado: typecheck, lint y build limpios; E2E con curl (encontrado, desconocido, dominio ajeno, malformado, payload enorme, 429 a la 11.ª petición) y capturas en móvil (390 px).
