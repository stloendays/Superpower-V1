import type { ConnectionType } from '../../../types/stores';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMcpCommunication } from '@src/hooks/useMcpCommunication';
import { useConnectionStatus, useServerConfig } from '../../../hooks';
import { useConnectionStore } from '@src/stores/connection.store';
import { Typography, Icon, Button } from '../ui';
import { cn } from '@src/lib/utils';
import { Card, CardContent } from '@src/components/ui/card';
import {
  inferConnectionType,
  loadRecentConnections,
  parseMcpConnectionInput,
  rememberRecentConnection,
  type ParsedConnectionInput,
  type RecentConnection,
} from './connection-input';
import {
  diagnoseConnectionError,
  type ConnectionDiagnosis,
} from './connection-diagnosis';

interface ServerStatusProps {
  status: string;
}

interface ConnectOptions {
  allowAutoRepair?: boolean;
}

const TRANSPORT_LABELS: Record<ConnectionType, string> = {
  'streamable-http': 'Streamable HTTP',
  sse: 'Server-Sent Events (SSE)',
  websocket: 'WebSocket',
};

const recentConnectionLabel = (connection: RecentConnection): string => {
  try {
    const url = new URL(connection.uri);
    const path = url.pathname === '/' ? '' : url.pathname;
    return `${connection.label ? `${connection.label} · ` : ''}${url.host}${path}`;
  } catch {
    return connection.label || connection.uri;
  }
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
  const [rawConnectionError, setRawConnectionError] = useState('');
  const [diagnosis, setDiagnosis] = useState<ConnectionDiagnosis | null>(null);
  const [repairNotice, setRepairNotice] = useState('');
  const [recognizedLabel, setRecognizedLabel] = useState('');
  const [authNotImported, setAuthNotImported] = useState(false);
  const [recentConnections, setRecentConnections] = useState<RecentConnection[]>([]);

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
    loadRecentConnections()
      .then(setRecentConnections)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isInitialized) return;

    getServerConfig().catch(() => undefined);
    forceConnectionStatusCheck().catch(() => undefined);
  }, [isInitialized, getServerConfig, forceConnectionStatusCheck]);

  const parsedPreview = useMemo(() => parseMcpConnectionInput(serverUri), [serverUri]);

  const resolvedAutomaticType = useMemo(() => {
    const previewUri = parsedPreview.ok ? parsedPreview.value.uri : serverUri.trim();
    if (previewUri && previewUri === serverConfig.uri?.trim() && serverConfig.connectionType) {
      return serverConfig.connectionType;
    }
    if (parsedPreview.ok) return parsedPreview.value.connectionType;
    return inferConnectionType(previewUri);
  }, [parsedPreview, serverUri, serverConfig.uri, serverConfig.connectionType]);

  const effectiveConnectionType = manualTransport ? connectionType : resolvedAutomaticType;

  const persistAndReconnect = useCallback(
    async (connection: Pick<ParsedConnectionInput, 'uri' | 'connectionType'>) => {
      setServerConfig({ uri: connection.uri, connectionType: connection.connectionType });
      const updated = await updateServerConfig({
        uri: connection.uri,
        connectionType: connection.connectionType,
      });
      if (!updated) throw new Error('Server configuration was not accepted.');

      const connected = await forceReconnect();
      if (!connected) {
        const latestError = useConnectionStore.getState().error;
        throw new Error(latestError || 'Connection attempt failed.');
      }
    },
    [setServerConfig, updateServerConfig, forceReconnect],
  );

  const completeSuccessfulConnection = useCallback(
    async (connection: Pick<ParsedConnectionInput, 'uri' | 'connectionType' | 'label'>) => {
      setServerUri(connection.uri);
      setConnectionType(connection.connectionType);
      setIsEditingUri(false);
      setShowSetup(false);
      setRecognizedLabel('');
      setAuthNotImported(false);
      setLocalError('');
      setRawConnectionError('');
      setDiagnosis(null);

      const nextRecent = await rememberRecentConnection({
        uri: connection.uri,
        connectionType: connection.connectionType,
        label: connection.label,
      });
      setRecentConnections(nextRecent);
    },
    [],
  );

  const connectResolved = useCallback(
    async (
      connection: Pick<ParsedConnectionInput, 'uri' | 'connectionType' | 'label'>,
      options: ConnectOptions = {},
    ) => {
      if (!isInitialized) {
        setLocalError('Superpower is still starting. Try again in a moment.');
        return;
      }

      setIsConnecting(true);
      setLocalError('');
      setRawConnectionError('');
      setDiagnosis(null);
      setRepairNotice('');

      try {
        await persistAndReconnect(connection);
        await completeSuccessfulConnection(connection);
        return;
      } catch (error) {
        const firstRawError =
          useConnectionStore.getState().error || (error instanceof Error ? error.message : String(error));
        const firstDiagnosis = diagnoseConnectionError(
          firstRawError,
          connection.uri,
          connection.connectionType,
        );

        if (
          options.allowAutoRepair &&
          firstDiagnosis.canAutoRepair &&
          firstDiagnosis.suggestedConnectionType &&
          firstDiagnosis.suggestedConnectionType !== connection.connectionType
        ) {
          const repairedConnection = {
            ...connection,
            connectionType: firstDiagnosis.suggestedConnectionType,
          };
          setRepairNotice(
            `Connection method mismatch detected. Trying ${TRANSPORT_LABELS[repairedConnection.connectionType]} once…`,
          );

          try {
            await persistAndReconnect(repairedConnection);
            await completeSuccessfulConnection(repairedConnection);
            setRepairNotice(
              `Connected automatically using ${TRANSPORT_LABELS[repairedConnection.connectionType]}.`,
            );
            return;
          } catch (repairError) {
            const repairRawError =
              useConnectionStore.getState().error ||
              (repairError instanceof Error ? repairError.message : String(repairError));
            const repairDiagnosis = diagnoseConnectionError(
              repairRawError,
              repairedConnection.uri,
              repairedConnection.connectionType,
            );
            setRawConnectionError(repairRawError);
            setDiagnosis(repairDiagnosis);
            setLocalError(repairDiagnosis.message);
            setRepairNotice('');
            setShowSetup(true);
            return;
          }
        }

        setRawConnectionError(firstRawError);
        setDiagnosis(firstDiagnosis);
        setLocalError(firstDiagnosis.message);
        setShowSetup(true);
      } finally {
        setIsConnecting(false);
      }
    },
    [isInitialized, persistAndReconnect, completeSuccessfulConnection],
  );

  const connect = useCallback(async () => {
    const parsed = parseMcpConnectionInput(serverUri);
    if (!parsed.ok) {
      setDiagnosis(null);
      setLocalError(parsed.error);
      return;
    }

    if (parsed.value.ignoredAuth || authNotImported) {
      setDiagnosis(null);
      setLocalError(
        'This configuration contains authentication fields. Superpower recognized the endpoint but did not import secrets. Authenticated config import will be handled separately for safety.',
      );
      return;
    }

    const sameAsSaved = parsed.value.uri === serverConfig.uri?.trim();
    const selectedType = manualTransport
      ? connectionType
      : sameAsSaved && serverConfig.connectionType
        ? serverConfig.connectionType
        : parsed.value.connectionType;

    await connectResolved(
      {
        uri: parsed.value.uri,
        connectionType: selectedType,
        label: parsed.value.label || recognizedLabel || undefined,
      },
      { allowAutoRepair: !manualTransport },
    );
  }, [
    serverUri,
    authNotImported,
    serverConfig.uri,
    serverConfig.connectionType,
    manualTransport,
    connectionType,
    connectResolved,
    recognizedLabel,
  ]);

  const connectToRecent = useCallback(
    async (connection: RecentConnection) => {
      setServerUri(connection.uri);
      setConnectionType(connection.connectionType);
      setManualTransport(false);
      setIsEditingUri(false);
      setAuthNotImported(false);
      setRecognizedLabel(connection.label || '');
      await connectResolved(connection, { allowAutoRepair: true });
    },
    [connectResolved],
  );

  const reconnect = useCallback(async () => {
    if (!isInitialized || busy || !serverConfig.uri) return;
    await connectResolved(
      {
        uri: serverConfig.uri,
        connectionType: serverConfig.connectionType || inferConnectionType(serverConfig.uri),
      },
      { allowAutoRepair: !manualTransport },
    );
  }, [isInitialized, busy, serverConfig.uri, serverConfig.connectionType, manualTransport, connectResolved]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text').trim();
    if (!pasted) return;

    const parsed = parseMcpConnectionInput(pasted);
    if (!parsed.ok) {
      if (pasted.startsWith('{')) {
        event.preventDefault();
        setDiagnosis(null);
        setLocalError(parsed.error);
      }
      return;
    }

    event.preventDefault();
    setServerUri(parsed.value.uri);
    setConnectionType(parsed.value.connectionType);
    setManualTransport(false);
    setIsEditingUri(true);
    setLocalError('');
    setRawConnectionError('');
    setDiagnosis(null);
    setRepairNotice('');
    setRecognizedLabel(parsed.value.label || (parsed.value.source === 'json' ? 'MCP configuration' : ''));
    setAuthNotImported(parsed.value.ignoredAuth);
  }, []);

  const statusPresentation = useMemo(() => {
    if (busy) {
      return {
        title: repairNotice ? 'Auto-repairing…' : 'Connecting…',
        message: repairNotice || 'Superpower is checking the MCP server and preparing its tools.',
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
      message: 'Paste an MCP server address or configuration. Superpower will recognize it for you.',
      icon: 'server' as const,
      iconClass: 'text-slate-600 dark:text-slate-300',
      iconBackground: 'bg-slate-100 dark:bg-slate-800',
    };
  }, [busy, isConnected, toolCount, repairNotice]);

  const technicalError = rawConnectionError || connectionError || '';
  const visibleError = localError || (connectionError
    ? diagnoseConnectionError(
        connectionError,
        serverConfig.uri || serverUri,
        serverConfig.connectionType || effectiveConnectionType,
      ).message
    : '');
  const jsonPreview = parsedPreview.ok && parsedPreview.value.source === 'json' ? parsedPreview.value : null;

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

        {repairNotice && isConnected && !busy && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-emerald-50 p-2.5 text-xs text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
            <Icon name="check" size="xs" className="mt-0.5 shrink-0" />
            <span>{repairNotice}</span>
          </div>
        )}

        {visibleError && !busy && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            <Icon name="alert-triangle" size="xs" className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div>{visibleError}</div>
              {diagnosis?.action && <div className="mt-1 text-[10px] leading-4 opacity-80">{diagnosis.action}</div>}
            </div>
          </div>
        )}

        {shouldShowSetup && (
          <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
            <label
              htmlFor="mcp-server-address"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              MCP server or config
            </label>
            <div className="mt-1.5 flex items-start gap-2">
              <textarea
                id="mcp-server-address"
                rows={serverUri.trim().startsWith('{') ? 4 : 1}
                value={serverUri}
                onChange={event => {
                  setServerUri(event.target.value);
                  setIsEditingUri(true);
                  setLocalError('');
                  setRawConnectionError('');
                  setDiagnosis(null);
                  setRepairNotice('');
                  setRecognizedLabel('');
                  setAuthNotImported(false);
                }}
                onPaste={handlePaste}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey && !serverUri.trim().startsWith('{')) {
                    event.preventDefault();
                    void connect();
                  }
                }}
                spellCheck={false}
                autoComplete="off"
                placeholder="https://example.com/mcp or paste MCP JSON"
                className="min-h-8 min-w-0 flex-1 resize-y rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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

            {(recognizedLabel || jsonPreview) && !authNotImported && (
              <div className="mt-2 flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1.5 text-[10px] text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                <Icon name="check" size="xs" />
                <span>
                  Recognized {recognizedLabel || jsonPreview?.label || 'MCP configuration'} ·{' '}
                  {TRANSPORT_LABELS[effectiveConnectionType]}
                </span>
              </div>
            )}

            {authNotImported && (
              <div className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-[10px] leading-4 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                Endpoint recognized, but authentication fields were not imported or stored. Secret-aware config import
                will be a separate guarded flow.
              </div>
            )}

            {recentConnections.length > 0 && (
              <div className="mt-3">
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Recent
                </div>
                <div className="space-y-1">
                  {recentConnections.slice(0, 3).map(connection => (
                    <button
                      key={`${connection.connectionType}:${connection.uri}`}
                      type="button"
                      disabled={busy || !isInitialized}
                      onClick={() => void connectToRecent(connection)}
                      className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-left hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">
                      <span className="min-w-0 truncate text-[10px] text-slate-600 dark:text-slate-300">
                        {recentConnectionLabel(connection)}
                      </span>
                      <span className="shrink-0 text-[9px] font-medium text-slate-400 dark:text-slate-500">
                        Connect
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-[10px] leading-4 text-slate-500 dark:text-slate-400">
                Paste a URL or common MCP JSON config. Successful safe endpoints appear under Recent.
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
                          setDiagnosis(null);
                          setRepairNotice('');
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
                      onChange={event => {
                        setConnectionType(event.target.value as ConnectionType);
                        setDiagnosis(null);
                        setRepairNotice('');
                      }}
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                      <option value="streamable-http">Streamable HTTP</option>
                      <option value="sse">Server-Sent Events (SSE)</option>
                      <option value="websocket">WebSocket</option>
                    </select>
                  )}

                  <div className="rounded-md border border-slate-200 bg-white p-2 text-[10px] leading-4 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                    Automatic repair may try one alternate HTTP transport only when the connection error clearly indicates a protocol mismatch. It never retries MCP tool calls. Local stdio configs must run through Superpower Host or a browser-accessible MCP proxy.
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

            {!manualTransport && serverUri.trim() && parsedPreview.ok && (
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
