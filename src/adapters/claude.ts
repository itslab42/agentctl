import { Permissions } from "../permissions";

export function renderClaude(permissions: Permissions): string {
  const allow: string[] = [];
  if (permissions.filesystem.edit === "allow") allow.push("Edit");
  if (permissions.filesystem.write === "allow") allow.push("Write");
  allow.push(...permissions.shell.allow.map((pattern) => `Bash(${pattern})`));
  const value = {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    cleanupPeriodDays: 90,
    alwaysThinkingEnabled: true,
    env: {
      DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1",
      CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1"
    },
    permissions: { allow, deny: permissions.shell.deny.map((pattern) => `Bash(${pattern})`) }
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}
