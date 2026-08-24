import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// When compiled, __dirname = <project>/dist-test/tests/
// We need to reach <project>/src/cli.ts
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const CLI = resolve(PROJECT_ROOT, "src", "cli.ts");
const TSX = resolve(PROJECT_ROOT, "node_modules", ".bin", "tsx");

function run(cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(TSX, [CLI, "status"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" }
  });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? 1 };
}

function runSync(cwd: string): void {
  const result = spawnSync(TSX, [CLI, "sync"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" }
  });
  assert.equal(result.status, 0, `sync failed: ${result.stderr}`);
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "agentctl-status-"));
}

function writeConfig(root: string, runtimes: Record<string, boolean>): void {
  const runtimesYaml = Object.entries(runtimes)
    .map(([name, enabled]) => `  ${name}:\n    enabled: ${enabled}`)
    .join("\n");
  const config = `project:
  name: test-project
runtimes:
${runtimesYaml}
sync:
  permissions: true
files:
  permissions: .ai/permissions.yaml
`;
  mkdirSync(join(root, ".ai"), { recursive: true });
  writeFileSync(join(root, ".ai", "config.yaml"), config, "utf8");
}

function writePermissions(root: string): void {
  const perms = `policy:
  precedence: deny_over_allow
filesystem:
  edit: allow
  write: allow
shell:
  default: ask
  allow:
    - "git *"
  deny:
    - "rm -rf /"
`;
  writeFileSync(join(root, ".ai", "permissions.yaml"), perms, "utf8");
}

test("status shows all runtimes as not configured when none enabled", () => {
  const root = makeTmpDir();
  try {
    writeConfig(root, { claude: false, codex: false, kiro: false, opencode: false });
    writePermissions(root);
    const { stdout, exitCode } = run(root);
    assert.match(stdout, /claude\s+– not configured/);
    assert.match(stdout, /codex\s+– not configured/);
    assert.match(stdout, /kiro\s+– not configured/);
    assert.match(stdout, /opencode\s+– not configured/);
    assert.equal(exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status shows in sync after a fresh sync", () => {
  const root = makeTmpDir();
  try {
    writeConfig(root, { claude: true, codex: false, kiro: false, opencode: false });
    writePermissions(root);
    runSync(root);
    const { stdout, exitCode } = run(root);
    assert.match(stdout, /claude\s+✓ in sync/);
    assert.match(stdout, /codex\s+– not configured/);
    assert.equal(exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status shows out of sync when generated file differs", () => {
  const root = makeTmpDir();
  try {
    writeConfig(root, { claude: true, codex: false, kiro: false, opencode: false });
    writePermissions(root);
    runSync(root);
    // Tamper with the generated file
    const claudePath = join(root, ".claude", "settings.json");
    writeFileSync(claudePath, '{"tampered": true}', "utf8");
    const { stdout, exitCode } = run(root);
    assert.match(stdout, /claude\s+✗ out of sync/);
    assert.equal(exitCode, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status shows out of sync when generated file is missing", () => {
  const root = makeTmpDir();
  try {
    writeConfig(root, { claude: true, codex: false, kiro: false, opencode: false });
    writePermissions(root);
    // Don't run sync — file doesn't exist
    const { stdout, exitCode } = run(root);
    assert.match(stdout, /claude\s+✗ out of sync/);
    assert.equal(exitCode, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status exits 0 when all enabled runtimes are in sync", () => {
  const root = makeTmpDir();
  try {
    writeConfig(root, { claude: true, codex: true, kiro: true, opencode: true });
    writePermissions(root);
    runSync(root);
    const { stdout, exitCode } = run(root);
    assert.match(stdout, /claude\s+✓ in sync/);
    assert.match(stdout, /codex\s+✓ in sync/);
    assert.match(stdout, /kiro\s+✓ in sync/);
    assert.match(stdout, /opencode\s+✓ in sync/);
    assert.equal(exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status lists drifted filenames in parentheses", () => {
  const root = makeTmpDir();
  try {
    writeConfig(root, { claude: false, codex: true, kiro: false, opencode: false });
    writePermissions(root);
    runSync(root);
    // Tamper with one codex file
    const configToml = join(root, ".codex", "config.toml");
    writeFileSync(configToml, "tampered = true", "utf8");
    const { stdout, exitCode } = run(root);
    assert.match(stdout, /codex\s+✗ out of sync/);
    assert.match(stdout, /\.codex\/config\.toml/);
    // The hook file is still in sync, so only config.toml should appear
    assert.doesNotMatch(stdout, /permission-policy\.py/);
    assert.equal(exitCode, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
