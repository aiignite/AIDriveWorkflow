import React, { useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';

const DISMISS_KEY = 'plm_pwa_install_dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * PWA install / update prompt for mobile portal.
 * - Android/Chrome: beforeinstallprompt
 * - iOS Safari: Add to Home Screen hint
 * - Service Worker update: reload prompt
 */
const PwaInstallPrompt: React.FC = () => {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [visible, setVisible] = useState(false);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Register SW (production build with vite-plugin-pwa)
    void (async () => {
      try {
        const mod = await import('virtual:pwa-register');
        if (cancelled) return;
        const update = mod.registerSW({
          immediate: true,
          onNeedRefresh() {
            if (!cancelled) setNeedRefresh(true);
          },
        });
        setUpdateSW(() => update);
      } catch {
        /* virtual module unavailable in tests / non-PWA builds */
      }
    })();

    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      /* ignore */
    }

    const isStandalone =
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches) ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    if (!window.location.pathname.startsWith('/m')) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    const ua = navigator.userAgent || '';
    const isIos = /iPad|iPhone|iPod/.test(ua);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIos && isSafari) {
      setShowIosHint(true);
      setVisible(true);
    }

    return () => {
      cancelled = true;
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    setShowIosHint(false);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    setDeferred(null);
    setVisible(false);
  };

  if (needRefresh) {
    return (
      <div className="fixed bottom-24 left-3 right-3 z-[60] rounded-xl bg-blue-600 text-white p-3 shadow-lg flex items-center gap-3 max-w-lg mx-auto">
        <p className="text-sm flex-1">有新版本可用</p>
        <button
          type="button"
          className="text-sm font-medium px-3 py-1.5 bg-white/20 rounded-lg"
          onClick={() => updateSW?.(true)}
        >
          刷新
        </button>
        <button type="button" aria-label="关闭" onClick={() => setNeedRefresh(false)}>
          <X size={16} />
        </button>
      </div>
    );
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-24 left-3 right-3 z-[60] rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-3 shadow-lg flex items-start gap-3 max-w-lg mx-auto">
      <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
        {showIosHint ? <Share size={18} className="text-blue-600" /> : <Download size={18} className="text-blue-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">安装到主屏幕</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {showIosHint
            ? '点击底部分享按钮，选择「添加到主屏幕」'
            : '安装后可像 App 一样快速打开移动工作台'}
        </p>
        {deferred && (
          <button
            type="button"
            onClick={install}
            className="mt-2 text-xs font-medium text-white bg-blue-600 px-3 py-1.5 rounded-lg"
          >
            立即安装
          </button>
        )}
      </div>
      <button type="button" aria-label="关闭" onClick={dismiss} className="text-gray-400">
        <X size={16} />
      </button>
    </div>
  );
};

export default PwaInstallPrompt;
