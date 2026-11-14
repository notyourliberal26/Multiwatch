const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  load: (board) => ipcRenderer.invoke('state:load', board),
  save: (state, board) => ipcRenderer.invoke('state:save', state, board),
  openBoard: (id) => ipcRenderer.invoke('board:open', id),
  resolveYouTube: (channelPath) => ipcRenderer.invoke('youtube:resolve', channelPath),
  toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  logDrop: (details) => ipcRenderer.invoke('log:drop', details),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  openDesks: (kind) => ipcRenderer.invoke('desks:open', kind),
  loadDesks: (kind) => ipcRenderer.invoke('desks:load', kind),
  saveDesks: (view, kind) => ipcRenderer.invoke('desks:save', view, kind),
});
