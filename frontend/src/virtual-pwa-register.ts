/** PWA 注册桩（AIDriveWorkflow 暂未启用 vite-plugin-pwa，接口与 virtual:pwa-register 兼容） */
type UpdateSW = (reloadPage?: boolean) => Promise<void>;

export function registerSW(_options?: {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegistered?: (registration: unknown) => void;
  onRegisterError?: (error: unknown) => void;
}): UpdateSW {
  return async () => {
    if (typeof window !== 'undefined') window.location.reload();
  };
}
