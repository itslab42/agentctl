import { Permissions, PermissionValue } from "./permissions";
import { ClaudeSettings, CodexSettings } from "./config";
import { McpConfig } from "./mcp";

/** A runtime config detected on disk. */
export interface DetectedRuntime {
  name: string;
  path: string;
  shell: PermissionValue;
  allowPatterns: string[];
  denyPatterns: string[];
  filesystem?: { edit?: PermissionValue; write?: PermissionValue };
}

/** Options passed to adapter render methods. */
export interface AdapterOptions {
  claude?: ClaudeSettings;
  codex?: CodexSettings;
  mcp?: McpConfig;
}

/** A generated file entry with path relative to project root. */
export interface GeneratedFile {
  /** Relative path from project root */
  path: string;
  content: string;
  executable?: boolean;
}

/**
 * The v2 permission capabilities a runtime may or may not be able to enforce.
 *
 * These correspond to the path-level and top-level sections a `version: 2`
 * permissions file can declare beyond the v1 blanket scalars:
 *
 * - `filesystemRead` / `filesystemWrite` — path-level `filesystem.read` /
 *   `filesystem.write` capability blocks (globs, not just a blanket scalar).
 * - `network` — top-level `network` access rules.
 * - `env` — top-level environment variable access rules.
 * - `mcp` — top-level MCP tool access rules.
 */
export type V2Capability = "filesystemRead" | "filesystemWrite" | "network" | "env" | "mcp";

/** All v2 capabilities, in a stable order for deterministic warning output. */
export const V2_CAPABILITIES: readonly V2Capability[] = [
  "filesystemRead",
  "filesystemWrite",
  "network",
  "env",
  "mcp"
];

/** Human-readable label for each v2 capability used in warning messages. */
export const CAPABILITY_LABELS: Record<V2Capability, string> = {
  filesystemRead: "path-level filesystem read",
  filesystemWrite: "path-level filesystem write",
  network: "network",
  env: "environment variable",
  mcp: "MCP tool"
};

/**
 * Unified adapter interface co-locating render + scan logic.
 *
 * Each adapter is fully self-contained: it knows its output paths,
 * how to render from canonical permissions, how to parse existing
 * configs back into DetectedRuntime, and which files it owns.
 */
export interface Adapter {
  /** Runtime identifier (e.g. "claude", "kiro") */
  readonly name: string;

  /** Relative paths this adapter manages (for scan detection + sync output) */
  readonly paths: string[];

  /**
   * The set of v2 capabilities this adapter can actually enforce in its
   * generated output. Capabilities absent from this set are dropped (or only
   * rendered advisorily) during `render`, so `sync`/`check`/`status` warn when
   * a policy declares them. v1 blanket filesystem/shell permissions are always
   * enforced and are not represented here.
   */
  readonly capabilities: ReadonlySet<V2Capability>;

  /** Render the adapter output from canonical permissions */
  render(permissions: Permissions, options?: AdapterOptions): GeneratedFile[];

  /** Parse an existing config file back into DetectedRuntime (for scan) */
  parse(raw: string, path: string): DetectedRuntime;

  /** Check if a file at the given relative path is managed by this adapter */
  owns(path: string): boolean;
}

/** All registered adapters, imported eagerly. */
import { claudeAdapter } from "./adapters/claude";
import { codexAdapter } from "./adapters/codex";
import { cursorAdapter } from "./adapters/cursor";
import { kiroAdapter } from "./adapters/kiro";
import { opencodeAdapter } from "./adapters/opencode";

export const adapters: Adapter[] = [
  claudeAdapter,
  codexAdapter,
  cursorAdapter,
  kiroAdapter,
  opencodeAdapter
];

/** Find adapter by runtime name. */
export function getAdapter(name: string): Adapter | undefined {
  return adapters.find((a) => a.name === name);
}

/**
 * Determines which v2 capabilities a permissions policy actually declares.
 *
 * A capability counts as "declared" only when the v2 section is present. For
 * path-level filesystem, this means the `read` / `writePaths` capability blocks
 * (the v1 blanket `edit` / `write` scalars alone never count). Pure v1 policies
 * declare no v2 capabilities and therefore never produce warnings.
 */
export function declaredCapabilities(permissions: Permissions): Set<V2Capability> {
  const declared = new Set<V2Capability>();
  if (permissions.filesystem.read) declared.add("filesystemRead");
  if (permissions.filesystem.writePaths) declared.add("filesystemWrite");
  if (permissions.network) declared.add("network");
  if (permissions.env) declared.add("env");
  if (permissions.mcp) declared.add("mcp");
  return declared;
}

/** A single unenforceable-capability warning for one runtime. */
export interface CapabilityWarning {
  runtime: string;
  capability: V2Capability;
  message: string;
}

/**
 * Computes warnings for every declared v2 capability that an enabled runtime
 * cannot enforce.
 *
 * @param permissions - The resolved canonical permissions
 * @param enabledRuntimes - Names of the runtimes that are enabled in config
 * @returns One warning per (runtime, unenforceable capability) pair, ordered by
 *   runtime (as given) then by the stable {@link V2_CAPABILITIES} order
 */
export function unenforceableCapabilityWarnings(
  permissions: Permissions,
  enabledRuntimes: string[]
): CapabilityWarning[] {
  const declared = declaredCapabilities(permissions);
  if (declared.size === 0) return [];

  const warnings: CapabilityWarning[] = [];
  for (const runtime of enabledRuntimes) {
    const adapter = getAdapter(runtime);
    if (!adapter) continue;
    for (const capability of V2_CAPABILITIES) {
      if (!declared.has(capability)) continue;
      if (adapter.capabilities.has(capability)) continue;
      const label = CAPABILITY_LABELS[capability];
      warnings.push({
        runtime,
        capability,
        message: `${runtime}: policy declares ${label} rules, but the ${
          runtime.charAt(0).toUpperCase() + runtime.slice(1)
        } runtime cannot enforce ${label} access — these rules are not applied.`
      });
    }
  }
  return warnings;
}
