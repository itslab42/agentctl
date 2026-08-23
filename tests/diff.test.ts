import test from "node:test";
import assert from "node:assert/strict";
import { unifiedDiff } from "../src/diff";

test("unifiedDiff returns empty string for identical content", () => {
  assert.equal(unifiedDiff("f.txt", "a\nb\nc\n", "a\nb\nc\n"), "");
});

test("unifiedDiff treats undefined before as new file", () => {
  const out = unifiedDiff("f.txt", undefined, "hello\nworld\n");
  assert.ok(out.startsWith("--- /dev/null\n+++ b/f.txt\n"));
  assert.ok(out.includes("+hello"));
  assert.ok(out.includes("+world"));
});

test("unifiedDiff produces correct hunk for a single-line change", () => {
  const before = "a\nb\nc\nd\ne\n";
  const after = "a\nb\nX\nd\ne\n";
  const out = unifiedDiff("f.txt", before, after);
  assert.ok(out.includes("--- a/f.txt"));
  assert.ok(out.includes("+++ b/f.txt"));
  assert.ok(out.includes("-c"));
  assert.ok(out.includes("+X"));
  // context lines present
  assert.ok(out.includes(" a") || out.includes(" b"));
  // not a full-file dump — only one hunk
  assert.equal((out.match(/^@@/gm) ?? []).length, 1);
});

test("unifiedDiff generates separate hunks for distant changes", () => {
  const base = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
  const changed = base.replace("line1\n", "X\n").replace("line20\n", "Y\n");
  const out = unifiedDiff("f.txt", base, changed);
  assert.equal((out.match(/^@@/gm) ?? []).length, 2);
});

test("unifiedDiff merges nearby changes into one hunk", () => {
  // Two changes 2 lines apart — within CONTEXT=3, should merge
  const before = "a\nb\nc\nd\ne\nf\ng\n";
  const after = "a\nB\nc\nD\ne\nf\ng\n";
  const out = unifiedDiff("f.txt", before, after);
  assert.equal((out.match(/^@@/gm) ?? []).length, 1);
});
