#!/usr/bin/env node
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { loadSource } from "./config";
import { renderClaude } from "./adapters/claude";
import { renderOpenCode } from "./adapters/opencode";
import { renderCodexConfig, renderCodexHook } from "./adapters/codex";

interface GeneratedFile {
  path: string;
  content: string;
  executable?: boolean;
  runtime: string;
}

function expected(root: string, source: Awaited<ReturnType<typeof loadSource>>): GeneratedFile[] {
  if (!source.config.sync.permissions) return [];
  const files: GeneratedFile[] = [];
  if (source.config.runtimes.claude.enabled)
    files.push({
      runtime: "Claude",
      path: resolve(root, ".claude/settings.json"),
      content: renderClaude(source.permissions)
    });
  if (source.config.runtimes.opencode.enabled)
    files.push({
      runtime: "OpenCode",
      path: resolve(root, ".opencode/opencode.json"),
      content: renderOpenCode(source.permissions)
    });
  if (source.config.runtimes.codex.enabled) {
    files.push({
      runtime: "Codex",
      path: resolve(root, ".codex/config.toml"),
      content: renderCodexConfig(source.permissions)
    });
    files.push({
      runtime: "Codex",
      path: resolve(root, ".codex/hooks/permission-policy.py"),
      content: renderCodexHook(source.permissions),
      executable: true
    });
  }
  return files;
}

async function current(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function display(root: string, path: string): string {
  return relative(root, path) || path;
}

function unifiedDiff(path: string, before: string | undefined, after: string): string {
  const oldLines = (before ?? "").split("\n");
  const newLines = after.split("\n");
  const body = [
    "--- a/" + path,
    "+++ b/" + path,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`)
  ];
  return body.join("\n") + "\n";
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || !["sync", "check", "validate", "diff"].includes(command)) {
    console.error("Usage: agentctl <sync|check|validate|diff>");
    process.exitCode = 2;
    return;
  }
  const root = process.cwd();
  let source: Awaited<ReturnType<typeof loadSource>>;
  try {
    source = await loadSource(root);
  } catch (error) {
    console.error(`❌ Validation failed: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  if (command === "validate") {
    console.log("✅ .ai configuration is valid.");
    return;
  }
  const files = expected(root, source);
  if (command === "sync") {
    console.log("🤖 Syncing agent configurations...\n");
    for (const file of files) {
      await mkdir(resolve(file.path, ".."), { recursive: true });
      await writeFile(file.path, file.content, "utf8");
      if (file.executable) await chmod(file.path, 0o755);
      console.log(`✓ ${file.runtime.padEnd(10)} → ${display(root, file.path)}`);
    }
    console.log("\n✅ Agent configuration sync complete.");
    return;
  }
  let drift = false;
  if (command === "check") console.log("🔍 Checking agent configurations...\n");
  for (const file of files) {
    const before = await current(file.path);
    const differs =
      before !== file.content ||
      (file.executable && (!existsSync(file.path) || ((await stat(file.path)).mode & 0o111) === 0));
    if (differs) {
      drift = true;
      if (command === "check") console.log(`✗ Out of sync: ${display(root, file.path)}`);
      else process.stdout.write(unifiedDiff(display(root, file.path), before, file.content));
    } else if (command === "check") console.log(`✓ In sync: ${display(root, file.path)}`);
  }
  if (command === "check")
    console.log(
      drift
        ? "\n❌ Agent configurations are out of sync."
        : "\n✅ Agent configurations are in sync."
    );
  if (drift) process.exitCode = 1;
}

void main();
