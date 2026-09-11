# Superpower MCP Core

`@superpower/mcp-core` is the browser-agnostic orchestration layer for Superpower.

It contains:

- deterministic task-focused Tool Router
- Context Budget Manager
- execution risk policy (`audit` / `guarded`)
- privacy-safe session telemetry
- transport-neutral `McpGateway`
- SDK-like client adapter

The package deliberately has no Chrome, DOM, React, Zustand, or concrete MCP SDK runtime dependency. Concrete stdio and Streamable HTTP setup lives in `@superpower/mcp-host`.

The original `@extension/shared` surface remains a compatibility layer for the browser extension, but new non-browser code should depend directly on `@superpower/mcp-core`.
