import { notifyDesktopGui } from '../core/local-agent-client';
import { createLogger } from '@extension/shared/lib/logger';

const logger = createLogger('AssistantMessageMirror');
const STABLE_MESSAGE_DELAY_MS = 1500;
const MAX_BROWSER_MESSAGE_CHARS = 16_000;

interface SiteMessageConfig {
  source: string;
  selectors: string[];
}

const SITE_CONFIGS: Array<{ matches: (hostname: string) => boolean; config: SiteMessageConfig }> = [
  {
    matches: hostname => hostname === 'chatgpt.com' || hostname.endsWith('.chatgpt.com'),
    config: {
      source: 'ChatGPT',
      selectors: [
        '[data-message-author-role="assistant"] .markdown',
        '[data-message-author-role="assistant"] [class*="markdown"]',
        '[data-message-author-role="assistant"]',
      ],
    },
  },
  {
    matches: hostname => hostname === 'gemini.google.com' || hostname.endsWith('.gemini.google.com'),
    config: {
      source: 'Gemini',
      selectors: [
        'model-response .markdown',
        'model-response .model-response-text',
        '[data-test-id="model-response"] .markdown',
        '[data-test-id="model-response"]',
        'model-response',
      ],
    },
  },
];

let observer: MutationObserver | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastDeliveredText = '';
let activeConfig: SiteMessageConfig | null = null;
let domReadyHandler: (() => void) | null = null;

const normalizeMessage = (value: string): string =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const readLatestAssistantMessage = (config: SiteMessageConfig): string => {
  const candidates: Element[] = [];
  const seen = new Set<Element>();

  for (const selector of config.selectors) {
    document.querySelectorAll(selector).forEach(element => {
      if (!seen.has(element)) {
        seen.add(element);
        candidates.push(element);
      }
    });
  }

  if (candidates.length === 0) return '';
  candidates.sort((left, right) => {
    if (left === right) return 0;
    const position = left.compareDocumentPosition(right);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  const latest = candidates[candidates.length - 1] as HTMLElement;
  return normalizeMessage(latest.innerText || latest.textContent || '').slice(0, MAX_BROWSER_MESSAGE_CHARS);
};

const cancelPendingFlush = (): void => {
  if (!flushTimer) return;
  clearTimeout(flushTimer);
  flushTimer = null;
};

const scheduleStableMessageFlush = (): void => {
  if (!activeConfig) return;
  cancelPendingFlush();

  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!activeConfig) return;

    const text = readLatestAssistantMessage(activeConfig);
    if (!text || text === lastDeliveredText) return;

    lastDeliveredText = text;
    void notifyDesktopGui({
      text,
      role: 'Assistant',
      source: activeConfig.source,
      kind: 'message',
    });
  }, STABLE_MESSAGE_DELAY_MS);
};

const startObserver = (): void => {
  if (observer || !activeConfig || !document.body) return;

  // Establish a baseline so opening Superpower does not mirror old conversation
  // content into the desktop GUI. Only subsequent stable changes are forwarded.
  lastDeliveredText = readLatestAssistantMessage(activeConfig);

  observer = new MutationObserver(() => scheduleStableMessageFlush());
  observer.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
  });

  logger.debug(`[AssistantMessageMirror] Watching new ${activeConfig.source} replies.`);
};

export const initializeAssistantMessageMirrorService = (): void => {
  if (observer || domReadyHandler) return;

  const hostname = window.location.hostname.toLowerCase();
  activeConfig = SITE_CONFIGS.find(entry => entry.matches(hostname))?.config || null;
  if (!activeConfig) return;

  if (document.body) {
    startObserver();
    return;
  }

  domReadyHandler = () => {
    domReadyHandler = null;
    startObserver();
  };
  document.addEventListener('DOMContentLoaded', domReadyHandler, { once: true });
};

export const cleanupAssistantMessageMirrorService = (): void => {
  cancelPendingFlush();
  observer?.disconnect();
  observer = null;

  if (domReadyHandler) {
    document.removeEventListener('DOMContentLoaded', domReadyHandler);
    domReadyHandler = null;
  }

  lastDeliveredText = '';
  activeConfig = null;
  logger.debug('[AssistantMessageMirror] Reply mirroring cleaned up.');
};
