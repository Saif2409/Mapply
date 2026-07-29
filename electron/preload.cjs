const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mapply", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  quit: () => ipcRenderer.invoke("app-quit"),
  toggleFullscreen: () => ipcRenderer.invoke("toggle-fullscreen"),
  isElectron: true,
});
