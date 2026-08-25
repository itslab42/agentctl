import { color } from "./color";

type Op = { type: "same" | "add" | "remove"; line: string };

const CONTEXT = 3;

function lcsOps(oldLines: string[], newLines: string[]): Op[] {
  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => Array.from<number>({ length: n + 1 }).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);

  const ops: Op[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.unshift({ type: "same", line: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "add", line: newLines[j - 1] });
      j--;
    } else {
      ops.unshift({ type: "remove", line: oldLines[i - 1] });
      i--;
    }
  }
  return ops;
}

export function unifiedDiff(path: string, before: string | undefined, after: string): string {
  if (before === undefined) {
    const lines = after.split("\n");
    return (
      `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n` +
      lines.map((l) => `+${l}`).join("\n") +
      "\n"
    );
  }

  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const ops = lcsOps(oldLines, newLines);

  const changed = ops.reduce<number[]>((acc, op, idx) => {
    if (op.type !== "same") acc.push(idx);
    return acc;
  }, []);
  if (changed.length === 0) return "";

  // Build hunk ranges over the ops array, merging when within CONTEXT distance
  const ranges: [number, number][] = [];
  let rs = Math.max(0, changed[0] - CONTEXT);
  let re = Math.min(ops.length - 1, changed[0] + CONTEXT);
  for (let k = 1; k < changed.length; k++) {
    const ci = changed[k];
    const ns = Math.max(0, ci - CONTEXT);
    if (ns <= re + 1) {
      re = Math.min(ops.length - 1, ci + CONTEXT);
    } else {
      ranges.push([rs, re]);
      rs = ns;
      re = Math.min(ops.length - 1, ci + CONTEXT);
    }
  }
  ranges.push([rs, re]);

  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (const [hs, he] of ranges) {
    const slice = ops.slice(hs, he + 1);
    let oldNum = 1;
    let newNum = 1;
    for (let k = 0; k < hs; k++) {
      if (ops[k].type !== "add") oldNum++;
      if (ops[k].type !== "remove") newNum++;
    }
    const oldCount = slice.filter((o) => o.type !== "add").length;
    const newCount = slice.filter((o) => o.type !== "remove").length;
    out.push(`@@ -${oldNum},${oldCount} +${newNum},${newCount} @@`);
    for (const op of slice)
      out.push((op.type === "same" ? " " : op.type === "add" ? "+" : "-") + op.line);
  }
  return out.join("\n") + "\n";
}

/** Apply ANSI colors to a unified-diff string, line by line. */
export function colorize(diff: string): string {
  return diff
    .split("\n")
    .map((line) => {
      if (line.startsWith("---") || line.startsWith("+++")) return color.bold(line);
      if (line.startsWith("@@")) return color.cyan(line);
      if (line.startsWith("+")) return color.green(line);
      if (line.startsWith("-")) return color.red(line);
      return line;
    })
    .join("\n");
}
