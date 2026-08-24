import { Permissions } from "../permissions";
import { ClaudeSettings, claudeDefaults } from "../config";

export function renderClaude(
  permissions: Permissions,
  settings: ClaudeSettings = claudeDefaults
): string {
  const allow: string[] = [];
  if (permissions.filesystem.edit === "allow") allow.push("Edit");
  if (permissions.filesystem.write === "allow") allow.push("Write");
  allow.push(...permissions.shell.allow.map((pattern) => `Bash(${pattern})`));
  const env: Record<string, string> = {};
  if (settings.disableTelemetry) {
    env.DISABLE_TELEMETRY = "1";
    env.DISABLE_ERROR_REPORTING = "1";
    env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY = "1";
  }
  const value: Record<string, unknown> = {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    cleanupPeriodDays: settings.cleanupPeriodDays,
    alwaysThinkingEnabled: settings.alwaysThinkingEnabled,
    permissions: { allow, deny: permissions.shell.deny.map((pattern) => `Bash(${pattern})`) }
  };
  if (Object.keys(env).length > 0) value.env = env;
  return `${JSON.stringify(value, null, 2)}\n`;
}
