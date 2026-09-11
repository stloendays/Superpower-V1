import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../ui';

const ONBOARDING_KEY = 'superpower:onboarding:v1';

interface OnboardingState {
  completed?: boolean;
  dismissed?: boolean;
}

interface FirstRunOnboardingProps {
  isConnected: boolean;
}

const readOnboardingState = (): Promise<OnboardingState> =>
  new Promise(resolve => {
    try {
      chrome.storage.local.get(ONBOARDING_KEY, result => {
        if (chrome.runtime.lastError) {
          resolve({});
          return;
        }
        const value = result[ONBOARDING_KEY];
        resolve(value && typeof value === 'object' ? (value as OnboardingState) : {});
      });
    } catch {
      resolve({});
    }
  });

const writeOnboardingState = (state: OnboardingState): Promise<void> =>
  new Promise(resolve => {
    try {
      chrome.storage.local.set({ [ONBOARDING_KEY]: state }, () => resolve());
    } catch {
      resolve();
    }
  });

const FirstRunOnboarding: React.FC<FirstRunOnboardingProps> = ({ isConnected }) => {
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    readOnboardingState()
      .then(state => {
        if (!active) return;
        const finished = state.completed || state.dismissed;
        setVisible(!finished && !isConnected);
        setLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setVisible(!isConnected);
        setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded || !isConnected) return;

    setVisible(false);
    writeOnboardingState({ completed: true }).catch(() => undefined);
  }, [isConnected, loaded]);

  const dismiss = useCallback(() => {
    setVisible(false);
    writeOnboardingState({ dismissed: true }).catch(() => undefined);
  }, []);

  if (!loaded || !visible || isConnected) return null;

  return (
    <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-800 dark:bg-blue-950/25">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-900 dark:text-blue-100">
            <Icon name="sparkles" size="xs" />
            Get started with Superpower
          </div>
          <p className="mt-1 text-[10px] leading-4 text-blue-700 dark:text-blue-300">
            You only need to connect MCP once. After that, ask normally in ChatGPT or Gemini and Superpower will prepare the relevant tools automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss getting started"
          className="shrink-0 rounded p-1 text-blue-500 hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900/40 dark:hover:text-blue-200">
          <Icon name="x" size="xs" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5 text-[9px] leading-3 text-slate-600 dark:text-slate-300">
        <div className="rounded-md bg-white/80 p-2 dark:bg-slate-900/60">
          <div className="font-semibold text-blue-700 dark:text-blue-300">1 · Paste</div>
          <div className="mt-0.5">MCP URL or JSON config</div>
        </div>
        <div className="rounded-md bg-white/80 p-2 dark:bg-slate-900/60">
          <div className="font-semibold text-blue-700 dark:text-blue-300">2 · Connect</div>
          <div className="mt-0.5">Superpower checks setup</div>
        </div>
        <div className="rounded-md bg-white/80 p-2 dark:bg-slate-900/60">
          <div className="font-semibold text-blue-700 dark:text-blue-300">3 · Ask</div>
          <div className="mt-0.5">Use ChatGPT normally</div>
        </div>
      </div>
    </div>
  );
};

export default FirstRunOnboarding;
