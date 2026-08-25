# Superpower Release Installation Guide

## Quick Installation

1. Download the latest Superpower release package.
2. Extract the ZIP file.
3. Double click:

```
Install-Superpower.cmd
```

4. Wait for the installer to prepare the extension.
5. Open Chrome:

```
chrome://extensions/
```

6. Enable Developer mode.
7. Select `Load unpacked`.
8. Choose the generated `dist` folder.

## MCP Connection

Superpower connects to MCP servers through the configured proxy.

Default local endpoint:

```
http://localhost:3006/sse
```

## Developer Installation

For source development:

```bash
pnpm install
pnpm build
```

The generated extension is located in:

```
dist/
```
