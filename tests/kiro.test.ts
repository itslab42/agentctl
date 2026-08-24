import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import { renderKiro } from "../src/adapters/kiro";
import { Permissions } from "../src/permissions";

const permissions: Permissions = {
  policy: { precedence: "deny_over_allow" },
  filesystem: { edit: "allow", write: "allow" },
  shell: { default: "ask", allow: ["git*", "pnpm*"], deny: ["git push*"] }
};

test("Kiro renders valid YAML with correct rule structure", () => {
  const output = renderKiro(permissions);
  const parsed = parse(output) as {
    rules: Array<{ capability: string; effect: string; match?: string[]; exclude?: string[] }>;
  };
  assert.ok(Array.isArray(parsed.rules), "output must have a rules array");
  assert.equal(parsed.rules.length, 4);
});

test("Kiro emits fs_read allow and fs_write allow for permissive filesystem", () => {
  const output = renderKiro(permissions);
  const parsed = parse(output) as {
    rules: Array<{ capability: string; effect: string; match?: string[] }>;
  };
  assert.deepEqual(parsed.rules[0], { capability: "fs_read", effect: "allow" });
  assert.deepEqual(parsed.rules[1], { capability: "fs_write", effect: "allow" });
});

test("Kiro emits shell deny patterns as exclude on allow rule", () => {
  const output = renderKiro(permissions);
  const parsed = parse(output) as {
    rules: Array<{ capability: string; effect: string; match?: string[]; exclude?: string[] }>;
  };
  const allowRule = parsed.rules.find((r) => r.capability === "shell" && r.effect === "allow");
  assert.ok(allowRule, "must have a shell allow rule");
  assert.deepEqual(allowRule.exclude, ["git push*"]);
});

test("Kiro emits shell allow rules with match patterns", () => {
  const output = renderKiro(permissions);
  const parsed = parse(output) as {
    rules: Array<{ capability: string; effect: string; match?: string[] }>;
  };
  const allowRule = parsed.rules.find((r) => r.capability === "shell" && r.effect === "allow");
  assert.ok(allowRule, "must have a shell allow rule");
  assert.deepEqual(allowRule.match, ["git*", "pnpm*"]);
});

test("Kiro emits shell default as catch-all (no match field)", () => {
  const output = renderKiro(permissions);
  const parsed = parse(output) as {
    rules: Array<{ capability: string; effect: string; match?: string[] }>;
  };
  const catchAll = parsed.rules[parsed.rules.length - 1];
  assert.equal(catchAll.capability, "shell");
  assert.equal(catchAll.effect, "ask");
  assert.equal(catchAll.match, undefined);
});

test("Kiro uses most permissive filesystem effect (edit=deny, write=allow → allow)", () => {
  const perms: Permissions = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "deny", write: "allow" },
    shell: { default: "allow", allow: [], deny: [] }
  };
  const parsed = parse(renderKiro(perms)) as {
    rules: Array<{ capability: string; effect: string }>;
  };
  const fsWrite = parsed.rules.find((r) => r.capability === "fs_write");
  assert.equal(fsWrite?.effect, "allow");
});

test("Kiro omits shell deny/allow rules when patterns are empty", () => {
  const perms: Permissions = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "ask", write: "ask" },
    shell: { default: "deny", allow: [], deny: [] }
  };
  const parsed = parse(renderKiro(perms)) as {
    rules: Array<{ capability: string; effect: string; match?: string[] }>;
  };
  // Should have: fs_read allow, fs_write ask, shell deny (catch-all) = 3 rules
  assert.equal(parsed.rules.length, 3);
  assert.deepEqual(parsed.rules[2], { capability: "shell", effect: "deny" });
});

test("Kiro output is deterministic", () => {
  assert.equal(renderKiro(permissions), renderKiro(permissions));
});
