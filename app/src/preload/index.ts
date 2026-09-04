/**
 * contextBridge — the only surface the Agent UI gets into the main process:
 * core base/state, window controls, app toggles, shell actions.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

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

const api = {
  /** Resolved core REST base (http://127.0.0.1:<port>) or null. */
  coreBase: (): Promise<string | null> => ipcRenderer.invoke('core:base'),
  appInfo: (): Promise<{ version: string; platform: string }> => ipcRenderer.invoke('app:info'),
  /** Subscribe to core lifecycle changes. Returns an unsubscribe fn. */
  onCoreState: (cb: (s: CoreStateMsg) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, s: CoreStateMsg): void => cb(s);
    ipcRenderer.on('core:state', listener);
    return () => ipcRenderer.removeListener('core:state', listener);
  },
  windowAction: (action: 'minimize' | 'close'): void =>
    ipcRenderer.send('win:action', action),
  setAlwaysOnTop: (on: boolean): Promise<boolean> => ipcRenderer.invoke('win:alwaysOnTop', on),
  autoLaunch: {
    get: (): Promise<boolean> => ipcRenderer.invoke('autoLaunch:get'),
    set: (on: boolean): Promise<boolean> => ipcRenderer.invoke('autoLaunch:set', on),
  },
  openExtensionsPage: (): void => ipcRenderer.send('shell:openExtensions'),
  openExternal: (url: string): void => ipcRenderer.send('shell:openExternal', url),
  openConfigDir: (): void => ipcRenderer.send('shell:openConfigDir'),
  openExtDir: (): void => ipcRenderer.send('shell:openExtDir'),
  extInfo: (): Promise<ExtInfo> => ipcRenderer.invoke('ext:info'),
  updater: {
    status: (): Promise<UpdaterStatus> => ipcRenderer.invoke('updater:status'),
    check: (): Promise<UpdaterStatus> => ipcRenderer.invoke('updater:check'),
    download: (): Promise<UpdaterStatus> => ipcRenderer.invoke('updater:download'),
    quitAndInstall: (): Promise<boolean> => ipcRenderer.invoke('updater:quitAndInstall'),
    onStatus: (cb: (s: UpdaterStatus) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, s: UpdaterStatus): void => cb(s);
      ipcRenderer.on('updater:status', listener);
      return () => ipcRenderer.removeListener('updater:status', listener);
    },
  },
};

contextBridge.exposeInMainWorld('tomi', api);

export type TomiApi = typeof api;
