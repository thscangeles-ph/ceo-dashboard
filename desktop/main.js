// THSC Summary Dashboard for Windows: opens the live dashboard (the same accounts, shared data and live
// updates as the web version) in its own window. The dashboard itself lives on Vercel, so the app always
// shows the latest version without reinstalling.
const { app, BrowserWindow, Menu, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const APP_URL = process.env.THSC_DASHBOARD_URL || "https://thscdashboards.vercel.app";
const ORIGIN = new URL(APP_URL).origin;
const BOUNDS_FILE = path.join(app.getPath("userData"), "window.json");

let win = null;

function savedBounds() {
  try { return JSON.parse(fs.readFileSync(BOUNDS_FILE, "utf8")); } catch { return { width: 1400, height: 900 }; }
}
function saveBounds() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(BOUNDS_FILE, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch { /* not kept */ }
}

function createWindow() {
  const bounds = savedBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 380,
    minHeight: 500,
    title: "THSC Summary Dashboard",
    icon: path.join(__dirname, "build", "icon.png"),
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true },
  });
  if (bounds.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  win.on("close", saveBounds);

  // Tells the dashboard it is running as the installed app (it then hides "Install app").
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} THSCDesktop/${app.getVersion()}`);

  // Links to other sites (YouTube, Google Sheets, Supabase …) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN)) return { action: "allow" };
    if (/^https?:|^mailto:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(ORIGIN) || url.startsWith("file:")) return;
    event.preventDefault();
    if (/^https?:|^mailto:/i.test(url)) void shell.openExternal(url);
  });

  // Without internet: a page that retries by itself once the connection is back.
  win.webContents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3: a navigation that was replaced, not an error
    void win.loadFile(path.join(__dirname, "offline.html"), { query: { url: url || APP_URL } });
  });

  void win.loadURL(APP_URL);
}

const menu = Menu.buildFromTemplate([
  { label: "File", submenu: [{ label: "Print…", accelerator: "CmdOrCtrl+P", click: () => win?.webContents.print() }, { type: "separator" }, { role: "quit", label: "Exit" }] },
  { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
  { label: "View", submenu: [
    { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => win?.webContents.reload() },
    { label: "Back to the dashboard", click: () => void win?.loadURL(APP_URL) },
    { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" },
  ] },
  { label: "Help", submenu: [{ label: "Open in the browser", click: () => void shell.openExternal(win?.webContents.getURL().startsWith(ORIGIN) ? win.webContents.getURL() : APP_URL) }] },
]);

// One window only: opening the app again brings the existing window forward.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.setAppUserModelId("ph.thsc.summarydashboard");
  app.whenReady().then(() => { Menu.setApplicationMenu(menu); createWindow(); });
  app.on("window-all-closed", () => app.quit());
}
