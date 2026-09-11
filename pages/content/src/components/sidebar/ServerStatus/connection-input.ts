import type { ConnectionType } from '../../../types/stores';

export interface ParsedConnectionInput {
  uri: string;
  connectionType: ConnectionType;
  label?: string;
  source: 'url' | 'json';
  ignoredAuth: boolean;
}

export interface RecentConnection {
  uri: string;
  connectionType: ConnectionType;
  label?: string;
  lastUsedAt: number;
}

export type ConnectionInputResult = { ok: true; value: ParsedConnectionInput } | { ok: false; error: string };

const RECENT_CONNECTIONS_KEY = 'superpower:mcp-recent-connections:v1';
const MAX_RECENT_CONNECTIONS = 5;
const SENSITIVE_QUERY_KEY = /(token|key|secret|auth|signature|credential|password)/i;

export const inferConnectionType = (uri: string): ConnectionType => {
  const normalized = uri.trim().toLowerCase();

  if (normalized.startsWith('ws://') || normalized.startsWith('wss://')) return 'websocket';

  try {
    const url = new URL(uri.trim());
    if (url.protocol === 'ws:' || url.protocol === 'wss:') return 'websocket';
    if (/\/sse\/?$/i.test(url.pathname)) return 'sse';
  } catch {
    if (/\/sse\/?(?:[?#].*)?$/i.test(normalized)) return 'sse';
  }

  return 'streamable-http';
};

const normalizeConnectionType = (value: unknown, uri: string): ConnectionType => {
  if (typeof value !== 'string') return inferConnectionType(uri);

  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'sse' || normalized === 'server-sent-events') return 'sse';
  if (normalized === 'websocket' || normalized === 'ws') return 'websocket';
  if (
    normalized === 'streamable-http' ||
    normalized === 'streamablehttp' ||
    normalized === 'http' ||
    normalized === 'https'
  ) {
    return 'streamable-http';
  }

  return inferConnectionType(uri);
};

const isRemoteUri = (value: unknown): value is string =>
  typeof value === 'string' && /^(https?|wss?):\/\//i.test(value.trim());

const hasAuthMaterial = (value: Record<string, unknown>): boolean => {
  const authKeys = ['headers', 'header', 'authorization', 'token', 'apiKey', 'api_key', 'secret', 'credentials'];
  return authKeys.some(key => key in value);
};

const extractRemoteEntry = (entry: Record<string, unknown>, label?: string): ParsedConnectionInput | null => {
  const rawUri = entry.url ?? entry.uri ?? entry.endpoint ?? entry.serverUrl ?? entry.server_url;
  if (!isRemoteUri(rawUri)) return null;

  const uri = rawUri.trim();
  return {
    uri,
    connectionType: normalizeConnectionType(entry.transport ?? entry.type ?? entry.connectionType, uri),
    label,
    source: 'json',
    ignoredAuth: hasAuthMaterial(entry),
  };
};

export const parseMcpConnectionInput = (rawInput: string): ConnectionInputResult => {
  const input = rawInput.trim();
  if (!input) return { ok: false, error: 'Paste an MCP server address or configuration first.' };

  if (/^(https?|wss?):\/\//i.test(input)) {
    return {
      ok: true,
      value: {
        uri: input,
        connectionType: inferConnectionType(input),
        source: 'url',
        ignoredAuth: false,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return {
      ok: false,
      error: 'That does not look like an MCP address or JSON configuration.',
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'The MCP configuration must be a JSON object.' };
  }

  const root = parsed as Record<string, unknown>;
  const direct = extractRemoteEntry(root, typeof root.name === 'string' ? root.name : undefined);
  if (direct) return { ok: true, value: direct };

  const servers = root.mcpServers ?? root.servers;
  if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
    let sawStdioConfig = false;

    for (const [name, candidate] of Object.entries(servers as Record<string, unknown>)) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const entry = candidate as Record<string, unknown>;
      const remote = extractRemoteEntry(entry, name);
      if (remote) return { ok: true, value: remote };
      if (typeof entry.command === 'string') sawStdioConfig = true;
    }

    if (sawStdioConfig) {
      return {
        ok: false,
        error:
          'This is a local stdio MCP configuration. A browser extension cannot launch local commands directly; connect it through the Superpower Host or a browser-accessible MCP proxy.',
      };
    }
  }

  if (typeof root.command === 'string') {
    return {
      ok: false,
      error:
        'This is a local stdio MCP configuration. A browser extension cannot launch local commands directly; connect it through the Superpower Host or a browser-accessible MCP proxy.',
    };
  }

  return {
    ok: false,
    error: 'No browser-accessible MCP endpoint was found in that configuration.',
  };
};

const canRememberUri = (uri: string): boolean => {
  try {
    const url = new URL(uri);
    if (url.username || url.password) return false;
    return !Array.from(url.searchParams.keys()).some(key => SENSITIVE_QUERY_KEY.test(key));
  } catch {
    return false;
  }
};

const storageGet = <T>(key: string): Promise<T | undefined> =>
  new Promise(resolve => {
    try {
      chrome.storage.local.get(key, result => {
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        resolve(result[key] as T | undefined);
      });
    } catch {
      resolve(undefined);
    }
  });

const storageSet = (value: Record<string, unknown>): Promise<void> =>
  new Promise(resolve => {
    try {
      chrome.storage.local.set(value, () => resolve());
    } catch {
      resolve();
    }
  });

export const loadRecentConnections = async (): Promise<RecentConnection[]> => {
  const parsed = await storageGet<unknown>(RECENT_CONNECTIONS_KEY);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(
      (item): item is RecentConnection =>
        !!item &&
        typeof item === 'object' &&
        typeof item.uri === 'string' &&
        canRememberUri(item.uri) &&
        ['sse', 'websocket', 'streamable-http'].includes(item.connectionType),
    )
    .slice(0, MAX_RECENT_CONNECTIONS);
};

export const rememberRecentConnection = async (
  connection: Omit<RecentConnection, 'lastUsedAt'>,
): Promise<RecentConnection[]> => {
  const current = await loadRecentConnections();
  if (!canRememberUri(connection.uri)) return current;

  const next: RecentConnection[] = [
    { ...connection, lastUsedAt: Date.now() },
    ...current.filter(item => item.uri !== connection.uri),
  ].slice(0, MAX_RECENT_CONNECTIONS);

  await storageSet({ [RECENT_CONNECTIONS_KEY]: next });
  return next;
};
