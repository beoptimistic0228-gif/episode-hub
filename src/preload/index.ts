import { contextBridge, ipcRenderer } from 'electron';

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
};

contextBridge.exposeInMainWorld('hub', api);
export type HubApi = typeof api;
