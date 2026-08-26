import { Permissions, globToRegexSource } from "./permissions";

export type Decision = "allow" | "deny" | "ask";

export interface ExplainResult {
  runtime: string;
  decision: Decision;
  reason: string;
  matchedPattern?: string;
  matchedList?: "allow" | "deny" | "default";
}

/**
 * Evaluate a command against permissions using deny_over_allow semantics:
 * 1. Check deny patterns first — if any match, decision is DENY
 * 2. Check allow patterns — if any match, decision is ALLOW
 * 3. Fall through to shell.default
 */
export function evaluate(command: string, permissions: Permissions): ExplainResult {
  // Check deny first (deny_over_allow)
  for (const pattern of permissions.shell.deny) {
    const regex = new RegExp(globToRegexSource(pattern));
    if (regex.test(command)) {
      return {
        runtime: "core",
        decision: "deny",
        reason: `matches deny pattern: "${pattern}"`,
        matchedPattern: pattern,
        matchedList: "deny"
      };
    }
  }
  // Check allow
  for (const pattern of permissions.shell.allow) {
    const regex = new RegExp(globToRegexSource(pattern));
    if (regex.test(command)) {
      return {
        runtime: "core",
        decision: "allow",
        reason: `matches allow pattern: "${pattern}"`,
        matchedPattern: pattern,
        matchedList: "allow"
      };
    }
  }
  // Default
  return {
    runtime: "core",
    decision: permissions.shell.default,
    reason: `no pattern matched, shell.default = ${permissions.shell.default}`,
    matchedList: "default"
  };
}

/** Runtime-specific vocabulary for formatting explain results. */
const runtimeVocabulary: Record<
  string,
  {
    denyReason: (pattern: string) => string;
    allowReason: (pattern: string) => string;
    defaultReason: (defaultValue: string) => string;
  }
> = {
  claude: {
    denyReason: (p) => `matches deny pattern: "Bash(${p})"`,
    allowReason: (p) => `matches allow pattern: "Bash(${p})"`,
    defaultReason: (d) => `no pattern matched, shell.default = ${d}`
  },
  codex: {
    denyReason: (p) => `matches deny regex: ${globToRegexSource(p)} in permission-policy.py`,
    allowReason: (p) => `matches allow regex: ${globToRegexSource(p)} in permission-policy.py`,
    defaultReason: (d) => `no pattern matched, approval_policy = ${d === "ask" ? "on-request" : d}`
  },
  cursor: {
    denyReason: (p) => `rule instructs: denied pattern "${p}"`,
    allowReason: (p) => `rule instructs: allowed pattern "${p}"`,
    defaultReason: (d) => `no pattern matched, default policy = ${d}`
  },
  kiro: {
    denyReason: (p) => `matches deny rule: shell deny ["${p}"]`,
    allowReason: (p) => `matches allow rule: shell allow ["${p}"]`,
    defaultReason: (d) => `no pattern matched, shell default = ${d}`
  },
  opencode: {
    denyReason: (p) => `matches deny key: "${p}" → deny`,
    allowReason: (p) => `matches allow key: "${p}" → allow`,
    defaultReason: (d) => `no pattern matched, bash["*"] = ${d}`
  }
};

/**
 * Format the core evaluation result into a per-runtime explanation.
 */
export function formatForRuntime(result: ExplainResult, runtime: string): ExplainResult {
  const vocab = runtimeVocabulary[runtime];
  if (!vocab) return { ...result, runtime };

  let reason: string;
  if (result.matchedList === "deny" && result.matchedPattern) {
    reason = vocab.denyReason(result.matchedPattern);
  } else if (result.matchedList === "allow" && result.matchedPattern) {
    reason = vocab.allowReason(result.matchedPattern);
  } else {
    reason = vocab.defaultReason(result.decision);
  }

  return {
    runtime,
    decision: result.decision,
    reason,
    matchedPattern: result.matchedPattern,
    matchedList: result.matchedList
  };
}
