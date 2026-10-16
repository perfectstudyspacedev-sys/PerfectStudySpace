// Makes a server test run repeatable: a fixed clock (2026-10-16 11:00 IST) and seeded ids/codes.
// Import this FIRST — before harness.ts loads the api function.
// deno-lint-ignore-file no-explicit-any
const FIXED = Date.parse("2026-10-16T05:30:00.000Z");
const RealDate = Date;
let offsetMs = 0;

class FixedDate extends RealDate {
  constructor(...args: any[]) {
    // @ts-ignore: forwarding any Date constructor form
    if (args.length === 0) super(FIXED + offsetMs); else super(...args);
  }
  static override now() { return FIXED + offsetMs; }
}
(globalThis as any).Date = FixedDate;

/** Moves the fixed clock forward (e.g. to let a session run into overtime). */
export function advanceClock(ms: number) { offsetMs += ms; }

let uuidCounter = 0;
(crypto as any).randomUUID = () => `00000000-0000-4000-8000-${(++uuidCounter).toString(16).padStart(12, "0")}`;

let seed = 20261016;
(crypto as any).getRandomValues = <T extends ArrayBufferView>(arr: T): T => {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  for (let i = 0; i < bytes.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    bytes[i] = (seed >> 16) & 0xff;
  }
  return arr;
};
