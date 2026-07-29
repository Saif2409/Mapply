const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mapply", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  quit: () => ipcRenderer.invoke("app-quit"),
  toggleFullscreen: () => ipcRenderer.invoke("toggle-fullscreen"),
  isElectron: true,

  // Connectors. Only ever reports whether a site has a session — never reads or
  // stores credentials; you sign in inside the embedded browser yourself.
  browserPartition: "persist:mapply-jobsites",
  connectorStatus: (domains) => ipcRenderer.invoke("connector-status", domains),
  connectorDisconnect: (domain) => ipcRenderer.invoke("connector-disconnect", domain),
  connectorDebug: () => ipcRenderer.invoke("connector-debug"),

  // Drag a generated CV/cover letter into a page's upload field.
  startFileDrag: (filePath) => ipcRenderer.send("start-file-drag", filePath),
});
