#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const config_1 = require("./config");
const claude_1 = require("./adapters/claude");
const opencode_1 = require("./adapters/opencode");
const codex_1 = require("./adapters/codex");
function expected(root, source) {
    if (!source.config.sync.permissions)
        return [];
    const files = [];
    if (source.config.runtimes.claude.enabled)
        files.push({ runtime: "Claude", path: (0, node_path_1.resolve)(root, ".claude/settings.json"), content: (0, claude_1.renderClaude)(source.permissions) });
    if (source.config.runtimes.opencode.enabled)
        files.push({ runtime: "OpenCode", path: (0, node_path_1.resolve)(root, ".opencode/opencode.json"), content: (0, opencode_1.renderOpenCode)(source.permissions) });
    if (source.config.runtimes.codex.enabled) {
        files.push({ runtime: "Codex", path: (0, node_path_1.resolve)(root, ".codex/config.toml"), content: (0, codex_1.renderCodexConfig)(source.permissions) });
        files.push({ runtime: "Codex", path: (0, node_path_1.resolve)(root, ".codex/hooks/permission-policy.py"), content: (0, codex_1.renderCodexHook)(source.permissions), executable: true });
    }
    return files;
}
async function current(path) {
    try {
        return await (0, promises_1.readFile)(path, "utf8");
    }
    catch {
        return undefined;
    }
}
function display(root, path) { return (0, node_path_1.relative)(root, path) || path; }
function unifiedDiff(path, before, after) {
    const oldLines = (before ?? "").split("\n");
    const newLines = after.split("\n");
    const body = ["--- a/" + path, "+++ b/" + path, `@@ -1,${oldLines.length} +1,${newLines.length} @@`, ...oldLines.map((line) => `-${line}`), ...newLines.map((line) => `+${line}`)];
    return body.join("\n") + "\n";
}
async function main() {
    const command = process.argv[2];
    if (!command || !["sync", "check", "validate", "diff"].includes(command)) {
        console.error("Usage: agentctl <sync|check|validate|diff>");
        process.exitCode = 2;
        return;
    }
    const root = process.cwd();
    let source;
    try {
        source = await (0, config_1.loadSource)(root);
    }
    catch (error) {
        console.error(`❌ Validation failed: ${error.message}`);
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
            await (0, promises_1.mkdir)((0, node_path_1.resolve)(file.path, ".."), { recursive: true });
            await (0, promises_1.writeFile)(file.path, file.content, "utf8");
            if (file.executable)
                await (0, promises_1.chmod)(file.path, 0o755);
            console.log(`✓ ${file.runtime.padEnd(10)} → ${display(root, file.path)}`);
        }
        console.log("\n✅ Agent configuration sync complete.");
        return;
    }
    let drift = false;
    if (command === "check")
        console.log("🔍 Checking agent configurations...\n");
    for (const file of files) {
        const before = await current(file.path);
        const differs = before !== file.content || (file.executable && (!(0, node_fs_1.existsSync)(file.path) || ((await (0, promises_1.stat)(file.path)).mode & 0o111) === 0));
        if (differs) {
            drift = true;
            if (command === "check")
                console.log(`✗ Out of sync: ${display(root, file.path)}`);
            else
                process.stdout.write(unifiedDiff(display(root, file.path), before, file.content));
        }
        else if (command === "check")
            console.log(`✓ In sync: ${display(root, file.path)}`);
    }
    if (command === "check")
        console.log(drift ? "\n❌ Agent configurations are out of sync." : "\n✅ Agent configurations are in sync.");
    if (drift)
        process.exitCode = 1;
}
void main();
