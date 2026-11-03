"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, ChevronLeft, LockKeyhole } from "lucide-react";
import { z } from "zod";
import { lookupRequestBody } from "@/lib/lookup-request";
import { PRIVACY_NOTICE, PRIVACY_NOTICE_ACK_LABEL } from "@/lib/privacy-notice";
import { tablePosition } from "@/lib/venue";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { FloorPlan } from "./floor-plan";

const ApiResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("found"),
    table: z.number().int().positive(),
    tablemates: z.array(z.object({ name: z.string(), company: z.string() })),
  }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("rate_limited") }),
  z.object({ status: z.literal("error") }),
]);

type Tablemate = { name: string; company: string };

type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; table: number; tablemates: Tablemate[] }
  | { kind: "message"; text: string };

const MESSAGES = {
  not_found: "No encontramos ese email. Revisa que sea tu email corporativo o acércate al punto de información.",
  rate_limited: "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.",
  error: "Algo ha fallado. Inténtalo de nuevo en unos segundos.",
} as const;

// Acute, grave, circumflex and diaeresis; the tilde (U+0303) is kept so "Ñ" survives.
const VOWEL_ACCENTS = /[\u0300\u0301\u0302\u0308]/g;

/** iOS Contacts-style monogram: first letter of the first and last word, without accents. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.normalize("NFD").replace(VOWEL_ACCENTS, "").normalize("NFC").toLocaleUpperCase("es");
}

function SectionHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pb-2">
      <h2 className="font-heading text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      {trailing}
    </div>
  );
}

/** True while a scroll container still has content below its visible area. */
function useHasMoreBelow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setHasMore(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    update();
    el.addEventListener("scroll", update, { passive: true });
    // Covers orientation changes, where the max-height (and so the overflow) changes.
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return { ref, hasMore };
}

function TablemateList({ tablemates }: { tablemates: Tablemate[] }) {
  const { ref: listRef, hasMore } = useHasMoreBelow<HTMLDivElement>();

  return (
    <section className="landscape:flex landscape:min-h-0 landscape:flex-col">
      <SectionHeader
        title="En tu mesa"
        trailing={
          tablemates.length > 0 ? (
            <Badge variant="secondary" className="tabular-nums">
              {tablemates.length}
            </Badge>
          ) : null
        }
      />
      <div className="relative landscape:flex landscape:min-h-0 landscape:flex-col">
        <Card
          ref={listRef}
          className="gap-0 rounded-2xl py-0 shadow-[0_1px_2px_rgb(0_0_0/0.04)] ring-0 landscape:min-h-0 landscape:overflow-y-auto landscape:overscroll-contain short-landscape:py-1"
        >
          {tablemates.length === 0 ? (
            <p className="px-4 py-4 text-[15px] text-muted-foreground">Aún no hay más asistentes asignados a tu mesa.</p>
          ) : (
            // Phone in landscape: two columns so a full table (9 tablemates) fits without scrolling.
            <ul className="short-landscape:grid short-landscape:grid-cols-2">
              {tablemates.map((mate, i) => (
                <li key={i}>
                  {i > 0 && <Separator className="ml-[4.25rem] w-auto short-landscape:hidden" />}
                  <div className="flex items-center gap-3 px-4 py-2.5 short-landscape:gap-2.5 short-landscape:px-3 short-landscape:py-0.5">
                    <Avatar className="size-10 after:hidden short-landscape:size-7">
                      <AvatarFallback className="bg-linear-to-b from-monogram-from to-monogram-to text-[15px] font-medium text-white short-landscape:text-[11px]">
                        {initials(mate.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[17px] leading-snug short-landscape:text-[13px]">{mate.name}</span>
                      <span className="truncate text-[13px] text-muted-foreground short-landscape:text-[11px]">{mate.company}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {/* Fade hinting at more tablemates below; hidden once the end of the list is reached. */}
        <div
          aria-hidden
          data-visible={hasMore}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-14 rounded-b-2xl bg-linear-to-t from-card to-transparent opacity-0 transition-opacity duration-300 data-[visible=true]:opacity-100 motion-reduce:transition-none"
        />
      </div>
    </section>
  );
}

const REVEAL = "animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-700 motion-reduce:animate-none";

function Result({ table, tablemates, onBack }: { table: number; tablemates: Tablemate[]; onBack: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { row, col } = tablePosition(table);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section aria-live="polite" className="mx-auto flex w-full max-w-md flex-col gap-8 landscape:max-w-5xl landscape:gap-2">
      <Button
        type="button"
        variant="link"
        onClick={onBack}
        className="-ml-2 h-auto self-start px-1 text-[17px] font-normal hover:no-underline"
      >
        <ChevronLeft className="size-5" aria-hidden />
        Buscar otro email
      </Button>

      {/*
        Portrait: stacked (number, plan, tablemates).
        Landscape: one screen, no page scroll. Left: compact number + tablemates; right: plan sized
        by height with aspect-[460/832], the FloorPlan viewBox.
      */}
      <div className="flex flex-col gap-8 landscape:grid landscape:h-[calc(100dvh-4rem)] landscape:grid-cols-[minmax(0,1fr)_auto] landscape:grid-rows-[minmax(0,1fr)] landscape:gap-6">
        <div className="contents landscape:flex landscape:min-h-0 landscape:flex-col landscape:gap-3">
          <header
            className={`order-1 flex flex-col items-center text-center landscape:grid landscape:grid-cols-[auto_1fr] landscape:items-center landscape:gap-x-4 landscape:rounded-2xl landscape:bg-primary landscape:px-5 landscape:py-3 landscape:text-left landscape:text-primary-foreground landscape:shadow-[0_10px_30px_-14px_var(--primary)] ${REVEAL}`}
          >
            <p className="text-[15px] font-medium text-muted-foreground landscape:col-start-2 landscape:row-start-1 landscape:self-end landscape:text-primary-foreground/80">
              Tu mesa
            </p>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="font-heading text-[8.5rem] leading-none font-semibold tracking-[-0.06em] tabular-nums outline-none landscape:col-start-1 landscape:row-span-2 landscape:row-start-1 landscape:text-[3.5rem]"
            >
              <span className="sr-only">Mesa </span>
              {table}
            </h1>
            <p className="mt-3 text-[15px] text-muted-foreground landscape:col-start-2 landscape:row-start-2 landscape:mt-0 landscape:self-start landscape:text-primary-foreground">
              Fila {row + 1} desde el escenario <span aria-hidden>·</span> {col + 1}ª desde la izquierda
            </p>
          </header>

          <div className={`order-3 delay-300 landscape:flex landscape:min-h-0 landscape:flex-col ${REVEAL}`}>
            <TablemateList tablemates={tablemates} />
          </div>
        </div>

        <section className={`order-2 delay-150 landscape:col-start-2 landscape:row-start-1 ${REVEAL}`}>
          <div className="landscape:hidden">
            <SectionHeader title="Cómo llegar" />
          </div>
          <Card className="rounded-2xl p-3 shadow-[0_1px_2px_rgb(0_0_0/0.04)] ring-0 landscape:aspect-[460/832] landscape:h-[calc(100dvh-4rem)] landscape:p-2">
            <FloorPlan highlightedTable={table} className="h-auto w-full landscape:h-full" />
          </Card>
        </section>
      </div>
    </section>
  );
}

export function SeatFinder() {
  const inputId = useId();
  const messageId = useId();
  const noticeId = useId();
  const [email, setEmail] = useState("");
  // Kept on "Buscar otro email": the notice was already read in this visit.
  const [noticeAccepted, setNoticeAccepted] = useState(false);
  const [state, setState] = useState<ViewState>({ kind: "idle" });
  const canSubmit = email.trim() !== "" && noticeAccepted;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind === "loading" || !canSubmit) return;
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: lookupRequestBody(email),
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
          ? { kind: "found", table: body.table, tablemates: body.tablemates }
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
    return <Result table={state.table} tablemates={state.tablemates} onBack={reset} />;
  }

  const loading = state.kind === "loading";
  const hasError = state.kind === "message";

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col animate-in fade-in duration-500 motion-reduce:animate-none">
      <header className="flex flex-col items-center gap-3 pt-[12vh] text-center">
        <p className="text-[15px] font-medium text-muted-foreground">Cena de empresa</p>
        <h1 className="font-heading text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.025em]">
          ¿Dónde me siento?
        </h1>
        <p className="max-w-[18rem] text-[17px] leading-snug text-muted-foreground">
          Introduce tu email corporativo y te mostramos tu mesa.
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate className="mt-10 flex flex-col gap-3">
        <div className="relative">
          <Input
            id={inputId}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            required
            maxLength={254}
            placeholder=" "
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state.kind === "message") setState({ kind: "idle" });
            }}
            aria-invalid={hasError || undefined}
            aria-describedby={messageId}
            className="peer h-14 rounded-2xl border-input bg-card px-4 pt-5 pr-14 pb-1.5 text-[17px] shadow-[0_1px_2px_rgb(0_0_0/0.04)] md:text-[17px] dark:bg-card aria-invalid:border-destructive/50 aria-invalid:ring-0 dark:aria-invalid:border-destructive/50"
          />
          <Label
            htmlFor={inputId}
            className="pointer-events-none absolute top-2.5 left-4 text-xs font-normal text-muted-foreground transition-all duration-200 peer-placeholder-shown:top-[1.15rem] peer-placeholder-shown:text-[17px] peer-focus:top-2.5 peer-focus:text-xs"
          >
            Email corporativo
          </Label>
          <Button
            type="submit"
            size="icon"
            disabled={loading || !canSubmit}
            aria-label="Ver mi mesa"
            className="absolute top-1/2 right-2.5 size-9 -translate-y-1/2 rounded-full transition-all duration-300 active:not-aria-[haspopup]:-translate-y-1/2 active:scale-95 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
          >
            {loading ? <Spinner aria-label="Buscando" className="size-4.5" /> : <ArrowRight className="size-4.5" aria-hidden />}
          </Button>
        </div>

        <p id={messageId} aria-live="polite" className="min-h-10 px-4 text-[13px] leading-snug text-destructive">
          {hasError ? (
            <span className="block animate-in fade-in slide-in-from-top-1 duration-300 motion-reduce:animate-none">
              {state.text}
            </span>
          ) : null}
        </p>

        <div className="flex flex-col gap-4 px-4">
          <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p id={noticeId}>
              Para mostrarte tu mesa usamos tu email corporativo, que no guardamos en claro. Verás tu número de mesa y el
              nombre, apellidos y empresa de tus compañeros de mesa, y ellos verán los tuyos. Los datos se borran
              automáticamente el {PRIVACY_NOTICE.deletionDate}. Responsable: {PRIVACY_NOTICE.controller}. Puedes ejercer
              tus derechos u oponerte a que se muestre tu nombre en{" "}
              <a
                href={`mailto:${PRIVACY_NOTICE.rightsContactEmail}`}
                className="underline underline-offset-2 hover:text-foreground"
              >
                {PRIVACY_NOTICE.rightsContactEmail}
              </a>
              . Nunca te pediremos contraseñas.
            </p>
          </div>
          <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-snug">
            <input
              type="checkbox"
              checked={noticeAccepted}
              onChange={(e) => setNoticeAccepted(e.target.checked)}
              aria-describedby={noticeId}
              className="mt-px size-5 shrink-0 cursor-pointer accent-primary"
            />
            <span>{PRIVACY_NOTICE_ACK_LABEL}</span>
          </label>
        </div>
      </form>
    </div>
  );
}
