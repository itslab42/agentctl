import test from "node:test";
import assert from "node:assert/strict";
import {
  parseInstructions,
  resolveForRuntime,
  renderClaudeInstructions,
  renderCodexInstructions,
  renderCursorInstructions,
  renderKiroInstructions,
  renderOpenCodeInstructions
} from "../src/instructions";
import { GENERATED_MARKER } from "../src/permissions";

const simpleContent = `# Project Instructions

## Build & Test
- Run \`pnpm test\` to run all tests

## Code Style
- Use TypeScript strict mode`;

const conditionalContent = `# Project Instructions

## Build & Test
- Run \`pnpm test\` to run all tests

<!-- agentctl:only claude codex -->
## Claude/Codex Specific
- You have access to Bash tool for running commands
<!-- agentctl:end -->

<!-- agentctl:only cursor -->
## Cursor Specific
- Use the integrated terminal for shell commands
<!-- agentctl:end -->

## Architecture
- Config flows one direction`;

test("parseInstructions parses simple content with no conditional blocks", () => {
  const result = parseInstructions(simpleContent);
  assert.equal(result.common, simpleContent);
  assert.equal(result.blocks.length, 0);
});

test("parseInstructions extracts conditional blocks", () => {
  const result = parseInstructions(conditionalContent);
  assert.equal(result.blocks.length, 2);
  assert.deepEqual(result.blocks[0].runtimes, ["claude", "codex"]);
  assert.ok(result.blocks[0].content.includes("Bash tool"));
  assert.deepEqual(result.blocks[1].runtimes, ["cursor"]);
  assert.ok(result.blocks[1].content.includes("integrated terminal"));
});

test("parseInstructions removes conditional blocks from common content", () => {
  const result = parseInstructions(conditionalContent);
  assert.ok(!result.common.includes("agentctl:only"));
  assert.ok(!result.common.includes("agentctl:end"));
  assert.ok(!result.common.includes("Bash tool"));
  assert.ok(!result.common.includes("integrated terminal"));
  assert.ok(result.common.includes("Build & Test"));
  assert.ok(result.common.includes("Config flows one direction"));
});

test("resolveForRuntime returns common content for runtime with no blocks", () => {
  const instructions = parseInstructions(conditionalContent);
  const result = resolveForRuntime(instructions, "kiro");
  assert.ok(result.includes("Build & Test"));
  assert.ok(!result.includes("Bash tool"));
  assert.ok(!result.includes("integrated terminal"));
});

test("resolveForRuntime includes matching blocks for claude", () => {
  const instructions = parseInstructions(conditionalContent);
  const result = resolveForRuntime(instructions, "claude");
  assert.ok(result.includes("Build & Test"));
  assert.ok(result.includes("Bash tool"));
  assert.ok(!result.includes("integrated terminal"));
});

test("resolveForRuntime includes matching blocks for cursor", () => {
  const instructions = parseInstructions(conditionalContent);
  const result = resolveForRuntime(instructions, "cursor");
  assert.ok(result.includes("Build & Test"));
  assert.ok(!result.includes("Bash tool"));
  assert.ok(result.includes("integrated terminal"));
});

test("resolveForRuntime handles simple content (no blocks)", () => {
  const instructions = parseInstructions(simpleContent);
  const result = resolveForRuntime(instructions, "claude");
  assert.equal(result, simpleContent);
});

test("renderClaudeInstructions includes generated marker", () => {
  const output = renderClaudeInstructions("test content");
  assert.ok(output.includes(GENERATED_MARKER));
  assert.ok(output.includes("test content"));
  assert.ok(output.endsWith("\n"));
});

test("renderCodexInstructions includes generated marker", () => {
  const output = renderCodexInstructions("test content");
  assert.ok(output.includes(GENERATED_MARKER));
  assert.ok(output.includes("test content"));
  assert.ok(output.endsWith("\n"));
});

test("renderCursorInstructions includes MDC frontmatter", () => {
  const output = renderCursorInstructions("test content");
  assert.ok(output.startsWith("---\n"));
  assert.ok(output.includes("alwaysApply: true"));
  assert.ok(output.includes('description: "Project instructions managed by agentctl"'));
  assert.ok(output.includes(GENERATED_MARKER));
  assert.ok(output.includes("test content"));
});

test("renderKiroInstructions includes steering frontmatter", () => {
  const output = renderKiroInstructions("test content");
  assert.ok(output.startsWith("---\n"));
  assert.ok(output.includes("inclusion: always"));
  assert.ok(output.includes('name: "Project Instructions"'));
  assert.ok(output.includes('description: "Core project instructions managed by agentctl"'));
  assert.ok(output.includes(GENERATED_MARKER));
  assert.ok(output.includes("test content"));
});

test("renderOpenCodeInstructions includes generated marker", () => {
  const output = renderOpenCodeInstructions("test content");
  assert.ok(output.includes(GENERATED_MARKER));
  assert.ok(output.includes("test content"));
  assert.ok(output.endsWith("\n"));
});

test("parseInstructions handles empty content", () => {
  const result = parseInstructions("");
  assert.equal(result.common, "");
  assert.equal(result.blocks.length, 0);
});

test("parseInstructions handles multiple runtimes in a single block", () => {
  const input = `Common content

<!-- agentctl:only claude codex opencode -->
Shared block
<!-- agentctl:end -->`;
  const result = parseInstructions(input);
  assert.equal(result.blocks.length, 1);
  assert.deepEqual(result.blocks[0].runtimes, ["claude", "codex", "opencode"]);
  assert.equal(result.blocks[0].content, "Shared block");
});

test("resolveForRuntime includes block for each listed runtime", () => {
  const input = `Common

<!-- agentctl:only claude codex opencode -->
Shared block
<!-- agentctl:end -->`;
  const instructions = parseInstructions(input);
  for (const rt of ["claude", "codex", "opencode"]) {
    const result = resolveForRuntime(instructions, rt);
    assert.ok(result.includes("Shared block"), `${rt} should include shared block`);
  }
  const result = resolveForRuntime(instructions, "kiro");
  assert.ok(!result.includes("Shared block"), "kiro should not include shared block");
});

test("all renderers produce deterministic output", () => {
  const content = "# Hello\n\nSome instructions";
  assert.equal(renderClaudeInstructions(content), renderClaudeInstructions(content));
  assert.equal(renderCodexInstructions(content), renderCodexInstructions(content));
  assert.equal(renderCursorInstructions(content), renderCursorInstructions(content));
  assert.equal(renderKiroInstructions(content), renderKiroInstructions(content));
  assert.equal(renderOpenCodeInstructions(content), renderOpenCodeInstructions(content));
});
