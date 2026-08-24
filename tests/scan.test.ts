import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { scan } from "../src/scan";

const PROJECT_ROOT = resolve(__dirname, "..", "..");
const CLI = resolve(PROJECT_ROOT, "src", "cli.ts");
const TSX = resolve(PROJECT_ROOT, "node_modules", ".bin", "tsx");

function runScan(
  cwd: string,
  args: string[] = []
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(TSX, [CLI, "scan", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" }
  });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? 1 };
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "agentctl-scan-"));
}

function writeClaude(root: string, allow: string[], deny: string[]): void {
  const settings = {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    permissions: {
      allow: ["Edit", "Write", ...allow.map((p) => `Bash(${p})`)],
      deny: deny.map((p) => `Bash(${p})`)
    }
  };
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify(settings, null, 2), "utf8");
}

function writeCodexToml(root: string, policy: string): void {
  const toml = `approval_policy = "${policy}"\nsandbox_mode = "workspace-write"\n`;
  mkdirSync(join(root, ".codex"), { recursive: true });
  writeFileSync(join(root, ".codex", "config.toml"), toml, "utf8");
}

function writeCodexHook(root: string, allow: string[], deny: string[]): void {
  const allowRegex = allow.map((g) => `^${g.replace(/\*/g, ".*")}$`);
  const denyRegex = deny.map((g) => `^${g.replace(/\*/g, ".*")}$`);
  const hook = `#!/usr/bin/env python3
DENY_PATTERNS = ${JSON.stringify(denyRegex, null, 2)}

ALLOW_PATTERNS = ${JSON.stringify(allowRegex, null, 2)}

def main():
    pass
`;
  mkdirSync(join(root, ".codex", "hooks"), { recursive: true });
  writeFileSync(join(root, ".codex", "hooks", "permission-policy.py"), hook, "utf8");
}

function writeCodexJson(root: string, policy: string, allow: string[], deny: string[]): void {
  const config = {
    approval_policy: policy,
    shell: { allow, deny }
  };
  writeFileSync(join(root, "codex.json"), JSON.stringify(config, null, 2), "utf8");
}

// --- Unit tests for scan() ---

test("scan detects .claude/settings.json and extracts Bash patterns", async () => {
  const root = makeTmpDir();
  try {
    writeClaude(root, ["git *", "pnpm *"], ["rm -rf *"]);
    const result = await scan(root);
    assert.equal(result.detected.length, 1);
    assert.equal(result.detected[0].name, "claude");
    assert.deepEqual(result.detected[0].allowPatterns, ["git *", "pnpm *"]);
    assert.deepEqual(result.detected[0].denyPatterns, ["rm -rf *"]);
    assert.equal(result.detected[0].shell, "ask");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan detects .codex/config.toml and extracts approval policy", async () => {
  const root = makeTmpDir();
  try {
    writeCodexToml(root, "auto");
    const result = await scan(root);
    assert.equal(result.detected.length, 1);
    assert.equal(result.detected[0].name, "codex");
    assert.equal(result.detected[0].shell, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan detects codex.json when .codex/config.toml is absent", async () => {
  const root = makeTmpDir();
  try {
    writeCodexJson(root, "on-request", ["npm test"], ["curl *"]);
    const result = await scan(root);
    assert.equal(result.detected.length, 1);
    assert.equal(result.detected[0].name, "codex");
    assert.equal(result.detected[0].path, "codex.json");
    assert.equal(result.detected[0].shell, "ask");
    assert.deepEqual(result.detected[0].allowPatterns, ["npm test"]);
    assert.deepEqual(result.detected[0].denyPatterns, ["curl *"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan prefers .codex/config.toml over codex.json", async () => {
  const root = makeTmpDir();
  try {
    writeCodexToml(root, "never");
    writeCodexJson(root, "auto", ["echo *"], []);
    const result = await scan(root);
    assert.equal(result.detected.length, 1);
    assert.equal(result.detected[0].path, ".codex/config.toml");
    assert.equal(result.detected[0].shell, "deny");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan reads codex hook patterns and converts regex back to globs", async () => {
  const root = makeTmpDir();
  try {
    writeCodexToml(root, "on-request");
    writeCodexHook(root, ["pnpm *", "git status"], ["rm -rf *"]);
    const result = await scan(root);
    assert.equal(result.detected.length, 1);
    assert.deepEqual(result.detected[0].allowPatterns, ["pnpm *", "git status"]);
    assert.deepEqual(result.detected[0].denyPatterns, ["rm -rf *"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan merges patterns from multiple runtimes with deduplication", async () => {
  const root = makeTmpDir();
  try {
    writeClaude(root, ["git *", "pnpm *"], ["rm -rf *"]);
    writeCodexToml(root, "auto");
    writeCodexHook(root, ["pnpm *", "npm test"], ["rm -rf *", "curl *"]);
    const result = await scan(root);
    assert.equal(result.detected.length, 2);
    // Check merged patterns have no duplicates
    const { permissionsYaml } = result;
    assert.ok(permissionsYaml.includes("git *"));
    assert.ok(permissionsYaml.includes("pnpm *"));
    assert.ok(permissionsYaml.includes("npm test"));
    assert.ok(permissionsYaml.includes("rm -rf *"));
    assert.ok(permissionsYaml.includes("curl *"));
    // "pnpm *" appears only once even though both runtimes have it
    const pnpmMatches = permissionsYaml.match(/pnpm \*/g);
    assert.equal(pnpmMatches?.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan reports shell mode conflicts between runtimes", async () => {
  const root = makeTmpDir();
  try {
    writeClaude(root, ["git *"], []);
    writeCodexToml(root, "auto"); // "allow" vs Claude's "ask"
    const result = await scan(root);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].field, "shell.default");
    assert.equal(result.conflicts[0].resolved, "ask"); // ask is more restrictive than allow
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan resolves conflict with most restrictive mode (deny > ask > allow)", async () => {
  const root = makeTmpDir();
  try {
    writeClaude(root, [], []);
    writeCodexToml(root, "never"); // "deny" vs Claude's "ask"
    const result = await scan(root);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].resolved, "deny");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan returns empty result when no configs are found", async () => {
  const root = makeTmpDir();
  try {
    const result = await scan(root);
    assert.equal(result.detected.length, 0);
    assert.equal(result.configYaml, "");
    assert.equal(result.permissionsYaml, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan generates valid config.yaml with detected runtimes enabled", async () => {
  const root = makeTmpDir();
  try {
    writeClaude(root, ["git *"], []);
    writeCodexToml(root, "on-request");
    const result = await scan(root);
    assert.ok(result.configYaml.includes("claude:"));
    assert.ok(result.configYaml.includes("enabled: true"));
    assert.ok(result.configYaml.includes("codex:"));
    // kiro and opencode should be disabled
    assert.ok(result.configYaml.includes("kiro:"));
    assert.ok(result.configYaml.includes("opencode:"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- CLI integration tests ---

test("CLI scan --dry-run prints config without writing files", () => {
  const root = makeTmpDir();
  try {
    writeClaude(root, ["git *", "pnpm test"], ["rm -rf *"]);
    const { stdout, exitCode } = runScan(root, ["--dry-run"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("Detected runtimes:"));
    assert.ok(stdout.includes(".claude/settings.json"));
    assert.ok(stdout.includes("--- .ai/config.yaml ---"));
    assert.ok(stdout.includes("--- .ai/permissions.yaml ---"));
    // Should NOT create .ai directory
    assert.ok(!existsSync(join(root, ".ai")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI scan writes .ai/ files when no existing .ai/ directory", () => {
  const root = makeTmpDir();
  try {
    writeClaude(root, ["git *"], ["rm -rf *"]);
    const { stdout, exitCode } = runScan(root);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("Generated:"));
    assert.ok(stdout.includes(".ai/config.yaml"));
    assert.ok(stdout.includes(".ai/permissions.yaml"));
    // Verify files exist
    assert.ok(existsSync(join(root, ".ai", "config.yaml")));
    assert.ok(existsSync(join(root, ".ai", "permissions.yaml")));
    // Verify content
    const config = readFileSync(join(root, ".ai", "config.yaml"), "utf8");
    assert.ok(config.includes("claude:"));
    const perms = readFileSync(join(root, ".ai", "permissions.yaml"), "utf8");
    assert.ok(perms.includes("deny_over_allow"));
    assert.ok(perms.includes("git *"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI scan refuses to overwrite existing .ai/ without --force", () => {
  const root = makeTmpDir();
  try {
    writeClaude(root, ["git *"], []);
    mkdirSync(join(root, ".ai"), { recursive: true });
    writeFileSync(join(root, ".ai", "config.yaml"), "existing: true", "utf8");
    const { stderr, exitCode } = runScan(root);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("already exists"));
    // Verify original file is untouched
    const content = readFileSync(join(root, ".ai", "config.yaml"), "utf8");
    assert.equal(content, "existing: true");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI scan --force overwrites existing .ai/ files", () => {
  const root = makeTmpDir();
  try {
    writeClaude(root, ["git *"], ["rm -rf *"]);
    mkdirSync(join(root, ".ai"), { recursive: true });
    writeFileSync(join(root, ".ai", "config.yaml"), "existing: true", "utf8");
    const { stdout, exitCode } = runScan(root, ["--force"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("Generated:"));
    // Verify file was overwritten
    const content = readFileSync(join(root, ".ai", "config.yaml"), "utf8");
    assert.ok(content.includes("claude:"));
    assert.notEqual(content, "existing: true");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI scan prints conflict warnings", () => {
  const root = makeTmpDir();
  try {
    writeClaude(root, ["git *"], []);
    writeCodexToml(root, "auto");
    const { stdout, exitCode } = runScan(root, ["--dry-run"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("⚠ Conflict:"));
    assert.ok(stdout.includes("ask"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI scan prints nothing-found message when no configs exist", () => {
  const root = makeTmpDir();
  try {
    const { stdout, exitCode } = runScan(root);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("No runtime configurations detected"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI scan uses project name from package.json", () => {
  const root = makeTmpDir();
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "my-app" }), "utf8");
    writeClaude(root, ["git *"], []);
    const { stdout, exitCode } = runScan(root, ["--dry-run"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("my-app"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
