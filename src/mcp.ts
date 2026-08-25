export type McpTransport = "stdio" | "streamable-http";

export interface McpServer {
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface McpConfig {
  servers: Record<string, McpServer>;
}

const transports = new Set<McpTransport>(["stdio", "streamable-http"]);

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value as string[];
}

function parseServer(raw: unknown, name: string): McpServer {
  const obj = asObject(raw, `servers.${name}`);
  const transport = obj.transport;
  if (typeof transport !== "string" || !transports.has(transport as McpTransport)) {
    throw new Error(`servers.${name}.transport must be one of: stdio, streamable-http`);
  }

  const server: McpServer = { transport: transport as McpTransport };

  if (transport === "stdio") {
    if (typeof obj.command !== "string" || obj.command.length === 0) {
      throw new Error(`servers.${name}.command is required for stdio transport`);
    }
    server.command = obj.command;
    if (obj.args !== undefined) {
      server.args = stringArray(obj.args, `servers.${name}.args`);
    }
    if (obj.url !== undefined) {
      throw new Error(`servers.${name}.url is not allowed for stdio transport`);
    }
  } else {
    // streamable-http
    if (typeof obj.url !== "string" || obj.url.length === 0) {
      throw new Error(`servers.${name}.url is required for streamable-http transport`);
    }
    server.url = obj.url;
    if (obj.command !== undefined) {
      throw new Error(`servers.${name}.command is not allowed for streamable-http transport`);
    }
    if (obj.args !== undefined) {
      throw new Error(`servers.${name}.args is not allowed for streamable-http transport`);
    }
  }

  if (obj.env !== undefined) {
    const envObj = asObject(obj.env, `servers.${name}.env`);
    const env: Record<string, string> = {};
    for (const [key, val] of Object.entries(envObj)) {
      if (typeof val !== "string") {
        throw new Error(`servers.${name}.env.${key} must be a string`);
      }
      env[key] = val;
    }
    server.env = env;
  }

  return server;
}

/** Validates and parses .ai/mcp.yaml content. */
export function parseMcpConfig(raw: unknown): McpConfig {
  const root = asObject(raw, "mcp config");
  const serversRaw = root.servers;
  if (serversRaw === undefined) {
    throw new Error("mcp config must have a servers key");
  }
  const serversObj = asObject(serversRaw, "servers");
  const servers: Record<string, McpServer> = {};
  for (const [name, value] of Object.entries(serversObj)) {
    servers[name] = parseServer(value, name);
  }
  if (Object.keys(servers).length === 0) {
    throw new Error("servers must contain at least one server");
  }
  return { servers };
}
