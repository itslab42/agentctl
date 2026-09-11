import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// When compiled, __dirname = <project>/dist-test/tests/
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const CLI = resolve(PROJECT_ROOT, "src", "cli.ts");
const TSX = resolve(PROJECT_ROOT, "node_modules", ".bin", "tsx");

function run(cwd: string, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(TSX, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    // Force NO_COLOR off / on explicitly per-test via flags; keep env clean.
    env: { ...process.env, NODE_NO_WARNINGS: "1", NO_COLOR: "1" }
  });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? 1 };
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "agentctl-cap-"));
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

const V2_PERMS = `version: 2
policy:
  precedence: deny_over_allow
filesystem:
  read:
    default: allow
    deny: [".env*"]
  write:
    default: allow
shell:
  default: ask
network:
  default: ask
  allow: ["https://registry.npmjs.org/*"]
env:
  default: deny
  allow: ["NODE_ENV"]
mcp:
  default: ask
  allow: ["filesystem:*"]
`;

const V1_PERMS = `policy:
  precedence: deny_over_allow
filesystem:
  edit: allow
  write: allow
shell:
  default: ask
  allow: ["git *"]
  deny: ["rm -rf /"]
`;

function writePermissions(root: string, contents: string): void {
  writeFileSync(join(root, ".ai", "permissions.yaml"), contents, "utf8");
}

test("sync warns for every unenforceable v2 capability on claude", () => {
  const root = makeTmpDir();
  try {
    writeConfig(root, { claude: true, codex: false, cursor: false, kiro: false, opencode: false });
    writePermissions(root, V2_PERMS);
    const { stderr, exitCode } = run(root, ["sync"]);
    assert.match(stderr, /claude: policy declares path-level filesystem read rules/);
    assert.match(stderr, /claude: policy declares path-level filesystem write rules/);
    assert.match(stderr, /claude: policy declares network rules/);
    assert.match(stderr, /claude: policy declares environment variable rules/);
    assert.match(stderr, /claude: policy declares MCP tool rules/);
    // Advisory only — sync still succeeds.
    assert.equal(exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync warns only for env on kiro (enforces the rest)", () => {
  const root = makeTmpDir();
  try {
    writeConfig(root, { claude: false, codex: false, cursor: false, kiro: true, opencode: false });
    writePermissions(root, V2_PERMS);
    const { stderr, exitCode } = run(root, ["sync"]);
    assert.match(stderr, /kiro: policy declares environment variable rules/);
    assert.doesNotMatch(stderr, /kiro: policy declares network rules/);
    assert.doesNotMatch(stderr, /kiro: policy declares MCP tool rules/);
    assert.doesNotMatch(stderr, /kiro: policy declares path-level filesystem/);
    assert.equal(exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no warning for a pure v1 policy", () => {
  const root = makeTmpDir();
  try {
    writeConfig(root, { claude: true, codex: true, cursor: true, kiro: true, opencode: true });
    writePermissions(root, V1_PERMS);
    const { stderr, exitCode } = run(root, ["sync"]);
    assert.doesNotMatch(stderr, /cannot enforce/);
    assert.equal(exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check surfaces the same warnings without flipping exit code", () => {
  const root = makeTmpDir();
  try {
    writeConfig(root, { claude: true, codex: false, cursor: false, kiro: false, opencode: false });
    writePermissions(root, V2_PERMS);
    // Sync first so there is no drift — exit code should stay 0.
    run(root, ["sync"]);
    const { stderr, exitCode } = run(root, ["check"]);
    assert.match(stderr, /claude: policy declares network rules/);
    assert.equal(exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status surfaces the same warnings", () => {
  const root = makeTmpDir();
  try {
    writeConfig(root, { claude: false, codex: false, cursor: false, kiro: true, opencode: false });
    writePermissions(root, V2_PERMS);
    run(root, ["sync"]);
    const { stderr, exitCode } = run(root, ["status"]);
    assert.match(stderr, /kiro: policy declares environment variable rules/);
    assert.equal(exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--no-color emits warnings without ANSI escape codes", () => {
  const root = makeTmpDir();
  try {
    writeConfig(root, { claude: true, codex: false, cursor: false, kiro: false, opencode: false });
    writePermissions(root, V2_PERMS);
    const { stderr } = run(root, ["sync", "--no-color"]);
    assert.match(stderr, /⚠ claude: policy declares/);
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(stderr, /\x1b\[/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--color forces ANSI escape codes even when piped", () => {
  const root = makeTmpDir();
  try {
    writeConfig(root, { claude: true, codex: false, cursor: false, kiro: false, opencode: false });
    writePermissions(root, V2_PERMS);
    const { stderr } = run(root, ["sync", "--color"]);
    // Cyan escape code should be present around the warning.
    // eslint-disable-next-line no-control-regex
    assert.match(stderr, /\x1b\[36m/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
