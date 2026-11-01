import { ALL_TABLES, VENUE, tablePosition } from "@/lib/venue";

const TABLE_RADIUS = 26;
const SEAT_RADIUS = 3.5;
const COL_SPACING = 80;
const ROW_SPACING = 68;
const ORIGIN_X = 70;
const ORIGIN_Y = 122;

const WIDTH = ORIGIN_X * 2 + COL_SPACING * (VENUE.tablesPerRow - 1);
const LAST_ROW_Y = ORIGIN_Y + ROW_SPACING * (VENUE.rows - 1);
const CROSS_AISLE_Y = LAST_ROW_Y + TABLE_RADIUS + 22;
// viewBox is 460x832: seat-finder.tsx sizes the landscape plan with aspect-[460/832]; keep both in sync.
const HEIGHT = CROSS_AISLE_Y + 50;
const ENTRANCE_X = WIDTH / 2;
const ENTRANCE_WIDTH = 90;
const CENTER_COL = Math.floor(VENUE.tablesPerRow / 2);

function center(table: number): { x: number; y: number } {
  const { row, col } = tablePosition(table);
  return { x: ORIGIN_X + col * COL_SPACING, y: ORIGIN_Y + row * ROW_SPACING };
}

/** Decorative seat marks, identical for every table: never encodes a specific seat. */
function seatOffsets(): { dx: number; dy: number }[] {
  const ring = TABLE_RADIUS + 6;
  return Array.from({ length: VENUE.seatsPerTable }, (_, i) => {
    const angle = (2 * Math.PI * i) / VENUE.seatsPerTable - Math.PI / 2;
    return { dx: Math.cos(angle) * ring, dy: Math.sin(angle) * ring };
  });
}
const SEATS = seatOffsets();

/** Manhattan path: entrance → cross aisle → nearest column aisle → beside the table. */
function walkingPath(table: number): string {
  const { col } = tablePosition(table);
  const { x, y } = center(table);
  const towardsRight = col <= CENTER_COL;
  const aisleX = x + (towardsRight ? COL_SPACING / 2 : -COL_SPACING / 2);
  const endX = x + (towardsRight ? TABLE_RADIUS + 10 : -(TABLE_RADIUS + 10));
  return [
    `M ${ENTRANCE_X} ${HEIGHT - 8}`,
    `L ${ENTRANCE_X} ${CROSS_AISLE_Y}`,
    `L ${aisleX} ${CROSS_AISLE_Y}`,
    `L ${aisleX} ${y}`,
    `L ${endX} ${y}`,
  ].join(" ");
}

export function FloorPlan({ highlightedTable, className = "h-auto w-full" }: { highlightedTable: number; className?: string }) {
  const target = center(highlightedTable);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-labelledby="plan-title"
      className={className}
    >
      <title id="plan-title">{`Plano de la sala con la mesa ${highlightedTable} resaltada`}</title>

      {/* Hall walls with a gap for the entrance */}
      <path
        className="plan-wall"
        d={`M ${ENTRANCE_X - ENTRANCE_WIDTH / 2} ${HEIGHT - 8} H 8 V 8 H ${WIDTH - 8} V ${HEIGHT - 8} H ${ENTRANCE_X + ENTRANCE_WIDTH / 2}`}
      />

      <rect className="plan-stage" x={40} y={24} width={WIDTH - 80} height={44} rx={14} />
      <text className="plan-label" x={WIDTH / 2} y={46} textAnchor="middle" dominantBaseline="central">
        ESCENARIO
      </text>

      {ALL_TABLES.map(({ table }) => {
        const { x, y } = center(table);
        const active = table === highlightedTable;
        return (
          <g key={table} className={active ? "plan-table plan-table--active" : "plan-table"}>
            {SEATS.map(({ dx, dy }, i) => (
              <circle key={i} className="plan-seat" cx={x + dx} cy={y + dy} r={SEAT_RADIUS} />
            ))}
            <circle className="plan-table-top" cx={x} cy={y} r={TABLE_RADIUS} />
            <text className="plan-table-number" x={x} y={y} textAnchor="middle" dominantBaseline="central">
              {table}
            </text>
          </g>
        );
      })}

      {/* pathLength normalises the dash animation (draw-on) regardless of route length */}
      <path className="plan-path" pathLength={1} d={walkingPath(highlightedTable)} />
      <circle className="plan-pulse" cx={target.x} cy={target.y} r={TABLE_RADIUS + 12} />

      <circle className="plan-you" cx={ENTRANCE_X} cy={HEIGHT - 8} r={7} />
      <text className="plan-label plan-label--you" x={ENTRANCE_X - 16} y={HEIGHT - 4} textAnchor="end">
        ESTÁS AQUÍ
      </text>
    </svg>
  );
}
