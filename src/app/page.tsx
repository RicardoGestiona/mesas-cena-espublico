import { connection } from "next/server";
import { SeatFinder } from "@/components/seat-finder";

export default async function Home() {
  // Dynamic rendering is required for the per-request CSP nonce (src/proxy.ts).
  await connection();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.25em] text-muted">Cena de empresa</p>
        <h1 className="font-display text-4xl font-semibold leading-tight">¿Dónde me siento?</h1>
        <p className="text-muted">Introduce tu email y te mostramos tu mesa en el plano de la sala.</p>
      </header>
      <SeatFinder />
    </main>
  );
}
