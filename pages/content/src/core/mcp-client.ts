import { contextBridge } from './context-bridge';
import { useConnectionStore } from '../stores/connection.store';
import { useToolStore } from '../stores/tool.store';
import { eventBus } from '../events/event-bus';
import type { ConnectionStatus, ServerConfig, Tool } from '../types/stores';
import { logMessage } from '../utils/helpers';
import { pluginRegistry } from '../plugins';

type RequestKind = 'heartbeat' | 'control' | 'tools' | 'tool' | 'reconnect' | 'config-update';

const clampTimeout = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, Math.round(value)));

/**
 * McpClient owns transport coordination between the content script and background
 * MCP runtime. Zustand stores own state mutation and the corresponding state events.
 * Keeping those responsibilities separate avoids duplicate event emission.
 */
class McpClient {
  private static instance: McpClient | null = null;
  private isInitialized = false;
  private heartbeatInterval: number | null = null;
  private readonly HEARTBEAT_INTERVAL = 30_000;

  private constructor() {
    this.initialize();
  }

  private initialize(): void {
    if (this.isInitialized) {
      logMessage('[McpClient] Already initialized');
      return;
    }

    try {
      logMessage('[McpClient] Starting initialization...');
      contextBridge.initialize();
      this.setupMessageListeners();
      this.startHeartbeat();

      // Set before the async bootstrap because public wrappers validate readiness.
      this.isInitialized = true;
      void this.requestInitialState().catch(error => {
        logMessage(
          `[McpClient] Initial state request failed (non-blocking): ${error instanceof Error ? error.message : String(error)}`,
        );
      });

      logMessage('[McpClient] Initialized successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.isInitialized = false;
      eventBus.emit('error:unhandled', {
        error: error instanceof Error ? error : new Error(errorMessage),
        context: 'mcp-client-initialization',
      });
      logMessage(`[McpClient] Initialization failed: ${errorMessage}`);
      throw error;
    }
  }

  private async requestInitialState(): Promise<void> {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        try {
          const statusResponse = await this.getCurrentConnectionStatus();
          this.handleConnectionStatusChange(statusResponse.status as ConnectionStatus);
        } catch (error) {
          logMessage(
            `[McpClient] Initial status unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        try {
          const config = await this.getServerConfig();
          useConnectionStore.getState().setServerConfig(config);
          logMessage('[McpClient] Initial server config loaded');
        } catch (error) {
          logMessage(
            `[McpClient] Server config unavailable; using local defaults: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        try {
          const tools = await this.getAvailableTools(true);
          logMessage(`[McpClient] Initial tools loaded: ${tools.length}`);
        } catch (error) {
          logMessage(
            `[McpClient] Initial tool catalog unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        return;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (attempt >= maxRetries) {
          eventBus.emit('error:unhandled', {
            error: error instanceof Error ? error : new Error(errorMessage),
            context: 'mcp-client-initial-state',
          });
          logMessage(`[McpClient] Initial state degraded after ${maxRetries} attempts: ${errorMessage}`);
          return;
        }

        const delay = Math.min(1_000 * 2 ** (attempt - 1), 5_000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  private setupMessageListeners(): void {
    contextBridge.onMessage('connection:status-changed', message => {
      try {
        const { status, error } = message.payload ?? {};
        if (!status) {
          logMessage('[McpClient] Ignored connection update without status');
          return;
        }
        this.handleConnectionStatusChange(status as ConnectionStatus, error);
      } catch (error) {
        logMessage(
          `[McpClient] Failed to process connection update: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    contextBridge.onMessage('mcp:tool-update', message => {
      try {
        const tools = Array.isArray(message.payload) ? message.payload : [];
        this.handleToolUpdate(tools);
      } catch (error) {
        logMessage(
          `[McpClient] Failed to process tool update: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    contextBridge.onMessage('mcp:server-config-updated', message => {
      const { config } = message.payload ?? {};
      if (config) this.handleServerConfigUpdate(config);
    });

    contextBridge.onMessage('mcp:heartbeat-response', message => {
      try {
        const { timestamp, isConnected } = message.payload ?? {};
        if (!timestamp) return;

        if (typeof isConnected === 'boolean') {
          const expectedStatus: ConnectionStatus = isConnected ? 'connected' : 'disconnected';
          if (useConnectionStore.getState().status !== expectedStatus) {
            this.handleConnectionStatusChange(expectedStatus);
          }
        }
        this.handleHeartbeatResponse(timestamp);
      } catch (error) {
        logMessage(
          `[McpClient] Failed to process heartbeat response: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  private handleConnectionStatusChange(status: ConnectionStatus, error?: string): void {
    const store = useConnectionStore.getState();
    logMessage(`[McpClient] Connection status: ${status}${error ? ` (${error})` : ''}`);

    switch (status) {
      case 'connected':
        store.setConnected(Date.now());
        // Tool refresh is idempotent and is not a user-side-effecting operation.
        void this.getAvailableTools(true).catch(toolError => {
          logMessage(
            `[McpClient] Tool refresh after connect failed: ${toolError instanceof Error ? toolError.message : String(toolError)}`,
          );
        });
        break;
      case 'reconnecting':
        store.startReconnecting();
        break;
      case 'error':
        store.setDisconnected(error ?? 'Unknown connection error');
        break;
      case 'connecting':
        store.setStatus('connecting');
        break;
      case 'disconnected':
      default:
        store.setDisconnected(error);
        break;
    }
  }

  private normalizeTools(tools: unknown[]): Tool[] {
    return tools
      .filter(tool => tool && typeof tool === 'object' && typeof (tool as any).name === 'string')
      .map(tool => {
        const candidate = tool as any;
        return {
          name: candidate.name,
          description: candidate.description || '',
          input_schema: candidate.input_schema || candidate.schema || {},
          schema:
            typeof candidate.schema === 'string'
              ? candidate.schema
              : JSON.stringify(candidate.input_schema || candidate.schema || {}),
        } as Tool;
      });
  }

  private handleToolUpdate(tools: unknown[]): void {
    const normalizedTools = this.normalizeTools(tools);
    // ToolStore owns tool:list-updated emission.
    useToolStore.getState().setAvailableTools(normalizedTools);
    logMessage(`[McpClient] Tool catalog updated: ${normalizedTools.length} tools`);
  }

  private handleServerConfigUpdate(config: Partial<ServerConfig>): void {
    useConnectionStore.getState().setServerConfig(config);
    logMessage('[McpClient] Server config updated from background');
  }

  private handleHeartbeatResponse(timestamp: number): void {
    eventBus.emit('connection:heartbeat', { timestamp });
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    this.heartbeatInterval = window.setInterval(() => {
      void this.sendHeartbeat();
    }, this.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatInterval) return;
    clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = null;
  }

  private getConfiguredBaseTimeout(override?: number): number {
    const configured = override ?? useConnectionStore.getState().serverConfig.timeout;
    return Number.isFinite(configured) && configured > 0 ? configured : 5_000;
  }

  /**
   * Adapt bridge deadlines to the configured MCP transport timeout while preserving
   * conservative floors and ceilings for each operation class.
   */
  private resolveRequestTimeout(kind: RequestKind, overrideBase?: number): number {
    const base = this.getConfiguredBaseTimeout(overrideBase);
    switch (kind) {
      case 'heartbeat':
        return clampTimeout(base, 3_000, 10_000);
      case 'control':
        return clampTimeout(base, 5_000, 15_000);
      case 'tools':
        return clampTimeout(base * 2, 10_000, 30_000);
      case 'reconnect':
        return clampTimeout(base * 5, 25_000, 60_000);
      case 'config-update':
        return clampTimeout(base * 3, 15_000, 60_000);
      case 'tool':
      default:
        // Preserve the historical 30 s floor, but let slower MCP servers opt into
        // longer calls. Never retry a tool call implicitly because it may mutate state.
        return clampTimeout(base * 6, 30_000, 120_000);
    }
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      await contextBridge.sendMessage(
        'background',
        'mcp:heartbeat',
        { timestamp: Date.now() },
        { timeout: this.resolveRequestTimeout('heartbeat') },
      );
    } catch (error) {
      logMessage(`[McpClient] Heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Execute one MCP tool call. No automatic retry is performed here: retrying an
   * unknown tool after a timeout could duplicate writes, messages, payments, etc.
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<any> {
    if (!this.isInitialized) throw new Error('McpClient not initialized');
    if (!toolName || typeof toolName !== 'string') throw new Error('Tool name is required and must be a string');

    const connectionStore = useConnectionStore.getState();
    if (connectionStore.status !== 'connected') {
      throw new Error(
        `Not connected to MCP server. Current status: ${connectionStore.status}. Please check your connection.`,
      );
    }

    const activePlugin = pluginRegistry.getActivePlugin();
    const adapterName = activePlugin?.name || (typeof window !== 'undefined' ? window.location.hostname : '') || 'unknown';
    const timeout = this.resolveRequestTimeout('tool');

    // Never log argument values here. They can contain credentials, private content,
    // prompts, file bodies, or external-system identifiers.
    logMessage(
      `[McpClient] Calling ${toolName} with ${Object.keys(args).length} argument field(s); timeout=${timeout}ms`,
    );

    const executionId = useToolStore.getState().startToolExecution(toolName, args);

    try {
      const result = await contextBridge.sendMessage(
        'background',
        'mcp:call-tool',
        { toolName, args, adapterName },
        { timeout },
      );

      useToolStore.getState().completeToolExecution(executionId, result, 'success');
      logMessage(`[McpClient] Tool call successful: ${toolName}`);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      useToolStore.getState().completeToolExecution(executionId, null, 'error', errorMessage);
      logMessage(`[McpClient] Tool call failed: ${toolName} - ${errorMessage}`);

      if (this.isConnectionError(errorMessage)) {
        connectionStore.setDisconnected(`Tool call failed: ${errorMessage}`);
      }
      throw error;
    }
  }

  private isConnectionError(errorMessage: string): boolean {
    const connectionErrorPatterns = [
      /connection refused/i,
      /econnrefused/i,
      /network error/i,
      /server unavailable/i,
      /could not connect/i,
      /connection failed/i,
      /transport error/i,
      /fetch failed/i,
      /chrome runtime error/i,
    ];
    return connectionErrorPatterns.some(pattern => pattern.test(errorMessage));
  }

  async getAvailableTools(forceRefresh = false): Promise<Tool[]> {
    if (!this.isInitialized) throw new Error('McpClient not initialized');

    try {
      const tools = await contextBridge.sendMessage(
        'background',
        'mcp:get-tools',
        { forceRefresh },
        { timeout: this.resolveRequestTimeout('tools') },
      );

      const normalizedTools = this.normalizeTools(Array.isArray(tools) ? tools : []);
      useToolStore.getState().setAvailableTools(normalizedTools);
      return normalizedTools;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logMessage(`[McpClient] Failed to get available tools: ${errorMessage}`);
      throw error;
    }
  }

  async forceReconnect(): Promise<boolean> {
    if (!this.isInitialized) throw new Error('McpClient not initialized');

    const connectionStore = useConnectionStore.getState();
    connectionStore.startReconnecting();

    try {
      const response = await contextBridge.sendMessage(
        'background',
        'mcp:force-reconnect',
        {},
        { timeout: this.resolveRequestTimeout('reconnect') },
      );

      const isConnected = response?.isConnected ?? false;
      if (!isConnected) {
        connectionStore.setDisconnected(response?.error || 'Reconnect attempt failed');
        return false;
      }

      connectionStore.setConnected(Date.now());
      try {
        await this.getAvailableTools(true);
      } catch (error) {
        logMessage(
          `[McpClient] Tool refresh after reconnect failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      connectionStore.setDisconnected(`Reconnect failed: ${errorMessage}`);
      throw error;
    }
  }

  async forceConnectionStatusCheck(): Promise<void> {
    if (!this.isInitialized) throw new Error('McpClient not initialized');

    try {
      const statusResponse = await this.getCurrentConnectionStatus();
      this.handleConnectionStatusChange(statusResponse.status as ConnectionStatus);
    } catch (error) {
      logMessage(
        `[McpClient] Immediate connection status check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getServerConfig(): Promise<ServerConfig> {
    if (!this.isInitialized) throw new Error('McpClient not initialized');

    try {
      return await contextBridge.sendMessage(
        'background',
        'mcp:get-server-config',
        {},
        { timeout: this.resolveRequestTimeout('control') },
      );
    } catch (error) {
      logMessage(`[McpClient] Failed to get server config: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async getCurrentConnectionStatus(): Promise<{ status: string; isConnected: boolean; timestamp: number }> {
    if (!this.isInitialized) throw new Error('McpClient not initialized');

    try {
      return await contextBridge.sendMessage(
        'background',
        'mcp:get-connection-status',
        {},
        { timeout: this.resolveRequestTimeout('control') },
      );
    } catch (error) {
      logMessage(
        `[McpClient] Failed to get current connection status: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async updateServerConfig(config: Partial<ServerConfig>): Promise<boolean> {
    if (!this.isInitialized) throw new Error('McpClient not initialized');

    // Log keys only; a URI can embed credentials or private host details.
    logMessage(`[McpClient] Updating server config fields: ${Object.keys(config).sort().join(', ')}`);

    try {
      const response = await contextBridge.sendMessage(
        'background',
        'mcp:update-server-config',
        { config },
        { timeout: this.resolveRequestTimeout('config-update', config.timeout) },
      );

      const success = Boolean(response?.success);
      if (success) useConnectionStore.getState().setServerConfig(config);
      return success;
    } catch (error) {
      logMessage(`[McpClient] Failed to update server config: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  getConnectionStatus(): ConnectionStatus {
    return useConnectionStore.getState().status;
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  cleanup(): void {
    this.stopHeartbeat();
    this.isInitialized = false;
    logMessage('[McpClient] Cleanup completed');
  }

  public static getInstance(): McpClient {
    if (!McpClient.instance) McpClient.instance = new McpClient();
    return McpClient.instance;
  }

  public static resetInstance(): void {
    if (!McpClient.instance) return;
    McpClient.instance.cleanup();
    McpClient.instance = null;
  }
}

export const mcpClient = McpClient.getInstance();
export type { McpClient };
