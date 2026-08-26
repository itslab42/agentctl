import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, formatForRuntime, ExplainResult } from "../src/explain";
import { Permissions } from "../src/permissions";

function makePermissions(overrides?: Partial<Permissions["shell"]>): Permissions {
  return {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: {
      default: "ask",
      allow: ["pnpm *", "npm test"],
      deny: ["git push --force*", "rm -rf *"],
      ...overrides
    }
  };
}

test("evaluate: deny pattern matches before allow", () => {
  // A command that could match both deny and allow should be denied
  const perms = makePermissions({
    allow: ["git *"],
    deny: ["git push --force*"]
  });
  const result = evaluate("git push --force origin main", perms);
  assert.equal(result.decision, "deny");
  assert.equal(result.matchedPattern, "git push --force*");
  assert.equal(result.matchedList, "deny");
});

test("evaluate: allow pattern matches when no deny", () => {
  const perms = makePermissions();
  const result = evaluate("pnpm test", perms);
  assert.equal(result.decision, "allow");
  assert.equal(result.matchedPattern, "pnpm *");
  assert.equal(result.matchedList, "allow");
});

test("evaluate: falls through to default when no pattern matches", () => {
  const perms = makePermissions();
  const result = evaluate("docker build .", perms);
  assert.equal(result.decision, "ask");
  assert.equal(result.matchedPattern, undefined);
  assert.equal(result.matchedList, "default");
  assert.ok(result.reason.includes("shell.default = ask"));
});

test("evaluate: deny takes precedence even if allow also matches", () => {
  const perms = makePermissions({
    allow: ["rm *"],
    deny: ["rm -rf *"]
  });
  const result = evaluate("rm -rf /tmp", perms);
  assert.equal(result.decision, "deny");
  assert.equal(result.matchedPattern, "rm -rf *");
});

test("evaluate: default is used as decision value", () => {
  const perms = makePermissions({ default: "deny", allow: [], deny: [] });
  const result = evaluate("anything", perms);
  assert.equal(result.decision, "deny");
  assert.equal(result.matchedList, "default");
});

test("evaluate: default allow when no patterns and default=allow", () => {
  const perms = makePermissions({ default: "allow", allow: [], deny: [] });
  const result = evaluate("any command", perms);
  assert.equal(result.decision, "allow");
});

test("evaluate: exact match without glob (no wildcard)", () => {
  const perms = makePermissions({ allow: ["npm test"], deny: [] });
  const result = evaluate("npm test", perms);
  assert.equal(result.decision, "allow");
  assert.equal(result.matchedPattern, "npm test");
});

test("evaluate: exact pattern does not match substring", () => {
  const perms = makePermissions({ allow: ["npm test"], deny: [] });
  const result = evaluate("npm testing", perms);
  assert.equal(result.decision, "ask");
  assert.equal(result.matchedList, "default");
});

test("evaluate: first matching deny pattern wins", () => {
  const perms = makePermissions({
    deny: ["git push *", "git push --force*"],
    allow: []
  });
  const result = evaluate("git push --force origin main", perms);
  assert.equal(result.matchedPattern, "git push *");
});

test("evaluate: first matching allow pattern wins", () => {
  const perms = makePermissions({
    deny: [],
    allow: ["pnpm *", "pnpm test"]
  });
  const result = evaluate("pnpm test", perms);
  assert.equal(result.matchedPattern, "pnpm *");
});

test("formatForRuntime: claude vocabulary for deny", () => {
  const core: ExplainResult = {
    runtime: "core",
    decision: "deny",
    reason: 'matches deny pattern: "git push --force*"',
    matchedPattern: "git push --force*",
    matchedList: "deny"
  };
  const result = formatForRuntime(core, "claude");
  assert.equal(result.runtime, "claude");
  assert.equal(result.decision, "deny");
  assert.ok(result.reason.includes("Bash(git push --force*)"));
});

test("formatForRuntime: codex vocabulary for allow", () => {
  const core: ExplainResult = {
    runtime: "core",
    decision: "allow",
    reason: 'matches allow pattern: "pnpm *"',
    matchedPattern: "pnpm *",
    matchedList: "allow"
  };
  const result = formatForRuntime(core, "codex");
  assert.equal(result.runtime, "codex");
  assert.equal(result.decision, "allow");
  assert.ok(result.reason.includes("permission-policy.py"));
  assert.ok(result.reason.includes("^pnpm .*$"));
});

test("formatForRuntime: kiro vocabulary for deny", () => {
  const core: ExplainResult = {
    runtime: "core",
    decision: "deny",
    reason: 'matches deny pattern: "rm -rf *"',
    matchedPattern: "rm -rf *",
    matchedList: "deny"
  };
  const result = formatForRuntime(core, "kiro");
  assert.equal(result.runtime, "kiro");
  assert.ok(result.reason.includes('shell deny ["rm -rf *"]'));
});

test("formatForRuntime: opencode vocabulary for default", () => {
  const core: ExplainResult = {
    runtime: "core",
    decision: "ask",
    reason: "no pattern matched, shell.default = ask",
    matchedList: "default"
  };
  const result = formatForRuntime(core, "opencode");
  assert.equal(result.runtime, "opencode");
  assert.equal(result.decision, "ask");
  assert.ok(result.reason.includes('bash["*"] = ask'));
});

test("formatForRuntime: cursor vocabulary for allow", () => {
  const core: ExplainResult = {
    runtime: "core",
    decision: "allow",
    reason: 'matches allow pattern: "pnpm *"',
    matchedPattern: "pnpm *",
    matchedList: "allow"
  };
  const result = formatForRuntime(core, "cursor");
  assert.equal(result.runtime, "cursor");
  assert.ok(result.reason.includes('allowed pattern "pnpm *"'));
});

test("formatForRuntime: codex default uses on-request for ask", () => {
  const core: ExplainResult = {
    runtime: "core",
    decision: "ask",
    reason: "no pattern matched, shell.default = ask",
    matchedList: "default"
  };
  const result = formatForRuntime(core, "codex");
  assert.ok(result.reason.includes("on-request"));
});

test("formatForRuntime: unknown runtime returns core result with runtime name", () => {
  const core: ExplainResult = {
    runtime: "core",
    decision: "allow",
    reason: 'matches allow pattern: "pnpm *"',
    matchedPattern: "pnpm *",
    matchedList: "allow"
  };
  const result = formatForRuntime(core, "unknown");
  assert.equal(result.runtime, "unknown");
  assert.equal(result.reason, core.reason);
});

test("evaluate: glob wildcard matches any characters", () => {
  const perms = makePermissions({
    allow: ["pnpm run *"],
    deny: []
  });
  // Wildcard should match anything after "pnpm run "
  const result = evaluate("pnpm run build", perms);
  assert.equal(result.decision, "allow");
  // Should not match without the prefix
  const result2 = evaluate("npm run build", perms);
  assert.equal(result2.decision, "ask");
});

test("evaluate: empty command string", () => {
  const perms = makePermissions();
  const result = evaluate("", perms);
  // Empty string doesn't match "pnpm *" or "git push --force*"
  assert.equal(result.decision, "ask");
  assert.equal(result.matchedList, "default");
});
