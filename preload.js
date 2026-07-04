const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('win-minimize'),
  hide: () => ipcRenderer.send('win-hide'),
  setPin: (flag) => ipcRenderer.send('win-pin', flag),
  setEdgeHide: (flag) => ipcRenderer.send('edge-hide', flag),
  notify: (title, body) => ipcRenderer.send('notify', title, body),
  exportData: (content, filename) => ipcRenderer.invoke('export-data', content, filename),
  importData: () => ipcRenderer.invoke('import-data'),
  loadData: () => ipcRenderer.invoke('load-data'),
  saveData: (content) => ipcRenderer.send('save-data', content),
  getDataDir: () => ipcRenderer.invoke('get-data-dir'),
  chooseDataDir: (currentContent) => ipcRenderer.invoke('choose-data-dir', currentContent)
});
