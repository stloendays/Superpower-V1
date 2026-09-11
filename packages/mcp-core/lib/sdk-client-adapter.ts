import { McpGateway, type McpGatewayOptions, type McpGatewayTransport } from './gateway.js';
import type { RoutableTool } from './tool-router.js';

export interface McpSdkTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  input_schema?: unknown;
}

export interface McpSdkLikeClient {
  listTools(): Promise<{ tools: McpSdkTool[] }>;
  callTool(request: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
  close?(): Promise<void>;
}

export interface SdkRoutableTool extends RoutableTool {
  inputSchema?: unknown;
}

const serializeSchema = (schema: unknown): string => {
  if (!schema) return '{}';
  if (typeof schema === 'string') return schema;

  try {
    return JSON.stringify(schema);
  } catch {
    return '{}';
  }
};

/**
 * Adapter for the official MCP TypeScript SDK and other clients exposing the same
 * `listTools()` / `callTool()` surface. No SDK package is imported here, which keeps
 * Superpower Core transport-neutral and usable outside the browser extension.
 */
export class McpSdkClientTransport implements McpGatewayTransport<SdkRoutableTool> {
  constructor(
    private readonly client: McpSdkLikeClient,
    public readonly adapterName = 'mcp-sdk',
  ) {}

  async listTools(): Promise<SdkRoutableTool[]> {
    const response = await this.client.listTools();
    const tools = Array.isArray(response?.tools) ? response.tools : [];

    return tools
      .filter(tool => tool && typeof tool.name === 'string' && tool.name.length > 0)
      .map(tool => {
        const inputSchema = tool.inputSchema ?? tool.input_schema ?? {};
        return {
          name: tool.name,
          description: tool.description ?? '',
          inputSchema,
          schema: serializeSchema(inputSchema),
        };
      });
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    return this.client.callTool({ name: toolName, arguments: args });
  }

  async close(): Promise<void> {
    if (this.client.close) await this.client.close();
  }
}

export const createMcpGatewayFromSdkClient = (
  client: McpSdkLikeClient,
  options: McpGatewayOptions = {},
  adapterName = 'mcp-sdk',
): McpGateway<SdkRoutableTool> => new McpGateway(new McpSdkClientTransport(client, adapterName), options);
