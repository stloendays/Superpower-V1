<div align="center">
  <img src="chrome-extension/public/icon-128.png" alt="Superpower icon" width="112" height="112">
  <h1>Superpower</h1>
  <p>MCP tools for web AI assistants.</p>
</div>

**Version:** 1.0.0 (V1)  
**License:** MIT

## Overview

Superpower is a Chrome extension that connects supported AI web interfaces to Model Context Protocol (MCP) tools through a local MCP proxy. It renders tool calls and tool results directly in the chat workflow so browser-based assistants can work with MCP servers and local tools.

V1 includes the Superpower rebrand, a new black-and-white extension icon, updated tool-call instructions, and ChatGPT attachment handling that can refresh the page after an MCP-injected file is submitted.

## Installation

### Load the V1 build

1. Build the project with the commands below.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the generated `dist` directory.

## MCP proxy

Superpower currently remains compatible with the upstream MCP SuperAssistant proxy package. The package name below is intentionally retained because it is an external dependency:

```bash
npx -y @srbhptl39/mcp-superassistant-proxy@latest --config ./config.json --outputTransport sse
```

Other supported proxy transports can be selected using the proxy CLI options. Keep the proxy bound to a trusted local interface unless you have intentionally configured network access and authentication.

## Development

### Prerequisites

- Node.js
- pnpm
- Chrome or another Chromium-based browser

### Install

```bash
pnpm install
```

### Development build

```bash
pnpm dev
```

### Production build

```bash
pnpm base-build
```

The production extension is written to `dist/`.

## Configuration

Environment-specific values are kept in a local `.env` file. During installation, `scripts/copy-env.mjs` creates `.env` from `.example.env` when needed. Do not commit `.env`, credentials, tokens, private keys, or machine-specific paths. `.env.example` is included as a key-only reference template.

## Security

MCP servers can expose powerful local capabilities. Only connect Superpower to MCP servers you trust, review tool permissions before use, and avoid exposing unauthenticated local proxies to public networks. See `SECURITY.md` for release guidance.

## Upstream and attribution

Superpower V1 is a modified derivative of **MCP SuperAssistant**, originally developed by Saurabh Patel. The original project is available at:

https://github.com/srbhptl39/MCP-SuperAssistant

The upstream project is MIT licensed. The original copyright notice is preserved in `LICENSE`. See `NOTICE.md` for additional attribution.

## License

MIT. See `LICENSE`.
