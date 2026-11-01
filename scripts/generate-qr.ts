/**
 * Generates the entrance QR (print-ready SVG + high-res PNG).
 * Error correction "H" (30%) tolerates glare, wear or a logo overlay.
 *
 * Usage: npm run qr -- --url https://mesas-cena-espublico.vercel.app [--out print]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import QRCode from "qrcode";
import { z } from "zod";

const ArgsSchema = z.object({
  url: z.url({ protocol: /^https$/ }),
  out: z.string().min(1),
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { url: { type: "string" }, out: { type: "string", default: "print" } },
  });
  const { url, out } = ArgsSchema.parse(values);
  const options = { errorCorrectionLevel: "H", margin: 4 } as const;

  const outDir = path.resolve(out);
  mkdirSync(outDir, { recursive: true });
  const svgPath = path.join(outDir, "qr-entrada.svg");
  const pngPath = path.join(outDir, "qr-entrada.png");

  writeFileSync(svgPath, await QRCode.toString(url, { ...options, type: "svg" }), "utf8");
  await QRCode.toFile(pngPath, url, { ...options, type: "png", width: 2048 });

  console.log(JSON.stringify({ event: "qr.generated", url, svg: path.relative(process.cwd(), svgPath), png: path.relative(process.cwd(), pngPath) }));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "qr.failed", message: error instanceof Error ? error.message : "unexpected failure" }));
  process.exit(1);
});
