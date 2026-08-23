"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const codex_1 = require("../src/adapters/codex");
const permissions_1 = require("../src/permissions");
const p = { policy: { precedence: "deny_over_allow" }, filesystem: { edit: "allow", write: "allow" }, shell: { default: "ask", allow: ["git*", "pnpm*"], deny: ["git push*", "git reset --hard*", "git clean*", "git rm*", "gh pr create*", "gh api*"] } };
(0, node_test_1.default)("Codex config uses native sandbox and approval settings", () => {
    strict_1.default.match((0, codex_1.renderCodexConfig)(p), /approval_policy = "on-request"/);
    strict_1.default.match((0, codex_1.renderCodexConfig)(p), /sandbox_mode = "workspace-write"/);
    const readonly = { ...p, filesystem: { edit: "ask", write: "deny" } };
    strict_1.default.match((0, codex_1.renderCodexConfig)(readonly), /sandbox_mode = "read-only"/);
});
(0, node_test_1.default)("glob conversion and generated hook block only dangerous Bash commands", () => {
    strict_1.default.equal((0, permissions_1.globToRegexSource)("git push*"), "^git push.*$");
    const dir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "agentctl-test-"));
    const hook = (0, node_path_1.join)(dir, "policy.py");
    (0, node_fs_1.writeFileSync)(hook, (0, codex_1.renderCodexHook)(p));
    const denied = ["git push", "git reset --hard HEAD", "git clean -fd", "git rm file.txt", "gh pr create", "gh api"];
    const allowed = ["git status", "git diff", "git add .", "git commit -m \\\"test\\\"", "pnpm test"];
    for (const command of denied) {
        const run = (0, node_child_process_1.spawnSync)("python3", [hook], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }), encoding: "utf8" });
        strict_1.default.equal(JSON.parse(run.stdout).permissionDecision, "deny", command);
    }
    for (const command of allowed) {
        const run = (0, node_child_process_1.spawnSync)("python3", [hook], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }), encoding: "utf8" });
        strict_1.default.equal(run.stdout, "", command);
    }
    strict_1.default.match((0, codex_1.renderCodexHook)(p), /GENERATED FILE — DO NOT EDIT/);
});
