import { notifyDesktopGui } from '../core/local-agent-client';
import { eventBus } from '../events/event-bus';
import type { UnsubscribeFunction } from '../events/event-types';
import { createLogger } from '@extension/shared/lib/logger';

const logger = createLogger('DesktopGuiService');
let unsubscribers: UnsubscribeFunction[] = [];

const currentSiteLabel = (): string => {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname.includes('chatgpt.com') || hostname.includes('openai.com')) return 'ChatGPT';
  if (hostname.includes('gemini.google.com')) return 'Gemini';
  if (hostname.includes('perplexity.ai')) return 'Perplexity';
  if (hostname.includes('grok.com') || hostname.includes('x.com') || hostname.includes('twitter.com')) return 'Grok';
  if (hostname.includes('deepseek.com')) return 'DeepSeek';
  if (hostname.includes('mistral.ai')) return 'Mistral';
  if (hostname.includes('github.com')) return 'GitHub Copilot';
  return hostname || 'Browser';
};

const notify = (text: string, kind: 'status' | 'success' | 'error'): void => {
  void notifyDesktopGui({
    text,
    role: 'Tool',
    source: currentSiteLabel(),
    kind,
  });
};

export const initializeDesktopGuiService = (): void => {
  if (unsubscribers.length > 0) return;

  unsubscribers = [
    eventBus.on('tool:execution-started', ({ toolName }) => {
      notify(`Using ${toolName}…`, 'status');
    }),
    eventBus.on('tool:execution-completed', ({ execution }) => {
      if (execution.status === 'error') {
        notify(`${execution.toolName} failed.`, 'error');
        return;
      }
      notify(`${execution.toolName} completed.`, 'success');
    }),
  ];

  logger.debug('[DesktopGuiService] Desktop GUI activity bridge initialized.');
};

export const cleanupDesktopGuiService = (): void => {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
  logger.debug('[DesktopGuiService] Desktop GUI activity bridge cleaned up.');
};
