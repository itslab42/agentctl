import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Permissions, parsePermissionsOverlay, mergeOverlay, resolveEnv } from "../src/permissions";
import { loadSource, overlayPathFor } from "../src/config";

// ---------------------------------------------------------------------------
// resolveEnv
// ---------------------------------------------------------------------------

test("resolveEnv: explicit value wins over everything", () => {
  assert.equal(resolveEnv("prod", { AGENTCTL_ENV: "ci", CI: "true" }), "prod");
});

test("resolveEnv: AGENTCTL_ENV used when no explicit value", () => {
  assert.equal(resolveEnv(undefined, { AGENTCTL_ENV: "staging" }), "staging");
});

test("resolveEnv: auto-detects ci from CI=true", () => {
  assert.equal(resolveEnv(undefined, { CI: "true" }), "ci");
});

test("resolveEnv: auto-detects ci from GITHUB_ACTIONS=true", () => {
  assert.equal(resolveEnv(undefined, { GITHUB_ACTIONS: "true" }), "ci");
});

test("resolveEnv: defaults to local", () => {
  assert.equal(resolveEnv(undefined, {}), "local");
});

test("resolveEnv: CI set to something other than 'true' does not trigger ci", () => {
  assert.equal(resolveEnv(undefined, { CI: "false" }), "local");
});

// ---------------------------------------------------------------------------
// overlayPathFor
// ---------------------------------------------------------------------------

test("overlayPathFor: inserts env before .yaml", () => {
  assert.equal(overlayPathFor("/repo/.ai/permissions.yaml", "ci"), "/repo/.ai/permissions.ci.yaml");
});

test("overlayPathFor: supports .yml extension", () => {
  assert.equal(
    overlayPathFor("/repo/.ai/permissions.yml", "prod"),
    "/repo/.ai/permissions.prod.yml"
  );
});

// ---------------------------------------------------------------------------
// parsePermissionsOverlay
// ---------------------------------------------------------------------------

test("parsePermissionsOverlay: all fields optional (empty overlay)", () => {
  const overlay = parsePermissionsOverlay({});
  assert.deepEqual(overlay, {});
});

test("parsePermissionsOverlay: parses partial shell overlay", () => {
  const overlay = parsePermissionsOverlay({
    shell: { default: "deny", deny: ["curl *"], allow: [] }
  });
  assert.equal(overlay.shell?.default, "deny");
  assert.deepEqual(overlay.shell?.deny, ["curl *"]);
  assert.deepEqual(overlay.shell?.allow, []);
});

test("parsePermissionsOverlay: accepts policy block when deny_over_allow", () => {
  assert.doesNotThrow(() =>
    parsePermissionsOverlay({
      policy: { precedence: "deny_over_allow" },
      shell: { default: "deny" }
    })
  );
});

test("parsePermissionsOverlay: rejects wrong policy precedence", () => {
  assert.throws(
    () => parsePermissionsOverlay({ policy: { precedence: "allow_over_deny" } }),
    /deny_over_allow/
  );
});

test("parsePermissionsOverlay: rejects invalid permission value", () => {
  assert.throws(() => parsePermissionsOverlay({ shell: { default: "maybe" } }), /allow, ask, deny/);
});

// ---------------------------------------------------------------------------
// mergeOverlay — tightening invariant
// ---------------------------------------------------------------------------

function baseline(): Permissions {
  return {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: { default: "ask", allow: ["git *", "docker *", "curl *"], deny: ["rm -rf *"] }
  };
}

test("mergeOverlay: deny is a union (overlay adds restrictions)", () => {
  const merged = mergeOverlay(baseline(), { shell: { deny: ["wget *"] } });
  assert.deepEqual([...merged.shell.deny].sort(), ["rm -rf *", "wget *"].sort());
});

test("mergeOverlay: allow is an intersection (overlay removes permissions)", () => {
  const merged = mergeOverlay(baseline(), { shell: { allow: ["git *"] } });
  assert.deepEqual(merged.shell.allow, ["git *"]);
});

test("mergeOverlay: empty allow list clears everything", () => {
  const merged = mergeOverlay(baseline(), { shell: { allow: [] } });
  assert.deepEqual(merged.shell.allow, []);
});

test("mergeOverlay: overlay allow cannot introduce new patterns", () => {
  // "npm *" is not in base allow, so intersection excludes it.
  const merged = mergeOverlay(baseline(), { shell: { allow: ["git *", "npm *"] } });
  assert.deepEqual(merged.shell.allow, ["git *"]);
});

test("mergeOverlay: default only tightens (ask -> deny wins)", () => {
  const merged = mergeOverlay(baseline(), { shell: { default: "deny" } });
  assert.equal(merged.shell.default, "deny");
});

test("mergeOverlay: default cannot loosen (deny stays deny even if overlay says allow)", () => {
  const base = baseline();
  base.shell.default = "deny";
  const merged = mergeOverlay(base, { shell: { default: "allow" } });
  assert.equal(merged.shell.default, "deny");
});

test("mergeOverlay: filesystem only tightens", () => {
  const merged = mergeOverlay(baseline(), { filesystem: { edit: "deny", write: "ask" } });
  assert.equal(merged.filesystem.edit, "deny");
  assert.equal(merged.filesystem.write, "ask");
});

test("mergeOverlay: filesystem cannot loosen", () => {
  const base = baseline();
  base.filesystem.write = "deny";
  const merged = mergeOverlay(base, { filesystem: { write: "allow" } });
  assert.equal(merged.filesystem.write, "deny");
});

test("mergeOverlay: filesystem scalars tighten v2 path capabilities", () => {
  const base = baseline();
  base.version = 2;
  base.filesystem.read = {
    default: "allow",
    allow: ["src/**"],
    ask: ["config/**"],
    deny: [".env*"]
  };
  base.filesystem.writePaths = {
    default: "allow",
    allow: ["dist/**"],
    ask: [],
    deny: [".git/**"]
  };

  const merged = mergeOverlay(base, { filesystem: { edit: "ask", write: "deny" } });

  assert.deepEqual(merged.filesystem.read, {
    default: "ask",
    allow: [],
    ask: ["config/**", "src/**"],
    deny: [".env*"]
  });
  assert.deepEqual(merged.filesystem.writePaths, {
    default: "deny",
    allow: [],
    ask: [],
    deny: [".git/**"]
  });
});

test("mergeOverlay: newly denied pattern is removed from allow (deny_over_allow invariant)", () => {
  const merged = mergeOverlay(baseline(), { shell: { deny: ["docker *"] } });
  assert.ok(merged.shell.deny.includes("docker *"));
  assert.ok(!merged.shell.allow.includes("docker *"));
});

test("mergeOverlay: does not mutate the base permissions", () => {
  const base = baseline();
  const snapshot = JSON.stringify(base);
  mergeOverlay(base, { shell: { deny: ["wget *"], allow: [] } });
  assert.equal(JSON.stringify(base), snapshot);
});

// ---------------------------------------------------------------------------
// loadSource integration
// ---------------------------------------------------------------------------

const CONFIG = `project:
  name: test-project
runtimes:
  kiro:
    enabled: true
sync:
  permissions: true
files:
  permissions: .ai/permissions.yaml
`;

const BASE_PERMS = `policy:
  precedence: deny_over_allow
filesystem:
  edit: allow
  write: allow
shell:
  default: ask
  allow:
    - "git *"
    - "docker *"
    - "curl *"
  deny:
    - "rm -rf *"
`;

function makeProject(overlays: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "agentctl-env-"));
  const aiDir = join(root, ".ai");
  mkdirSync(aiDir, { recursive: true });
  writeFileSync(join(aiDir, "config.yaml"), CONFIG, "utf8");
  writeFileSync(join(aiDir, "permissions.yaml"), BASE_PERMS, "utf8");
  for (const [env, content] of Object.entries(overlays)) {
    writeFileSync(join(aiDir, `permissions.${env}.yaml`), content, "utf8");
  }
  return root;
}

test("loadSource: missing overlay is not an error, uses base", async () => {
  const root = makeProject();
  try {
    const source = await loadSource(root, { env: "ci" });
    assert.equal(source.env, "ci");
    assert.equal(source.permissions.shell.default, "ask");
    assert.deepEqual(source.permissions.shell.allow, ["git *", "docker *", "curl *"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadSource: applies ci overlay tightening permissions", async () => {
  const ciOverlay = `shell:
  default: deny
  deny:
    - "curl *"
    - "wget *"
  allow: []
`;
  const root = makeProject({ ci: ciOverlay });
  try {
    const source = await loadSource(root, { env: "ci" });
    assert.equal(source.env, "ci");
    assert.equal(source.permissions.shell.default, "deny");
    assert.deepEqual(source.permissions.shell.allow, []);
    assert.ok(source.permissions.shell.deny.includes("curl *"));
    assert.ok(source.permissions.shell.deny.includes("wget *"));
    assert.ok(source.permissions.shell.deny.includes("rm -rf *"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadSource: local env with no local overlay uses base untouched", async () => {
  const root = makeProject({ ci: `shell:\n  default: deny\n` });
  try {
    const source = await loadSource(root, { env: "local" });
    assert.equal(source.env, "local");
    assert.equal(source.permissions.shell.default, "ask");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadSource: invalid overlay surfaces an error", async () => {
  const root = makeProject({ ci: `shell:\n  default: maybe\n` });
  try {
    await assert.rejects(() => loadSource(root, { env: "ci" }), /allow, ask, deny/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
