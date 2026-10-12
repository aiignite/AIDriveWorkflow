/** virtual:pwa-register 模块声明（运行时由 src/virtual-pwa-register.ts 桩实现） */
declare module 'virtual:pwa-register' {
  export type RegisterSWOptions = {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: unknown) => void;
    onRegisterError?: (error: unknown) => void;
  };
  export type UpdateSW = (reloadPage?: boolean) => Promise<void>;
  export function registerSW(options?: RegisterSWOptions): UpdateSW;
}
