import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC_CHANNELS,
  type AppSettings,
  type LiveSessionEvent,
  type LiveSessionStatusUpdate,
  type OrchestralApi,
  type SecretKeyName,
  type StartSessionParams,
} from '../shared/ipc-contract'

function onChannel<P>(
  channel: string,
  callback: (payload: P) => void,
): () => void {
  const listener = (_event: IpcRendererEvent, payload: P) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.off(channel, listener)
  }
}

const api: OrchestralApi = {
  project: {
    pick: () => ipcRenderer.invoke(IPC_CHANNELS.projectPick),
    recent: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.projectRecentList),
      remove: (path: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.projectRecentRemove, path),
    },
  },
  sessions: {
    list: (projectPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.sessionsList, projectPath),
    read: (projectPath: string, sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.sessionsRead, projectPath, sessionId),
    start: (params: StartSessionParams) =>
      ipcRenderer.invoke(IPC_CHANNELS.sessionStart, params),
    sendInput: (sessionId: string, text: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.sessionInput, sessionId, text),
    cancel: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.sessionCancel, sessionId),
    onEvent: (cb) => onChannel<LiveSessionEvent>(IPC_CHANNELS.sessionEvent, cb),
    onStatus: (cb) =>
      onChannel<LiveSessionStatusUpdate>(IPC_CHANNELS.sessionStatus, cb),
  },
  worktrees: {
    list: (projectPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.worktreesList, projectPath),
    create: (projectPath: string, branchRequest: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.worktreesCreate, projectPath, branchRequest),
    remove: (projectPath: string, worktreePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.worktreesRemove, projectPath, worktreePath),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    set: (partial: Partial<AppSettings>) =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsSet, partial),
  },
  secrets: {
    has: (key: SecretKeyName) => ipcRenderer.invoke(IPC_CHANNELS.secretsHas, key),
    set: (key: SecretKeyName, value: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.secretsSet, key, value),
    delete: (key: SecretKeyName) =>
      ipcRenderer.invoke(IPC_CHANNELS.secretsDelete, key),
  },
}

contextBridge.exposeInMainWorld('orchestral', api)
