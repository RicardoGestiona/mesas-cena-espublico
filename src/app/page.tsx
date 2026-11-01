import { connection } from "next/server";
import { SeatFinder } from "@/components/seat-finder";

export default async function Home() {
  // Dynamic rendering is required for the per-request CSP nonce (src/proxy.ts).
  await connection();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-5 pt-[max(env(safe-area-inset-top),3.5rem)] pb-[max(env(safe-area-inset-bottom),2rem)] landscape:pt-3 landscape:pb-3">
      <SeatFinder />
    </main>
  );
}
