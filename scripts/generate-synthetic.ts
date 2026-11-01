/**
 * Generates a deterministic synthetic attendee list (with a simulated draw)
 * in the seating CSV format. Uses RFC 2606 `.example` domains: never real.
 *
 * Usage: npm run seating:synthetic [-- --count 500 --seed 2026 --out data/private/attendees.synthetic.csv]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { TABLE_COUNT, VENUE } from "../src/lib/venue";

const COMPANIES = [
  { name: "Nexo Digital", domain: "nexodigital.example", weight: 30 },
  { name: "Atria Sistemas", domain: "atriasistemas.example", weight: 25 },
  { name: "Cumbre Cloud", domain: "cumbrecloud.example", weight: 20 },
  { name: "Lumen Datos", domain: "lumendatos.example", weight: 15 },
  { name: "Vértice Consultoría", domain: "verticeconsultoria.example", weight: 10 },
] as const;

const FIRST_NAMES = [
  "Lucía", "Hugo", "Martina", "Mateo", "Sofía", "Martín", "María", "Leo", "Julia", "Daniel",
  "Paula", "Alejandro", "Valeria", "Pablo", "Emma", "Manuel", "Daniela", "Álvaro", "Carla", "Adrián",
  "Alba", "Mario", "Noa", "Enzo", "Sara", "Diego", "Carmen", "Javier", "Irene", "Marcos",
  "Laura", "Sergio", "Elena", "Jorge", "Ana", "David", "Marta", "Iván", "Cristina", "Raúl",
  "Nerea", "Rubén", "Andrea", "Óscar", "Claudia", "Íñigo", "Aitana", "Guillermo", "Olivia", "Rodrigo",
  "Inés", "Gonzalo", "Lola", "Víctor", "Vega", "Nicolás", "Candela", "Samuel", "Jimena", "Joan",
];

const SURNAMES = [
  "García", "Rodríguez", "González", "Fernández", "López", "Martínez", "Sánchez", "Pérez", "Gómez", "Martín",
  "Jiménez", "Ruiz", "Hernández", "Díaz", "Moreno", "Muñoz", "Álvarez", "Romero", "Alonso", "Gutiérrez",
  "Navarro", "Torres", "Domínguez", "Vázquez", "Ramos", "Gil", "Ramírez", "Serrano", "Blanco", "Molina",
  "Morales", "Suárez", "Ortega", "Delgado", "Castro", "Ortiz", "Rubio", "Marín", "Sanz", "Núñez",
  "Iglesias", "Medina", "Garrido", "Cortés", "Castillo", "Santos", "Lozano", "Guerrero", "Cano", "Prieto",
  "Méndez", "Cruz", "Calvo", "Gallego", "Vidal", "León", "Márquez", "Herrera", "Peña", "Flores",
  "Cabrera", "Campos", "Vega", "Fuentes", "Carrasco", "Diez", "Caballero", "Reyes", "Nieto", "Aguilar",
  "Pascual", "Santana", "Herrero", "Lorenzo", "Montero", "Hidalgo", "Giménez", "Ibáñez", "Ferrer", "Durán",
];

/** mulberry32: small seeded PRNG for reproducible datasets. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function main(): void {
  const { values } = parseArgs({
    options: {
      count: { type: "string", default: String(TABLE_COUNT * VENUE.seatsPerTable) },
      seed: { type: "string", default: "2026" },
      out: { type: "string", default: "data/private/attendees.synthetic.csv" },
    },
  });
  const count = Number(values.count);
  const capacity = TABLE_COUNT * VENUE.seatsPerTable;
  if (!Number.isInteger(count) || count < 1 || count > capacity) {
    throw new Error(`--count must be an integer between 1 and ${capacity}`);
  }

  const random = prng(Number(values.seed));
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const totalWeight = COMPANIES.reduce((sum, c) => sum + c.weight, 0);
  const pickCompany = () => {
    let r = random() * totalWeight;
    for (const company of COMPANIES) {
      r -= company.weight;
      if (r < 0) return company;
    }
    return COMPANIES[COMPANIES.length - 1];
  };

  const usedEmails = new Set<string>();
  const people = Array.from({ length: count }, () => {
    const firstName = pick(FIRST_NAMES);
    const surname1 = pick(SURNAMES);
    const surname2 = pick(SURNAMES);
    const company = pickCompany();
    const base = `${slug(firstName)}.${slug(surname1)}`;
    let local = base;
    for (let n = 2; usedEmails.has(`${local}@${company.domain}`); n++) local = `${base}${n}`;
    const email = `${local}@${company.domain}`;
    usedEmails.add(email);
    return { firstName, lastName: `${surname1} ${surname2}`, email, company: company.name };
  });

  // Simulated draw: Fisher–Yates shuffle, then fill tables of `seatsPerTable` in order.
  const order = people.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const tableOf = new Map<number, number>();
  order.forEach((personIndex, position) => {
    tableOf.set(personIndex, Math.floor(position / VENUE.seatsPerTable) + 1);
  });

  const lines = [
    "first_name,last_name,email,company,table",
    ...people.map((p, i) => [p.firstName, p.lastName, p.email, p.company, tableOf.get(i)].join(",")),
  ];

  const outPath = path.resolve(values.out);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
  console.log(JSON.stringify({ event: "synthetic.generated", rows: count, out: values.out }));
  console.log(JSON.stringify({ event: "synthetic.domains", domains: COMPANIES.map((c) => c.domain).join(",") }));
}

main();
