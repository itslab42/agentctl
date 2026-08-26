import test from "node:test";
import assert from "node:assert/strict";
import { formatError, levenshtein, suggestCommand, AgentctlError } from "../src/errors";
import { setForceColor } from "../src/color";

// Disable color for predictable test output
test.beforeEach(() => setForceColor(false));
test.afterEach(() => setForceColor(undefined));

// --- formatError ---

test("formatError shows message only when no extras provided", () => {
  const result = formatError({ message: "something went wrong" });
  assert.ok(result.includes("Error: something went wrong"));
  assert.ok(!result.includes("→"));
  assert.ok(!result.includes("Hint:"));
});

test("formatError includes file path", () => {
  const result = formatError({ message: "invalid value", file: ".ai/config.yaml" });
  assert.ok(result.includes("→ .ai/config.yaml"));
});

test("formatError includes file path and line number", () => {
  const result = formatError({ message: "bad syntax", file: ".ai/config.yaml", line: 5 });
  assert.ok(result.includes("→ .ai/config.yaml:5"));
});

test("formatError includes context lines", () => {
  const ctx = "  runtimes:\n    claude: on    ← expected: enabled | disabled";
  const result = formatError({ message: "invalid value", context: ctx });
  assert.ok(result.includes("runtimes:"));
  assert.ok(result.includes("claude: on"));
});

test("formatError includes hint", () => {
  const result = formatError({
    message: "invalid runtime value",
    hint: 'valid values are "enabled" or "disabled"'
  });
  assert.ok(result.includes("Hint: valid values are"));
});

test("formatError includes all parts together", () => {
  const err: AgentctlError = {
    message: 'invalid runtime value "on"',
    file: ".ai/config.yaml",
    line: 4,
    context: "  claude: on",
    hint: "valid values: true | false"
  };
  const result = formatError(err);
  assert.ok(result.includes('Error: invalid runtime value "on"'));
  assert.ok(result.includes("→ .ai/config.yaml:4"));
  assert.ok(result.includes("claude: on"));
  assert.ok(result.includes("Hint: valid values: true | false"));
});

// --- levenshtein ---

test("levenshtein returns 0 for identical strings", () => {
  assert.equal(levenshtein("sync", "sync"), 0);
});

test("levenshtein returns correct distance for single edit", () => {
  assert.equal(levenshtein("sync", "snyc"), 2); // transposition = 2 in standard levenshtein
  assert.equal(levenshtein("init", "inot"), 1);
});

test("levenshtein returns correct distance for insertions/deletions", () => {
  assert.equal(levenshtein("syn", "sync"), 1);
  assert.equal(levenshtein("syncc", "sync"), 1);
});

test("levenshtein handles empty strings", () => {
  assert.equal(levenshtein("", "abc"), 3);
  assert.equal(levenshtein("abc", ""), 3);
  assert.equal(levenshtein("", ""), 0);
});

// --- suggestCommand ---

test("suggestCommand returns exact match", () => {
  const commands = ["init", "sync", "check"];
  assert.equal(suggestCommand("sync", commands), "sync");
});

test("suggestCommand suggests closest match for typo", () => {
  const commands = ["init", "sync", "check", "validate", "diff", "status"];
  assert.equal(suggestCommand("synk", commands), "sync");
  assert.equal(suggestCommand("inti", commands), "init");
  assert.equal(suggestCommand("chek", commands), "check");
});

test("suggestCommand returns undefined for completely unrelated input", () => {
  const commands = ["init", "sync", "check", "validate"];
  assert.equal(suggestCommand("foobar", commands), undefined);
});

test("suggestCommand handles single character difference", () => {
  const commands = ["init", "sync", "check", "validate", "diff", "status", "scan"];
  assert.equal(suggestCommand("scam", commands), "scan");
  assert.equal(suggestCommand("dif", commands), "diff");
});

test("suggestCommand handles prefix input", () => {
  const commands = ["init", "sync", "check", "validate", "diff", "status", "explain", "audit"];
  // "val" is only 5 edits away from "validate" — too far
  // but "validat" is 1 edit away
  assert.equal(suggestCommand("validat", commands), "validate");
});
