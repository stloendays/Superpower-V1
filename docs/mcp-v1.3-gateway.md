# MCP v1.3 — Superpower Core / Gateway

## Goal

Make Superpower's intelligence layer reusable without requiring the browser extension as the execution host.

The browser extension remains a supported adapter, but routing, context budgeting, execution policy, and telemetry now live in the independent browser-agnostic `@superpower/mcp-core` workspace package.

## Architecture

```text
AI client / agent
      |
      v
@superpower/mcp-core
  |-- McpGateway
  |-- Tool Router
  |-- Context Budget
  |-- Execution Policy
  |-- Privacy-safe Telemetry
      |
      v
MCP Transport Adapter
      |
      +-- Browser adapter / compatibility facade
      +-- SDK-like client adapter
      +-- @superpower/mcp-host
      |
      v
MCP Server(s)
```

Current browser mode can continue using its existing transport and UI. Native clients can use `McpSdkClientTransport`, while users who do not want to write SDK setup code can use the first-party `@superpower/mcp-host` CLI.

## Package boundaries

### `@superpower/mcp-core`

The canonical orchestration package. It has no Chrome, DOM, React, Zustand, or concrete MCP SDK runtime dependency.

It provides:

- deterministic task-focused tool routing
- bounded context configuration
- audit or guarded execution policy
- optional confirmation callbacks for high/critical actions
- privacy-safe session telemetry
- transport-neutral `McpGateway`
- SDK-like client adapter

### `@superpower/mcp-host`

The first-party Node/CLI runtime. It owns concrete MCP SDK imports and stdio / Streamable HTTP connection configuration.

### `@extension/shared`

The browser extension compatibility facade. Existing imports remain stable while the implementation is delegated to `@superpower/mcp-core`.

## Adapter contract

A transport provides:

- `adapterName`
- `listTools()`
- `callTool(toolName, args)`

The gateway provides routing, policy, budgeting configuration, and telemetry independently of the transport.

## Native SDK adapter

`McpSdkClientTransport` depends on an SDK-like interface rather than importing `@modelcontextprotocol/sdk`. This keeps `@superpower/mcp-core` independent of a concrete SDK version while remaining compatible with the official TypeScript SDK.

## First-party Node / CLI host

Development examples:

```bash
pnpm -F @superpower/mcp-host start -- connect --http http://localhost:3000/mcp --focus "find files"

pnpm -F @superpower/mcp-host start -- connect --stdio node --server-arg server.js
```

The `connect` command opens a small interactive shell in a TTY with `tools`, `focus`, `policy`, `call`, and `stats` commands. `tools` and `call` also work as one-shot commands, and `--json` provides machine-readable output.

High/critical actions fail closed in guarded non-interactive mode unless the caller explicitly supplies `--yes`. HTTP headers and child-process secrets can be mapped from environment variables with `--header-env` and `--server-env`; telemetry retains keys/timings only, not secret values or result bodies.

## SDK version boundary

The repository deliberately stays on its existing v1 `@modelcontextprotocol/sdk` dependency during this refactor. Concrete SDK imports are isolated in `packages/mcp-host`; the core itself is SDK-neutral. A later SDK v2 migration therefore changes the host boundary rather than the router/policy/telemetry implementation.

## Migration status

1. Keep compatibility re-exports in `pages/content/src/core` so existing browser imports remain stable. **Done.**
2. Move orchestration work out of browser-specific code. **Done.**
3. Provide the SDK-like native adapter for browserless clients. **Done.**
4. Add a first-party CLI/Node host for stdio and Streamable HTTP. **Done.**
5. Package the canonical orchestration layer as `@superpower/mcp-core`. **Done.**
6. Wire the existing browser bridge through the same `McpGateway` boundary.
7. Add result compression and read-only caching at the core gateway boundary.

This staged migration avoids a large-bang rewrite and keeps the current extension usable throughout v1.3.
