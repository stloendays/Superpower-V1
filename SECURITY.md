# Security

Superpower can invoke MCP tools that may access local files, processes, shells, networks, or other privileged resources depending on the connected MCP server.

## Recommended deployment

- Connect only to MCP servers you trust.
- Prefer loopback or another explicitly trusted interface for local proxy services.
- Do not expose an unauthenticated MCP proxy directly to the public Internet.
- Review MCP server permissions and tool capabilities before enabling automatic execution.
- Keep credentials, tokens, private keys, `.env` files, and machine-specific configuration out of Git.
- Disable or remove MCP servers that are no longer needed.

## Reporting

For security-sensitive reports, avoid posting credentials or exploit details in a public issue. Use a private contact channel associated with the repository owner once one is configured.
