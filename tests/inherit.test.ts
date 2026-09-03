import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyTarget,
  mergeInheritedPermissions,
  denyListWarning,
  validatePolicyYaml,
  resolveExtends,
  isCacheFresh,
  cacheStatus,
  MAX_EXTENDS_DEPTH,
  RemoteFetch
} from "../src/inherit";
import { Permissions } from "../src/permissions";

// --- classifyTarget ---

test("classifyTarget recognizes HTTPS URLs", () => {
  assert.equal(classifyTarget("https://example.com/policy.yaml"), "https");
});

test("classifyTarget rejects insecure HTTP URLs", () => {
  assert.throws(
    () => classifyTarget("http://example.com/policy.yaml"),
    /Only HTTPS URLs are allowed/
  );
});

test("classifyTarget recognizes scoped npm package paths", () => {
  assert.equal(classifyTarget("@myorg/agent-policy/permissions.yaml"), "npm");
});

test("classifyTarget recognizes bare npm package paths", () => {
  assert.equal(classifyTarget("agent-policy/permissions.yaml"), "npm");
});

test("classifyTarget recognizes relative local paths", () => {
  assert.equal(classifyTarget("../shared/.ai/permissions.yaml"), "local");
  assert.equal(classifyTarget("./permissions.yaml"), "local");
});

test("classifyTarget recognizes absolute and home local paths", () => {
  assert.equal(classifyTarget("/etc/policy.yaml"), "local");
  assert.equal(classifyTarget("~/policies/permissions.yaml"), "local");
});

// --- mergeInheritedPermissions ---

const base: Permissions = {
  policy: { precedence: "deny_over_allow" },
  filesystem: { edit: "allow", write: "allow" },
  shell: {
    default: "ask",
    allow: ["git *", "pnpm *", "ls *"],
    deny: ["rm -rf *", "git push *"]
  }
};

test("mergeInheritedPermissions: local deny is added (union)", () => {
  const local: Permissions = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: { default: "ask", allow: [], deny: ["curl *"] }
  };
  const merged = mergeInheritedPermissions(base, local);
  assert.ok(merged.shell.deny.includes("rm -rf *"), "keeps base deny");
  assert.ok(merged.shell.deny.includes("git push *"), "keeps base deny");
  assert.ok(merged.shell.deny.includes("curl *"), "adds local deny");
});

test("mergeInheritedPermissions: local cannot remove an inherited deny", () => {
  // Local omits a base deny; the base deny must still be present.
  const local: Permissions = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: { default: "ask", allow: [], deny: [] }
  };
  const merged = mergeInheritedPermissions(base, local);
  assert.ok(merged.shell.deny.includes("rm -rf *"));
  assert.ok(merged.shell.deny.includes("git push *"));
});

test("mergeInheritedPermissions: local cannot broaden the allow list", () => {
  const local: Permissions = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    // "curl *" is not allowed by the base, so it must be dropped
    shell: { default: "ask", allow: ["git *", "curl *"], deny: [] }
  };
  const merged = mergeInheritedPermissions(base, local);
  assert.ok(merged.shell.allow.includes("git *"), "keeps allow present in base");
  assert.ok(!merged.shell.allow.includes("curl *"), "drops allow absent from base");
});

test("mergeInheritedPermissions: filesystem can only tighten", () => {
  const local: Permissions = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "deny", write: "allow" },
    shell: { default: "ask", allow: [], deny: [] }
  };
  const merged = mergeInheritedPermissions(base, local);
  assert.equal(merged.filesystem.edit, "deny", "local tightens edit to deny");
  assert.equal(merged.filesystem.write, "allow", "write stays allow (neither tightened)");
});

test("mergeInheritedPermissions: local cannot weaken filesystem", () => {
  const strictBase: Permissions = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "deny", write: "deny" },
    shell: { default: "deny", allow: [], deny: [] }
  };
  const local: Permissions = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: { default: "allow", allow: [], deny: [] }
  };
  const merged = mergeInheritedPermissions(strictBase, local);
  assert.equal(merged.filesystem.edit, "deny", "cannot weaken deny to allow");
  assert.equal(merged.filesystem.write, "deny");
  assert.equal(merged.shell.default, "deny", "cannot weaken shell default");
});

test("mergeInheritedPermissions: denied pattern removed from allow", () => {
  const local: Permissions = {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: { default: "ask", allow: ["git *", "pnpm *"], deny: ["git *"] }
  };
  const merged = mergeInheritedPermissions(base, local);
  assert.ok(!merged.shell.allow.includes("git *"), "denied pattern removed from allow");
  assert.ok(merged.shell.deny.includes("git *"));
});

// --- denyListWarning ---

test("denyListWarning: reports added denies", () => {
  const merged = mergeInheritedPermissions(base, {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: { default: "ask", allow: [], deny: ["curl *"] }
  });
  const warning = denyListWarning(base, merged);
  assert.ok(warning, "should produce a warning");
  assert.match(warning!, /curl \*/);
});

test("denyListWarning: no warning when deny list unchanged", () => {
  const merged = mergeInheritedPermissions(base, {
    policy: { precedence: "deny_over_allow" },
    filesystem: { edit: "allow", write: "allow" },
    shell: { default: "ask", allow: ["git *"], deny: [] }
  });
  assert.equal(denyListWarning(base, merged), undefined);
});

// --- validatePolicyYaml ---

const validYaml = `policy:
  precedence: deny_over_allow
filesystem:
  edit: allow
  write: allow
shell:
  default: ask
  allow: []
  deny: []
`;

test("validatePolicyYaml: parses valid permissions", () => {
  const perms = validatePolicyYaml(validYaml, "test");
  assert.equal(perms.shell.default, "ask");
});

test("validatePolicyYaml: rejects invalid YAML", () => {
  assert.throws(() => validatePolicyYaml("foo: [unterminated", "test"), /not valid YAML/);
});

test("validatePolicyYaml: rejects schema violations", () => {
  assert.throws(
    () => validatePolicyYaml("policy:\n  precedence: wrong\n", "test"),
    /failed validation/
  );
});

// --- isCacheFresh ---

test("isCacheFresh: true within TTL", () => {
  const now = 1_000_000;
  const entry = { url: "u", fetchedAt: now - 1000, content: "" };
  assert.equal(isCacheFresh(entry, 5000, now), true);
});

test("isCacheFresh: false past TTL", () => {
  const now = 1_000_000;
  const entry = { url: "u", fetchedAt: now - 10_000, content: "" };
  assert.equal(isCacheFresh(entry, 5000, now), false);
});

// --- resolveExtends: local files ---

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "agentctl-inherit-"));
}

test("resolveExtends: resolves a local base policy", async () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "base.yaml"), validYaml);
    const perms = await resolveExtends("./base.yaml", dir);
    assert.equal(perms.shell.default, "ask");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveExtends: nested local extends resolves recursively", async () => {
  const dir = tmp();
  try {
    writeFileSync(
      join(dir, "org.yaml"),
      `policy:
  precedence: deny_over_allow
filesystem:
  edit: allow
  write: allow
shell:
  default: ask
  allow: ["git *"]
  deny: ["rm -rf *"]
`
    );
    writeFileSync(
      join(dir, "team.yaml"),
      `extends: ./org.yaml
policy:
  precedence: deny_over_allow
filesystem:
  edit: allow
  write: allow
shell:
  default: ask
  allow: ["git *"]
  deny: ["curl *"]
`
    );
    const perms = await resolveExtends("./team.yaml", dir);
    // Union of org + team denies
    assert.ok(perms.shell.deny.includes("rm -rf *"));
    assert.ok(perms.shell.deny.includes("curl *"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveExtends: detects circular extends", async () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "a.yaml"), `extends: ./b.yaml\n${validYaml}`);
    writeFileSync(join(dir, "b.yaml"), `extends: ./a.yaml\n${validYaml}`);
    await assert.rejects(() => resolveExtends("./a.yaml", dir), /Circular extends/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveExtends: caps recursion depth", async () => {
  const dir = tmp();
  try {
    // Chain of MAX+2 files each extending the next.
    const count = MAX_EXTENDS_DEPTH + 2;
    for (let i = 0; i < count; i++) {
      const next = i < count - 1 ? `extends: ./p${i + 1}.yaml\n` : "";
      writeFileSync(join(dir, `p${i}.yaml`), `${next}${validYaml}`);
    }
    await assert.rejects(() => resolveExtends("./p0.yaml", dir), /maximum depth/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveExtends: clear error for missing local file", async () => {
  const dir = tmp();
  try {
    await assert.rejects(() => resolveExtends("./nope.yaml", dir), /file not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveExtends: rejects insecure HTTP", async () => {
  const dir = tmp();
  try {
    await assert.rejects(
      () => resolveExtends("http://example.com/p.yaml", dir),
      /Only HTTPS URLs are allowed/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- resolveExtends: remote with injected fetch + caching ---

test("resolveExtends: fetches remote policy and caches it", async () => {
  const dir = tmp();
  const cacheDir = join(dir, ".cache");
  try {
    let calls = 0;
    const fetchImpl: RemoteFetch = async () => {
      calls++;
      return { status: 200, body: validYaml, etag: '"v1"' };
    };
    const url = "https://example.com/permissions.yaml";
    const perms = await resolveExtends(url, dir, { fetchImpl, cacheDir });
    assert.equal(perms.shell.default, "ask");
    assert.equal(calls, 1);
    // Cache file written
    assert.ok(readdirSync(cacheDir).some((f) => f.endsWith(".json")));

    // Second call within TTL should use cache (no new fetch)
    await resolveExtends(url, dir, { fetchImpl, cacheDir });
    assert.equal(calls, 1, "fresh cache avoids re-fetch");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveExtends: --refresh forces re-fetch", async () => {
  const dir = tmp();
  const cacheDir = join(dir, ".cache");
  try {
    let calls = 0;
    const fetchImpl: RemoteFetch = async () => {
      calls++;
      return { status: 200, body: validYaml, etag: '"v1"' };
    };
    const url = "https://example.com/permissions.yaml";
    await resolveExtends(url, dir, { fetchImpl, cacheDir });
    await resolveExtends(url, dir, { fetchImpl, cacheDir, refresh: true });
    assert.equal(calls, 2, "refresh re-fetches even with a fresh cache");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveExtends: --offline uses cache and never fetches", async () => {
  const dir = tmp();
  const cacheDir = join(dir, ".cache");
  try {
    let calls = 0;
    const fetchImpl: RemoteFetch = async () => {
      calls++;
      return { status: 200, body: validYaml };
    };
    const url = "https://example.com/permissions.yaml";
    // Warm the cache.
    await resolveExtends(url, dir, { fetchImpl, cacheDir });
    // Offline: use cache, no fetch.
    const perms = await resolveExtends(url, dir, { fetchImpl, cacheDir, offline: true });
    assert.equal(perms.shell.default, "ask");
    assert.equal(calls, 1, "offline does not fetch");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveExtends: --offline errors without a cache", async () => {
  const dir = tmp();
  const cacheDir = join(dir, ".cache");
  try {
    const fetchImpl: RemoteFetch = async () => ({ status: 200, body: validYaml });
    await assert.rejects(
      () =>
        resolveExtends("https://example.com/p.yaml", dir, {
          fetchImpl,
          cacheDir,
          offline: true
        }),
      /no cached policy/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveExtends: --no-remote rejects remote targets", async () => {
  const dir = tmp();
  try {
    await assert.rejects(
      () => resolveExtends("https://example.com/p.yaml", dir, { noRemote: true }),
      /Remote fetching disabled/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveExtends: remote policies cannot extend local targets", async () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "local.yaml"), validYaml);
    const fetchImpl: RemoteFetch = async () => ({
      status: 200,
      body: `extends: ./local.yaml\n${validYaml}`
    });

    await assert.rejects(
      () =>
        resolveExtends("https://example.com/policy.yaml", dir, {
          fetchImpl,
          cacheDir: join(dir, ".cache")
        }),
      /cannot extend non-HTTPS target/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveExtends: falls back to cache when network fails", async () => {
  const dir = tmp();
  const cacheDir = join(dir, ".cache");
  try {
    let attempt = 0;
    const fetchImpl: RemoteFetch = async () => {
      attempt++;
      if (attempt === 1) return { status: 200, body: validYaml };
      throw new Error("network down");
    };
    const url = "https://example.com/permissions.yaml";
    const warnings: string[] = [];
    // Warm cache.
    await resolveExtends(url, dir, { fetchImpl, cacheDir });
    // Force refresh so it hits the network (which now fails) → falls back to cache.
    const perms = await resolveExtends(url, dir, {
      fetchImpl,
      cacheDir,
      refresh: true,
      warn: (m) => warnings.push(m)
    });
    assert.equal(perms.shell.default, "ask");
    assert.ok(warnings.some((w) => /using cached policy/.test(w)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveExtends: 304 Not Modified reuses cache", async () => {
  const dir = tmp();
  const cacheDir = join(dir, ".cache");
  try {
    let calls = 0;
    const receivedHeaders: Parameters<RemoteFetch>[1][] = [];
    const fetchImpl: RemoteFetch = async (_url, headers) => {
      calls++;
      receivedHeaders.push(headers);
      if (calls === 1) return { status: 200, body: validYaml, etag: '"v1"' };
      // Second call sends If-None-Match; server responds 304.
      return { status: 304, body: "" };
    };
    const url = "https://example.com/permissions.yaml";
    await resolveExtends(url, dir, { fetchImpl, cacheDir });
    // Force re-validation with a zero TTL so it revalidates.
    const perms = await resolveExtends(url, dir, { fetchImpl, cacheDir, cacheTtlMs: 0 });
    assert.equal(perms.shell.default, "ask");
    assert.equal(calls, 2);
    assert.equal(receivedHeaders[1]?.etag, '"v1"');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveExtends: rejects invalid remote YAML before caching", async () => {
  const dir = tmp();
  const cacheDir = join(dir, ".cache");
  try {
    const fetchImpl: RemoteFetch = async () => ({
      status: 200,
      body: "policy:\n  precedence: bogus\n"
    });
    await assert.rejects(
      () => resolveExtends("https://example.com/p.yaml", dir, { fetchImpl, cacheDir }),
      /failed validation/
    );
    // Nothing should have been cached.
    assert.ok(!existsSync(cacheDir) || readdirSync(cacheDir).length === 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- cacheStatus ---

test("cacheStatus: reports uncached URL", async () => {
  const dir = tmp();
  try {
    const status = await cacheStatus("https://example.com/x.yaml", {
      cacheDir: join(dir, ".cache")
    });
    assert.equal(status.cached, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cacheStatus: reports cached freshness after fetch", async () => {
  const dir = tmp();
  const cacheDir = join(dir, ".cache");
  try {
    const fetchImpl: RemoteFetch = async () => ({ status: 200, body: validYaml });
    const url = "https://example.com/permissions.yaml";
    await resolveExtends(url, dir, { fetchImpl, cacheDir });
    const status = await cacheStatus(url, { cacheDir });
    assert.equal(status.cached, true);
    assert.equal(status.fresh, true);
    assert.equal(typeof status.fetchedAt, "number");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- npm package resolution (local node_modules layout) ---

test("resolveExtends: resolves an npm package policy path", async () => {
  const dir = tmp();
  try {
    const pkgDir = join(dir, "node_modules", "@myorg", "agent-policy");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@myorg/agent-policy" }));
    writeFileSync(join(pkgDir, "permissions.yaml"), validYaml);
    const perms = await resolveExtends("@myorg/agent-policy/permissions.yaml", dir);
    assert.equal(perms.shell.default, "ask");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
