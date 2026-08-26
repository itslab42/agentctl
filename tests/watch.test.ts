import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const PROJECT_ROOT = resolve(__dirname, "..", "..");
const CLI = resolve(PROJECT_ROOT, "src", "cli.ts");
const TSX = resolve(PROJECT_ROOT, "node_modules", ".bin", "tsx");

function makeTmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentctl-watch-"));
  mkdirSync(join(dir, ".ai"), { recursive: true });
  writeFileSync(
    join(dir, ".ai", "config.yaml"),
    `project:\n  name: test\nruntimes:\n  claude:\n    enabled: true\nsync:\n  permissions: true\nfiles:\n  permissions: .ai/permissions.yaml\n`
  );
  writeFileSync(
    join(dir, ".ai", "permissions.yaml"),
    `policy:\n  precedence: deny_over_allow\nfilesystem:\n  edit: allow\n  write: allow\nshell:\n  default: ask\n  allow: []\n  deny: []\n`
  );
  return dir;
}

test("sync --watch performs initial sync and exits on SIGINT", async () => {
  const dir = makeTmpProject();
  try {
    const child = spawn(TSX, [CLI, "sync", "--watch"], {
      cwd: dir,
      env: { ...process.env, NODE_NO_WARNINGS: "1" }
    });

    let output = "";
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });

    // Wait for initial sync to complete
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (output.includes("file(s) updated")) {
          clearInterval(check);
          resolve();
        }
      }, 50);
      // Safety timeout
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 5000);
    });

    assert.ok(output.includes("Watching .ai/"), "should print watch message");
    assert.ok(output.includes("file(s) updated"), "should perform initial sync");

    // Verify the sync actually wrote files
    const settings = readFileSync(join(dir, ".claude", "settings.json"), "utf8");
    assert.ok(settings.includes("agentctl"), "should have generated claude settings");

    // Send SIGINT
    child.kill("SIGINT");
    await new Promise<void>((resolve) => child.on("close", () => resolve()));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sync --watch re-syncs when .ai/ file changes", async () => {
  const dir = makeTmpProject();
  try {
    const child = spawn(TSX, [CLI, "sync", "--watch"], {
      cwd: dir,
      env: { ...process.env, NODE_NO_WARNINGS: "1" }
    });

    let output = "";
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });

    // Wait for initial sync
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (output.includes("file(s) updated")) {
          clearInterval(check);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 5000);
    });

    // Modify a file to trigger re-sync
    const initialOutput = output;
    writeFileSync(
      join(dir, ".ai", "permissions.yaml"),
      `policy:\n  precedence: deny_over_allow\nfilesystem:\n  edit: allow\n  write: allow\nshell:\n  default: deny\n  allow: []\n  deny: []\n`
    );

    // Wait for the re-sync
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (output.length > initialOutput.length && output.includes("changed → syncing")) {
          clearInterval(check);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 3000);
    });

    assert.ok(output.includes("changed → syncing"), "should detect file change and re-sync");

    child.kill("SIGINT");
    await new Promise<void>((resolve) => child.on("close", () => resolve()));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sync --watch errors if .ai/ does not exist", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agentctl-watch-noai-"));
  try {
    const child = spawn(TSX, [CLI, "sync", "--watch"], {
      cwd: dir,
      env: { ...process.env, NODE_NO_WARNINGS: "1" }
    });

    let stderr = "";
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const code = await new Promise<number>((resolve) => {
      child.on("close", (c) => resolve(c ?? 1));
    });

    // The loadSource will fail since there's no .ai/config.yaml
    // This exits with code 1 after the validation error
    assert.ok(code !== 0 || stderr.includes("not found"), "should fail without .ai/");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
