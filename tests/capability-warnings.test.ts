import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import { parsePermissions } from "../src/permissions";
import {
  adapters,
  getAdapter,
  declaredCapabilities,
  unenforceableCapabilityWarnings,
  V2_CAPABILITIES
} from "../src/adapter";

const V1_YAML = `
policy:
  precedence: deny_over_allow
filesystem:
  edit: allow
  write: allow
shell:
  default: ask
  allow: ["pnpm *"]
  deny: ["rm -rf *"]
`;

const V2_FULL_YAML = `
version: 2
policy:
  precedence: deny_over_allow
filesystem:
  read:
    default: allow
    deny: [".env*"]
  write:
    default: allow
    deny: [".git/**"]
shell:
  default: ask
  allow: ["pnpm *"]
  deny: ["rm -rf *"]
network:
  default: ask
  allow: ["https://registry.npmjs.org/*"]
env:
  default: deny
  allow: ["NODE_ENV"]
mcp:
  default: ask
  allow: ["filesystem:*"]
`;

function perms(yaml: string) {
  return parsePermissions(parse(yaml));
}

// --- declaredCapabilities ----------------------------------------------------

test("pure v1 policies declare no v2 capabilities", () => {
  assert.equal(declaredCapabilities(perms(V1_YAML)).size, 0);
});

test("a full v2 policy declares every v2 capability", () => {
  const declared = declaredCapabilities(perms(V2_FULL_YAML));
  for (const capability of V2_CAPABILITIES) {
    assert.ok(declared.has(capability), `expected ${capability} to be declared`);
  }
});

test("a blanket v2 filesystem scalar alone does not declare path-level capabilities", () => {
  // version: 2 but filesystem is expressed as v1 blanket scalars only.
  const yaml = `
version: 2
policy:
  precedence: deny_over_allow
filesystem:
  edit: allow
  write: allow
shell:
  default: ask
network:
  default: ask
`;
  const declared = declaredCapabilities(perms(yaml));
  assert.ok(!declared.has("filesystemRead"));
  assert.ok(!declared.has("filesystemWrite"));
  assert.ok(declared.has("network"));
});

// --- unenforceableCapabilityWarnings -----------------------------------------

test("no warnings for a pure v1 policy on any runtime", () => {
  const runtimes = adapters.map((a) => a.name);
  assert.deepEqual(unenforceableCapabilityWarnings(perms(V1_YAML), runtimes), []);
});

test("claude warns for every declared v2 capability (enforces none)", () => {
  const warnings = unenforceableCapabilityWarnings(perms(V2_FULL_YAML), ["claude"]);
  const caps = warnings.map((w) => w.capability).sort();
  assert.deepEqual(caps, [...V2_CAPABILITIES].sort());
  assert.ok(warnings.every((w) => w.runtime === "claude"));
});

test("codex, cursor, opencode each warn for all declared v2 capabilities", () => {
  for (const runtime of ["codex", "cursor", "opencode"]) {
    const warnings = unenforceableCapabilityWarnings(perms(V2_FULL_YAML), [runtime]);
    assert.equal(
      warnings.length,
      V2_CAPABILITIES.length,
      `${runtime} should warn for all v2 capabilities`
    );
  }
});

test("kiro only warns for env (it enforces the rest)", () => {
  const warnings = unenforceableCapabilityWarnings(perms(V2_FULL_YAML), ["kiro"]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].capability, "env");
  assert.equal(warnings[0].runtime, "kiro");
});

test("no warning when a runtime enforces every declared capability", () => {
  // A v2 policy that only declares capabilities Kiro can enforce.
  const yaml = `
version: 2
policy:
  precedence: deny_over_allow
filesystem:
  read:
    default: allow
  write:
    default: allow
shell:
  default: ask
network:
  default: ask
mcp:
  default: ask
`;
  assert.deepEqual(unenforceableCapabilityWarnings(perms(yaml), ["kiro"]), []);
});

test("warnings are aggregated across multiple enabled runtimes", () => {
  const warnings = unenforceableCapabilityWarnings(perms(V2_FULL_YAML), ["kiro", "claude"]);
  const kiro = warnings.filter((w) => w.runtime === "kiro");
  const claude = warnings.filter((w) => w.runtime === "claude");
  assert.equal(kiro.length, 1);
  assert.equal(claude.length, V2_CAPABILITIES.length);
});

test("unknown runtime names are ignored", () => {
  assert.deepEqual(unenforceableCapabilityWarnings(perms(V2_FULL_YAML), ["nonexistent"]), []);
});

test("warning message names the runtime and the capability label", () => {
  const [warning] = unenforceableCapabilityWarnings(perms(V2_FULL_YAML), ["kiro"]);
  assert.match(warning.message, /^kiro: policy declares environment variable rules/);
  assert.match(warning.message, /the Kiro runtime cannot enforce/);
  assert.match(warning.message, /these rules are not applied\.$/);
});

test("every adapter declares a capabilities set", () => {
  for (const adapter of adapters) {
    assert.ok(adapter.capabilities instanceof Set, `${adapter.name} missing capabilities set`);
  }
  assert.ok(getAdapter("kiro")!.capabilities.has("network"));
  assert.ok(!getAdapter("kiro")!.capabilities.has("env"));
});
