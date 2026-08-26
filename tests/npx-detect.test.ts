import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const PROJECT_ROOT = resolve(__dirname, "..", "..");
const CLI = resolve(PROJECT_ROOT, "src", "cli.ts");
const TSX = resolve(PROJECT_ROOT, "node_modules", ".bin", "tsx");

function runInit(
  cwd: string,
  extraArgs: string[] = []
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(TSX, [CLI, "init", ...extraArgs], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" }
  });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? 1 };
}

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentctl-npx-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test-project" }));
  return dir;
}

test("init shows devDependency tip when node_modules/@lab42/agentctl is absent (npx)", () => {
  const dir = makeTmpDir();
  try {
    const { exitCode, stdout } = runInit(dir);
    assert.equal(exitCode, 0, "init should succeed");
    assert.ok(
      stdout.includes("pnpm add -D @lab42/agentctl"),
      "should suggest adding as devDependency"
    );
    assert.ok(stdout.includes("Tip:"), "should include Tip label");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("init does NOT show devDependency tip when package is locally installed", () => {
  const dir = makeTmpDir();
  // Simulate local installation by creating the expected directory
  mkdirSync(join(dir, "node_modules", "@lab42", "agentctl"), { recursive: true });
  writeFileSync(
    join(dir, "node_modules", "@lab42", "agentctl", "package.json"),
    JSON.stringify({ name: "@lab42/agentctl", version: "0.4.0" })
  );
  try {
    const { exitCode, stdout } = runInit(dir);
    assert.equal(exitCode, 0, "init should succeed");
    assert.ok(
      !stdout.includes("pnpm add -D @lab42/agentctl"),
      "should NOT suggest adding as devDependency"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
