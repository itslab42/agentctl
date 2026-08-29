import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { Permissions, parsePermissions } from "./permissions";

/**
 * Returns the user-level configuration directory.
 * Respects XDG_CONFIG_HOME (returns $XDG_CONFIG_HOME/agentctl/) or
 * defaults to ~/.ai/.
 */
export function getUserConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.XDG_CONFIG_HOME) {
    return join(env.XDG_CONFIG_HOME, "agentctl");
  }
  return join(homedir(), ".ai");
}

/**
 * Determines whether user-level configuration should be applied.
 *
 * @param options - Options that can disable user configuration or inheritance.
 * @returns `true` when user configuration is enabled, `false` when disabled by the options or `AGENTCTL_NO_USER=1`.
 */
export function shouldUseUserConfig(
  options: { noUser?: boolean; inherit?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (options.noUser === true) return false;
  if (options.inherit === false) return false;
  if (env.AGENTCTL_NO_USER === "1") return false;
  return true;
}

/**
 * Loads user permission settings from `permissions.yaml`.
 *
 * @param options - Controls whether user configuration is disabled with `noUser`.
 * @param env - Environment variables used to locate the user configuration directory.
 * @returns Parsed permissions, or `undefined` when user configuration is disabled or unavailable.
 */
export async function loadUserPermissions(
  options: { noUser?: boolean } = {},
  env?: NodeJS.ProcessEnv
): Promise<Permissions | undefined> {
  if (options.noUser) return undefined;
  const dir = getUserConfigDir(env);
  const permPath = resolve(dir, "permissions.yaml");
  let content: string;
  try {
    content = await readFile(permPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    // Other errors (EACCES etc.) are silently ignored for user config
    return undefined;
  }
  try {
    const raw = parse(content);
    return parsePermissions(raw);
  } catch {
    // Invalid user config is silently ignored — project config is authoritative
    return undefined;
  }
}

/**
 * Loads user configuration settings from `config.yaml`.
 *
 * @param options - Options controlling whether user configuration is disabled
 * @returns The parsed configuration mapping, or `undefined` if user configuration is disabled, unavailable, unreadable, invalid, or not a mapping
 */
export async function loadUserConfig(
  options: { noUser?: boolean } = {},
  env?: NodeJS.ProcessEnv
): Promise<Record<string, unknown> | undefined> {
  if (options.noUser) return undefined;
  const dir = getUserConfigDir(env);
  const configPath = resolve(dir, "config.yaml");
  let content: string;
  try {
    content = await readFile(configPath, "utf8");
  } catch {
    return undefined;
  }
  try {
    const raw = parse(content);
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Merges user-level permissions (baseline) with project permissions (override).
 *
 * Merge strategy:
 * - shell.default: project wins (project value used if set)
 * - shell.allow: union of both lists (deduplicated)
 * - shell.deny: union of both lists (deduplicated)
 * - filesystem: project wins
 * - policy: always deny_over_allow
 *
 * @param user - The user-level baseline permissions
 * @param project - The project-level permissions that override
 * @returns Merged permissions
 */
export function mergeUserPermissions(user: Permissions, project: Permissions): Permissions {
  // Union of allow lists, deduplicated
  const allowSet = new Set([...user.shell.allow, ...project.shell.allow]);
  // Union of deny lists, deduplicated
  const denySet = new Set([...user.shell.deny, ...project.shell.deny]);

  // Remove any pattern that appears in both allow and deny
  // (deny_over_allow: deny wins, so remove from allow)
  const finalAllow = [...allowSet].filter((p) => !denySet.has(p));
  const finalDeny = [...denySet];

  return {
    policy: { precedence: "deny_over_allow" },
    filesystem: {
      edit: project.filesystem.edit,
      write: project.filesystem.write
    },
    shell: {
      default: project.shell.default,
      allow: finalAllow,
      deny: finalDeny
    }
  };
}
