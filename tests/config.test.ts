import test from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../src/config";

const full = {
  project: { name: "test-project" },
  runtimes: {
    claude: { enabled: true },
    codex: { enabled: false },
    kiro: { enabled: true },
    opencode: { enabled: false }
  },
  sync: { permissions: true },
  files: { permissions: ".ai/permissions.yaml" }
};

test("parseConfig accepts a full config with all runtimes declared", () => {
  const config = parseConfig(full);
  assert.equal(config.runtimes.claude.enabled, true);
  assert.equal(config.runtimes.codex.enabled, false);
  assert.equal(config.runtimes.kiro.enabled, true);
  assert.equal(config.runtimes.opencode.enabled, false);
});

test("parseConfig defaults missing runtimes to disabled", () => {
  const minimal = {
    project: { name: "only-kiro" },
    runtimes: {
      kiro: { enabled: true }
    },
    sync: { permissions: true },
    files: { permissions: ".ai/permissions.yaml" }
  };
  const config = parseConfig(minimal);
  assert.equal(config.runtimes.kiro.enabled, true);
  assert.equal(config.runtimes.claude.enabled, false);
  assert.equal(config.runtimes.codex.enabled, false);
  assert.equal(config.runtimes.opencode.enabled, false);
});

test("parseConfig defaults all runtimes to disabled when runtimes key is omitted", () => {
  const noRuntimes = {
    project: { name: "no-runtimes" },
    sync: { permissions: true },
    files: { permissions: ".ai/permissions.yaml" }
  };
  const config = parseConfig(noRuntimes);
  assert.equal(config.runtimes.claude.enabled, false);
  assert.equal(config.runtimes.codex.enabled, false);
  assert.equal(config.runtimes.kiro.enabled, false);
  assert.equal(config.runtimes.opencode.enabled, false);
});

test("parseConfig still requires project, sync, and files", () => {
  assert.throws(() => parseConfig({}), /project must be an object/);
  assert.throws(
    () => parseConfig({ project: { name: "x" }, sync: { permissions: true } }),
    /files must be an object/
  );
});

test("parseConfig rejects invalid runtime value", () => {
  const bad = {
    project: { name: "bad" },
    runtimes: { kiro: { enabled: "yes" } },
    sync: { permissions: true },
    files: { permissions: ".ai/permissions.yaml" }
  };
  assert.throws(() => parseConfig(bad), /runtimes\.kiro\.enabled must be a boolean/);
});

test("parseConfig uses claude defaults when claude section is omitted", () => {
  const config = parseConfig(full);
  assert.equal(config.claude.alwaysThinkingEnabled, true);
  assert.equal(config.claude.cleanupPeriodDays, 90);
  assert.equal(config.claude.disableTelemetry, true);
});

test("parseConfig parses custom claude settings", () => {
  const custom = {
    ...full,
    claude: {
      alwaysThinkingEnabled: false,
      cleanupPeriodDays: 7,
      disableTelemetry: false
    }
  };
  const config = parseConfig(custom);
  assert.equal(config.claude.alwaysThinkingEnabled, false);
  assert.equal(config.claude.cleanupPeriodDays, 7);
  assert.equal(config.claude.disableTelemetry, false);
});

test("parseConfig uses defaults for omitted claude sub-fields", () => {
  const partial = {
    ...full,
    claude: { cleanupPeriodDays: 14 }
  };
  const config = parseConfig(partial);
  assert.equal(config.claude.cleanupPeriodDays, 14);
  assert.equal(config.claude.alwaysThinkingEnabled, true); // default
  assert.equal(config.claude.disableTelemetry, true); // default
});

test("parseConfig rejects invalid claude field types", () => {
  assert.throws(
    () => parseConfig({ ...full, claude: { cleanupPeriodDays: "thirty" } }),
    /claude\.cleanupPeriodDays must be a number/
  );
  assert.throws(
    () => parseConfig({ ...full, claude: { alwaysThinkingEnabled: "yes" } }),
    /claude\.alwaysThinkingEnabled must be a boolean/
  );
});
