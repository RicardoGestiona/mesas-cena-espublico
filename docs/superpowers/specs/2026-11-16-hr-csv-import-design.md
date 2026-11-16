# Diseño: importar el CSV de RR. HH. para cambios de última hora

Fecha: 2026-11-16 · Tamaño: cambio pequeño

## Intención

RR. HH. mantiene el listado definitivo y puede cambiarlo hasta la noche de la cena (2026-11-27). Ricardo publica cada versión con el script existente (`seating:import --target redis`). El objetivo es que el fichero que exporta Excel en español entre a la primera y que los errores se puedan devolver a RR. HH. antes de publicar.

## Enfoques considerados

- **A. Panel `/admin` en la web pública.** Descartado: el token de escritura de Redis quedaría en el despliegue público y rompería el mínimo privilegio.
- **B. Segundo proyecto de Vercel solo para administración.** Descartado por coste y plazo (11 días): crea un proyecto nuevo y un login nuevo, y añade superficie de ataque.
- **C. Ricardo importa con el script actual, con mejoras de formato y validación previa.** **Elegido.** No hay código nuevo en el runtime ni superficie de ataque nueva. El precio aceptado es que Ricardo tiene que estar disponible con el portátil, el repo y los secretos.

## Objetivos

1. Aceptar el CSV de Excel en español:
   - Separador `;` o `,`, detectado a partir de la cabecera: se elige el que produzca las 5 columnas obligatorias. Si ambos o ninguno las producen, se rechaza con un error claro.
   - Comillas estándar (RFC 4180): `"Empresa, S.L."` y `""` para escapar una comilla dentro del valor. Un salto de línea dentro de comillas o unas comillas sin cerrar se rechazan indicando el número de línea.
   - Las filas con todas las celdas vacías (`;;;;`, que Excel añade a menudo) se ignoran como si fueran líneas en blanco.
   - **Detectar ficheros que no están en UTF-8.** Si se guarda como «CSV (delimitado por comas)» en lugar de «CSV UTF-8», los acentos llegan como `U+FFFD`. Hoy se publicarían nombres corruptos sin dar error. Se rechazará el fichero con un mensaje que diga «guarda como CSV UTF-8».
2. Añadir `--dry-run` a `seating:import`: ejecuta `buildSeating` completo y muestra en JSON `{attendees, tables, errors}` sin escribir en ningún almacén ni verificar contra producción. No exige `--expires-at`. Se recomienda usarlo con `--secrets-file` para validar contra los dominios reales; sin él, usa `.env.local`, y la salida dice qué fuente de dominios se ha usado.
3. Añadir al runbook (`soc/07-runbook-evento.md`, local) el procedimiento de cambio de última hora. El canal interno de recepción lo concretará Ricardo; no se usa el correo. Los pasos son: dry-run, devolver los errores a RR. HH., import y borrar el CSV y los secretos.

## No objetivos

- No hay panel web ni login, y no se crean usuarios ACL de escritura.
- No se lee `.xlsx`, así que no se añade ninguna dependencia.
- No hay importación incremental: cada import sustituye el listado entero, que es el comportamiento actual.

## Restricciones (invariantes que no cambian)

- Todo o nada. Los mensajes de error nunca reproducen valores (email, nombre o empresa): solo indican línea, campo y regla.
- `normalizeEmail` sigue siendo la única normalización.
- Los logs se quedan en el JSON actual, sin datos personales.

## Lo que cambia en el código

- `src/server/seating-import.ts`: se sustituye `parseCsv` por un parser con detección de separador y comillas. Sigue siendo una función pura, sin I/O. `sampleProbes` lo reutiliza.
- `scripts/import-seating.ts`: se añade la opción `--dry-run`.
- `tests/seating-import.test.ts`: el test «rejects quoted fields» pasa a «accepts quoted fields». No es un invariante de privacidad, es una limitación de formato que se elimina conscientemente.
- `CLAUDE.md`: se actualiza la sección «Formato del CSV del sorteo».

## Tests propuestos (TDD)

- Separador `;` y `,`; cabecera ambigua o sin columnas obligatorias.
- Valores con comillas y comas; `""` escapadas; comillas sin cerrar o con salto de línea dentro.
- Filas vacías del tipo `;;;;`; BOM con `;`.
- `U+FFFD` en cualquier campo, rechazado con un mensaje que no reproduce el valor.
- `--dry-run` no escribe nada (con un almacén falso) y devuelve los errores.

## Decisiones que deja a quien lo implemente

- La forma interna del parser (máquina de estados o bucle por caracteres). No se añade una librería CSV: el formato es acotado y el parser actual ya es propio.
