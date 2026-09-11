import type { ConnectionType } from '../../../types/stores';
import { inferConnectionType } from './connection-input';

export type ConnectionIssueKind =
  | 'auth'
  | 'cors'
  | 'not-found'
  | 'unreachable'
  | 'timeout'
  | 'tls'
  | 'transport'
  | 'unknown';

export interface ConnectionDiagnosis {
  kind: ConnectionIssueKind;
  message: string;
  action: string;
  suggestedConnectionType?: ConnectionType;
  canAutoRepair: boolean;
}

const alternateHttpTransport = (currentType: ConnectionType): ConnectionType | undefined => {
  if (currentType === 'streamable-http') return 'sse';
  if (currentType === 'sse') return 'streamable-http';
  return undefined;
};

export const diagnoseConnectionError = (
  rawError: string,
  uri: string,
  currentType: ConnectionType,
): ConnectionDiagnosis => {
  const error = rawError.trim();
  const normalized = error.toLowerCase();

  if (/\b401\b|unauthori[sz]ed|authentication required|invalid (?:api )?token|invalid credentials/.test(normalized)) {
    return {
      kind: 'auth',
      message: 'This MCP server requires authentication.',
      action: 'Use the server’s authenticated setup flow or add credentials through a guarded connection method.',
      canAutoRepair: false,
    };
  }

  if (/\b403\b|forbidden|permission denied|access denied/.test(normalized)) {
    return {
      kind: 'auth',
      message: 'The MCP server refused access.',
      action: 'Check the account, token scopes, or server permissions.',
      canAutoRepair: false,
    };
  }

  if (/cors|access-control-allow-origin|cross-origin|blocked by.*origin/.test(normalized)) {
    return {
      kind: 'cors',
      message: 'The server is reachable, but the browser is blocking this cross-origin connection.',
      action: 'Enable CORS on the MCP server or connect it through Superpower Host / a browser-accessible proxy.',
      canAutoRepair: false,
    };
  }

  if (/certificate|cert_|ssl|tls|mixed content|insecure content/.test(normalized)) {
    return {
      kind: 'tls',
      message: 'The browser rejected the server’s secure connection.',
      action: 'Use a valid HTTPS/WSS certificate and avoid insecure endpoints from a secure webpage.',
      canAutoRepair: false,
    };
  }

  if (/\b404\b|not found|cannot find endpoint|unknown endpoint/.test(normalized)) {
    return {
      kind: 'not-found',
      message: 'That MCP endpoint could not be found.',
      action: 'Check the server address and MCP path. Superpower will not guess a different URL automatically.',
      canAutoRepair: false,
    };
  }

  if (/econnrefused|connection refused|enotfound|dns|network error|server unavailable|could not connect/.test(normalized)) {
    return {
      kind: 'unreachable',
      message: 'Superpower cannot reach the MCP server.',
      action: 'Make sure the server or proxy is running and that the address is reachable from the browser.',
      canAutoRepair: false,
    };
  }

  if (/timeout|etimedout|timed out/.test(normalized)) {
    return {
      kind: 'timeout',
      message: 'The MCP server took too long to respond.',
      action: 'Check server load and network reachability, then reconnect. Superpower will not cycle protocols on a timeout.',
      canAutoRepair: false,
    };
  }

  const inferredType = inferConnectionType(uri);
  const alternateType = alternateHttpTransport(currentType);
  const explicitTransportMismatch =
    /unsupported media type|\b415\b|method not allowed|\b405\b|text\/event-stream|server[- ]sent events|\bsse\b|streamable[- ]?http|unexpected content[- ]type|invalid transport|transport mismatch|plugin .* does not support uri/.test(
      normalized,
    );

  if (explicitTransportMismatch) {
    const suggestedConnectionType =
      currentType === 'websocket' && inferredType !== 'websocket' ? inferredType : alternateType;

    if (suggestedConnectionType && suggestedConnectionType !== currentType) {
      return {
        kind: 'transport',
        message: 'The server appears to use a different MCP connection method.',
        action: `Try ${suggestedConnectionType === 'sse' ? 'SSE' : suggestedConnectionType === 'websocket' ? 'WebSocket' : 'Streamable HTTP'}.`,
        suggestedConnectionType,
        canAutoRepair: true,
      };
    }
  }

  if (/failed to fetch/.test(normalized)) {
    return {
      kind: 'unreachable',
      message: 'The browser could not complete the MCP connection.',
      action: 'Check the endpoint, browser network access, CORS settings, and whether the server is running.',
      canAutoRepair: false,
    };
  }

  return {
    kind: 'unknown',
    message: error
      ? 'Superpower could not connect to this MCP server.'
      : 'Superpower could not determine why the MCP connection failed.',
    action: 'Open Advanced for the technical error, or verify the endpoint and server configuration.',
    canAutoRepair: false,
  };
};
