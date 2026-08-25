/** Force-color state managed by CLI flags (--color / --no-color). */
let forceColor: boolean | undefined;

/** Set the force-color override from CLI flag parsing. */
export function setForceColor(value: boolean | undefined): void {
  forceColor = value;
}

/** Returns true if color output should be emitted. */
export function colorEnabled(): boolean {
  if (forceColor !== undefined) return forceColor;
  if (process.env.NO_COLOR) return false;
  if (process.env.TERM === "dumb") return false;
  return process.stdout.isTTY === true;
}

const RESET = "\x1b[0m";

export const color = {
  red: (s: string): string => (colorEnabled() ? `\x1b[31m${s}${RESET}` : s),
  green: (s: string): string => (colorEnabled() ? `\x1b[32m${s}${RESET}` : s),
  cyan: (s: string): string => (colorEnabled() ? `\x1b[36m${s}${RESET}` : s),
  bold: (s: string): string => (colorEnabled() ? `\x1b[1m${s}${RESET}` : s),
  dim: (s: string): string => (colorEnabled() ? `\x1b[2m${s}${RESET}` : s)
};
