# MCP v1.3 — Superpower Core / Gateway

## Goal

Make Superpower's intelligence layer reusable without requiring the browser extension as the execution host.

The browser extension remains a supported adapter, but routing, context budgeting, execution policy, and telemetry now live in browser-agnostic shared code.

## Architecture

```text
AI client / agent
      |
      v
Superpower McpGateway
  |-- Tool Router
  |-- Context Budget
  |-- Execution Policy
  |-- Privacy-safe Telemetry
      |
      v
MCP Transport Adapter
      |
      v
MCP Server(s)
```

Current browser mode can continue using its existing transport and UI. Native clients can use `McpSdkClientTransport` to wrap an official MCP SDK `Client` without any browser APIs.

## Adapter contract

A transport provides:

- `adapterName`
- `listTools()`
- `callTool(toolName, args)`

The gateway provides:

- deterministic task-focused tool routing
- bounded tool catalog size
- audit or guarded execution policy
- optional confirmation callback for high/critical actions
- privacy-safe session telemetry

## Native SDK adapter

`McpSdkClientTransport` deliberately depends on an SDK-like interface rather than importing `@modelcontextprotocol/sdk`. This keeps Superpower Core independent of a concrete SDK version while remaining directly compatible with the official TypeScript SDK.

Example with a local stdio MCP server:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMcpGatewayFromSdkClient } from '@extension/shared';

const client = new Client({ name: 'superpower-native', version: '1.3.0' });
await client.connect(
  new StdioClientTransport({
    command: 'node',
    args: ['server.js'],
  }),
);

const gateway = createMcpGatewayFromSdkClient(client, {
  taskFocus: 'find and summarize repository issues',
  policyMode: 'guarded',
  confirm: async ({ toolName, policy }) => {
    console.log(`Confirm ${toolName}: ${policy.reasons.join(', ')}`);
    return false;
  },
});

const routed = await gateway.listTools();
console.log(routed.tools.map(tool => tool.name));

await client.close();
```

For Streamable HTTP, connect the SDK `Client` with its `StreamableHTTPClientTransport` and pass the same connected client to Superpower. No gateway code changes are required.

## Migration strategy

1. Keep compatibility re-exports in `pages/content/src/core` so existing browser imports remain stable.
2. Move orchestration work into the shared core.
3. Provide the SDK-like native adapter for browserless clients.
4. Add a first-party CLI/Node host that owns stdio and Streamable HTTP connection configuration.
5. Wire the existing browser bridge through the same `McpGateway` boundary.
6. Once both hosts are stable, package the shared core as a separately versioned `@superpower/mcp-core` workspace package.

This staged migration avoids a large-bang rewrite and keeps the current extension usable throughout v1.3.
