/**
 * Structured JSON logger. NEVER pass emails, hashes or IPs in `fields`.
 */
type Level = "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | undefined>;

function write(level: Level, event: string, fields: Fields = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};
