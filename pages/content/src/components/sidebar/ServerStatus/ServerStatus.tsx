import type { ConnectionType } from '../../../types/stores';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMcpCommunication } from '@src/hooks/useMcpCommunication';
import { useConnectionStatus, useServerConfig } from '../../../hooks';
import { Typography, Icon, Button } from '../ui';
import { cn } from '@src/lib/utils';
import { Card, CardContent } from '@src/components/ui/card';

interface ServerStatusProps {
  status: string;
}

const TRANSPORT_LABELS: Record<ConnectionType, string> = {
  'streamable-http': 'Streamable HTTP',
  sse: 'Server-Sent Events (SSE)',
  websocket: 'WebSocket',
};

const inferConnectionType = (uri: string): ConnectionType => {
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

const friendlyConnectionError = (error: string): string => {
  const normalized = error.toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('404') || normalized.includes('not found')) {
    return 'That server address could not be found. Check the address and try again.';
  }
  if (normalized.includes('403') || normalized.includes('forbidden')) {
    return 'The server refused access. Check its authentication or permissions.';
  }
  if (normalized.includes('econnrefused') || normalized.includes('connection refused')) {
    return 'The server is not accepting connections. Make sure it is running.';
  }
  if (normalized.includes('timeout') || normalized.includes('etimedout')) {
    return 'The server took too long to respond. Check that it is reachable and try again.';
  }
  if (normalized.includes('enotfound') || normalized.includes('failed to fetch')) {
    return 'Superpower could not reach that server. Check the address, network access, and CORS settings.';
  }
  return 'Superpower could not connect to this server. Check the address or open Advanced for technical details.';
};

const ServerStatus: React.FC<ServerStatusProps> = ({ status: initialStatus }) => {
  const { status: connectionStatus, isConnected, isReconnecting, error: connectionError } = useConnectionStatus();
  const { config: serverConfig, setConfig: setServerConfig } = useServerConfig();
  const {
    availableTools,
    forceReconnect,
    getServerConfig,
    updateServerConfig,
    forceConnectionStatusCheck,
    isInitialized,
  } = useMcpCommunication();

  const [serverUri, setServerUri] = useState(serverConfig.uri || '');
  const [connectionType, setConnectionType] = useState<ConnectionType>(
    serverConfig.connectionType || 'streamable-http',
  );
  const [showSetup, setShowSetup] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [manualTransport, setManualTransport] = useState(false);
  const [isEditingUri, setIsEditingUri] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [localError, setLocalError] = useState('');

  const status = connectionStatus || initialStatus || 'disconnected';
  const busy = isConnecting || isReconnecting || status === 'connecting' || status === 'reconnecting';
  const shouldShowSetup = showSetup || (!isConnected && !busy);
  const toolCount = availableTools.length;

  useEffect(() => {
    if (!isEditingUri && serverConfig.uri && serverConfig.uri !== serverUri) {
      setServerUri(serverConfig.uri);
    }
    if (!manualTransport && serverConfig.connectionType) {
      setConnectionType(serverConfig.connectionType);
    }
  }, [serverConfig.uri, serverConfig.connectionType, isEditingUri, manualTransport, serverUri]);

  useEffect(() => {
    if (!isInitialized) return;

    getServerConfig().catch(() => undefined);
    forceConnectionStatusCheck().catch(() => undefined);
  }, [isInitialized, getServerConfig, forceConnectionStatusCheck]);

  const resolvedAutomaticType = useMemo(() => {
    const normalizedUri = serverUri.trim();
    if (normalizedUri && normalizedUri === serverConfig.uri?.trim() && serverConfig.connectionType) {
      return serverConfig.connectionType;
    }
    return inferConnectionType(normalizedUri);
  }, [serverUri, serverConfig.uri, serverConfig.connectionType]);

  const effectiveConnectionType = manualTransport ? connectionType : resolvedAutomaticType;

  const connect = useCallback(async () => {
    const uri = serverUri.trim();
    if (!uri) {
      setLocalError('Paste an MCP server address first.');
      return;
    }
    if (!isInitialized) {
      setLocalError('Superpower is still starting. Try again in a moment.');
      return;
    }

    const selectedType = manualTransport ? connectionType : resolvedAutomaticType;
    setIsConnecting(true);
    setLocalError('');

    try {
      setServerConfig({ uri, connectionType: selectedType });
      const updated = await updateServerConfig({ uri, connectionType: selectedType });
      if (!updated) throw new Error('Server configuration was not accepted.');

      const connected = await forceReconnect();
      if (!connected) throw new Error('Connection attempt failed.');

      setConnectionType(selectedType);
      setIsEditingUri(false);
      setShowSetup(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalError(friendlyConnectionError(message) || 'Connection failed.');
      setShowSetup(true);
    } finally {
      setIsConnecting(false);
    }
  }, [
    serverUri,
    isInitialized,
    manualTransport,
    connectionType,
    resolvedAutomaticType,
    setServerConfig,
    updateServerConfig,
    forceReconnect,
  ]);

  const reconnect = useCallback(async () => {
    if (!isInitialized || busy) return;
    setIsConnecting(true);
    setLocalError('');
    try {
      const connected = await forceReconnect();
      if (!connected) throw new Error('Connection attempt failed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalError(friendlyConnectionError(message) || 'Connection failed.');
      setShowSetup(true);
    } finally {
      setIsConnecting(false);
    }
  }, [isInitialized, busy, forceReconnect]);

  const statusPresentation = useMemo(() => {
    if (busy) {
      return {
        title: 'Connecting…',
        message: 'Superpower is checking the MCP server and preparing its tools.',
        icon: 'refresh' as const,
        iconClass: 'text-amber-600 dark:text-amber-400 animate-spin',
        iconBackground: 'bg-amber-100 dark:bg-amber-900/25',
      };
    }

    if (isConnected) {
      return {
        title: 'MCP ready',
        message:
          toolCount > 0
            ? `${toolCount} tool${toolCount === 1 ? '' : 's'} available. Superpower will choose relevant tools automatically as you type.`
            : 'Connected. Superpower is ready to load tools from this server.',
        icon: 'check' as const,
        iconClass: 'text-emerald-600 dark:text-emerald-400',
        iconBackground: 'bg-emerald-100 dark:bg-emerald-900/25',
      };
    }

    return {
      title: 'Connect MCP',
      message: 'Paste your MCP server address. Superpower will handle the connection method for you.',
      icon: 'server' as const,
      iconClass: 'text-slate-600 dark:text-slate-300',
      iconBackground: 'bg-slate-100 dark:bg-slate-800',
    };
  }, [busy, isConnected, toolCount]);

  const technicalError = localError || connectionError || '';
  const visibleError = localError || friendlyConnectionError(connectionError || '');

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="p-3">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
              statusPresentation.iconBackground,
            )}>
            <Icon name={statusPresentation.icon} size="sm" className={statusPresentation.iconClass} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <Typography variant="h4" className="text-slate-800 dark:text-slate-100">
                {statusPresentation.title}
              </Typography>
              {isConnected && !busy && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowSetup(value => !value)}
                    className="rounded px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                    {showSetup ? 'Cancel' : 'Change'}
                  </button>
                  <button
                    type="button"
                    onClick={reconnect}
                    aria-label="Reconnect MCP server"
                    title="Reconnect"
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                    <Icon name="refresh" size="xs" />
                  </button>
                </div>
              )}
            </div>
            <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{statusPresentation.message}</p>
          </div>
        </div>

        {visibleError && !busy && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            <Icon name="alert-triangle" size="xs" className="mt-0.5 shrink-0" />
            <span>{visibleError}</span>
          </div>
        )}

        {shouldShowSetup && (
          <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
            <label
              htmlFor="mcp-server-address"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              MCP server address
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="mcp-server-address"
                type="text"
                value={serverUri}
                onChange={event => {
                  setServerUri(event.target.value);
                  setIsEditingUri(true);
                  setLocalError('');
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') void connect();
                }}
                spellCheck={false}
                autoComplete="off"
                placeholder="https://example.com/mcp"
                className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <Button
                onClick={connect}
                disabled={busy || !serverUri.trim() || !isInitialized}
                variant="default"
                size="sm"
                className="h-8 shrink-0 bg-blue-600 px-3 text-xs text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700">
                {busy ? 'Connecting…' : 'Connect'}
              </Button>
            </div>

            <div className="mt-1.5 flex items-center justify-between gap-3">
              <p className="text-[10px] leading-4 text-slate-500 dark:text-slate-400">
                Superpower automatically chooses the connection method. Press Enter to connect.
              </p>
              <button
                type="button"
                onClick={() => setShowAdvanced(value => !value)}
                className="shrink-0 text-[10px] font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                {showAdvanced ? 'Hide advanced' : 'Advanced'}
              </button>
            </div>

            {showAdvanced && (
              <Card className="mt-3 border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60">
                <CardContent className="space-y-3 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-200">Connection method</div>
                      <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                        Automatic currently selects {TRANSPORT_LABELS[resolvedAutomaticType]}.
                      </div>
                    </div>
                    <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                      <input
                        type="checkbox"
                        checked={manualTransport}
                        onChange={event => {
                          const enabled = event.target.checked;
                          setManualTransport(enabled);
                          if (enabled) setConnectionType(resolvedAutomaticType);
                        }}
                        className="h-3.5 w-3.5 rounded border-slate-300"
                      />
                      Manual
                    </label>
                  </div>

                  {manualTransport && (
                    <select
                      value={connectionType}
                      onChange={event => setConnectionType(event.target.value as ConnectionType)}
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                      <option value="streamable-http">Streamable HTTP</option>
                      <option value="sse">Server-Sent Events (SSE)</option>
                      <option value="websocket">WebSocket</option>
                    </select>
                  )}

                  <div className="rounded-md border border-slate-200 bg-white p-2 text-[10px] leading-4 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                    Browser connections require an MCP endpoint reachable from this page. If a local server only exposes
                    stdio, use a browser-accessible MCP proxy or gateway first.
                  </div>

                  {technicalError && (
                    <details className="text-[10px] text-slate-500 dark:text-slate-400">
                      <summary className="cursor-pointer font-medium">Technical error</summary>
                      <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-2 font-mono text-[10px] dark:bg-slate-950">
                        {technicalError}
                      </pre>
                    </details>
                  )}
                </CardContent>
              </Card>
            )}

            {!manualTransport && serverUri.trim() && (
              <div className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
                Connection method: {TRANSPORT_LABELS[effectiveConnectionType]} · automatic
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ServerStatus;
