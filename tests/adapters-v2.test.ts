import test from "node:test";
import assert from "node:assert/strict";
import { renderClaude } from "../src/adapters/claude";
import { renderOpenCode } from "../src/adapters/opencode";
import { renderCursorRule } from "../src/adapters/cursor";
import { renderCodexConfig, renderCodexHook } from "../src/adapters/codex";
import { Permissions } from "../src/permissions";

// A representative v2 policy exercising every capability section.
const v2: Permissions = {
  version: 2,
  policy: { precedence: "deny_over_allow" },
  filesystem: {
    edit: "allow",
    write: "allow",
    read: { default: "allow", allow: [], ask: [], deny: [".env*", "**/*.pem"] },
    writePaths: { default: "allow", allow: [], ask: ["*.config.*"], deny: [".git/**"] }
  },
  shell: { default: "ask", allow: ["pnpm *"], deny: ["rm -rf *"] },
  network: {
    default: "ask",
    allow: ["https://registry.npmjs.org/*", "*://api.github.com/*"],
    ask: [],
    deny: ["http://*"]
  },
  env: { default: "deny", allow: ["NODE_ENV", "GITHUB_*"], ask: ["CI"], deny: ["*_TOKEN"] },
  mcp: {
    default: "ask",
    allow: ["filesystem:*", "postgres:query"],
    ask: [],
    deny: ["postgres:drop_table"]
  }
};

// --- Claude ------------------------------------------------------------------

test("Claude v2: filesystem.read maps to scoped Read entries", () => {
  const parsed = JSON.parse(renderClaude(v2));
  assert.ok(parsed.permissions.deny.includes("Read(.env*)"));
  assert.ok(parsed.permissions.deny.includes("Read(**/*.pem)"));
});

test("Claude v2: filesystem.write maps to scoped Edit and Write entries", () => {
  const parsed = JSON.parse(renderClaude(v2));
  assert.ok(parsed.permissions.deny.includes("Edit(.git/**)"));
  assert.ok(parsed.permissions.deny.includes("Write(.git/**)"));
  assert.ok(parsed.permissions.ask.includes("Edit(*.config.*)"));
  assert.ok(parsed.permissions.ask.includes("Write(*.config.*)"));
});

test("Claude v2: network maps to WebFetch(domain:...) entries", () => {
  const parsed = JSON.parse(renderClaude(v2));
  assert.ok(parsed.permissions.allow.includes("WebFetch(domain:registry.npmjs.org)"));
  assert.ok(parsed.permissions.allow.includes("WebFetch(domain:api.github.com)"));
  assert.ok(parsed.permissions.deny.includes("WebFetch(domain:*)"));
});

test("Claude v2: env and mcp are surfaced as advisory (not dropped)", () => {
  const parsed = JSON.parse(renderClaude(v2));
  assert.ok(Array.isArray(parsed._advisory));
  const joined = parsed._advisory.join("\n");
  assert.match(joined, /env access is advisory/);
  assert.match(joined, /mcp access is advisory/);
  assert.match(joined, /\*_TOKEN/);
  assert.match(joined, /postgres:drop_table/);
});

// --- OpenCode ----------------------------------------------------------------

test("OpenCode v2: filesystem.read maps to native read object", () => {
  const parsed = JSON.parse(renderOpenCode(v2));
  assert.equal(parsed.permission.read["*"], "allow");
  assert.equal(parsed.permission.read[".env*"], "deny");
  assert.equal(parsed.permission.read["**/*.pem"], "deny");
});

test("OpenCode v2: filesystem.write maps to native edit object", () => {
  const parsed = JSON.parse(renderOpenCode(v2));
  assert.equal(parsed.permission.edit["*"], "allow");
  assert.equal(parsed.permission.edit["*.config.*"], "ask");
  assert.equal(parsed.permission.edit[".git/**"], "deny");
});

test("OpenCode v2: network maps to native webfetch object", () => {
  const parsed = JSON.parse(renderOpenCode(v2));
  assert.equal(parsed.permission.webfetch["*"], "ask");
  assert.equal(parsed.permission.webfetch["https://registry.npmjs.org/*"], "allow");
  assert.equal(parsed.permission.webfetch["http://*"], "deny");
});

test("OpenCode v2: env and mcp surfaced as advisory", () => {
  const parsed = JSON.parse(renderOpenCode(v2));
  assert.ok(Array.isArray(parsed._advisory));
  const joined = parsed._advisory.join("\n");
  assert.match(joined, /env access is advisory/);
  assert.match(joined, /mcp access is advisory/);
});

// --- Cursor ------------------------------------------------------------------

test("Cursor v2: renders read/write path sections", () => {
  const output = renderCursorRule(v2);
  assert.match(output, /### Read paths/);
  assert.match(output, /### Write paths/);
  assert.match(output, /`\.env\*`/);
  assert.match(output, /`\.git\/\*\*`/);
});

test("Cursor v2: renders network, env, and mcp advisory sections", () => {
  const output = renderCursorRule(v2);
  assert.match(output, /## Network/);
  assert.match(output, /## Environment Variables/);
  assert.match(output, /## MCP Tools/);
  assert.match(output, /`\*_TOKEN`/);
  assert.match(output, /`postgres:drop_table`/);
});

// --- Codex -------------------------------------------------------------------

test("Codex v2: config registers hooks for fs and network tools", () => {
  const output = renderCodexConfig(v2);
  assert.match(output, /Bash = "\.codex\/hooks\/permission-policy\.py"/);
  assert.match(output, /Read = "\.codex\/hooks\/permission-policy\.py"/);
  assert.match(output, /Edit = "\.codex\/hooks\/permission-policy\.py"/);
  assert.match(output, /Write = "\.codex\/hooks\/permission-policy\.py"/);
  assert.match(output, /WebFetch = "\.codex\/hooks\/permission-policy\.py"/);
});

test("Codex v2: hook embeds capability policies for Read/Edit/Write/WebFetch", () => {
  const output = renderCodexHook(v2);
  assert.match(output, /CAPABILITY_POLICIES/);
  assert.match(output, /"Read"/);
  assert.match(output, /"Edit"/);
  assert.match(output, /"Write"/);
  assert.match(output, /"WebFetch"/);
  assert.match(output, /def enforce_capability/);
});

test("Codex v2: env and mcp surfaced as advisory comments", () => {
  const output = renderCodexHook(v2);
  assert.match(output, /# env access is advisory in Codex/);
  assert.match(output, /# mcp access is advisory in Codex/);
});

// --- No silent v1 regression -------------------------------------------------

const v1: Permissions = {
  policy: { precedence: "deny_over_allow" },
  filesystem: { edit: "allow", write: "allow" },
  shell: { default: "ask", allow: ["pnpm *"], deny: ["rm -rf *"] }
};

test("v1 Claude output unchanged (blanket Edit/Write, no advisory)", () => {
  const parsed = JSON.parse(renderClaude(v1));
  assert.deepEqual(parsed.permissions.allow, ["Edit", "Write", "Bash(pnpm *)"]);
  assert.deepEqual(parsed.permissions.deny, ["Bash(rm -rf *)"]);
  assert.equal(parsed._advisory, undefined);
  assert.equal(parsed.permissions.ask, undefined);
});

test("v1 OpenCode output uses blanket edit/write scalars", () => {
  const parsed = JSON.parse(renderOpenCode(v1));
  assert.equal(parsed.permission.edit, "allow");
  assert.equal(parsed.permission.write, "allow");
  assert.equal(parsed.permission.read, undefined);
  assert.equal(parsed._advisory, undefined);
});

test("v1 Codex config registers only the Bash hook", () => {
  const output = renderCodexConfig(v1);
  assert.match(output, /Bash = "\.codex\/hooks\/permission-policy\.py"/);
  assert.doesNotMatch(output, /Read = /);
  assert.doesNotMatch(output, /WebFetch = /);
});
