import { color } from "./color";

export interface AgentctlError {
  message: string;
  file?: string;
  line?: number;
  context?: string;
  hint?: string;
}

/**
 * Format a structured error into a multi-line, colored string for terminal display.
 *
 * Example output:
 *   Error: invalid runtime value "on" in .ai/config.yaml
 *
 *     runtimes:
 *       claude: on    ← expected: enabled | disabled
 *               ^^
 *
 *   Hint: valid values are "enabled" or "disabled"
 */
export function formatError(err: AgentctlError): string {
  const lines: string[] = [];

  lines.push(color.red(`Error: ${err.message}`));

  if (err.file) {
    lines.push(color.dim(`  → ${err.file}${err.line !== undefined ? `:${err.line}` : ""}`));
  }

  if (err.context) {
    lines.push("");
    for (const ctxLine of err.context.split("\n")) {
      lines.push(`    ${ctxLine}`);
    }
  }

  if (err.hint) {
    lines.push("");
    lines.push(color.cyan(`  Hint: ${err.hint}`));
  }

  return lines.join("\n");
}

/**
 * Compute Levenshtein distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Suggest the closest matching command from a list of valid commands.
 * Returns undefined if no suggestion is close enough (threshold: max 3 edits).
 */
export function suggestCommand(input: string, validCommands: string[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;

  for (const cmd of validCommands) {
    const dist = levenshtein(input, cmd);
    if (dist < bestDist) {
      bestDist = dist;
      best = cmd;
    }
  }

  // Only suggest if the distance is reasonable (at most half the command length or 3)
  const threshold = Math.min(3, Math.ceil((best?.length ?? 0) / 2));
  return bestDist <= threshold ? best : undefined;
}
