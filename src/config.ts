import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { Permissions, parsePermissions } from "./permissions";

export interface ClaudeSettings {
  alwaysThinkingEnabled: boolean;
  cleanupPeriodDays: number;
  disableTelemetry: boolean;
}

export const claudeDefaults: ClaudeSettings = {
  alwaysThinkingEnabled: true,
  cleanupPeriodDays: 90,
  disableTelemetry: true
};

export interface AgentctlConfig {
  project: { name: string };
  runtimes: Record<"claude" | "codex" | "cursor" | "kiro" | "opencode", { enabled: boolean }>;
  claude: ClaudeSettings;
  sync: { permissions: boolean };
  files: { permissions: string };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}
function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${label} must be a number`);
  return value;
}
function runtime(raw: Record<string, unknown>, name: string): { enabled: boolean } {
  if (!(name in raw)) return { enabled: false };
  const value = object(raw[name], `runtimes.${name}`);
  return { enabled: bool(value.enabled, `runtimes.${name}.enabled`) };
}

export function parseConfig(raw: unknown): AgentctlConfig {
  const root = object(raw, "config");
  const project = object(root.project, "project");
  const runtimes = root.runtimes ? object(root.runtimes, "runtimes") : {};
  const sync = object(root.sync, "sync");
  const files = object(root.files, "files");

  let claude: ClaudeSettings = { ...claudeDefaults };
  if (root.claude) {
    const c = object(root.claude, "claude");
    claude = {
      alwaysThinkingEnabled:
        c.alwaysThinkingEnabled !== undefined
          ? bool(c.alwaysThinkingEnabled, "claude.alwaysThinkingEnabled")
          : claudeDefaults.alwaysThinkingEnabled,
      cleanupPeriodDays:
        c.cleanupPeriodDays !== undefined
          ? number(c.cleanupPeriodDays, "claude.cleanupPeriodDays")
          : claudeDefaults.cleanupPeriodDays,
      disableTelemetry:
        c.disableTelemetry !== undefined
          ? bool(c.disableTelemetry, "claude.disableTelemetry")
          : claudeDefaults.disableTelemetry
    };
  }

  return {
    project: { name: string(project.name, "project.name") },
    runtimes: {
      claude: runtime(runtimes, "claude"),
      codex: runtime(runtimes, "codex"),
      cursor: runtime(runtimes, "cursor"),
      kiro: runtime(runtimes, "kiro"),
      opencode: runtime(runtimes, "opencode")
    },
    claude,
    sync: { permissions: bool(sync.permissions, "sync.permissions") },
    files: { permissions: string(files.permissions, "files.permissions") }
  };
}

async function yamlFile(path: string): Promise<unknown> {
  try {
    return parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${(error as Error).message}`);
  }
}

export async function loadSource(
  root: string
): Promise<{ config: AgentctlConfig; permissions: Permissions }> {
  const configPath = resolve(root, ".ai/config.yaml");
  const config = parseConfig(await yamlFile(configPath));
  const permissions = parsePermissions(await yamlFile(resolve(root, config.files.permissions)));
  return { config, permissions };
}
