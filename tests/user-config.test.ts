import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { getUserConfigDir, shouldUseUserConfig, mergeUserPermissions } from "../src/user-config";
import { Permissions } from "../src/permissions";
import { loadSource } from "../src/config";

// --- getUserConfigDir ---

test("getUserConfigDir returns ~/.ai by default", () => {
  const dir = getUserConfigDir({});
  assert.equal(dir, join(homedir(), ".ai"));
});

test("getUserConfigDir respects XDG_CONFIG_HOME", () => {
  const dir = getUserConfigDir({ XDG_CONFIG_HOME: "/custom/config" });
  assert.equal(dir, "/custom/config/agentctl");
});

test("getUserConfigDir ignores empty XDG_CONFIG_HOME", () => {
  const dir = getUserConfigDir({ XDG_CONFIG_HOME: "" });
  assert.equal(dir, join(homedir(), ".ai"));
});

// --- shouldUseUserConfig ---

test("shouldUseUserConfig returns true by default", () => {
  assert.equal(shouldUseUserConfig({}, {}), true);
});

test("shouldUseUserConfig returns false when noUser is true", () => {
  assert.equal(shouldUseUserConfig({ noUser: true }, {}), false);
});

test("shouldUseUserConfig returns false when inherit is false", () => {
  assert.equal(shouldUseUserConfig({ inherit: false }, {}), false);
});

test("shouldUseUserConfig returns false when AGENTCTL_NO_USER=1", () => {
  assert.equal(shouldUseUserConfig({}, { AGENTCTL_NO_USER: "1" }), false);
});

test("shouldUseUserConfig returns true when AGENTCTL_NO_USER is not 1", () => {
  assert.equal(shouldUseUserConfig({}, { AGENTCTL_NO_USER: "0" }), true);
  assert.equal(shouldUseUserConfig({}, { AGENTCTL_NO_USER: "" }), true);
});

test("shouldUseUserConfig returns true when inherit is undefined (default)", () => {
  assert.equal(shouldUseUserConfig({ inherit: undefined }, {}), true);
});

test("shouldUseUserConfig returns true when inherit is true", () => {
  assert.equal(shouldUseUserConfig({ inherit: true }, {}), true);
});

test("loadSource applies user config defaults while project settings and runtimes override", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "agentctl-user-config-"));
  const projectDir = join(root, "project");
  const projectAiDir = join(projectDir, ".ai");
  const userConfigDir = join(root, "config", "agentctl");
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;

  process.env.XDG_CONFIG_HOME = join(root, "config");
  t.after(() => {
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    rmSync(root, { recursive: true, force: true });
  });

  mkdirSync(projectAiDir, { recursive: true });
  mkdirSync(userConfigDir, { recursive: true });
  writeFileSync(
    join(userConfigDir, "config.yaml"),
    `runtimes:
  codex:
    enabled: true
claude:
  alwaysThinkingEnabled: false
  cleanupPeriodDays: 30
  disableTelemetry: false
`,
    "utf8"
  );
  writeFileSync(
    join(projectAiDir, "config.yaml"),
    `project:
  name: test-project
runtimes:
  claude:
    enabled: true
claude:
  cleanupPeriodDays: 7
sync:
  permissions: true
files:
  permissions: .ai/permissions.yaml
`,
    "utf8"
  );
  writeFileSync(
    join(projectAiDir, "permissions.yaml"),
    `policy:
  precedence: deny_over_allow
filesystem:
  edit: allow
  write: allow
shell:
  default: ask
  allow: []
  deny: []
`,
    "utf8"
  );

  const source = await loadSource(projectDir);

  assert.equal(source.config.claude.alwaysThinkingEnabled, false);
  assert.equal(source.config.claude.cleanupPeriodDays, 7);
  assert.equal(source.config.claude.disableTelemetry, false);
  assert.equal(source.config.runtimes.claude.enabled, true);
  assert.equal(source.config.runtimes.codex.enabled, false);
});

// --- mergeUserPermissions ---

const baseUser: Permissions = {
  policy: { precedence: "deny_over_allow" },
  filesystem: { edit: "allow", write: "allow" },
  shell: {
    default: "ask",
    allow: ["pnpm *", "npm *", "git status"],
    deny: ["rm -rf /", "git push --force *"]
  }
};

const baseProject: Permissions = {
  policy: { precedence: "deny_over_allow" },
  filesystem: { edit: "allow", write: "deny" },
  shell: {
    default: "deny",
    allow: ["pnpm test", "cargo build"],
    deny: ["docker rm *", "rm -rf /"]
  }
};

test("mergeUserPermissions: project wins for shell.default", () => {
  const merged = mergeUserPermissions(baseUser, baseProject);
  assert.equal(merged.shell.default, "deny");
});

test("mergeUserPermissions: project wins for filesystem", () => {
  const merged = mergeUserPermissions(baseUser, baseProject);
  assert.equal(merged.filesystem.edit, "allow");
  assert.equal(merged.filesystem.write, "deny");
});

test("mergeUserPermissions: union of allow lists (deduplicated)", () => {
  const merged = mergeUserPermissions(baseUser, baseProject);
  // Union: pnpm *, npm *, git status (from user) + pnpm test, cargo build (from project)
  assert.ok(merged.shell.allow.includes("pnpm *"));
  assert.ok(merged.shell.allow.includes("npm *"));
  assert.ok(merged.shell.allow.includes("git status"));
  assert.ok(merged.shell.allow.includes("pnpm test"));
  assert.ok(merged.shell.allow.includes("cargo build"));
});

test("mergeUserPermissions: union of deny lists (deduplicated)", () => {
  const merged = mergeUserPermissions(baseUser, baseProject);
  // Union: rm -rf / (both), git push --force * (user), docker rm * (project)
  assert.ok(merged.shell.deny.includes("rm -rf /"));
  assert.ok(merged.shell.deny.includes("git push --force *"));
  assert.ok(merged.shell.deny.includes("docker rm *"));
  // Should not have duplicates
  const rmCount = merged.shell.deny.filter((p) => p === "rm -rf /").length;
  assert.equal(rmCount, 1);
});

test("mergeUserPermissions: policy is always deny_over_allow", () => {
  const merged = mergeUserPermissions(baseUser, baseProject);
  assert.equal(merged.policy.precedence, "deny_over_allow");
});

test("mergeUserPermissions: overlapping allow/deny removes from allow (deny wins)", () => {
  const user: Permissions = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: {
      default: "ask",
      allow: ["dangerous-cmd *"],
      deny: []
    }
  };
  const project: Permissions = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: {
      default: "ask",
      allow: [],
      deny: ["dangerous-cmd *"]
    }
  };
  const merged = mergeUserPermissions(user, project);
  // Pattern is in deny list from project, so it should be removed from allow
  assert.ok(!merged.shell.allow.includes("dangerous-cmd *"));
  assert.ok(merged.shell.deny.includes("dangerous-cmd *"));
});

test("mergeUserPermissions: empty user lists", () => {
  const emptyUser: Permissions = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: { default: "ask", allow: [], deny: [] }
  };
  const merged = mergeUserPermissions(emptyUser, baseProject);
  assert.deepEqual(merged.shell.allow, baseProject.shell.allow);
  assert.deepEqual(merged.shell.deny, baseProject.shell.deny);
  assert.equal(merged.shell.default, baseProject.shell.default);
});

test("mergeUserPermissions: empty project lists", () => {
  const emptyProject: Permissions = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: { default: "ask", allow: [], deny: [] }
  };
  const merged = mergeUserPermissions(baseUser, emptyProject);
  assert.deepEqual(merged.shell.allow, baseUser.shell.allow);
  assert.deepEqual(merged.shell.deny, baseUser.shell.deny);
  // project wins for shell.default even when it's "ask"
  assert.equal(merged.shell.default, "ask");
});

test("mergeUserPermissions: duplicate patterns across user and project are deduplicated", () => {
  const user: Permissions = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: {
      default: "ask",
      allow: ["pnpm *", "npm *"],
      deny: ["rm -rf /"]
    }
  };
  const project: Permissions = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: {
      default: "ask",
      allow: ["pnpm *", "cargo *"],
      deny: ["rm -rf /", "git push --force *"]
    }
  };
  const merged = mergeUserPermissions(user, project);
  // allow: pnpm *, npm *, cargo * (pnpm * deduplicated)
  const allowCount = merged.shell.allow.filter((p) => p === "pnpm *").length;
  assert.equal(allowCount, 1);
  assert.equal(merged.shell.allow.length, 3);
  // deny: rm -rf /, git push --force * (rm -rf / deduplicated)
  const denyCount = merged.shell.deny.filter((p) => p === "rm -rf /").length;
  assert.equal(denyCount, 1);
  assert.equal(merged.shell.deny.length, 2);
});
