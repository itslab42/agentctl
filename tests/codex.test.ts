import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCodexConfig, renderCodexHook } from "../src/adapters/codex";
import { Permissions, globToRegexSource } from "../src/permissions";

const p: Permissions = {
  policy: { precedence: "deny_over_allow" },
  filesystem: { edit: "allow", write: "allow" },
  shell: {
    default: "ask",
    allow: ["git*", "pnpm*"],
    deny: ["git push*", "git reset --hard*", "git clean*", "git rm*", "gh pr create*", "gh api*"]
  }
};
test("Codex config uses native sandbox and approval settings", () => {
  assert.match(renderCodexConfig(p), /approval_policy = "on-request"/);
  assert.match(renderCodexConfig(p), /sandbox_mode = "workspace-write"/);
  const readonly = { ...p, filesystem: { edit: "ask" as const, write: "deny" as const } };
  assert.match(renderCodexConfig(readonly), /sandbox_mode = "read-only"/);
});
test("glob conversion and generated hook block only dangerous Bash commands", () => {
  assert.equal(globToRegexSource("git push*"), "^git push.*$");
  const dir = mkdtempSync(join(tmpdir(), "agentctl-test-"));
  const hook = join(dir, "policy.py");
  writeFileSync(hook, renderCodexHook(p));
  const denied = [
    "git push",
    "git reset --hard HEAD",
    "git clean -fd",
    "git rm file.txt",
    "gh pr create",
    "gh api"
  ];
  const allowed = ["git status", "git diff", "git add .", 'git commit -m \\"test\\"', "pnpm test"];
  for (const command of denied) {
    const run = spawnSync("python3", [hook], {
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      encoding: "utf8"
    });
    assert.equal(JSON.parse(run.stdout).permissionDecision, "deny", command);
  }
  for (const command of allowed) {
    const run = spawnSync("python3", [hook], {
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      encoding: "utf8"
    });
    assert.equal(run.stdout, "", command);
  }
  assert.match(renderCodexHook(p), /GENERATED FILE — DO NOT EDIT/);
});
