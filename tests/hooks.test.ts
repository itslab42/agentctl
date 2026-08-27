import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";

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
  const dir = mkdtempSync(join(tmpdir(), "agentctl-hooks-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test-project" }));
  return dir;
}

test("--with-hooks with lefthook.yml adds an agentctl command to pre-commit", () => {
  const dir = makeTmpDir();
  writeFileSync(
    join(dir, "lefthook.yml"),
    "pre-commit:\n  commands:\n    lint:\n      run: echo lint\n"
  );
  try {
    const { exitCode, stdout } = runInit(dir, ["--with-hooks"]);
    assert.equal(exitCode, 0, stdout);
    const yml = parse(readFileSync(join(dir, "lefthook.yml"), "utf8")) as {
      "pre-commit": { commands: Record<string, { run: string }> };
    };
    assert.equal(yml["pre-commit"].commands.agentctl.run, "pnpm exec agentctl check");
    // Preserves the existing command
    assert.equal(yml["pre-commit"].commands.lint.run, "echo lint");
    assert.ok(stdout.includes("Added agentctl check"), "should report addition");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--with-hooks with .husky/ appends to .husky/pre-commit", () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, ".husky"), { recursive: true });
  writeFileSync(join(dir, ".husky", "pre-commit"), "#!/bin/sh\npnpm test\n");
  try {
    const { exitCode, stdout } = runInit(dir, ["--with-hooks"]);
    assert.equal(exitCode, 0, stdout);
    const hook = readFileSync(join(dir, ".husky", "pre-commit"), "utf8");
    assert.ok(hook.includes("pnpm test"), "should preserve existing content");
    assert.ok(hook.includes("pnpm exec agentctl check"), "should append hook command");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--with-hooks with simple-git-hooks key adds pre-commit entry to package.json", () => {
  const dir = makeTmpDir();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      { name: "test-project", "simple-git-hooks": { "pre-commit": "npm test" } },
      null,
      2
    )
  );
  try {
    const { exitCode, stdout } = runInit(dir, ["--with-hooks"]);
    assert.equal(exitCode, 0, stdout);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      "simple-git-hooks": { "pre-commit": string };
    };
    assert.ok(
      pkg["simple-git-hooks"]["pre-commit"].includes("pnpm exec agentctl check"),
      "should add hook command"
    );
    assert.ok(
      pkg["simple-git-hooks"]["pre-commit"].includes("npm test"),
      "should preserve existing command"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--with-hooks with no manager and a .git dir writes .git/hooks/pre-commit", () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, ".git"), { recursive: true });
  try {
    const { exitCode, stdout } = runInit(dir, ["--with-hooks"]);
    assert.equal(exitCode, 0, stdout);
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    assert.ok(existsSync(hookPath), "should create raw git hook");
    const hook = readFileSync(hookPath, "utf8");
    assert.ok(hook.startsWith("#!/bin/sh"), "should start with shebang");
    assert.ok(hook.includes("pnpm exec agentctl check"), "should contain hook command");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--with-hooks with no manager and no .git prints a warning and skips", () => {
  const dir = makeTmpDir();
  try {
    const { exitCode, stdout } = runInit(dir, ["--with-hooks"]);
    assert.equal(exitCode, 0, stdout);
    assert.ok(stdout.includes("No .git directory"), "should warn about missing .git");
    assert.ok(!existsSync(join(dir, ".git")), "should not create .git");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--with-hooks does not duplicate an existing agentctl check hook", () => {
  const dir = makeTmpDir();
  writeFileSync(
    join(dir, "lefthook.yml"),
    "pre-commit:\n  commands:\n    agentctl:\n      run: pnpm exec agentctl check\n"
  );
  try {
    const { exitCode, stdout } = runInit(dir, ["--with-hooks"]);
    assert.equal(exitCode, 0, stdout);
    const yml = parse(readFileSync(join(dir, "lefthook.yml"), "utf8")) as {
      "pre-commit": { commands: Record<string, { run: string }> };
    };
    // Only one command still
    assert.equal(Object.keys(yml["pre-commit"].commands).length, 1);
    assert.ok(stdout.includes("already"), "should report already configured");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--hook-manager raw forces raw git hook even when lefthook is present", () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, "lefthook.yml"), "pre-commit:\n  commands: {}\n");
  mkdirSync(join(dir, ".git"), { recursive: true });
  try {
    const { exitCode, stdout } = runInit(dir, ["--hook-manager", "raw"]);
    assert.equal(exitCode, 0, stdout);
    assert.ok(
      existsSync(join(dir, ".git", "hooks", "pre-commit")),
      "should create raw git hook due to override"
    );
    // lefthook.yml should be untouched (no agentctl command)
    const yml = parse(readFileSync(join(dir, "lefthook.yml"), "utf8")) as {
      "pre-commit": { commands: Record<string, unknown> };
    };
    assert.equal(Object.keys(yml["pre-commit"].commands ?? {}).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("multiple managers detected warns about the ignored ones", () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, "lefthook.yml"), "pre-commit:\n  commands: {}\n");
  mkdirSync(join(dir, ".husky"), { recursive: true });
  try {
    const { exitCode, stdout } = runInit(dir, ["--with-hooks"]);
    assert.equal(exitCode, 0, stdout);
    assert.ok(stdout.includes("Multiple hook managers detected"), "should warn");
    assert.ok(stdout.includes("husky"), "should mention ignored husky");
    // Chose lefthook (highest priority)
    const yml = parse(readFileSync(join(dir, "lefthook.yml"), "utf8")) as {
      "pre-commit": { commands: Record<string, { run: string }> };
    };
    assert.equal(yml["pre-commit"].commands.agentctl.run, "pnpm exec agentctl check");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid --hook-manager value exits with code 2", () => {
  const dir = makeTmpDir();
  try {
    const { exitCode, stderr } = runInit(dir, ["--hook-manager", "bogus"]);
    assert.equal(exitCode, 2);
    assert.ok(stderr.includes("Unknown hook manager"), "should report unknown manager");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("init without --with-hooks does not configure any hook", () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, ".git"), { recursive: true });
  try {
    const { exitCode } = runInit(dir);
    assert.equal(exitCode, 0);
    assert.ok(
      !existsSync(join(dir, ".git", "hooks", "pre-commit")),
      "should not create hook without flag"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
