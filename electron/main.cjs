// Electron Config

//import gpu config
const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("node:path");

// WebGL2 + high-DPI friendliness
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-features", "WebGL2ComputeContext");

//only allow a single instance to run
if (!app.requestSingleInstanceLock()) {
    app.quit();
}

let win;

//! Windows Creation
function createWindow() {
    win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 600,
        backgroundColor: "#1e1e1e",
        title: "Liquid Composer",
        icon: path.join(__dirname, "..", "public", "icon-512.png"), // find the liquid composer icon form /public/
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
        },
    });

    // link handling

    win.once("ready-to-show", () => win.show());

    // Open any external link in the system browser, never inside the app.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/i.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (e, url) => {
        if (!url.startsWith("file://") && !url.startsWith("http://localhost")) {
            e.preventDefault();
            if (/^https?:/i.test(url)) shell.openExternal(url);
        }
    });

    //! load app content

    if (process.env.ELECTRON_DEV_URL) {
        win.loadURL(process.env.ELECTRON_DEV_URL);
    } else {
        win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    }
}

//! app lifecycle

app.on("second-instance", () => {
    if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
    }
});

//! window loading
app.whenReady().then(() => {
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []), //? Darwin is [refers to] MacOS
            { role: "fileMenu" },
            { role: "editMenu" },
            { role: "viewMenu" },
            { role: "windowMenu" },
        ]),
    );
    createWindow();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit(); //& Quit handeling for mac
});
