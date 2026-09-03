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
import {
  shouldUseUserConfig,
  loadUserConfig,
  loadUserPermissions,
  mergeUserPermissions
} from "./user-config";
import {
  InheritOptions,
  resolveExtends,
  mergeInheritedPermissions,
  denyListWarning
} from "./inherit";

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

export interface CodexSettings {
  /** Log to stderr when the hook blocks a command. Default: false */
  notifyOnDeny: boolean;
}

export const codexDefaults: CodexSettings = {
  notifyOnDeny: false
};

export interface AgentctlConfig {
  project: { name: string };
  /**
   * Optional base policy to inherit from. May be an HTTPS URL, an npm package
   * path (`@scope/pkg/path.yaml`), or a local file path. Local permissions are
   * merged on top and can only tighten, never weaken, the inherited policy.
   */
  extends?: string;
  inherit?: boolean;
  runtimes: Record<"claude" | "codex" | "cursor" | "kiro" | "opencode", { enabled: boolean }>;
  claude: ClaudeSettings;
  codex: CodexSettings;
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

/**
 * Parses and validates raw configuration data into an `AgentctlConfig`.
 *
 * @param raw - The raw configuration value to validate
 * @returns The validated configuration with defaults applied
 */
export function parseConfig(raw: unknown): AgentctlConfig {
  const root = object(raw, "config");
  const project = object(root.project, "project");
  const runtimes = root.runtimes ? object(root.runtimes, "runtimes") : {};
  const sync = object(root.sync, "sync");
  const files = object(root.files, "files");

  // Parse optional inherit field (defaults to true)
  let inherit: boolean | undefined;
  if (root.inherit !== undefined) {
    inherit = bool(root.inherit, "inherit");
  }

  // Parse optional extends field (base policy to inherit from)
  let extendsTarget: string | undefined;
  if (root.extends !== undefined) {
    extendsTarget = string(root.extends, "extends");
    if (extendsTarget.trim().length === 0) {
      throw new Error("extends must be a non-empty string");
    }
  }

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

  let codex: CodexSettings = { ...codexDefaults };
  if (root.codex) {
    const cx = object(root.codex, "codex");
    codex = {
      notifyOnDeny:
        cx.notifyOnDeny !== undefined
          ? bool(cx.notifyOnDeny, "codex.notifyOnDeny")
          : codexDefaults.notifyOnDeny
    };
  }

  return {
    project: { name: string(project.name, "project.name") },
    extends: extendsTarget,
    inherit,
    runtimes: {
      claude: runtime(runtimes, "claude"),
      codex: runtime(runtimes, "codex"),
      cursor: runtime(runtimes, "cursor"),
      kiro: runtime(runtimes, "kiro"),
      opencode: runtime(runtimes, "opencode")
    },
    claude,
    codex,
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

const userClaudeDefaults = [
  "alwaysThinkingEnabled",
  "cleanupPeriodDays",
  "disableTelemetry"
] as const;

/** Applies supported user-level setting defaults without inheriting runtime enablement. */
function mergeUserConfigDefaults(user: Record<string, unknown>, project: unknown): unknown {
  if (!project || typeof project !== "object" || Array.isArray(project)) return project;

  const userClaude = user.claude;
  if (!userClaude || typeof userClaude !== "object" || Array.isArray(userClaude)) return project;

  const projectRoot = project as Record<string, unknown>;
  const projectClaude = projectRoot.claude;
  if (
    projectClaude !== undefined &&
    (!projectClaude || typeof projectClaude !== "object" || Array.isArray(projectClaude))
  ) {
    return project;
  }
  const projectClaudeSettings = projectClaude ? (projectClaude as Record<string, unknown>) : {};
  const claude: Record<string, unknown> = {};

  for (const key of userClaudeDefaults) {
    if (key in userClaude) claude[key] = (userClaude as Record<string, unknown>)[key];
  }

  return {
    ...projectRoot,
    claude: { ...claude, ...projectClaudeSettings }
  };
}

/**
 * Reads and parses a YAML file.
 *
 * @param path - The path to the YAML file
 * @returns The parsed YAML value
 * @throws An error with file and syntax details when the file cannot be read or contains invalid YAML
 */
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
 * Loads and parses a YAML file when present.
 *
 * @param path - The YAML file path
 * @returns The parsed YAML value, or `undefined` when the file does not exist
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
 * Derives an environment-specific overlay path from a permissions file path.
 *
 * A `.yaml` or `.yml` extension is preserved after inserting `.{env}` before it; paths with other extensions or no extension receive `.{env}` appended.
 */
export function overlayPathFor(permissionsPath: string, env: string): string {
  const dir = dirname(permissionsPath);
  const file = basename(permissionsPath);
  const match = file.match(/^(.*)(\.ya?ml)$/);
  const overlayName = match ? `${match[1]}.${env}${match[2]}` : `${file}.${env}`;
  return join(dir, overlayName);
}

/**
 * Loads project configuration, permissions, and optional integrations for the active environment.
 *
 * @param root - The project root directory
 * @param options - Optional environment selection and user-level permission inheritance control
 * @returns The parsed configuration, effective permissions, optional MCP and instruction data, and active environment
 * @throws Error if a required file is unavailable or contains invalid data
 */
export async function loadSource(
  root: string,
  options: {
    env?: string;
    noUser?: boolean;
    inherit?: InheritOptions;
  } = {}
): Promise<{
  config: AgentctlConfig;
  permissions: Permissions;
  mcp?: McpConfig;
  instructions?: Instructions;
  env: string;
  inheritedFrom?: string;
  inheritanceWarnings?: string[];
}> {
  const activeEnv = resolveEnv(options.env);
  const configPath = resolve(root, ".ai/config.yaml");

  let configRaw = await yamlFile(configPath);

  const projectInherit =
    configRaw && typeof configRaw === "object" && !Array.isArray(configRaw)
      ? (configRaw as Record<string, unknown>).inherit
      : undefined;
  if (
    shouldUseUserConfig({
      noUser: options.noUser,
      inherit: projectInherit === false ? false : undefined
    })
  ) {
    const userConfig = await loadUserConfig({ noUser: options.noUser });
    if (userConfig) configRaw = mergeUserConfigDefaults(userConfig, configRaw);
  }

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

  // Merge user-level baseline permissions if applicable.
  // User permissions serve as a baseline; project permissions override.
  if (shouldUseUserConfig({ noUser: options.noUser, inherit: config.inherit })) {
    const userPerms = await loadUserPermissions({ noUser: options.noUser });
    if (userPerms) {
      permissions = mergeUserPermissions(userPerms, permissions);
    }
  }

  // Resolve an inherited base policy (extends). The inherited policy is the
  // baseline; the local (user + project) permissions are merged on top and can
  // only tighten — never weaken — the inherited baseline.
  let inheritedFrom: string | undefined;
  const inheritanceWarnings: string[] = [];
  if (config.extends) {
    const configDir = dirname(configPath);
    const inheritOptions: InheritOptions = {
      ...options.inherit,
      cacheDir: options.inherit?.cacheDir ?? resolve(root, ".ai/.cache")
    };
    const base = await resolveExtends(config.extends, configDir, inheritOptions);
    const merged = mergeInheritedPermissions(base, permissions);
    const warning = denyListWarning(base, merged);
    if (warning) inheritanceWarnings.push(warning);
    permissions = merged;
    inheritedFrom = config.extends;
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

  return {
    config,
    permissions,
    mcp,
    instructions,
    env: activeEnv,
    inheritedFrom,
    inheritanceWarnings: inheritanceWarnings.length > 0 ? inheritanceWarnings : undefined
  };
}
