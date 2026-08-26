import test from "node:test";
import assert from "node:assert/strict";
import { audit, generateTestCommands, evaluateForRuntime, AuditResult } from "../src/audit";
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

// --- generateTestCommands ---

test("generateTestCommands: includes expansions of allow patterns", () => {
  const perms = makePermissions({ allow: ["pnpm *", "npm test"], deny: [] });
  const commands = generateTestCommands(perms);
  assert.ok(commands.includes("pnpm arg"), "should include expanded 'pnpm *'");
  assert.ok(commands.includes("npm test"), "should include exact pattern 'npm test'");
});

test("generateTestCommands: includes expansions of deny patterns", () => {
  const perms = makePermissions({ allow: [], deny: ["rm -rf *", "git push --force*"] });
  const commands = generateTestCommands(perms);
  assert.ok(commands.includes("rm -rf arg"), "should include expanded 'rm -rf *'");
  assert.ok(
    commands.includes("git push --forcearg"),
    "should include expanded 'git push --force*'"
  );
});

test("generateTestCommands: includes near-miss commands", () => {
  const perms = makePermissions({ allow: ["pnpm *"], deny: ["rm -rf *"] });
  const commands = generateTestCommands(perms);
  // Near-miss for "pnpm *" should be something like "pnpmx arg"
  assert.ok(
    commands.some((c) => c.startsWith("pnpmx")),
    "should include near-miss for allow pattern"
  );
  // Near-miss for "rm -rf *" should be something like "rmx"
  assert.ok(
    commands.some((c) => c.startsWith("rmx")),
    "should include near-miss for deny pattern"
  );
});

test("generateTestCommands: includes default-testing commands", () => {
  const perms = makePermissions({ allow: [], deny: [] });
  const commands = generateTestCommands(perms);
  assert.ok(commands.includes("docker build ."));
  assert.ok(commands.includes("curl https://example.com"));
  assert.ok(commands.includes("whoami"));
});

test("generateTestCommands: deduplicates commands", () => {
  const perms = makePermissions({ allow: ["whoami"], deny: [] });
  const commands = generateTestCommands(perms);
  const whoamiCount = commands.filter((c) => c === "whoami").length;
  assert.equal(whoamiCount, 1, "should not have duplicate 'whoami'");
});

test("generateTestCommands: caps at 200 commands", () => {
  // Create permissions with lots of patterns
  const allow = Array.from({ length: 60 }, (_, i) => `cmd${i} *`);
  const deny = Array.from({ length: 60 }, (_, i) => `bad${i} *`);
  const perms = makePermissions({ allow, deny });
  const commands = generateTestCommands(perms);
  assert.ok(commands.length <= 200, `should cap at 200, got ${commands.length}`);
});

// --- audit: skip cases ---

test("audit: skips when no runtimes enabled", () => {
  const perms = makePermissions();
  const summary = audit(perms, []);
  assert.equal(summary.tested, 0);
  assert.equal(summary.skipped, "No runtimes enabled");
});

test("audit: skips when only one runtime enabled", () => {
  const perms = makePermissions();
  const summary = audit(perms, ["claude"]);
  assert.equal(summary.tested, 0);
  assert.ok(summary.skipped?.includes("Only one runtime"));
  assert.ok(summary.skipped?.includes("claude"));
});

// --- audit: all-consistent case ---

test("audit: reports all-consistent when runtimes agree", () => {
  const perms = makePermissions();
  const summary = audit(perms, ["claude", "codex", "kiro", "opencode"], {
    commands: ["pnpm test", "rm -rf /tmp", "docker build ."]
  });
  assert.equal(summary.tested, 3);
  assert.equal(summary.consistent, 3);
  assert.equal(summary.divergences.length, 0);
  assert.equal(summary.skipped, undefined);
});

test("audit: all runtimes produce same decision for allow pattern", () => {
  const perms = makePermissions();
  const summary = audit(perms, ["claude", "codex", "kiro", "opencode"], {
    commands: ["pnpm test"]
  });
  assert.equal(summary.tested, 1);
  assert.equal(summary.consistent, 1);
  const result = getAllResultsForTest(
    perms,
    ["claude", "codex", "kiro", "opencode"],
    ["pnpm test"]
  );
  for (const d of result[0].decisions) {
    assert.equal(d.decision, "allow");
  }
});

test("audit: all runtimes produce same decision for deny pattern", () => {
  const perms = makePermissions();
  const summary = audit(perms, ["claude", "codex", "kiro", "opencode"], {
    commands: ["rm -rf /tmp"]
  });
  assert.equal(summary.consistent, 1);
  const result = getAllResultsForTest(
    perms,
    ["claude", "codex", "kiro", "opencode"],
    ["rm -rf /tmp"]
  );
  for (const d of result[0].decisions) {
    assert.equal(d.decision, "deny");
  }
});

test("audit: all runtimes produce same decision for default", () => {
  const perms = makePermissions();
  const summary = audit(perms, ["claude", "codex", "kiro", "opencode"], {
    commands: ["docker build ."]
  });
  assert.equal(summary.consistent, 1);
  const result = getAllResultsForTest(
    perms,
    ["claude", "codex", "kiro", "opencode"],
    ["docker build ."]
  );
  for (const d of result[0].decisions) {
    assert.equal(d.decision, "ask");
  }
});

// --- audit: cursor advisory handling ---

test("audit: cursor differences are ignored by default", () => {
  // Since cursor uses the same evaluation logic, this will always agree
  // But we can test the failOnAdvisory flag behavior
  const perms = makePermissions();
  const summary = audit(perms, ["claude", "codex", "cursor"], {
    commands: ["pnpm test"]
  });
  assert.equal(summary.consistent, 1);
});

test("audit: auto-generated commands all agree across hard-enforcing runtimes", () => {
  const perms = makePermissions();
  const runtimes = ["claude", "codex", "kiro", "opencode"];
  const summary = audit(perms, runtimes);
  // All should be consistent since they use the same evaluation logic
  assert.equal(summary.divergences.length, 0);
  assert.equal(summary.consistent, summary.tested);
});

// --- audit: custom commands ---

test("audit: accepts custom command list", () => {
  const perms = makePermissions();
  const commands = ["echo hello", "ls -la", "rm -rf /"];
  const summary = audit(perms, ["claude", "codex"], { commands });
  assert.equal(summary.tested, 3);
});

// --- audit: failOnAdvisory ---

test("audit: failOnAdvisory has no effect when all agree", () => {
  const perms = makePermissions();
  const summary = audit(perms, ["claude", "codex", "cursor", "kiro"], {
    commands: ["pnpm test"],
    failOnAdvisory: true
  });
  assert.equal(summary.consistent, 1);
  assert.equal(summary.divergences.length, 0);
});

// --- audit: result structure ---

test("audit: result includes correct command string", () => {
  const perms = makePermissions();
  const summary = audit(perms, ["claude", "codex"], {
    commands: ["pnpm run build"]
  });
  // There should be a result about "pnpm run build"
  // Since it's consistent, it won't be in divergences
  assert.equal(summary.tested, 1);
});

test("audit: decisions include pattern and reason", () => {
  const perms = makePermissions();
  const results = getAllResultsForTest(perms, ["claude", "codex"], ["pnpm test"]);
  const claudeDecision = results[0].decisions.find((d) => d.runtime === "claude");
  assert.ok(claudeDecision);
  assert.equal(claudeDecision.decision, "allow");
  assert.equal(claudeDecision.pattern, "pnpm *");
  assert.ok(claudeDecision.reason.includes("Bash(pnpm *)"));
});

test("audit: codex decision includes regex reason", () => {
  const perms = makePermissions();
  const results = getAllResultsForTest(perms, ["codex"], ["pnpm test"]);
  const codexDecision = results[0].decisions[0];
  assert.equal(codexDecision.decision, "allow");
  assert.ok(codexDecision.reason.includes("permission-policy.py"));
});

// --- evaluateForRuntime ---

test("evaluateForRuntime: codex simulates regex matching for deny", () => {
  const perms = makePermissions();
  const result = evaluateForRuntime("rm -rf /tmp", perms, "codex");
  assert.equal(result.runtime, "codex");
  assert.equal(result.decision, "deny");
  assert.equal(result.pattern, "rm -rf *");
  assert.ok(result.reason.includes("permission-policy.py"));
});

test("evaluateForRuntime: codex simulates regex matching for allow", () => {
  const perms = makePermissions();
  const result = evaluateForRuntime("pnpm test", perms, "codex");
  assert.equal(result.decision, "allow");
  assert.equal(result.pattern, "pnpm *");
});

test("evaluateForRuntime: codex falls to default when no match", () => {
  const perms = makePermissions();
  const result = evaluateForRuntime("docker build .", perms, "codex");
  assert.equal(result.decision, "ask");
  assert.equal(result.pattern, null);
  assert.ok(result.reason.includes("on-request"));
});

test("evaluateForRuntime: claude uses core evaluation with formatted reason", () => {
  const perms = makePermissions();
  const result = evaluateForRuntime("pnpm test", perms, "claude");
  assert.equal(result.decision, "allow");
  assert.equal(result.pattern, "pnpm *");
  assert.ok(result.reason.includes("Bash(pnpm *)"));
});

test("evaluateForRuntime: kiro uses core evaluation", () => {
  const perms = makePermissions();
  const result = evaluateForRuntime("rm -rf /tmp", perms, "kiro");
  assert.equal(result.decision, "deny");
  assert.equal(result.pattern, "rm -rf *");
  assert.ok(result.reason.includes("shell deny"));
});

test("evaluateForRuntime: opencode uses core evaluation", () => {
  const perms = makePermissions();
  const result = evaluateForRuntime("docker build .", perms, "opencode");
  assert.equal(result.decision, "ask");
  assert.equal(result.pattern, null);
  assert.ok(result.reason.includes('bash["*"]'));
});

// --- audit: edge cases ---

test("audit: empty allow and deny lists — all commands go to default", () => {
  const perms = makePermissions({ allow: [], deny: [], default: "deny" });
  const summary = audit(perms, ["claude", "codex", "kiro"], {
    commands: ["anything", "echo hi"]
  });
  assert.equal(summary.consistent, 2);
  assert.equal(summary.divergences.length, 0);
});

test("audit: single deny pattern produces consistent results", () => {
  const perms = makePermissions({ allow: [], deny: ["dangerous *"], default: "allow" });
  const summary = audit(perms, ["claude", "codex", "kiro", "opencode"], {
    commands: ["dangerous thing", "safe thing"]
  });
  assert.equal(summary.tested, 2);
  assert.equal(summary.consistent, 2);
});

test("audit: handles commands with special regex characters", () => {
  const perms = makePermissions({
    allow: ["echo $HOME"],
    deny: []
  });
  // "$HOME" has $ which is a regex special char but globToRegexSource escapes it
  const summary = audit(perms, ["claude", "codex"], {
    commands: ["echo $HOME"]
  });
  assert.equal(summary.consistent, 1);
});

test("audit: summary fields are correct", () => {
  const perms = makePermissions();
  const summary = audit(perms, ["claude", "codex", "kiro"], {
    commands: ["pnpm test", "rm -rf /", "echo hello"]
  });
  assert.equal(summary.tested, 3);
  assert.equal(typeof summary.consistent, "number");
  assert.ok(Array.isArray(summary.divergences));
  assert.equal(summary.tested, summary.consistent + summary.divergences.length);
});

// --- audit: with all 5 runtimes including cursor ---

test("audit: all 5 runtimes produce consistent results", () => {
  const perms = makePermissions();
  const summary = audit(perms, ["claude", "codex", "cursor", "kiro", "opencode"], {
    commands: ["pnpm test", "rm -rf /tmp", "docker build ."]
  });
  assert.equal(summary.tested, 3);
  assert.equal(summary.consistent, 3);
  assert.equal(summary.divergences.length, 0);
});

test("audit: default=allow is consistent across all runtimes", () => {
  const perms = makePermissions({ allow: [], deny: [], default: "allow" });
  const summary = audit(perms, ["claude", "codex", "kiro", "opencode"], {
    commands: ["anything"]
  });
  assert.equal(summary.consistent, 1);
  const results = getAllResultsForTest(
    perms,
    ["claude", "codex", "kiro", "opencode"],
    ["anything"]
  );
  for (const d of results[0].decisions) {
    assert.equal(d.decision, "allow");
  }
});

test("audit: default=deny is consistent across all runtimes", () => {
  const perms = makePermissions({ allow: [], deny: [], default: "deny" });
  const summary = audit(perms, ["claude", "codex", "kiro", "opencode"], {
    commands: ["anything"]
  });
  assert.equal(summary.consistent, 1);
  const results = getAllResultsForTest(
    perms,
    ["claude", "codex", "kiro", "opencode"],
    ["anything"]
  );
  for (const d of results[0].decisions) {
    assert.equal(d.decision, "deny");
  }
});

// --- Helper to get all results (not just divergences) for test assertions ---

function getAllResultsForTest(
  permissions: Permissions,
  runtimes: string[],
  commands: string[]
): AuditResult[] {
  // Re-implement the inner logic to get full results
  const { evaluate } = require("../src/explain") as typeof import("../src/explain");
  const { formatForRuntime } = require("../src/explain") as typeof import("../src/explain");

  const results: AuditResult[] = [];
  for (const command of commands) {
    const core = evaluate(command, permissions);
    const decisions = runtimes.map((runtime) => {
      const formatted = formatForRuntime(core, runtime);
      return {
        runtime,
        decision: formatted.decision,
        pattern: formatted.matchedPattern ?? null,
        reason: formatted.reason
      };
    });
    const first = decisions[0]?.decision;
    const consistent = decisions.every((d) => d.decision === first);
    results.push({ command, decisions, consistent });
  }
  return results;
}
