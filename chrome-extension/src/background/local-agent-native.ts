const LOCAL_AGENT_HOST = 'com.superpower.local_agent';
const LOCAL_AGENT_MESSAGE_TYPE = 'local-agent:request';

const ALLOWED_ACTIONS = new Set([
  'ping',
  'capabilities',
  'memory.remember',
  'memory.forget',
  'memory.resolve',
  'memory.list',
  'memory.add_root',
  'memory.list_roots',
  'file.search',
  'file.open',
]);

interface LocalAgentBridgeMessage {
  type: typeof LOCAL_AGENT_MESSAGE_TYPE;
  payload?: {
    id?: string | number;
    action?: string;
    args?: Record<string, unknown>;
  };
}

interface LocalAgentBridgeResponse {
  success: boolean;
  payload?: unknown;
  error?: string;
}

const isLocalAgentMessage = (message: unknown): message is LocalAgentBridgeMessage => {
  if (!message || typeof message !== 'object') return false;
  return (message as { type?: unknown }).type === LOCAL_AGENT_MESSAGE_TYPE;
};

const validateRequest = (message: LocalAgentBridgeMessage): string | null => {
  const action = message.payload?.action;
  if (!action || typeof action !== 'string') return 'Local Agent action is required.';
  if (!ALLOWED_ACTIONS.has(action)) return `Local Agent action is not allowed: ${action}`;

  if (action === 'file.open' && message.payload?.args?.approved !== true) {
    return 'Opening a local file requires explicit user approval.';
  }
  return null;
};

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: LocalAgentBridgeResponse) => void) => {
  if (!isLocalAgentMessage(message)) return false;

  if (sender.id && sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: 'Rejected Local Agent request from another extension.' });
    return false;
  }

  const validationError = validateRequest(message);
  if (validationError) {
    sendResponse({ success: false, error: validationError });
    return false;
  }

  chrome.runtime
    .sendNativeMessage(LOCAL_AGENT_HOST, message.payload)
    .then(payload => sendResponse({ success: true, payload }))
    .catch(error => {
      const detail = error instanceof Error ? error.message : String(error);
      sendResponse({
        success: false,
        error:
          detail ||
          'Superpower Local Agent is not available. Install the C++ native host and restart the browser.',
      });
    });

  return true;
});

export const LOCAL_AGENT_REQUEST_TYPE = LOCAL_AGENT_MESSAGE_TYPE;
