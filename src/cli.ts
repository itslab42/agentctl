#!/usr/bin/env node
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { loadSource } from "./config";
import { unifiedDiff } from "./diff";
import { renderClaude } from "./adapters/claude";
import { renderOpenCode } from "./adapters/opencode";
import { renderCodexConfig, renderCodexHook } from "./adapters/codex";
import { renderKiro } from "./adapters/kiro";
import { scan } from "./scan";

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
      content: renderClaude(source.permissions, source.config.claude)
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
  if (source.config.runtimes.kiro.enabled)
    files.push({
      runtime: "Kiro",
      path: resolve(root, ".kiro/settings/permissions.yaml"),
      content: renderKiro(source.permissions)
    });
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

async function projectName(root: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      name?: unknown;
    };
    if (typeof pkg.name === "string" && pkg.name.length > 0) return pkg.name;
  } catch {
    // fall through
  }
  return basename(root);
}

async function runInit(root: string): Promise<void> {
  const aiDir = resolve(root, ".ai");
  if (existsSync(aiDir)) {
    console.error("❌ .ai/ already exists. Remove it first if you want to re-initialize.");
    process.exitCode = 1;
    return;
  }
  const stubsDir = resolve(__dirname, "stubs");
  const name = await projectName(root);
  const config = (await readFile(resolve(stubsDir, "config.yaml"), "utf8")).replace(
    "__PROJECT_NAME__",
    name
  );
  const permissions = await readFile(resolve(stubsDir, "permissions.yaml"), "utf8");
  await mkdir(aiDir, { recursive: true });
  await writeFile(resolve(aiDir, "config.yaml"), config, "utf8");
  await writeFile(resolve(aiDir, "permissions.yaml"), permissions, "utf8");
  console.log("✅ Initialized .ai/config.yaml and .ai/permissions.yaml");
  console.log("   Edit them, then run: agentctl sync");
  console.log("   Tip: add generated dirs to .gitignore (.claude/ .codex/ .opencode/)");
}

async function runScan(root: string): Promise<void> {
  const args = process.argv.slice(3);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  const aiDir = resolve(root, ".ai");
  if (existsSync(aiDir) && !force && !dryRun) {
    console.error("❌ .ai/ already exists. Use --force to overwrite or --dry-run to preview.");
    process.exitCode = 1;
    return;
  }

  const result = await scan(root);

  if (result.detected.length === 0) {
    console.log("No runtime configurations detected.");
    return;
  }

  // Print summary of detected runtimes
  console.log("Detected runtimes:");
  for (const runtime of result.detected) {
    const parts: string[] = [`shell: ${runtime.shell}`];
    if (runtime.allowPatterns.length > 0)
      parts.push(`${runtime.allowPatterns.length} allow patterns`);
    if (runtime.denyPatterns.length > 0) parts.push(`${runtime.denyPatterns.length} deny patterns`);
    console.log(`  ${runtime.path.padEnd(40)} → ${parts.join(", ")}`);
  }

  // Print conflicts
  if (result.conflicts.length > 0) {
    console.log("");
    for (const conflict of result.conflicts) {
      const details = conflict.runtimes.map((r) => `${r.name} uses "${r.value}"`).join(", ");
      console.log(`⚠ Conflict: ${details}. Defaulted to "${conflict.resolved}".`);
    }
  }

  // Substitute project name
  const name = await projectName(root);
  const configYaml = result.configYaml.replace("__PROJECT_NAME__", name);

  if (dryRun) {
    console.log("\n--- .ai/config.yaml ---");
    console.log(configYaml);
    console.log("--- .ai/permissions.yaml ---");
    console.log(result.permissionsYaml);
    return;
  }

  // Write files
  await mkdir(aiDir, { recursive: true });
  await writeFile(resolve(aiDir, "config.yaml"), configYaml, "utf8");
  await writeFile(resolve(aiDir, "permissions.yaml"), result.permissionsYaml, "utf8");

  console.log("\nGenerated:");
  console.log("  .ai/config.yaml");
  console.log("  .ai/permissions.yaml");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "--version" || command === "-V") {
    const pkg = JSON.parse(await readFile(resolve(__dirname, "../package.json"), "utf8")) as {
      version: string;
    };
    console.log(pkg.version);
    return;
  }
  if (
    !command ||
    !["init", "sync", "check", "validate", "diff", "status", "scan"].includes(command)
  ) {
    console.error("Usage: agentctl <init|sync|check|validate|diff|status|scan|--version>");
    process.exitCode = 2;
    return;
  }
  const root = process.cwd();
  if (command === "init") {
    await runInit(root);
    return;
  }
  if (command === "scan") {
    await runScan(root);
    return;
  }
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

  if (command === "status") {
    const allRuntimes = ["claude", "codex", "kiro", "opencode"] as const;
    let drift = false;
    for (const name of allRuntimes) {
      const enabled = source.config.runtimes[name].enabled;
      if (!enabled) {
        console.log(`${name.padEnd(10)} – not configured`);
        continue;
      }
      const runtimeFiles = files.filter((f) => f.runtime.toLowerCase() === name);
      const diffs: string[] = [];
      for (const file of runtimeFiles) {
        const before = await current(file.path);
        const differs =
          before !== file.content ||
          (file.executable &&
            (!existsSync(file.path) || ((await stat(file.path)).mode & 0o111) === 0));
        if (differs) diffs.push(display(root, file.path));
      }
      if (diffs.length > 0) {
        drift = true;
        console.log(`${name.padEnd(10)} ✗ out of sync (${diffs.join(", ")})`);
      } else {
        console.log(`${name.padEnd(10)} ✓ in sync`);
      }
    }
    if (drift) process.exitCode = 1;
    return;
  }

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
