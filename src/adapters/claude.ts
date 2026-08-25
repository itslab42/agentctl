import { Permissions, GENERATED_MARKER } from "../permissions";
import { ClaudeSettings, claudeDefaults } from "../config";
import { McpConfig } from "../mcp";

export function renderClaude(
  permissions: Permissions,
  settings: ClaudeSettings = claudeDefaults,
  mcp?: McpConfig
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
    _generatedBy: GENERATED_MARKER,
    cleanupPeriodDays: settings.cleanupPeriodDays,
    alwaysThinkingEnabled: settings.alwaysThinkingEnabled,
    permissions: { allow, deny: permissions.shell.deny.map((pattern) => `Bash(${pattern})`) }
  };
  if (Object.keys(env).length > 0) value.env = env;
  if (mcp) {
    const mcpServers: Record<string, Record<string, unknown>> = {};
    for (const [name, server] of Object.entries(mcp.servers)) {
      const entry: Record<string, unknown> = {};
      if (server.transport === "stdio") {
        entry.command = server.command;
        if (server.args && server.args.length > 0) entry.args = server.args;
      } else {
        entry.url = server.url;
      }
      if (server.env && Object.keys(server.env).length > 0) entry.env = server.env;
      mcpServers[name] = entry;
    }
    value.mcpServers = mcpServers;
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}
