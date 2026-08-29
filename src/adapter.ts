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
