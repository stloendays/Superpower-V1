import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { generateInstructionsJsonDetailed } from './instructionGeneratorJson';
import { useToolEnablement, useUserPreferences } from '../../../hooks';
import { useCurrentAdapter } from '../../../hooks/useAdapter';
import { Typography } from '../ui';
import { cn } from '@src/lib/utils';
import { logMessage } from '@src/utils/helpers';
import { createLogger } from '@extension/shared/lib/logger';

const logger = createLogger('InstructionManager');
const AUTO_ROUTE_DEBOUNCE_MS = 350;
const MAX_ROUTING_QUERY_CHARS = 2_000;

const normalizeRoutingQuery = (value: string | null | undefined): string =>
  (value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_ROUTING_QUERY_CHARS);

/**
 * Small external store used by the popover/capture layer. Instruction generation
 * itself remains React-driven; there is intentionally no polling loop.
 */
export const instructionsState = {
  instructions: '',
  updating: false,
  listeners: [] as ((instructions: string) => void)[],

  setInstructions(newInstructions: string) {
    if (!newInstructions || instructionsState.instructions === newInstructions || instructionsState.updating) return;

    instructionsState.updating = true;
    instructionsState.instructions = newInstructions;
    try {
      instructionsState.listeners.slice().forEach(listener => {
        try {
          listener(newInstructions);
        } catch (error) {
          logger.error('[InstructionsState] Listener failed:', error);
        }
      });
    } finally {
      instructionsState.updating = false;
    }
  },

  subscribe(listener: (instructions: string) => void) {
    instructionsState.listeners.push(listener);
    return () => {
      const index = instructionsState.listeners.indexOf(listener);
      if (index >= 0) instructionsState.listeners.splice(index, 1);
    };
  },
};

interface InstructionManagerProps {
  adapter: any;
  tools: Array<{ name: string; schema: string; description: string }>;
}

interface ActionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  color: 'blue' | 'green' | 'red' | 'slate';
  label: string;
}

const ActionButton: React.FC<ActionButtonProps> = ({ onClick, disabled, color, label }) => {
  const colorClasses = {
    blue: 'text-blue-700 dark:text-blue-500 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-800/40',
    green:
      'text-green-700 dark:text-green-500 bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-800/40',
    red: 'text-red-700 dark:text-red-500 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-800/40',
    slate: 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-[70px] rounded px-2 py-1 text-center text-xs font-medium transition-colors',
        disabled ? colorClasses.slate : colorClasses[color],
      )}>
      {label}
    </button>
  );
};

const InstructionManager: React.FC<InstructionManagerProps> = ({ tools }) => {
  const { preferences, updatePreferences } = useUserPreferences();
  const { enabledTools: enabledToolsSet, isToolEnabled } = useToolEnablement();
  const { plugin: currentPlugin, activeAdapterName, status: adapterStatus } = useCurrentAdapter();

  const [instructions, setInstructions] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [automaticRoutingQuery, setAutomaticRoutingQuery] = useState('');
  const [routingOverride, setRoutingOverride] = useState('');
  const [showRoutingAdvanced, setShowRoutingAdvanced] = useState(false);
  const [showTechnicalInstructions, setShowTechnicalInstructions] = useState(false);
  const [customInstructions, setCustomInstructions] = useState(preferences.customInstructions || '');
  const [customInstructionsEnabled, setCustomInstructionsEnabled] = useState(
    preferences.customInstructionsEnabled || false,
  );
  const [isEditingCustom, setIsEditingCustom] = useState(false);

  useEffect(() => {
    setCustomInstructions(preferences.customInstructions || '');
    setCustomInstructionsEnabled(preferences.customInstructionsEnabled || false);
  }, [preferences.customInstructions, preferences.customInstructionsEnabled]);

  /**
   * Read the current website composer only when the page emits input/focus events.
   * This keeps automatic routing local and event-driven without bringing back the
   * old instruction polling loop. The draft text is kept in component state only.
   */
  useEffect(() => {
    let debounceTimer: number | null = null;

    const refreshAutomaticRouting = () => {
      let nextQuery = '';
      try {
        nextQuery = normalizeRoutingQuery(currentPlugin?.getCurrentPromptText?.());
      } catch (error) {
        logger.debug('[InstructionManager] Prompt context is not available from the active adapter:', error);
      }
      setAutomaticRoutingQuery(current => (current === nextQuery ? current : nextQuery));
    };

    const scheduleRefresh = () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(refreshAutomaticRouting, AUTO_ROUTE_DEBOUNCE_MS);
    };

    refreshAutomaticRouting();
    document.addEventListener('input', scheduleRefresh, true);
    document.addEventListener('change', scheduleRefresh, true);
    document.addEventListener('focusin', scheduleRefresh, true);

    return () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      document.removeEventListener('input', scheduleRefresh, true);
      document.removeEventListener('change', scheduleRefresh, true);
      document.removeEventListener('focusin', scheduleRefresh, true);
    };
  }, [currentPlugin, activeAdapterName, adapterStatus]);

  /**
   * Include the full schema in the signature. The previous name+description
   * signature could miss a server-side schema change and leave stale instructions.
   */
  const toolsSignature = useMemo(
    () =>
      tools
        .map(tool => `${tool.name}\u0000${tool.description || ''}\u0000${tool.schema || ''}`)
        .sort()
        .join('\u0001'),
    [tools],
  );

  const enabledTools = useMemo(
    () => tools.filter(tool => isToolEnabled(tool.name)),
    [tools, toolsSignature, enabledToolsSet, isToolEnabled],
  );

  const routingQuery = useMemo(
    () => normalizeRoutingQuery(routingOverride) || automaticRoutingQuery,
    [routingOverride, automaticRoutingQuery],
  );
  const isManualRouting = Boolean(normalizeRoutingQuery(routingOverride));
  const isAutomaticRouting = !isManualRouting && Boolean(automaticRoutingQuery);

  const generation = useMemo(
    () =>
      generateInstructionsJsonDetailed(enabledTools, customInstructions, customInstructionsEnabled, {
        routingQuery,
        maxTools: routingQuery ? 12 : 24,
        maxInstructionChars: 24_000,
      }),
    [enabledTools, customInstructions, customInstructionsEnabled, routingQuery],
  );

  const generatedInstructions = generation.instructions;

  /**
   * Instruction state is event/dependency driven. Automatic task-context changes
   * regenerate once after the debounce rather than continuously polling tools.
   */
  useEffect(() => {
    if (isEditing) return;
    setInstructions(current => (current === generatedInstructions ? current : generatedInstructions));
    instructionsState.setInstructions(generatedInstructions);
    logMessage(
      `[InstructionManager] Injected ${generation.stats.selectedTools}/${enabledTools.length} enabled tools (~${generation.stats.estimatedTokens} tokens)`,
    );
  }, [
    generatedInstructions,
    generation.stats.selectedTools,
    generation.stats.estimatedTokens,
    enabledTools.length,
    isEditing,
  ]);

  useEffect(
    () =>
      instructionsState.subscribe(newInstructions => {
        if (isEditing) return;
        setInstructions(current => (current === newInstructions ? current : newInstructions));
      }),
    [isEditing],
  );

  const handleSave = useCallback(() => {
    setIsEditing(false);
    instructionsState.setInstructions(instructions);
  }, [instructions]);

  const handleCancel = useCallback(() => {
    setInstructions(generatedInstructions);
    instructionsState.setInstructions(generatedInstructions);
    setIsEditing(false);
  }, [generatedInstructions]);

  const handleCustomInstructionsToggle = useCallback(
    async (enabled: boolean) => {
      setCustomInstructionsEnabled(enabled);
      try {
        await Promise.resolve(updatePreferences({ customInstructionsEnabled: enabled }));
      } catch (error) {
        logger.error('[InstructionManager] Failed to save custom-instruction toggle:', error);
      }
    },
    [updatePreferences],
  );

  const handleCustomInstructionsSave = useCallback(async () => {
    setIsEditingCustom(false);
    try {
      await Promise.resolve(updatePreferences({ customInstructions }));
    } catch (error) {
      logger.error('[InstructionManager] Failed to save custom instructions:', error);
    }
  }, [customInstructions, updatePreferences]);

  const handleCustomInstructionsCancel = useCallback(() => {
    setCustomInstructions(preferences.customInstructions || '');
    setIsEditingCustom(false);
  }, [preferences.customInstructions]);

  const budgetPercent = Math.round(Math.min(1, generation.stats.budgetUtilization) * 100);
  const omittedTools = generation.stats.omittedByRouter + generation.stats.omittedByBudget;
  const adapterLabel = (activeAdapterName || 'browser').replace(/Adapter$/i, '');

  return (
    <div className="space-y-3">
      <div className="sidebar-card rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Typography variant="h4" className="text-slate-700 dark:text-slate-300">
                  Smart tool selection
                </Typography>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium',
                    routingQuery
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                  )}>
                  {isManualRouting ? 'Override' : isAutomaticRouting ? 'Automatic' : 'Ready'}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {isAutomaticRouting
                  ? `Superpower is using your current ${adapterLabel} prompt to prepare ${generation.stats.selectedTools} relevant tools.`
                  : isManualRouting
                    ? `Using your advanced override to prepare ${generation.stats.selectedTools} relevant tools.`
                    : `Start typing in ${adapterLabel}; Superpower will automatically prepare the tools for your request.`}
              </div>
              {routingQuery && omittedTools > 0 && (
                <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-500">
                  {omittedTools} unrelated or excess tools kept out of the prompt.
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowRoutingAdvanced(value => !value)}
              className="shrink-0 rounded px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">
              {showRoutingAdvanced ? 'Hide' : 'Advanced'}
            </button>
          </div>

          {showRoutingAdvanced && (
            <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
              <label
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                htmlFor="mcp-task-focus-override">
                Tool-selection override <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id="mcp-task-focus-override"
                type="text"
                value={routingOverride}
                onChange={event => setRoutingOverride(event.target.value)}
                placeholder="Only needed when you want to override automatic selection"
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              />
              <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                Leave empty for automatic selection. This setting changes local routing only and is not sent as an extra
                AI request.
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="sidebar-card rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 p-3 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Typography variant="h4" className="text-slate-700 dark:text-slate-300">
              Custom Instructions
            </Typography>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={customInstructionsEnabled}
                onChange={event => handleCustomInstructionsToggle(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 bg-gray-100 text-blue-600 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:ring-offset-gray-800 dark:focus:ring-blue-600"
              />
              <span className="text-xs text-slate-600 dark:text-slate-400">Enable</span>
            </label>
          </div>
          <div className="flex items-center gap-1.5">
            {isEditingCustom ? (
              <>
                <ActionButton onClick={handleCustomInstructionsSave} color="green" label="Save" />
                <ActionButton onClick={handleCustomInstructionsCancel} color="red" label="Cancel" />
              </>
            ) : (
              <ActionButton
                onClick={() => setIsEditingCustom(true)}
                color="blue"
                label="Edit"
                disabled={!customInstructionsEnabled}
              />
            )}
          </div>
        </div>

        <div className="bg-white p-3 dark:bg-slate-900">
          {isEditingCustom ? (
            <textarea
              value={customInstructions}
              onChange={event => setCustomInstructions(event.target.value)}
              placeholder="Enter your custom instructions here..."
              className="h-32 w-full rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-blue-400 dark:focus:ring-blue-400"
            />
          ) : (
            <div className="scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600 max-h-32 overflow-y-auto">
              {customInstructionsEnabled && customInstructions ? (
                <pre className="whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {customInstructions}
                </pre>
              ) : (
                <div className="p-3 text-xs italic text-slate-500 dark:text-slate-400">
                  {customInstructionsEnabled ? 'No custom instructions set' : 'Custom instructions disabled'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="sidebar-card rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between p-3">
          <div>
            <Typography variant="h4" className="text-slate-700 dark:text-slate-300">
              Technical details
            </Typography>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {generation.stats.selectedTools}/{enabledTools.length} tools · ~
              {generation.stats.estimatedTokens.toLocaleString()} tokens · {budgetPercent}% context budget
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowTechnicalInstructions(value => !value)}
            className="rounded px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            {showTechnicalInstructions ? 'Hide' : 'View'}
          </button>
        </div>

        {showTechnicalInstructions && (
          <>
            <div className="flex items-center justify-end gap-1.5 border-t border-slate-200 px-3 py-2 dark:border-slate-700">
              {isEditing ? (
                <>
                  <ActionButton onClick={handleSave} color="green" label="Save" />
                  <ActionButton onClick={handleCancel} color="red" label="Cancel" />
                </>
              ) : (
                <ActionButton onClick={() => setIsEditing(true)} color="blue" label="Edit" />
              )}
            </div>
            <div className="border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              {isEditing ? (
                <textarea
                  value={instructions}
                  onChange={event => setInstructions(event.target.value)}
                  className="h-64 w-full rounded-md border border-slate-300 bg-white p-2 font-mono text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-blue-400 dark:focus:ring-blue-400"
                />
              ) : (
                <div className="scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600 max-h-64 overflow-y-auto">
                  <pre className="whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {instructions}
                  </pre>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default InstructionManager;
