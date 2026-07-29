const { app, BrowserWindow, ipcMain, nativeImage, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const net = require("net");

const DEV = !app.isPackaged;
const BACKEND_PORT = 8710;
let mainWindow = null;
let backendProc = null;

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: "127.0.0.1" });
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => resolve(false));
  });
}

/**
 * Locate the Python backend.
 *
 * Mapply is workspace-bound by design: the app, Claude Code and the tailoring
 * scripts all read the same `profiles/` and `templates/` folders. So rather than
 * bundling a 270MB virtualenv into the exe, we resolve the backend that lives
 * next to it in the workspace. Candidates are tried in order.
 */
function findBackendDir() {
  const fs = require("fs");

  // A portable build unpacks itself into %TEMP% and runs from there, so
  // process.execPath points at the temp copy — NOT at the release folder the
  // user double-clicked. electron-builder hands us the real location in
  // PORTABLE_EXECUTABLE_DIR; that has to be checked first or every workspace
  // candidate below resolves under %TEMP% and misses.
  const roots = [];
  if (process.env.PORTABLE_EXECUTABLE_DIR) roots.push(process.env.PORTABLE_EXECUTABLE_DIR);
  roots.push(path.dirname(process.execPath));

  const candidates = [];
  if (DEV) {
    candidates.push(path.join(__dirname, "..", "backend"));
  } else {
    for (const root of roots) {
      candidates.push(
        path.join(root, "backend"),               // exe beside backend/
        path.join(root, "..", "backend"),         // exe in <app>/release/
        path.join(root, "..", "..", "backend"),   // exe nested one deeper
      );
    }
    candidates.push(path.join(process.resourcesPath, "backend"));  // bundled fallback
  }

  const hasBackend = (dir) => fs.existsSync(path.join(dir, "main.py"));
  const hasVenv = (dir) => fs.existsSync(path.join(dir, ".venv", "Scripts", "python.exe"));

  // A backend with its virtualenv beats one without: the bundled fallback copy
  // ships the .py files only, and system Python has none of the dependencies.
  return candidates.find((d) => hasBackend(d) && hasVenv(d))
      || candidates.find(hasBackend)
      || candidates[candidates.length - 1];
}

function backendLogPath() {
  return path.join(app.getPath("userData"), "backend.log");
}

async function ensureBackend() {
  // In dev the backend is usually launched separately; only spawn if not running.
  if (await portOpen(BACKEND_PORT)) return { ok: true, spawned: false };
  const fs = require("fs");
  const backendDir = findBackendDir();
  const venvPy = path.join(backendDir, ".venv", "Scripts", "python.exe");
  const python = fs.existsSync(venvPy) ? venvPy : "python";

  // uvicorn's own errors are the only clue when a spawn fails, so they go to a
  // log file instead of /dev/null — a silent failure here is what made the
  // first packaged build look like it simply had no backend.
  let out = "ignore";
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    out = fs.openSync(backendLogPath(), "a");
    fs.writeSync(out, `\n=== ${new Date().toISOString()} dir=${backendDir} python=${python}\n`);
  } catch {}

  try {
    backendProc = spawn(python, ["-m", "uvicorn", "main:app", "--port", String(BACKEND_PORT)], {
      cwd: backendDir,
      stdio: out === "ignore" ? "ignore" : ["ignore", out, out],
      windowsHide: true,
    });
    backendProc.on("error", (e) => {
      try { fs.appendFileSync(backendLogPath(), `spawn error: ${e.message}\n`); } catch {}
    });
  } catch (e) {
    return { ok: false, backendDir, python, error: e.message };
  }

  // Cold start imports pandas/jobspy, which is slow on first run — wait up to 60s.
  for (let i = 0; i < 120; i++) {
    if (await portOpen(BACKEND_PORT)) return { ok: true, spawned: true, backendDir };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, backendDir, python, error: "backend did not open port " + BACKEND_PORT };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: false,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: "#070B14",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Connectors embeds a real Chromium view so job sites can be logged into
      // inside the app. Sessions live in a persistent partition, so cookies
      // survive restarts exactly like a browser profile — and the app never sees
      // a password, because you type it into that view yourself.
      webviewTag: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  if (DEV) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  // External links (job postings, LinkedIn searches) open in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.handle("open-external", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

// ---------- Connectors: browser sessions for job sites ----------

const BROWSER_PARTITION = "persist:mapply-jobsites";

function jobSession() {
  const { session } = require("electron");
  return session.fromPartition(BROWSER_PARTITION);
}

/** Connected = this site has left cookies behind, which only happens once you
 *  have actually signed in. We never read cookie VALUES, only that they exist. */
ipcMain.handle("connector-status", async (_e, domains) => {
  const out = {};
  if (!Array.isArray(domains)) return out;
  for (const d of domains) {
    try {
      const cookies = await jobSession().cookies.get({ domain: d });
      // a logged-out visit still drops consent/analytics cookies, so require a
      // session-ish cookie rather than merely "some cookie exists"
      const signedIn = cookies.some(
        (c) => /sess|auth|token|login|_id$|jsessionid/i.test(c.name) && c.value
      );
      out[d] = { cookies: cookies.length, connected: signedIn };
    } catch {
      out[d] = { cookies: 0, connected: false };
    }
  }
  return out;
});

/** Drag a generated PDF out of the side panel and into a page's upload field.
 *  startDrag hands the OS a real file, so the drop target sees an ordinary file
 *  drop — which is why this works on sites that reject scripted file inputs. */
ipcMain.on("start-file-drag", (event, filePath) => {
  const fs = require("fs");
  if (typeof filePath !== "string" || !fs.existsSync(filePath)) return;
  try {
    event.sender.startDrag({
      file: filePath,
      icon: nativeImage.createFromPath(path.join(__dirname, "..", "resources", "icon.png"))
        .resize({ width: 64, height: 64 }),
    });
  } catch {}
});

ipcMain.handle("connector-disconnect", async (_e, domain) => {
  if (typeof domain !== "string" || !domain) return { ok: false };
  try {
    const cookies = await jobSession().cookies.get({ domain });
    for (const c of cookies) {
      const url = `${c.secure ? "https" : "http"}://${c.domain.replace(/^\./, "")}${c.path}`;
      await jobSession().cookies.remove(url, c.name).catch(() => {});
    }
    return { ok: true, removed: cookies.length };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
ipcMain.handle("app-quit", () => app.quit());
ipcMain.handle("toggle-fullscreen", () => {
  if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

let watchdog = null;
let quitting = false;

/** Respawn the backend if it dies. Without this the window stays open but every
 *  page is empty, which looks like the app is broken rather than the API. */
function startWatchdog() {
  if (watchdog) return;
  watchdog = setInterval(async () => {
    if (quitting) return;
    if (await portOpen(BACKEND_PORT)) return;
    await ensureBackend();
  }, 5000);
}

app.whenReady().then(async () => {
  // Window first: the splash animates while Python boots, instead of the user
  // staring at nothing. The renderer retries reads until the port answers.
  createWindow();
  const result = await ensureBackend();
  if (!result.ok) {
    const { dialog } = require("electron");
    dialog.showErrorBox(
      "Mapply backend didn't start",
      `Tried: ${result.python}\nin: ${result.backendDir}\n\n${result.error}\n\nLog: ${backendLogPath()}`
    );
  }
  startWatchdog();
});

app.on("window-all-closed", () => {
  quitting = true;
  if (watchdog) clearInterval(watchdog);
  if (backendProc) try { backendProc.kill(); } catch {}
  app.quit();
});
