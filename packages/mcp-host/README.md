# Superpower MCP Host

`@superpower/mcp-host` is the first-party browserless runtime for the Superpower MCP Gateway.

It owns concrete MCP SDK connection setup while `@extension/shared` owns browser-agnostic routing, context budgeting, execution policy, and privacy-safe telemetry.

## Development usage

```bash
pnpm -F @superpower/mcp-host start -- connect --http http://localhost:3000/mcp
```

Local stdio server:

```bash
pnpm -F @superpower/mcp-host start -- connect --stdio node --server-arg server.js
```

List only the routed tools:

```bash
pnpm -F @superpower/mcp-host start -- tools --http http://localhost:3000/mcp --focus "find repository issues"
```

Call one tool:

```bash
pnpm -F @superpower/mcp-host start -- call search --args '{"query":"MCP"}' --http http://localhost:3000/mcp
```

## Credentials and secrets

Prefer environment references instead of putting secret values directly in command arguments.

For HTTP:

```bash
export MCP_TOKEN='...'
pnpm -F @superpower/mcp-host start -- connect \
  --http https://example.com/mcp \
  --header-env Authorization=MCP_AUTH_HEADER
```

`MCP_AUTH_HEADER` should contain the complete header value (for example a bearer value). Superpower reads it at runtime and does not retain it in telemetry.

For stdio child processes, use `--server-env NAME=ENV_VAR` to map a host environment variable into the child without printing its value.

## Guarded mode

`--policy guarded` requires confirmation for high/critical actions. In an interactive terminal the CLI prompts before execution. In a non-interactive process, guarded high/critical calls fail closed unless `--yes` was explicitly supplied.

## SDK version boundary

The repository currently uses the v1 monolithic `@modelcontextprotocol/sdk`. The official SDK has moved to a v2 split-package layout. This host intentionally isolates concrete SDK imports so that migration can happen here without changing Superpower Core.
