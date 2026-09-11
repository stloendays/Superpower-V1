import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { eventBus } from '../events';
import { evaluateToolExecution } from '../core/execution-policy';
import { mcpTelemetry } from '../core/mcp-telemetry';
import { getToolEnablementState, saveToolEnablementState } from '../utils/storage';
import type { Tool, DetectedTool, ToolExecution } from '../types/stores';
import { createLogger } from '@extension/shared/lib/logger';

const logger = createLogger('useToolStore');
const pendingTelemetry = new Map<string, ReturnType<typeof mcpTelemetry.begin>>();

const getResultChars = (value: unknown): number => {
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
};

export interface ToolState {
  availableTools: Tool[];
  detectedTools: DetectedTool[];
  toolExecutions: Record<string, ToolExecution>; // Store executions by ID
  isExecuting: boolean;
  lastExecutionId: string | null;
  enabledTools: Set<string>;
  isLoadingEnablement: boolean;

  // Actions
  setAvailableTools: (tools: Tool[]) => void;
  addDetectedTool: (tool: DetectedTool) => void;
  clearDetectedTools: () => void;
  startToolExecution: (toolName: string, parameters: Record<string, any>) => string;
  updateToolExecution: (execution: Partial<ToolExecution> & { id: string }) => void;
  completeToolExecution: (id: string, result: any, status: 'success' | 'error', error?: string) => void;
  getToolExecution: (id: string) => ToolExecution | undefined;
  enableTool: (toolName: string) => void;
  disableTool: (toolName: string) => void;
  enableAllTools: () => void;
  disableAllTools: () => void;
  isToolEnabled: (toolName: string) => boolean;
  loadToolEnablementState: () => Promise<void>;
}

const initialState: Omit<
  ToolState,
  | 'setAvailableTools'
  | 'addDetectedTool'
  | 'clearDetectedTools'
  | 'startToolExecution'
  | 'updateToolExecution'
  | 'completeToolExecution'
  | 'getToolExecution'
  | 'enableTool'
  | 'disableTool'
  | 'enableAllTools'
  | 'disableAllTools'
  | 'isToolEnabled'
  | 'loadToolEnablementState'
> = {
  availableTools: [],
  detectedTools: [],
  toolExecutions: {},
  isExecuting: false,
  lastExecutionId: null,
  enabledTools: new Set(),
  isLoadingEnablement: false,
};

export const useToolStore = create<ToolState>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setAvailableTools: (tools: Tool[]) => {
        set({ availableTools: tools });
        logger.debug('[ToolStore] Available tools updated', {
          count: tools.length,
          names: tools.map(tool => tool.name),
        });
        eventBus.emit('tool:list-updated', { tools });

        // Load tool enablement state from storage.
        void get().loadToolEnablementState();
      },

      addDetectedTool: (tool: DetectedTool) => {
        set(state => ({ detectedTools: [...state.detectedTools, tool] }));
        logger.debug('[ToolStore] Tool detected', {
          name: tool.name,
          source: tool.source || 'unknown',
          confidence: tool.confidence,
          parameterKeys: Object.keys(tool.parameters || {}),
        });
        eventBus.emit('tool:detected', { tools: [tool], source: tool.source || 'unknown' });
      },

      clearDetectedTools: () => {
        set({ detectedTools: [] });
        logger.debug('[ToolStore] Detected tools cleared.');
      },

      startToolExecution: (toolName: string, parameters: Record<string, any>): string => {
        const executionId = `exec_${toolName}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const tool = get().availableTools.find(candidate => candidate.name === toolName);
        const policy = evaluateToolExecution(toolName, parameters, tool?.description || '', 'audit');
        const adapterName = typeof window !== 'undefined' ? window.location.hostname || 'content-script' : 'content-script';

        pendingTelemetry.set(executionId, mcpTelemetry.begin(toolName, adapterName, policy.risk, parameters));

        const newExecution: ToolExecution = {
          id: executionId,
          toolName,
          parameters,
          status: 'pending',
          timestamp: Date.now(),
          result: null,
        };

        set(state => ({
          toolExecutions: { ...state.toolExecutions, [executionId]: newExecution },
          isExecuting: true,
          lastExecutionId: executionId,
        }));

        // Do not log parameter values. MCP arguments may contain credentials, file
        // contents, messages, or other user data.
        logger.debug(`[ToolStore] Starting execution for ${toolName} (ID: ${executionId})`, {
          risk: policy.risk,
          decision: policy.decision,
          parameterKeys: Object.keys(parameters).sort(),
          sensitiveArgumentKeys: policy.sensitiveArgumentKeys,
        });

        eventBus.emit('tool:execution-started', { toolName, callId: executionId });
        return executionId;
      },

      updateToolExecution: (executionUpdate: Partial<ToolExecution> & { id: string }) => {
        const { id, ...updateData } = executionUpdate;
        const existingExecution = get().toolExecutions[id];
        if (!existingExecution) {
          logger.warn(`Attempted to update non-existent execution (ID: ${id})`);
          return;
        }

        const updatedExecution = { ...existingExecution, ...updateData, timestamp: Date.now() };
        set(state => ({
          toolExecutions: { ...state.toolExecutions, [id]: updatedExecution },
          isExecuting: updatedExecution.status === 'pending',
        }));

        logger.debug(`Execution updated (ID: ${id})`, {
          toolName: updatedExecution.toolName,
          status: updatedExecution.status,
          hasResult: updatedExecution.result !== null && updatedExecution.result !== undefined,
          resultChars: getResultChars(updatedExecution.result),
          hasError: Boolean(updatedExecution.error),
        });

        if (updatedExecution.status === 'success' || updatedExecution.status === 'error') {
          eventBus.emit('tool:execution-completed', { execution: updatedExecution });
        }
      },

      completeToolExecution: (id: string, result: any, status: 'success' | 'error', error?: string) => {
        const execution = get().toolExecutions[id];
        if (!execution) {
          logger.warn(`Attempted to complete non-existent execution (ID: ${id})`);
          return;
        }

        const completedExecution: ToolExecution = {
          ...execution,
          result,
          status,
          error,
          timestamp: Date.now(),
        };

        set(state => ({
          toolExecutions: { ...state.toolExecutions, [id]: completedExecution },
          isExecuting: Object.values(state.toolExecutions).some(ex => ex.id !== id && ex.status === 'pending'),
        }));

        const pending = pendingTelemetry.get(id);
        if (pending) {
          if (status === 'success') mcpTelemetry.success(pending, result);
          else mcpTelemetry.error(pending, error ? new Error(error) : new Error('Unknown execution error'));
          pendingTelemetry.delete(id);
        }

        logger.debug(`Execution ${status} (ID: ${id})`, {
          toolName: execution.toolName,
          resultChars: getResultChars(result),
          hasError: Boolean(error),
        });

        eventBus.emit('tool:execution-completed', { execution: completedExecution });
        if (status === 'error') {
          eventBus.emit('tool:execution-failed', {
            toolName: execution.toolName,
            error: error || 'Unknown execution error',
            callId: id,
          });
        }
      },

      getToolExecution: (id: string): ToolExecution | undefined => get().toolExecutions[id],

      enableTool: (toolName: string) => {
        set(state => {
          const newEnabledTools = new Set([...state.enabledTools, toolName]);
          saveToolEnablementState(newEnabledTools).catch(error =>
            logger.error('[ToolStore] Failed to save tool enablement state:', error),
          );
          return { enabledTools: newEnabledTools };
        });
        logger.debug(`Tool enabled: ${toolName}`);
      },

      disableTool: (toolName: string) => {
        set(state => {
          const newEnabledTools = new Set(state.enabledTools);
          newEnabledTools.delete(toolName);
          saveToolEnablementState(newEnabledTools).catch(error =>
            logger.error('[ToolStore] Failed to save tool enablement state:', error),
          );
          return { enabledTools: newEnabledTools };
        });
        logger.debug(`Tool disabled: ${toolName}`);
      },

      enableAllTools: () => {
        set(state => {
          const newEnabledTools = new Set(state.availableTools.map(tool => tool.name));
          saveToolEnablementState(newEnabledTools).catch(error =>
            logger.error('[ToolStore] Failed to save tool enablement state:', error),
          );
          return { enabledTools: newEnabledTools };
        });
        logger.debug('[ToolStore] All tools enabled');
      },

      disableAllTools: () => {
        const newEnabledTools = new Set<string>();
        set({ enabledTools: newEnabledTools });
        saveToolEnablementState(newEnabledTools).catch(error =>
          logger.error('[ToolStore] Failed to save tool enablement state:', error),
        );
        logger.debug('[ToolStore] All tools disabled');
      },

      isToolEnabled: (toolName: string): boolean => get().enabledTools.has(toolName),

      loadToolEnablementState: async () => {
        set({ isLoadingEnablement: true });
        try {
          const storedEnabledTools = await getToolEnablementState();
          const state = get();

          if (storedEnabledTools.size === 0 && state.availableTools.length > 0) {
            const allToolsEnabled = new Set(state.availableTools.map(tool => tool.name));
            set({ enabledTools: allToolsEnabled, isLoadingEnablement: false });
            await saveToolEnablementState(allToolsEnabled);
            logger.debug('[ToolStore] No stored state found, enabled all tools by default');
          } else {
            set({ enabledTools: storedEnabledTools, isLoadingEnablement: false });
            logger.debug(`Tool enablement state loaded: ${storedEnabledTools.size} tools enabled`);
          }
        } catch (error) {
          logger.error('[ToolStore] Failed to load tool enablement state:', error);
          set({ isLoadingEnablement: false });
        }
      },
    }),
    { name: 'ToolStore', store: 'tool' },
  ),
);
