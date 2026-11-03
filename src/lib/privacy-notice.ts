/**
 * Privacy notice (GDPR art. 13) shown before the lookup. Legal basis: legitimate interest,
 * so the checkbox acknowledges the information; it is not consent.
 * Placeholders (`<...>`) are rejected by tests/privacy-notice.test.ts so they never ship.
 */
export const PRIVACY_NOTICE = {
  controller: "ESPUBLICO SERVICIOS PARA LA ADMINISTRACIÓN, S.A.",
  rightsContactEmail: "dpd@espublico.com",
  /** Must match the `--expires-at` of the production import. */
  deletionDate: "28/11/2026",
} as const;

export const PRIVACY_NOTICE_ACK_LABEL = "He leído la información sobre protección de datos";
