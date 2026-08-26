import { Permissions, globToRegexSource } from "./permissions";
import { evaluate, formatForRuntime, Decision } from "./explain";

/** Severity of a divergence */
export type Severity = "critical" | "warning" | "info";

/** Per-runtime decision in an audit result */
export interface RuntimeDecision {
  runtime: string;
  decision: Decision;
  pattern: string | null;
  reason: string;
}

/** Result of auditing a single command */
export interface AuditResult {
  command: string;
  decisions: RuntimeDecision[];
  consistent: boolean;
  severity?: Severity;
}

/** Summary of a full audit run */
export interface AuditSummary {
  tested: number;
  consistent: number;
  divergences: AuditResult[];
  skipped?: string;
}

/** Options for the audit function */
export interface AuditOptions {
  /** Custom commands to test (overrides auto-generation) */
  commands?: string[];
  /** Treat cursor advisory differences as failures */
  failOnAdvisory?: boolean;
}

/** Maximum number of auto-generated test commands */
const MAX_GENERATED_COMMANDS = 200;

/**
 * Expand a glob pattern into a concrete command that should match.
 * Replaces `*` with a realistic argument.
 */
function expandGlob(pattern: string): string {
  // If no wildcard, the pattern is already a concrete command
  if (!pattern.includes("*")) return pattern;
  // Replace first * with a plausible arg
  return pattern.replace("*", "arg");
}

/**
 * Generate a "near miss" — a command close to the pattern but that should NOT match.
 * Useful for testing false-positive risk.
 */
function nearMiss(pattern: string): string {
  // If pattern starts with a word followed by space/wildcard, prepend a char to break it
  const firstWord = pattern.split(/[\s*]/)[0];
  if (firstWord.length > 0) {
    return `${firstWord}x ${pattern.includes("*") ? "arg" : ""}`.trim();
  }
  return `x${pattern}`;
}

/**
 * Generate a comprehensive set of test commands from permissions.
 * Includes: exact pattern expansions, boundary near-misses, and common default-testing commands.
 */
export function generateTestCommands(permissions: Permissions): string[] {
  const commands: string[] = [];

  // 1. Expand each allow pattern into a concrete matching command
  for (const pattern of permissions.shell.allow) {
    commands.push(expandGlob(pattern));
  }

  // 2. Expand each deny pattern into a concrete matching command
  for (const pattern of permissions.shell.deny) {
    commands.push(expandGlob(pattern));
  }

  // 3. Near-miss for each allow pattern (should NOT match allow)
  for (const pattern of permissions.shell.allow) {
    commands.push(nearMiss(pattern));
  }

  // 4. Near-miss for each deny pattern (should NOT match deny)
  for (const pattern of permissions.shell.deny) {
    commands.push(nearMiss(pattern));
  }

  // 5. Common commands that test the default policy
  const defaults = [
    "docker build .",
    "curl https://example.com",
    "whoami",
    "cat /etc/passwd",
    "echo hello"
  ];
  for (const cmd of defaults) {
    commands.push(cmd);
  }

  // Deduplicate and cap
  const unique = [...new Set(commands)];
  return unique.slice(0, MAX_GENERATED_COMMANDS);
}

/**
 * Determine the severity of a divergence between runtime decisions.
 */
function classifySeverity(
  decisions: RuntimeDecision[],
  failOnAdvisory: boolean
): Severity | undefined {
  const hasAllow = decisions.some((d) => d.decision === "allow");
  const hasDeny = decisions.some((d) => d.decision === "deny");

  if (hasAllow && hasDeny) return "critical";

  // Check if only cursor diverges
  const nonCursor = decisions.filter((d) => d.runtime !== "cursor");
  const cursorOnly = decisions.filter((d) => d.runtime === "cursor");
  if (nonCursor.length > 0 && cursorOnly.length > 0) {
    const nonCursorDecisions = new Set(nonCursor.map((d) => d.decision));
    const cursorDecision = cursorOnly[0].decision;
    if (nonCursorDecisions.size === 1 && !nonCursorDecisions.has(cursorDecision)) {
      // Only cursor differs
      return failOnAdvisory ? "warning" : "info";
    }
  }

  return "warning";
}

/**
 * Check if all decisions are consistent.
 * By default, cursor (advisory) differences are not treated as divergences
 * unless failOnAdvisory is true.
 */
function isConsistent(decisions: RuntimeDecision[], failOnAdvisory: boolean): boolean {
  if (decisions.length <= 1) return true;

  if (failOnAdvisory) {
    // All must agree
    const first = decisions[0].decision;
    return decisions.every((d) => d.decision === first);
  }

  // Ignore cursor for consistency check
  const nonCursor = decisions.filter((d) => d.runtime !== "cursor");
  if (nonCursor.length <= 1) return true;
  const first = nonCursor[0].decision;
  return nonCursor.every((d) => d.decision === first);
}

/**
 * Run the cross-runtime audit.
 * Tests each command against all enabled runtimes and reports divergences.
 */
export function audit(
  permissions: Permissions,
  runtimes: string[],
  options: AuditOptions = {}
): AuditSummary {
  // Edge cases
  if (runtimes.length === 0) {
    return { tested: 0, consistent: 0, divergences: [], skipped: "No runtimes enabled" };
  }
  if (runtimes.length === 1) {
    return {
      tested: 0,
      consistent: 0,
      divergences: [],
      skipped: `Only one runtime enabled (${runtimes[0]}) — nothing to compare`
    };
  }

  const commands = options.commands ?? generateTestCommands(permissions);
  const failOnAdvisory = options.failOnAdvisory ?? false;
  const results: AuditResult[] = [];

  for (const command of commands) {
    const coreResult = evaluate(command, permissions);
    const decisions: RuntimeDecision[] = runtimes.map((runtime) => {
      const formatted = formatForRuntime(coreResult, runtime);
      return {
        runtime,
        decision: formatted.decision,
        pattern: formatted.matchedPattern ?? null,
        reason: formatted.reason
      };
    });

    const consistent = isConsistent(decisions, failOnAdvisory);
    const result: AuditResult = { command, decisions, consistent };
    if (!consistent) {
      result.severity = classifySeverity(decisions, failOnAdvisory);
    }
    results.push(result);
  }

  const divergences = results.filter((r) => !r.consistent);
  return {
    tested: results.length,
    consistent: results.length - divergences.length,
    divergences
  };
}

/**
 * Simulate per-runtime evaluation by re-implementing each runtime's matching logic.
 * This catches cases where the adapter's output format would produce different behavior
 * from the core evaluate() function.
 *
 * Currently all adapters use the same globToRegexSource logic, so decisions align.
 * However, this function exists to detect if an adapter's rendering would cause
 * different matching behavior (e.g., a regex compilation issue in Codex's Python hook).
 */
export function evaluateForRuntime(
  command: string,
  permissions: Permissions,
  runtime: string
): RuntimeDecision {
  if (runtime === "codex") {
    // Codex uses regex from globToRegexSource — simulate the Python re.match behavior
    // Python re.match anchors at start but not end; however globToRegexSource adds ^ and $
    // so behavior should match. We still simulate it for correctness.
    for (const pattern of permissions.shell.deny) {
      const regex = new RegExp(globToRegexSource(pattern));
      if (regex.test(command)) {
        return {
          runtime,
          decision: "deny",
          pattern,
          reason: `matches deny regex: ${globToRegexSource(pattern)} in permission-policy.py`
        };
      }
    }
    for (const pattern of permissions.shell.allow) {
      const regex = new RegExp(globToRegexSource(pattern));
      if (regex.test(command)) {
        return {
          runtime,
          decision: "allow",
          pattern,
          reason: `matches allow regex: ${globToRegexSource(pattern)} in permission-policy.py`
        };
      }
    }
    return {
      runtime,
      decision: permissions.shell.default,
      pattern: null,
      reason: `no pattern matched, approval_policy = ${permissions.shell.default === "ask" ? "on-request" : permissions.shell.default}`
    };
  }

  // Claude, Kiro, OpenCode, Cursor all use glob matching (same as core)
  const coreResult = evaluate(command, permissions);
  const formatted = formatForRuntime(coreResult, runtime);
  return {
    runtime,
    decision: formatted.decision,
    pattern: formatted.matchedPattern ?? null,
    reason: formatted.reason
  };
}
