import test from "node:test";
import assert from "node:assert/strict";
import { renderClaude } from "../src/adapters/claude";
import { ClaudeSettings, claudeDefaults } from "../src/config";
import { Permissions } from "../src/permissions";

const permissions: Permissions = {
  policy: { precedence: "deny_over_allow" },
  filesystem: { edit: "allow", write: "allow" },
  shell: { default: "ask", allow: ["git*", "pnpm*"], deny: ["git push*"] }
};

test("Claude maps filesystem and shell permissions deterministically", () => {
  const output = renderClaude(permissions);
  const parsed = JSON.parse(output);
  assert.deepEqual(parsed.permissions.allow, ["Edit", "Write", "Bash(git*)", "Bash(pnpm*)"]);
  assert.deepEqual(parsed.permissions.deny, ["Bash(git push*)"]);
  assert.equal(output, renderClaude(permissions));
});

test("Claude uses sensible defaults when no settings are passed", () => {
  const parsed = JSON.parse(renderClaude(permissions));
  assert.equal(parsed.alwaysThinkingEnabled, true);
  assert.equal(parsed.cleanupPeriodDays, 90);
  assert.deepEqual(parsed.env, {
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1"
  });
});

test("Claude respects custom settings overrides", () => {
  const custom: ClaudeSettings = {
    alwaysThinkingEnabled: false,
    cleanupPeriodDays: 30,
    disableTelemetry: false
  };
  const parsed = JSON.parse(renderClaude(permissions, custom));
  assert.equal(parsed.alwaysThinkingEnabled, false);
  assert.equal(parsed.cleanupPeriodDays, 30);
  assert.equal(parsed.env, undefined, "env should be omitted when telemetry is enabled");
});

test("Claude includes env only when disableTelemetry is true", () => {
  const withTelemetry: ClaudeSettings = { ...claudeDefaults, disableTelemetry: true };
  const parsed = JSON.parse(renderClaude(permissions, withTelemetry));
  assert.ok(parsed.env, "env should be present");
  assert.equal(parsed.env.DISABLE_TELEMETRY, "1");

  const noTelemetry: ClaudeSettings = { ...claudeDefaults, disableTelemetry: false };
  const parsed2 = JSON.parse(renderClaude(permissions, noTelemetry));
  assert.equal(parsed2.env, undefined);
});
