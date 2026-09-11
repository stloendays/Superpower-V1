# MCP Core compatibility facade

The canonical browser-agnostic implementation now lives in the independent `@superpower/mcp-core` workspace package at `packages/mcp-core`.

`@extension/shared` re-exports that package from this directory so existing browser-extension imports keep working during the v1.3 migration. New browserless code should depend on `@superpower/mcp-core` directly rather than this compatibility path.

The canonical pipeline is:

`task -> router -> context budget -> execution policy -> transport adapter -> telemetry`
