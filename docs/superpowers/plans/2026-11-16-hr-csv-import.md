# HR CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept the CSV that Spanish Excel exports (`;`, quotes, empty rows, UTF-8 check) and add `--dry-run` to `seating:import`.

**Architecture:** Replace `parseCsv` in `src/server/seating-import.ts` with a pure parser (delimiter detection + RFC 4180 quotes, per line). Split `buildSeating` into a non-throwing `validateSeating` (used by `--dry-run`) and the existing throwing wrapper. The CLI only gains a branch that prints the report and exits before any store access.

**Tech Stack:** TypeScript strict, Zod 4, Vitest, tsx. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-hr-csv-import-design.md`

## Global Constraints

- All-or-nothing import; error messages never echo values (only line, field, rule).
- `normalizeEmail` stays the only normalization.
- No new dependencies; no runtime (`src/app`, `src/server/lookup.ts`, repositories) changes.
- Logs: one JSON line via `console.log`/`console.error` in the CLI, no personal data.
- Work on branch `feat/hr-csv-import` from `main`; leave the uncommitted `src/components/seat-finder.tsx` change untouched (stash it, restore it on its branch afterwards).

## Review Focus

- Header detected with `;` but a data row has a `,` inside an unquoted value → value kept as-is (`,` is not the delimiter), not split.
- Quoted email cell `"a@x.example"` → unquoted before `normalizeEmail`, lookup works.
- Spaces around quotes (`; "Empresa, S.L." ;`) → accepted as quoted value after trim.
- Trailing `\r` (CRLF from Windows Excel) inside last quoted cell → no stray `\r` in company.
- Trailing empty columns (`a;b;c;d;e;;`) → ignored like any extra column.

---

### Task 1: Excel-compatible CSV parser

**Files:**
- Modify: `src/server/seating-import.ts` (`parseCsv`, `sampleProbes` uses it unchanged)
- Test: `tests/seating-import.test.ts`

**Interfaces:**
- Produces: `parseCsv(content: string): { header: string[]; rows: { line: number; cells: string[] }[] }` (same shape as today; cells already unquoted, not trimmed beyond what callers do).

- [ ] **Step 1: Write failing tests** in a new `describe("parseCsv / Excel format")`, using `build()` and `expectImportError()`:
  - `accepts semicolon-separated files`: SAMPLE_CSV with `,`→`;` builds 2 entries, same digests as the comma version.
  - `accepts quoted values with delimiters and escaped quotes`: company `"Nexo, S.L."` (with `,`) and `"Nexo ""Digital"""` (with `;`) → tablemate company `Nexo, S.L.` / `Nexo "Digital"`.
  - `accepts a quoted email`: `"lucia.garcia@nexodigital.example"` resolves to `digest("lucia.garcia@nexodigital.example")`.
  - `skips rows whose cells are all empty`: SAMPLE_CSV (`;`) + `\n;;;;\n;;;;` → size 2.
  - `strips BOM with semicolon header`.
  - `handles CRLF with a quoted last cell`: no `\r` in any company.
  - `rejects unterminated quotes` → `"line 2: unterminated quoted field"`.
  - `rejects ambiguous or unknown delimiter`: header `email;table,first_name,last_name,company` → `"header must contain"`; header without any required column → same message.
  - `rejects non-UTF-8 content`: a row containing `�` → `"line 2: not valid UTF-8 (save as \"CSV UTF-8\")"`, and the message does not contain the row's name.
  - Replace `rejects quoted fields` (line 82) — delete it; covered above.
  - Review Focus tests: unquoted `,` inside a `;` file kept in the value; `; "Empresa, S.L." ;` accepted; trailing empty columns ignored.
- [ ] **Step 2: Run** `npx vitest run tests/seating-import.test.ts` → new tests FAIL.
- [ ] **Step 3: Implement.** Delimiter = whichever of `;`/`,` splits the (unquoted) header into a set containing all `REQUIRED_COLUMNS`; if neither or both → fall through to `columnIndexes`' existing error. Per line: character loop with `inQuotes` state; `""` inside quotes = literal `"`; a quote opening after optional whitespace starts a quoted cell; line ending while `inQuotes` → `ImportError("line N: unterminated quoted field")`. Check `�` on the raw line before parsing → `ImportError` with the message above (throw immediately: an encoding error affects the whole file). Skip lines where every cell trims to `""`.
- [ ] **Step 4: Run** `npx vitest run` → all PASS (incl. privacy invariants in `api-lookup`/`lookup`).
- [ ] **Step 5: Commit** `feat(import): accept Excel CSV (semicolon, quotes, empty rows) and reject non-UTF-8`.

### Task 2: `--dry-run`

**Files:**
- Modify: `src/server/seating-import.ts`, `scripts/import-seating.ts`
- Test: `tests/seating-import.test.ts`

**Interfaces:**
- Consumes: `parseCsv` (Task 1).
- Produces: `validateSeating(csv: string, allowedDomains: string[], pepper: string): { seating: Map<string, SeatEntry>; errors: string[] }` — never throws for row errors (an `ImportError` from `parseCsv`/header becomes a single entry in `errors`). `buildSeating` = `validateSeating` + throw `ImportError` with today's exact message format when `errors.length > 0`.

- [ ] **Step 1: Write failing tests:**
  - `validateSeating reports all row errors without throwing`: CSV with an invalid email (line 2) and table 99 (line 3) → `errors` contains `"line 2: invalid email"` and `"line 3: table must be 1..50"`, `seating.size` is 0 for errored rows' table occupancy irrelevant — assert only `errors.length === 2`.
  - `validateSeating turns header errors into a single error`: header missing `company` → `errors` = one string containing `"missing: company"`.
  - `validateSeating errors never echo values`: errors joined do not contain the email/local-part used.
  - Existing `buildSeating` error-message tests stay green unchanged.
- [ ] **Step 2: Run** → FAIL (`validateSeating` not exported).
- [ ] **Step 3: Implement** `validateSeating`; refactor `buildSeating` onto it.
- [ ] **Step 4: CLI.** Add `"dry-run": { type: "boolean" }` to `parseArgs` and `ArgsSchema` (`z.boolean().default(false)`). When set: skip the `--secrets-file` requirement and `--expires-at`; call `validateSeating`; print `{"event":"seating.dry_run","attendees","tables","errors":[...],"domainsSource":"secrets-file"|".env.local"}`; exit code 1 if `errors.length > 0`, else 0; never call `writeRedis`/`writeMemory`. Update the usage block in the file header.
- [ ] **Step 5: Verify manually:**
  - `npm run seating:import -- --input data/private/attendees.synthetic.csv --dry-run` → `errors: []`, `attendees: 500`, exit 0; `git status` shows no change to `data/private/seating.hashed.json` (check mtime before/after).
  - Same on a copy converted to `;` with one broken email → exit 1, one error, no value echoed.
- [ ] **Step 6: Run** `npm run typecheck && npm run lint && npx vitest run` → all PASS.
- [ ] **Step 7: Commit** `feat(import): add --dry-run to validate a seating CSV without publishing`.

### Task 3: Docs and runbook

**Files:**
- Modify: `CLAUDE.md` (sections «Comandos» and «Formato del CSV del sorteo»), `soc/07-runbook-evento.md` (local, gitignored), `traceability.md`

- [ ] **Step 1:** `CLAUDE.md`: add the `--dry-run` command; replace «sin comillas» with «separador `,` o `;` (detectado por la cabecera), comillas RFC 4180, UTF-8 obligatorio (Excel: «CSV UTF-8»), filas vacías ignoradas». Keep under 20.000 chars.
- [ ] **Step 2:** Runbook: section «Cambio de última hora» — receive CSV via internal channel (not email; channel TBD by Ricardo) → `--dry-run --secrets-file …` → send errors back to HR → import `--target redis --secrets-file … --expires-at …` → delete CSV and secrets file.
- [ ] **Step 3:** `traceability.md`: one concise entry for this session.
- [ ] **Step 4: Commit** `docs: document Excel CSV format and dry-run import` (CLAUDE.md, traceability.md, spec and plan).
