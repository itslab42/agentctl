import test from "node:test";
import assert from "node:assert/strict";
import { parseMcpConfig } from "../src/mcp";
import { renderCursorMcp } from "../src/adapters/cursor";
import { renderKiroMcp } from "../src/adapters/kiro";
import { renderClaude } from "../src/adapters/claude";
import { Permissions } from "../src/permissions";
import { McpConfig } from "../src/mcp";

// --- Parsing tests ---

const validStdio = {
  servers: {
    filesystem: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }
};

const validHttp = {
  servers: {
    "my-api": {
      transport: "streamable-http",
      url: "http://localhost:3001/mcp"
    }
  }
};

const validMixed = {
  servers: {
    filesystem: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    github: {
      transport: "stdio",
      command: "docker",
      args: [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" }
    },
    "my-api": {
      transport: "streamable-http",
      url: "http://localhost:3001/mcp"
    }
  }
};

test("parseMcpConfig accepts a valid stdio server", () => {
  const config = parseMcpConfig(validStdio);
  assert.equal(Object.keys(config.servers).length, 1);
  assert.equal(config.servers.filesystem.transport, "stdio");
  assert.equal(config.servers.filesystem.command, "npx");
  assert.deepEqual(config.servers.filesystem.args, [
    "-y",
    "@modelcontextprotocol/server-filesystem",
    "/tmp"
  ]);
});

test("parseMcpConfig accepts a valid streamable-http server", () => {
  const config = parseMcpConfig(validHttp);
  assert.equal(config.servers["my-api"].transport, "streamable-http");
  assert.equal(config.servers["my-api"].url, "http://localhost:3001/mcp");
});

test("parseMcpConfig accepts mixed transports", () => {
  const config = parseMcpConfig(validMixed);
  assert.equal(Object.keys(config.servers).length, 3);
  assert.equal(config.servers.filesystem.transport, "stdio");
  assert.equal(config.servers.github.transport, "stdio");
  assert.equal(config.servers["my-api"].transport, "streamable-http");
});

test("parseMcpConfig parses env for stdio servers", () => {
  const config = parseMcpConfig(validMixed);
  assert.deepEqual(config.servers.github.env, { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" });
});

test("parseMcpConfig accepts stdio without args", () => {
  const config = parseMcpConfig({
    servers: { simple: { transport: "stdio", command: "my-server" } }
  });
  assert.equal(config.servers.simple.command, "my-server");
  assert.equal(config.servers.simple.args, undefined);
});

// --- Validation error tests ---

test("parseMcpConfig rejects missing servers key", () => {
  assert.throws(() => parseMcpConfig({}), /must have a servers key/);
});

test("parseMcpConfig rejects empty servers object", () => {
  assert.throws(() => parseMcpConfig({ servers: {} }), /must contain at least one server/);
});

test("parseMcpConfig rejects non-object root", () => {
  assert.throws(() => parseMcpConfig(null), /must be an object/);
  assert.throws(() => parseMcpConfig("string"), /must be an object/);
});

test("parseMcpConfig rejects invalid transport", () => {
  assert.throws(
    () => parseMcpConfig({ servers: { bad: { transport: "sse" } } }),
    /servers\.bad\.transport must be one of/
  );
});

test("parseMcpConfig rejects stdio without command", () => {
  assert.throws(
    () => parseMcpConfig({ servers: { bad: { transport: "stdio" } } }),
    /servers\.bad\.command is required for stdio/
  );
});

test("parseMcpConfig rejects streamable-http without url", () => {
  assert.throws(
    () => parseMcpConfig({ servers: { bad: { transport: "streamable-http" } } }),
    /servers\.bad\.url is required for streamable-http/
  );
});

test("parseMcpConfig rejects url on stdio server", () => {
  assert.throws(
    () =>
      parseMcpConfig({ servers: { bad: { transport: "stdio", command: "x", url: "http://a" } } }),
    /servers\.bad\.url is not allowed for stdio/
  );
});

test("parseMcpConfig rejects command on streamable-http server", () => {
  assert.throws(
    () =>
      parseMcpConfig({
        servers: { bad: { transport: "streamable-http", url: "http://a", command: "x" } }
      }),
    /servers\.bad\.command is not allowed for streamable-http/
  );
});

test("parseMcpConfig rejects args on streamable-http server", () => {
  assert.throws(
    () =>
      parseMcpConfig({
        servers: { bad: { transport: "streamable-http", url: "http://a", args: ["x"] } }
      }),
    /servers\.bad\.args is not allowed for streamable-http/
  );
});

test("parseMcpConfig rejects non-string env values", () => {
  assert.throws(
    () =>
      parseMcpConfig({ servers: { bad: { transport: "stdio", command: "x", env: { KEY: 123 } } } }),
    /servers\.bad\.env\.KEY must be a string/
  );
});

test("parseMcpConfig rejects non-array args", () => {
  assert.throws(
    () =>
      parseMcpConfig({ servers: { bad: { transport: "stdio", command: "x", args: "not-array" } } }),
    /servers\.bad\.args must be an array of strings/
  );
});

// --- Adapter render tests ---

const mcpConfig: McpConfig = parseMcpConfig(validMixed);

const permissions: Permissions = {
  policy: { precedence: "deny_over_allow" },
  filesystem: { edit: "allow", write: "allow" },
  shell: { default: "ask", allow: ["git *"], deny: ["git push *"] }
};

test("renderCursorMcp produces valid JSON with mcpServers key", () => {
  const output = renderCursorMcp(mcpConfig);
  const parsed = JSON.parse(output);
  assert.ok(parsed.mcpServers, "must have mcpServers key");
  assert.equal(Object.keys(parsed.mcpServers).length, 3);
});

test("renderCursorMcp renders stdio server correctly", () => {
  const parsed = JSON.parse(renderCursorMcp(mcpConfig));
  const fs = parsed.mcpServers.filesystem;
  assert.equal(fs.command, "npx");
  assert.deepEqual(fs.args, ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]);
  assert.equal(fs.url, undefined);
});

test("renderCursorMcp renders streamable-http server with url only", () => {
  const parsed = JSON.parse(renderCursorMcp(mcpConfig));
  const api = parsed.mcpServers["my-api"];
  assert.equal(api.url, "http://localhost:3001/mcp");
  assert.equal(api.command, undefined);
  assert.equal(api.args, undefined);
});

test("renderCursorMcp includes env when present", () => {
  const parsed = JSON.parse(renderCursorMcp(mcpConfig));
  assert.deepEqual(parsed.mcpServers.github.env, {
    GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
  });
});

test("renderCursorMcp omits env when not present", () => {
  const parsed = JSON.parse(renderCursorMcp(mcpConfig));
  assert.equal(parsed.mcpServers.filesystem.env, undefined);
});

test("renderKiroMcp produces same format as renderCursorMcp", () => {
  const cursorOutput = JSON.parse(renderCursorMcp(mcpConfig));
  const kiroOutput = JSON.parse(renderKiroMcp(mcpConfig));
  assert.deepEqual(cursorOutput, kiroOutput);
});

test("renderKiroMcp output is deterministic", () => {
  assert.equal(renderKiroMcp(mcpConfig), renderKiroMcp(mcpConfig));
});

test("renderCursorMcp output is deterministic", () => {
  assert.equal(renderCursorMcp(mcpConfig), renderCursorMcp(mcpConfig));
});

test("renderClaude includes mcpServers when mcp config is provided", () => {
  const output = renderClaude(permissions, undefined, mcpConfig);
  const parsed = JSON.parse(output);
  assert.ok(parsed.mcpServers, "must include mcpServers");
  assert.equal(Object.keys(parsed.mcpServers).length, 3);
  assert.equal(parsed.mcpServers.filesystem.command, "npx");
  assert.equal(parsed.mcpServers["my-api"].url, "http://localhost:3001/mcp");
});

test("renderClaude omits mcpServers when mcp config is undefined", () => {
  const output = renderClaude(permissions);
  const parsed = JSON.parse(output);
  assert.equal(parsed.mcpServers, undefined);
});

test("renderClaude mcpServers includes env when present", () => {
  const parsed = JSON.parse(renderClaude(permissions, undefined, mcpConfig));
  assert.deepEqual(parsed.mcpServers.github.env, {
    GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
  });
});

test("renderCursorMcp omits args when empty array", () => {
  const config: McpConfig = {
    servers: {
      simple: { transport: "stdio", command: "my-server", args: [] }
    }
  };
  const parsed = JSON.parse(renderCursorMcp(config));
  assert.equal(parsed.mcpServers.simple.args, undefined);
});

test("renderKiroMcp omits args when empty array", () => {
  const config: McpConfig = {
    servers: {
      simple: { transport: "stdio", command: "my-server", args: [] }
    }
  };
  const parsed = JSON.parse(renderKiroMcp(config));
  assert.equal(parsed.mcpServers.simple.args, undefined);
});
