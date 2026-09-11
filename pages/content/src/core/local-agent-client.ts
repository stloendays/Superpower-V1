const LOCAL_AGENT_MESSAGE_TYPE = 'local-agent:request';

export type LocalAgentAction =
  | 'ping'
  | 'capabilities'
  | 'memory.remember'
  | 'memory.forget'
  | 'memory.resolve'
  | 'memory.list'
  | 'memory.add_root'
  | 'memory.list_roots'
  | 'file.search'
  | 'file.open'
  | 'gui.notify';

export type DesktopGuiMessageKind = 'message' | 'status' | 'success' | 'warning' | 'error';

export interface LocalAgentRequest {
  id?: string | number;
  action: LocalAgentAction;
  args?: Record<string, unknown>;
}

interface LocalAgentBridgeResponse {
  success: boolean;
  payload?: unknown;
  error?: string;
}

export interface DesktopGuiNotification {
  text: string;
  role?: string;
  source?: string;
  kind?: DesktopGuiMessageKind;
}

let nativeUnavailableUntil = 0;
const NATIVE_FAILURE_COOLDOWN_MS = 30_000;

export const callLocalAgent = async (request: LocalAgentRequest): Promise<unknown> => {
  const response = (await chrome.runtime.sendMessage({
    type: LOCAL_AGENT_MESSAGE_TYPE,
    payload: request,
  })) as LocalAgentBridgeResponse | undefined;

  if (!response?.success) {
    throw new Error(response?.error || 'Superpower Local Agent request failed.');
  }
  return response.payload;
};

export const notifyDesktopGui = async (notification: DesktopGuiNotification): Promise<boolean> => {
  const text = notification.text.trim();
  if (!text || Date.now() < nativeUnavailableUntil) return false;

  try {
    const payload = (await callLocalAgent({
      action: 'gui.notify',
      args: {
        text,
        role: notification.role || 'Assistant',
        source: notification.source || 'Browser',
        kind: notification.kind || 'message',
      },
    })) as { ok?: boolean; result?: { delivered?: boolean } } | undefined;

    nativeUnavailableUntil = 0;
    return payload?.ok === true && payload.result?.delivered === true;
  } catch {
    nativeUnavailableUntil = Date.now() + NATIVE_FAILURE_COOLDOWN_MS;
    return false;
  }
};
