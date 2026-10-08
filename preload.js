'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('imcheck', {
  pick: () => ipcRenderer.invoke('pick'),
  analyze: (f) => ipcRenderer.invoke('analyze', f),
  readFile: (f) => ipcRenderer.invoke('read-file', f),
  saveReport: (n, c) => ipcRenderer.invoke('save-report', n, c),
  reveal: (f) => ipcRenderer.invoke('reveal', f),
  pathOf: (file) => webUtils.getPathForFile(file),
});
