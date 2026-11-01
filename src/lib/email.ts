/**
 * Single source of truth for email normalization.
 * MUST be shared by the import script and the lookup endpoint: if they
 * diverge, lookups silently miss.
 */
export function normalizeEmail(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

export function emailDomain(normalizedEmail: string): string {
  const at = normalizedEmail.lastIndexOf("@");
  return at === -1 ? "" : normalizedEmail.slice(at + 1);
}
