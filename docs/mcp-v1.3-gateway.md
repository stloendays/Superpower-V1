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
      +-- Browser adapter
      +-- SDK-like client adapter
      +-- First-party Node/CLI host
      |
      v
MCP Server(s)
```

Current browser mode can continue using its existing transport and UI. Native clients can use `McpSdkClientTransport`, while users who do not want to write SDK setup code can use the first-party `@superpower/mcp-host` CLI.

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

## First-party Node / CLI host

`packages/mcp-host` now owns concrete stdio and Streamable HTTP setup. This is the first browserless end-user path in the repository.

Development examples:

```bash
pnpm -F @superpower/mcp-host start -- connect --http http://localhost:3000/mcp --focus "find files"

pnpm -F @superpower/mcp-host start -- connect --stdio node --server-arg server.js
```

The `connect` command opens a small interactive shell in a TTY with `tools`, `focus`, `policy`, `call`, and `stats` commands. `tools` and `call` also work as one-shot commands, and `--json` provides machine-readable output.

High/critical actions fail closed in guarded non-interactive mode unless the caller explicitly supplies `--yes`. HTTP headers and child-process secrets can be mapped from environment variables with `--header-env` and `--server-env`; telemetry retains keys/timings only, not secret values or result bodies.

## SDK version boundary

The repository is deliberately staying on its existing v1 `@modelcontextprotocol/sdk` dependency during this refactor. The official TypeScript SDK now has a v2 split-package layout. Concrete SDK imports are isolated in `packages/mcp-host`, while the shared gateway uses only the SDK-like adapter contract. A later SDK v2 migration therefore changes the host boundary rather than the router/policy/telemetry implementation.

## Migration strategy

1. Keep compatibility re-exports in `pages/content/src/core` so existing browser imports remain stable. **Done.**
2. Move orchestration work into the shared core. **Done.**
3. Provide the SDK-like native adapter for browserless clients. **Done.**
4. Add a first-party CLI/Node host that owns stdio and Streamable HTTP connection configuration. **Done.**
5. Wire the existing browser bridge through the same `McpGateway` boundary.
6. Add result compression and read-only caching at the shared gateway boundary.
7. Once both hosts are stable, package the shared core as a separately versioned `@superpower/mcp-core` workspace package.

This staged migration avoids a large-bang rewrite and keeps the current extension usable throughout v1.3.
