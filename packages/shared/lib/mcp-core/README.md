# Superpower MCP Core

This directory contains the browser-agnostic orchestration primitives used by Superpower.

The core intentionally has no DOM, Chrome extension, React, Zustand, or concrete transport dependency. It can be reused by the current browser adapter and by future native MCP, CLI, IDE, or agent adapters.

## Pipeline

`task -> router -> context budget -> execution policy -> transport adapter -> telemetry`

`McpGateway` is the adapter boundary. A transport only needs to implement `listTools()` and `callTool()` plus a stable `adapterName`.

`McpSdkClientTransport` is a concrete adapter for the official MCP TypeScript SDK (and compatible clients) without importing the SDK into core. Pass an already-connected SDK `Client` to `createMcpGatewayFromSdkClient()` to use routing, policy, and telemetry without the browser extension.

Guarded execution is opt-in. High/critical actions can require a caller-provided confirmation handler without changing MCP tool schemas.

Telemetry is session-local and value-free: it records tool names, argument keys, timing, status, risk, and result size, but not argument values or result bodies.
