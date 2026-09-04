/// <reference types="vite/client" />

/** Minimal typing for the preload bridge (window.tomi). Keep in sync with ../preload/index.ts. */
export interface CoreStateMsg {
  kind: 'adopted' | 'forked' | 'missing' | 'stopped';
  base: string | null;
  reason?: string;
}

export interface ExtInfo {
  prepared: boolean;
  dir: string;
  version: string;
  changed: boolean;
}

export interface UpdaterStatus {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'not-available'
    | 'disabled'
    | 'error';
  version?: string;
  percent?: number;
  message?: string;
}

declare global {
  interface Window {
    tomi?: {
      coreBase: () => Promise<string | null>;
      appInfo: () => Promise<{ version: string; platform: string; coreDist: string }>;
      onCoreState: (cb: (s: CoreStateMsg) => void) => () => void;
      windowAction: (action: 'minimize' | 'close') => void;
      setAlwaysOnTop: (on: boolean) => Promise<boolean>;
      autoLaunch: { get: () => Promise<boolean>; set: (on: boolean) => Promise<boolean> };
      openExtensionsPage: () => void;
      openExternal: (url: string) => void;
      openConfigDir: () => void;
      openExtDir: () => void;
      extInfo: () => Promise<ExtInfo>;
      updater: {
        status: () => Promise<UpdaterStatus>;
        check: () => Promise<UpdaterStatus>;
        download: () => Promise<UpdaterStatus>;
        quitAndInstall: () => Promise<boolean>;
        onStatus: (cb: (s: UpdaterStatus) => void) => () => void;
      };
    };
  }
}

export {};
