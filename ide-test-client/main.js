const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

const BASE_URL = 'http://127.0.0.1:3335';
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'C3 IDE — Test Client',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Start with WS Bridge test client
  mainWindow.loadFile(path.join(__dirname, '..', 'ide-test.html'));

  // DevTools on F12
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // ─── Menu ────────────────────────────────────────────
  const menu = Menu.buildFromTemplate([
    {
      label: 'C3',
      submenu: [
        {
          label: 'WS Bridge Test',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow.loadFile(path.join(__dirname, '..', 'ide-test.html')),
        },
        { type: 'separator' },
        {
          label: 'Chat UI',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow.loadURL(`${BASE_URL}/chat-ui`),
        },
        {
          label: 'Architect Mode',
          accelerator: 'CmdOrCtrl+3',
          click: () => mainWindow.loadURL(`${BASE_URL}/architect`),
        },
        {
          label: 'Experts',
          accelerator: 'CmdOrCtrl+4',
          click: () => mainWindow.loadURL(`${BASE_URL}/experts`),
        },
        {
          label: 'Agents',
          accelerator: 'CmdOrCtrl+5',
          click: () => mainWindow.loadURL(`${BASE_URL}/agents`),
        },
        { type: 'separator' },
        {
          label: 'Memory',
          click: () => mainWindow.loadURL(`${BASE_URL}/memory`),
        },
        {
          label: 'API Health',
          click: () => mainWindow.loadURL(`${BASE_URL}/api/debug/health`),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
    {
      label: 'Navigate',
      submenu: [
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          click: () => { if (mainWindow.webContents.canGoBack()) mainWindow.webContents.goBack(); },
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          click: () => { if (mainWindow.webContents.canGoForward()) mainWindow.webContents.goForward(); },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
