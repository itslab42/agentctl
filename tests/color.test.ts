import test from "node:test";
import assert from "node:assert/strict";
import { color, colorEnabled, setForceColor } from "../src/color";
import { colorize } from "../src/diff";

test("colorEnabled() returns false when NO_COLOR is set", () => {
  const orig = process.env.NO_COLOR;
  try {
    setForceColor(undefined);
    process.env.NO_COLOR = "1";
    assert.equal(colorEnabled(), false);
  } finally {
    if (orig === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = orig;
  }
});

test("colorEnabled() returns false when TERM=dumb", () => {
  const origColor = process.env.NO_COLOR;
  const origTerm = process.env.TERM;
  try {
    setForceColor(undefined);
    delete process.env.NO_COLOR;
    process.env.TERM = "dumb";
    assert.equal(colorEnabled(), false);
  } finally {
    if (origColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = origColor;
    if (origTerm === undefined) delete process.env.TERM;
    else process.env.TERM = origTerm;
  }
});

test("setForceColor(true) forces color on regardless of env", () => {
  const orig = process.env.NO_COLOR;
  try {
    process.env.NO_COLOR = "1";
    setForceColor(true);
    assert.equal(colorEnabled(), true);
  } finally {
    if (orig === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = orig;
    setForceColor(undefined);
  }
});

test("setForceColor(false) forces color off regardless of TTY", () => {
  setForceColor(false);
  assert.equal(colorEnabled(), false);
  setForceColor(undefined);
});

test("color functions apply ANSI codes when forced on", () => {
  setForceColor(true);
  try {
    assert.equal(color.red("x"), "\x1b[31mx\x1b[0m");
    assert.equal(color.green("x"), "\x1b[32mx\x1b[0m");
    assert.equal(color.cyan("x"), "\x1b[36mx\x1b[0m");
    assert.equal(color.bold("x"), "\x1b[1mx\x1b[0m");
    assert.equal(color.dim("x"), "\x1b[2mx\x1b[0m");
  } finally {
    setForceColor(undefined);
  }
});

test("color functions return plain text when forced off", () => {
  setForceColor(false);
  try {
    assert.equal(color.red("hello"), "hello");
    assert.equal(color.green("hello"), "hello");
    assert.equal(color.cyan("hello"), "hello");
    assert.equal(color.bold("hello"), "hello");
    assert.equal(color.dim("hello"), "hello");
  } finally {
    setForceColor(undefined);
  }
});

test("colorize() applies correct colors to diff lines when color forced on", () => {
  setForceColor(true);
  try {
    const diff = [
      "--- a/file.txt",
      "+++ b/file.txt",
      "@@ -1,3 +1,3 @@",
      " unchanged",
      "-removed",
      "+added"
    ].join("\n");
    const result = colorize(diff);
    const lines = result.split("\n");
    // --- header is bold
    assert.ok(lines[0].startsWith("\x1b[1m"));
    // +++ header is bold
    assert.ok(lines[1].startsWith("\x1b[1m"));
    // @@ hunk is cyan
    assert.ok(lines[2].startsWith("\x1b[36m"));
    // unchanged line has no color prefix
    assert.equal(lines[3], " unchanged");
    // - line is red
    assert.ok(lines[4].startsWith("\x1b[31m"));
    // + line is green
    assert.ok(lines[5].startsWith("\x1b[32m"));
  } finally {
    setForceColor(undefined);
  }
});

test("colorize() returns plain text when color is off", () => {
  setForceColor(false);
  try {
    const diff = "--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-old\n+new\n";
    assert.equal(colorize(diff), diff);
  } finally {
    setForceColor(undefined);
  }
});
