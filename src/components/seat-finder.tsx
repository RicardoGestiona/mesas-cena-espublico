"use client";

import { useId, useState, type FormEvent } from "react";
import { z } from "zod";
import { tablePosition } from "@/lib/venue";
import { FloorPlan } from "./floor-plan";

const ApiResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("found"), table: z.number().int().positive() }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("rate_limited") }),
  z.object({ status: z.literal("error") }),
]);

type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; table: number }
  | { kind: "message"; text: string };

const MESSAGES = {
  not_found:
    "No encontramos ese email en la lista de asistentes. Revisa que sea tu email corporativo o acércate al punto de información.",
  rate_limited: "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.",
  error: "Algo ha fallado. Inténtalo de nuevo en unos segundos.",
} as const;

function ordinal(n: number): string {
  return `${n}ª`;
}

export function SeatFinder() {
  const inputId = useId();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<ViewState>({ kind: "idle" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        cache: "no-store",
      });
      const parsed = ApiResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setState({ kind: "message", text: MESSAGES.error });
        return;
      }
      const body = parsed.data;
      setState(
        body.status === "found"
          ? { kind: "found", table: body.table }
          : { kind: "message", text: MESSAGES[body.status] },
      );
    } catch {
      setState({ kind: "message", text: MESSAGES.error });
    }
  }

  function reset() {
    setEmail("");
    setState({ kind: "idle" });
  }

  if (state.kind === "found") {
    const { row, col } = tablePosition(state.table);
    return (
      <section aria-live="polite" className="flex flex-col gap-5">
        <div className="card text-center">
          <p className="text-sm uppercase tracking-[0.2em] text-muted">Tu mesa</p>
          <p className="font-display text-7xl font-semibold leading-none text-accent">{state.table}</p>
          <p className="mt-3 text-sm text-muted">
            {ordinal(row + 1)} fila desde el escenario · {ordinal(col + 1)} mesa desde la izquierda
          </p>
        </div>
        <div className="card p-3">
          <FloorPlan highlightedTable={state.table} />
        </div>
        <button type="button" onClick={reset} className="btn-secondary">
          Buscar otro email
        </button>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-4" noValidate>
      <label htmlFor={inputId} className="text-sm font-medium">
        Tu email corporativo
      </label>
      <input
        id={inputId}
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        maxLength={254}
        placeholder="nombre.apellido@empresa.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="input"
      />
      <button type="submit" className="btn-primary" disabled={state.kind === "loading" || email.trim() === ""}>
        {state.kind === "loading" ? "Buscando…" : "Ver mi mesa"}
      </button>
      <p aria-live="polite" className="min-h-5 text-sm text-danger">
        {state.kind === "message" ? state.text : ""}
      </p>
      <p className="text-xs text-muted">
        Solo usamos tu email para buscar tu mesa. No se guarda ni se registra.
      </p>
    </form>
  );
}
