/**
 * Minimal streaming RFC 4180 CSV parser — enough for nflverse's play-by-play
 * files, whose free-text `desc` column contains commas and quotes, which is why
 * `src/lib/nfl/games.ts`'s plain comma split can't be reused here. Deliberately
 * dependency-free: quoted fields, doubled-quote escapes, and newlines inside
 * quotes are the whole spec that matters.
 *
 * Feed it text chunks in order; it calls `onRow` once per complete record
 * (header included — the caller decides what the first row means).
 */
export class CsvStreamParser {
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  /** A quote seen inside a quoted field — either an escaped `""` or the field's closing quote; the next char decides. */
  private pendingQuote = false;

  constructor(private readonly onRow: (row: string[]) => void) {}

  push(chunk: string): void {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (c === '"') {
          this.field += '"';
          continue;
        }
        this.inQuotes = false; // the previous quote closed the field; fall through to handle `c` normally
      }
      if (this.inQuotes) {
        if (c === '"') this.pendingQuote = true;
        else this.field += c;
        continue;
      }
      if (c === '"') this.inQuotes = true;
      else if (c === ",") {
        this.row.push(this.field);
        this.field = "";
      } else if (c === "\n") {
        this.endRow();
      } else if (c !== "\r") {
        this.field += c;
      }
    }
  }

  /** Flush a final record with no trailing newline. */
  end(): void {
    if (this.pendingQuote) {
      this.pendingQuote = false;
      this.inQuotes = false;
    }
    if (this.field !== "" || this.row.length > 0) this.endRow();
  }

  private endRow(): void {
    this.row.push(this.field);
    this.onRow(this.row);
    this.row = [];
    this.field = "";
  }
}

/** Parse a complete CSV string into rows — convenience for tests and small files. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const p = new CsvStreamParser((r) => rows.push(r));
  p.push(text);
  p.end();
  return rows;
}
