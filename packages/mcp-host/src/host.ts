import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  createMcpGatewayFromSdkClient,
  type ExecutionPolicyMode,
  type McpGateway,
  type McpGatewayConfirmationHandler,
  type SdkRoutableTool,
} from '@extension/shared';

export interface StdioHostConnection {
  kind: 'stdio';
  command: string;
  args?: string[];
  /** Child-process environment key -> current host environment variable name. */
  envFrom?: Record<string, string>;
}

export interface HttpHostConnection {
  kind: 'http';
  url: string;
  /** HTTP header name -> current host environment variable name. */
  headerFrom?: Record<string, string>;
}

export type HostConnection = StdioHostConnection | HttpHostConnection;

export interface SuperpowerHostOptions {
  connection: HostConnection;
  taskFocus?: string;
  policyMode?: ExecutionPolicyMode;
  confirm?: McpGatewayConfirmationHandler;
  clientName?: string;
  clientVersion?: string;
}

export interface ConnectedSuperpowerHost {
  client: Client;
  gateway: McpGateway<SdkRoutableTool>;
  transportKind: HostConnection['kind'];
  close(): Promise<void>;
}

const readEnvironmentReferences = (references: Record<string, string> = {}): Record<string, string> => {
  const resolved: Record<string, string> = {};

  Object.entries(references).forEach(([targetName, sourceName]) => {
    const value = process.env[sourceName];
    if (value === undefined) {
      throw new Error(`Required environment variable is not set: ${sourceName}`);
    }
    resolved[targetName] = value;
  });

  return resolved;
};

const inheritedEnvironment = (): Record<string, string> => {
  const environment: Record<string, string> = {};
  Object.entries(process.env).forEach(([key, value]) => {
    if (value !== undefined) environment[key] = value;
  });
  return environment;
};

/**
 * First-party browserless host for Superpower's MCP gateway.
 *
 * This package owns concrete MCP SDK connection setup while `@extension/shared`
 * remains SDK- and browser-agnostic. The split keeps future SDK v2 migration local
 * to this host package rather than coupling it to routing/policy/telemetry code.
 */
export const connectSuperpowerHost = async (options: SuperpowerHostOptions): Promise<ConnectedSuperpowerHost> => {
  const client = new Client({
    name: options.clientName ?? 'superpower-mcp-host',
    version: options.clientVersion ?? '1.3.0',
  });

  const connection = options.connection;
  const transport =
    connection.kind === 'stdio'
      ? new StdioClientTransport({
          command: connection.command,
          args: connection.args ?? [],
          ...(connection.envFrom && Object.keys(connection.envFrom).length > 0
            ? {
                env: {
                  ...inheritedEnvironment(),
                  ...readEnvironmentReferences(connection.envFrom),
                },
              }
            : {}),
        })
      : new StreamableHTTPClientTransport(new URL(connection.url), {
          ...(connection.headerFrom && Object.keys(connection.headerFrom).length > 0
            ? {
                requestInit: {
                  headers: readEnvironmentReferences(connection.headerFrom),
                },
              }
            : {}),
        });

  try {
    await client.connect(transport);
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }

  const gateway = createMcpGatewayFromSdkClient(
    client,
    {
      taskFocus: options.taskFocus,
      policyMode: options.policyMode,
      confirm: options.confirm,
    },
    `mcp-${connection.kind}`,
  );

  return {
    client,
    gateway,
    transportKind: connection.kind,
    close: async () => client.close(),
  };
};
