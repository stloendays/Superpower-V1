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

Current browser mode can continue using its existing transport and UI. Future adapters can implement the small `McpGatewayTransport` interface instead of duplicating orchestration logic.

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

## Migration strategy

1. Keep compatibility re-exports in `pages/content/src/core` so existing browser imports remain stable.
2. Move new orchestration work into the shared core first.
3. Add a browser transport adapter backed by the current extension bridge.
4. Add a native Node/stdio or streamable-HTTP adapter using the same gateway.
5. Once both adapters are stable, package the shared core as a separately versioned `@superpower/mcp-core` workspace package.

This staged migration avoids a large-bang rewrite and keeps the current extension usable throughout v1.3.
