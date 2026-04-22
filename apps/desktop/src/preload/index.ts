import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type OrchestralApi } from '../shared/ipc-contract'

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
  },
}

contextBridge.exposeInMainWorld('orchestral', api)
