import { readFile } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";
import { parse } from "yaml";
import {
  Permissions,
  PermissionsOverlay,
  parsePermissions,
  parsePermissionsOverlay,
  mergeOverlay,
  resolveEnv
} from "./permissions";
import { McpConfig, parseMcpConfig } from "./mcp";
import { Instructions, loadInstructions } from "./instructions";
import { AgentctlError, formatError } from "./errors";

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
  sync: { permissions: boolean; mcp: boolean; instructions: boolean };
  files: { permissions: string; mcp?: string; instructions?: string };
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
  const enabled = value.enabled;
  if (typeof enabled !== "boolean") {
    throw new Error(
      `runtimes.${name}.enabled must be a boolean (got ${JSON.stringify(enabled)}). Valid values: true | false`
    );
  }
  return { enabled };
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
    sync: {
      permissions: bool(sync.permissions, "sync.permissions"),
      mcp: sync.mcp !== undefined ? bool(sync.mcp, "sync.mcp") : false,
      instructions:
        sync.instructions !== undefined ? bool(sync.instructions, "sync.instructions") : false
    },
    files: {
      permissions: string(files.permissions, "files.permissions"),
      mcp: files.mcp !== undefined ? string(files.mcp, "files.mcp") : undefined,
      instructions:
        files.instructions !== undefined
          ? string(files.instructions, "files.instructions")
          : undefined
    }
  };
}

async function yamlFile(path: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const agentErr: AgentctlError = {
      message: `Cannot read ${path}: ${err.code === "ENOENT" ? "file not found" : err.message}`,
      file: path,
      hint:
        err.code === "ENOENT"
          ? 'Run "agentctl init" to create the .ai/ directory'
          : err.code === "EACCES"
            ? "Check file permissions"
            : undefined
    };
    throw new Error(formatError(agentErr));
  }
  try {
    return parse(content);
  } catch (error) {
    const yamlErr = error as Error & { linePos?: [{ line: number; col: number }] };
    const line = yamlErr.linePos?.[0]?.line;
    const agentErr: AgentctlError = {
      message: `Invalid YAML in ${path}`,
      file: path,
      line,
      context: line ? getContextLines(content, line) : undefined,
      hint: "Fix the YAML syntax error above"
    };
    throw new Error(formatError(agentErr));
  }
}

/**
 * Like {@link yamlFile}, but returns `undefined` when the file does not exist
 * (ENOENT) instead of throwing. Parse errors and other read errors still throw.
 * Used for optional environment overlay files.
 */
async function optionalYamlFile(path: string): Promise<unknown> {
  try {
    await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    // Non-ENOENT read errors (e.g. EACCES) surface via yamlFile below.
  }
  return yamlFile(path);
}

/** Extract a few lines of context around the given 1-based line number. */
function getContextLines(content: string, line: number): string {
  const lines = content.split("\n");
  const start = Math.max(0, line - 2);
  const end = Math.min(lines.length, line + 1);
  return lines
    .slice(start, end)
    .map((l, i) => {
      const lineNum = start + i + 1;
      const marker = lineNum === line ? ">" : " ";
      return `${marker} ${String(lineNum).padStart(3)} | ${l}`;
    })
    .join("\n");
}

/**
 * Derives the overlay file path for a given environment from a base
 * permissions path. `.ai/permissions.yaml` + `ci` → `.ai/permissions.ci.yaml`.
 * A path without a `.yaml`/`.yml` extension gets `.{env}` appended before an
 * assumed `.yaml` suffix is preserved as-is.
 */
export function overlayPathFor(permissionsPath: string, env: string): string {
  const dir = dirname(permissionsPath);
  const file = basename(permissionsPath);
  const match = file.match(/^(.*)(\.ya?ml)$/);
  const overlayName = match ? `${match[1]}.${env}${match[2]}` : `${file}.${env}`;
  return join(dir, overlayName);
}

export async function loadSource(
  root: string,
  options: { env?: string } = {}
): Promise<{
  config: AgentctlConfig;
  permissions: Permissions;
  mcp?: McpConfig;
  instructions?: Instructions;
  env: string;
}> {
  const activeEnv = resolveEnv(options.env);
  const configPath = resolve(root, ".ai/config.yaml");

  const configRaw = await yamlFile(configPath);

  let config: AgentctlConfig;
  try {
    config = parseConfig(configRaw);
  } catch (error) {
    const agentErr: AgentctlError = {
      message: (error as Error).message,
      file: configPath,
      hint: "Check your .ai/config.yaml against the expected schema"
    };
    throw new Error(formatError(agentErr));
  }

  const permissionsPath = resolve(root, config.files.permissions);
  const permissionsRaw = await yamlFile(permissionsPath);

  let permissions: Permissions;
  try {
    permissions = parsePermissions(permissionsRaw);
  } catch (error) {
    const agentErr: AgentctlError = {
      message: (error as Error).message,
      file: permissionsPath,
      hint: "Check your permissions.yaml against the expected schema"
    };
    throw new Error(formatError(agentErr));
  }

  // Apply an environment overlay if a matching file exists. A missing overlay
  // for the active environment is not an error — the base permissions are used.
  const overlayPath = overlayPathFor(permissionsPath, activeEnv);
  const overlayRaw = await optionalYamlFile(overlayPath);
  if (overlayRaw !== undefined) {
    let overlay: PermissionsOverlay;
    try {
      overlay = parsePermissionsOverlay(overlayRaw);
    } catch (error) {
      const agentErr: AgentctlError = {
        message: (error as Error).message,
        file: overlayPath,
        hint: `Check your ${basename(overlayPath)} overlay against the expected schema`
      };
      throw new Error(formatError(agentErr));
    }
    permissions = mergeOverlay(permissions, overlay);
  }

  let mcp: McpConfig | undefined;
  if (config.files.mcp) {
    const mcpPath = resolve(root, config.files.mcp);
    const mcpRaw = await yamlFile(mcpPath);
    try {
      mcp = parseMcpConfig(mcpRaw);
    } catch (error) {
      const agentErr: AgentctlError = {
        message: (error as Error).message,
        file: mcpPath,
        hint: "Check your mcp.yaml against the expected schema"
      };
      throw new Error(formatError(agentErr));
    }
  }

  let instructions: Instructions | undefined;
  if (config.sync.instructions && config.files.instructions) {
    instructions = await loadInstructions(root, config.files.instructions);
  }

  return { config, permissions, mcp, instructions, env: activeEnv };
}
