import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { parse } from "yaml";
import { Permissions, PermissionValue, parsePermissions } from "./permissions";
import { formatError } from "./errors";

/** Maximum number of nested `extends` levels to resolve before erroring. */
export const MAX_EXTENDS_DEPTH = 3;

/** Default cache time-to-live for remote policies (24 hours, in milliseconds). */
export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Options controlling how an `extends` chain is resolved. */
export interface InheritOptions {
  /** Force re-fetching remote policies, ignoring any cached copy. */
  refresh?: boolean;
  /** Use only cached copies of remote policies; never hit the network. */
  offline?: boolean;
  /** Disable all remote fetching (airgapped). Remote `extends` targets error. */
  noRemote?: boolean;
  /** Cache TTL in milliseconds. Defaults to {@link DEFAULT_CACHE_TTL_MS}. */
  cacheTtlMs?: number;
  /** Directory to store cached policies. Defaults to `<root>/.ai/.cache`. */
  cacheDir?: string;
  /**
   * Injectable fetch implementation for testing. Receives the URL and optional
   * conditional-request headers; returns the resolved response.
   */
  fetchImpl?: RemoteFetch;
  /** Emit a warning message (defaults to `console.warn`). */
  warn?: (message: string) => void;
}

/** A minimal remote fetch result used by {@link RemoteFetch}. */
export interface RemoteFetchResult {
  /** HTTP status code. */
  status: number;
  /** Response body text (empty for 304 Not Modified). */
  body: string;
  /** ETag response header, if present. */
  etag?: string;
  /** Last-Modified response header, if present. */
  lastModified?: string;
}

/** Conditional-request headers derived from a cached entry. */
export interface ConditionalHeaders {
  etag?: string;
  lastModified?: string;
}

/** A function that fetches a remote HTTPS policy. */
export type RemoteFetch = (url: string, headers: ConditionalHeaders) => Promise<RemoteFetchResult>;

/** Metadata persisted alongside a cached remote policy. */
interface CacheEntry {
  url: string;
  fetchedAt: number;
  etag?: string;
  lastModified?: string;
  content: string;
}

/** Classifies an `extends` target into one of the supported kinds. */
export type ExtendsKind = "https" | "npm" | "local";

/**
 * Classifies an `extends` target string.
 *
 * @param target - The raw `extends` value from config
 * @returns The resolved kind: `https`, `npm`, or `local`
 * @throws If the target uses an insecure `http://` scheme
 */
export function classifyTarget(target: string): ExtendsKind {
  const trimmed = target.trim();
  if (/^https:\/\//i.test(trimmed)) return "https";
  if (/^http:\/\//i.test(trimmed)) {
    throw new Error(
      formatError({
        message: `Insecure extends target: ${trimmed}`,
        hint: "Only HTTPS URLs are allowed for remote policies. Use https:// instead of http://."
      })
    );
  }
  // npm package path: starts with @scope/name/... or bare-name/...
  // Distinguish from local relative paths (./ ../ or absolute) and Windows drives.
  if (
    !trimmed.startsWith(".") &&
    !trimmed.startsWith("/") &&
    !trimmed.startsWith("~") &&
    !isAbsolute(trimmed) &&
    !/^[a-zA-Z]:[\\/]/.test(trimmed) &&
    /^(@[^/]+\/)?[^/]+\/.+/.test(trimmed)
  ) {
    return "npm";
  }
  return "local";
}

/** Builds a stable cache file name for a remote URL. */
function cacheFileName(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return `policy-${hash}.yaml`;
}

/** Reads a cache entry for the given URL, if present and parseable. */
async function readCache(cacheDir: string, url: string): Promise<CacheEntry | undefined> {
  const metaPath = resolve(cacheDir, `${cacheFileName(url)}.json`);
  try {
    const raw = await readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as CacheEntry;
    if (parsed && typeof parsed.content === "string" && parsed.url === url) return parsed;
  } catch {
    // Missing or corrupt cache — treat as absent.
  }
  return undefined;
}

/** Persists a cache entry for the given URL. */
async function writeCache(cacheDir: string, entry: CacheEntry): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const metaPath = resolve(cacheDir, `${cacheFileName(entry.url)}.json`);
  await writeFile(metaPath, JSON.stringify(entry, null, 2), "utf8");
}

/** Determines whether a cache entry is still fresh under the given TTL. */
export function isCacheFresh(entry: CacheEntry, ttlMs: number, now: number): boolean {
  return now - entry.fetchedAt < ttlMs;
}

/** Default HTTPS fetch using the global `fetch` API with conditional headers. */
const defaultFetch: RemoteFetch = async (url, headers) => {
  const requestHeaders: Record<string, string> = {};
  if (headers.etag) requestHeaders["If-None-Match"] = headers.etag;
  if (headers.lastModified) requestHeaders["If-Modified-Since"] = headers.lastModified;

  const response = await fetch(url, { headers: requestHeaders });
  const body = response.status === 304 ? "" : await response.text();
  return {
    status: response.status,
    body,
    etag: response.headers.get("etag") ?? undefined,
    lastModified: response.headers.get("last-modified") ?? undefined
  };
};

/**
 * Resolves the raw YAML content of an HTTPS `extends` target, honoring the
 * cache, TTL, and offline/refresh/no-remote options.
 */
async function loadRemote(url: string, options: InheritOptions): Promise<string> {
  if (options.noRemote) {
    throw new Error(
      formatError({
        message: `Remote fetching disabled (--no-remote): cannot resolve ${url}`,
        hint: "Remove --no-remote, or vendor the policy locally and use a local extends path."
      })
    );
  }

  const cacheDir = options.cacheDir ?? resolve(process.cwd(), ".ai/.cache");
  const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = Date.now();
  const cached = await readCache(cacheDir, url);

  // Offline: cache is the only source of truth.
  if (options.offline) {
    if (cached) return cached.content;
    throw new Error(
      formatError({
        message: `Offline mode (--offline): no cached policy for ${url}`,
        hint: "Run once with network access to populate the cache, or drop --offline."
      })
    );
  }

  // Fresh cache and not forcing refresh → use cache without hitting network.
  if (cached && !options.refresh && isCacheFresh(cached, ttlMs, now)) {
    return cached.content;
  }

  const fetchImpl = options.fetchImpl ?? defaultFetch;

  let result: RemoteFetchResult;
  try {
    result = await fetchImpl(url, {
      etag: options.refresh ? undefined : cached?.etag,
      lastModified: options.refresh ? undefined : cached?.lastModified
    });
  } catch (error) {
    // Network failure → fall back to cache if we have one.
    if (cached) {
      options.warn?.(`Failed to fetch ${url} (${(error as Error).message}); using cached policy.`);
      return cached.content;
    }
    throw new Error(
      formatError({
        message: `Cannot fetch remote policy ${url}: ${(error as Error).message}`,
        hint: "Check the URL and your network connection, or use --offline with a warm cache."
      })
    );
  }

  // 304 Not Modified → cache is still valid; refresh its timestamp.
  if (result.status === 304 && cached) {
    await writeCache(cacheDir, { ...cached, fetchedAt: now });
    return cached.content;
  }

  if (result.status < 200 || result.status >= 300) {
    if (cached) {
      options.warn?.(`Remote policy ${url} returned HTTP ${result.status}; using cached policy.`);
      return cached.content;
    }
    throw new Error(
      formatError({
        message: `Remote policy ${url} returned HTTP ${result.status}`,
        hint: "Verify the URL is correct and publicly reachable over HTTPS."
      })
    );
  }

  // Validate before caching so we never persist garbage.
  validatePolicyYaml(result.body, url);

  await writeCache(cacheDir, {
    url,
    fetchedAt: now,
    etag: result.etag,
    lastModified: result.lastModified,
    content: result.body
  });

  return result.body;
}

/** Resolves an npm-style `@scope/pkg/path.yaml` target to raw YAML content. */
async function loadNpm(target: string, fromDir: string): Promise<string> {
  // Split into package name and the file path within the package.
  const parts = target.split("/");
  let pkgName: string;
  let subPathParts: string[];
  if (target.startsWith("@")) {
    pkgName = parts.slice(0, 2).join("/");
    subPathParts = parts.slice(2);
  } else {
    pkgName = parts[0];
    subPathParts = parts.slice(1);
  }
  if (subPathParts.length === 0) {
    throw new Error(
      formatError({
        message: `Invalid npm extends target: ${target}`,
        hint: 'Include the file path inside the package, e.g. "@myorg/agent-policy/permissions.yaml".'
      })
    );
  }

  let pkgDir: string;
  try {
    // Resolve the package's package.json, then read the file relative to it.
    const require = createRequire(fromDir);
    const pkgJsonPath = require.resolve(`${pkgName}/package.json`, { paths: [fromDir] });
    pkgDir = dirname(pkgJsonPath);
  } catch {
    throw new Error(
      formatError({
        message: `Cannot resolve npm package "${pkgName}" for extends target ${target}`,
        hint: `Install it first, e.g. "pnpm add -D ${pkgName}".`
      })
    );
  }

  const filePath = resolve(pkgDir, ...subPathParts);
  return readLocalFile(filePath, target);
}

/** Reads a local file, producing a friendly error when missing. */
async function readLocalFile(path: string, originalTarget: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    throw new Error(
      formatError({
        message: `Cannot read extends target "${originalTarget}": ${
          err.code === "ENOENT" ? "file not found" : err.message
        }`,
        file: path,
        hint:
          err.code === "ENOENT"
            ? "Check the path is correct and relative to the config file."
            : "Check file permissions."
      })
    );
  }
}

/**
 * Resolves the raw YAML content for a single `extends` target based on its kind.
 *
 * @param target - The `extends` value
 * @param fromDir - Directory the target is resolved relative to (config dir)
 * @param options - Inheritance options controlling caching and remote access
 */
async function resolveTargetContent(
  target: string,
  fromDir: string,
  options: InheritOptions
): Promise<string> {
  const kind = classifyTarget(target);
  if (kind === "https") return loadRemote(target, options);
  if (kind === "npm") return loadNpm(target, fromDir);

  // local
  const expanded = target.startsWith("~/")
    ? resolve(homedir(), target.slice(2))
    : isAbsolute(target)
      ? target
      : resolve(fromDir, target);
  return readLocalFile(expanded, target);
}

/**
 * Parses raw YAML into validated {@link Permissions}, wrapping parse and schema
 * errors with a clear, sourced message.
 */
export function validatePolicyYaml(content: string, source: string): Permissions {
  let raw: unknown;
  try {
    raw = parse(content);
  } catch (error) {
    throw new Error(
      formatError({
        message: `Inherited policy from ${source} is not valid YAML: ${(error as Error).message}`,
        hint: "Ensure the extends target points at a valid permissions.yaml file."
      })
    );
  }
  try {
    return parsePermissions(raw);
  } catch (error) {
    throw new Error(
      formatError({
        message: `Inherited policy from ${source} failed validation: ${(error as Error).message}`,
        hint: "The extends target must be a valid permissions.yaml file."
      })
    );
  }
}

/** Ranks permission values by strictness (deny strictest). */
const strictness: Record<PermissionValue, number> = { deny: 2, ask: 1, allow: 0 };

/** Returns the stricter of two permission values. */
function stricter(base: PermissionValue, local: PermissionValue): PermissionValue {
  return strictness[local] > strictness[base] ? local : base;
}

/**
 * Merges a locally-defined policy on top of an inherited base policy.
 *
 * Local rules may only tighten the inherited baseline; they can never weaken it:
 * - `filesystem` / `shell.default`: the stricter of base and local wins.
 * - `shell.deny`: union of both lists (local can add denials).
 * - `shell.allow`: local allows are kept only when the base also allows them
 *   (local cannot broaden the inherited allow list), and anything denied by
 *   either layer is removed from allow to preserve `deny_over_allow`.
 *
 * @param base - The inherited (baseline) permissions
 * @param local - The project-local permissions layered on top
 * @returns The merged, tightened permissions
 */
export function mergeInheritedPermissions(base: Permissions, local: Permissions): Permissions {
  const deny = [...new Set([...base.shell.deny, ...local.shell.deny])];
  const denySet = new Set(deny);

  // Local can only keep allows that the base already permitted; and never an
  // allow that is denied by either layer.
  const baseAllowSet = new Set(base.shell.allow);
  const allow = local.shell.allow.filter(
    (pattern) => baseAllowSet.has(pattern) && !denySet.has(pattern)
  );

  return {
    policy: { precedence: "deny_over_allow" },
    filesystem: {
      edit: stricter(base.filesystem.edit, local.filesystem.edit),
      write: stricter(base.filesystem.write, local.filesystem.write)
    },
    shell: {
      default: stricter(base.shell.default, local.shell.default),
      allow,
      deny
    }
  };
}

/**
 * Detects whether merging the local policy onto the base changes the effective
 * deny list, and returns a human-readable warning if so.
 */
export function denyListWarning(base: Permissions, merged: Permissions): string | undefined {
  const added = merged.shell.deny.filter((p) => !base.shell.deny.includes(p));
  const removed = base.shell.deny.filter((p) => !merged.shell.deny.includes(p));
  if (added.length === 0 && removed.length === 0) return undefined;
  const parts: string[] = [];
  if (added.length) parts.push(`+${added.length} added (${added.join(", ")})`);
  if (removed.length) parts.push(`-${removed.length} removed (${removed.join(", ")})`);
  return `Inherited policy changes the effective deny list: ${parts.join("; ")}`;
}

/**
 * Resolves an `extends` chain into a single base {@link Permissions} object.
 *
 * Follows nested `extends` declarations recursively (capped at
 * {@link MAX_EXTENDS_DEPTH}), detects circular references, and merges each level
 * so that deeper (more ancestral) policies form the baseline that closer
 * policies tighten.
 *
 * @param target - The initial `extends` target from the project config
 * @param configDir - Directory the target is resolved relative to
 * @param options - Inheritance options controlling caching and remote access
 * @returns The fully-resolved inherited base permissions
 */
export async function resolveExtends(
  target: string,
  configDir: string,
  options: InheritOptions = {}
): Promise<Permissions> {
  const seen = new Set<string>();

  const resolveChain = async (
    currentTarget: string,
    fromDir: string,
    depth: number
  ): Promise<Permissions> => {
    if (depth > MAX_EXTENDS_DEPTH) {
      throw new Error(
        formatError({
          message: `extends chain exceeds the maximum depth of ${MAX_EXTENDS_DEPTH}`,
          hint: "Flatten your policy hierarchy so it nests no more than 3 levels deep."
        })
      );
    }

    const key = canonicalKey(currentTarget, fromDir);
    if (seen.has(key)) {
      throw new Error(
        formatError({
          message: `Circular extends detected: ${currentTarget}`,
          hint: "Remove the cycle so each policy is inherited only once."
        })
      );
    }
    seen.add(key);

    const content = await resolveTargetContent(currentTarget, fromDir, options);
    const raw = parseRaw(content, currentTarget);
    const policy = validatePolicyYaml(content, currentTarget);

    // If this policy itself extends another, resolve the ancestor first and
    // merge this policy on top (this policy tightens its ancestor).
    const parentExtends =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>).extends
        : undefined;
    if (typeof parentExtends === "string" && parentExtends.trim().length > 0) {
      const nextDir =
        classifyTarget(currentTarget) === "local" ? dirForTarget(currentTarget, fromDir) : fromDir;
      const ancestor = await resolveChain(parentExtends, nextDir, depth + 1);
      return mergeInheritedPermissions(ancestor, policy);
    }

    return policy;
  };

  return resolveChain(target, configDir, 1);
}

/** Parses raw YAML for inspecting a nested `extends`, without schema validation. */
function parseRaw(content: string, source: string): unknown {
  try {
    return parse(content);
  } catch (error) {
    throw new Error(
      formatError({
        message: `Inherited policy from ${source} is not valid YAML: ${(error as Error).message}`,
        hint: "Ensure the extends target points at a valid permissions.yaml file."
      })
    );
  }
}

/** Computes the directory a nested local target should resolve relative to. */
function dirForTarget(target: string, fromDir: string): string {
  const expanded = target.startsWith("~/")
    ? resolve(homedir(), target.slice(2))
    : isAbsolute(target)
      ? target
      : resolve(fromDir, target);
  return dirname(expanded);
}

/** Produces a canonical identity for cycle detection. */
function canonicalKey(target: string, fromDir: string): string {
  const kind = classifyTarget(target);
  if (kind === "https" || kind === "npm") return `${kind}:${target}`;
  const expanded = target.startsWith("~/")
    ? resolve(homedir(), target.slice(2))
    : isAbsolute(target)
      ? target
      : resolve(fromDir, target);
  return `local:${expanded}`;
}

// Imported Node builtins are declared at the top of this module.

/** Re-exported for callers that want to know cache freshness for status output. */
export async function cacheStatus(
  url: string,
  options: { cacheDir?: string; cacheTtlMs?: number } = {}
): Promise<{ cached: boolean; fetchedAt?: number; fresh?: boolean }> {
  const cacheDir = options.cacheDir ?? resolve(process.cwd(), ".ai/.cache");
  const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const entry = await readCache(cacheDir, url);
  if (!entry) return { cached: false };
  return {
    cached: true,
    fetchedAt: entry.fetchedAt,
    fresh: isCacheFresh(entry, ttlMs, Date.now())
  };
}
