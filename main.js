'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { analyze, shutdown, IMAGE_EXT, VIDEO_EXT } = require('./src/analyze');

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 900, minHeight: 600,
    title: 'imcheck', backgroundColor: '#14161a',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (process.env.IMCHECK_SHOT) { // Entwickler-Selbsttest: IMCHECK_SHOT=out.png IMCHECK_FILES=a;b IMCHECK_TAB=ela
    win.webContents.once('did-finish-load', async () => {
      const files = JSON.stringify((process.env.IMCHECK_FILES || '').split(';'));
      await win.webContents.executeJavaScript(`addFiles(${files})`);
      await new Promise((r) => setTimeout(r, 4000));
      if (process.env.IMCHECK_TAB) { await win.webContents.executeJavaScript(`tab=${JSON.stringify(process.env.IMCHECK_TAB)};renderView()`); await new Promise((r) => setTimeout(r, 2500)); }
      fs.writeFileSync(process.env.IMCHECK_SHOT, (await win.webContents.capturePage()).toPNG());
      app.quit();
    });
  }
}

ipcMain.handle('pick', async () => {
  const exts = [...IMAGE_EXT, ...VIDEO_EXT].map((e) => e.slice(1));
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Bilder & Videos', extensions: exts }, { name: 'Alle Dateien', extensions: ['*'] }] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('analyze', async (_e, file) => {
  try { return { ok: true, result: await analyze(file) }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('read-file', async (_e, file, max = 150 * 1024 * 1024) => {
  const st = await fs.promises.stat(file);
  if (st.size > max) return null;
  return fs.promises.readFile(file);
});
ipcMain.handle('save-report', async (_e, name, content) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return false;
  await fs.promises.writeFile(r.filePath, content, 'utf8');
  return true;
});
ipcMain.handle('reveal', (_e, file) => shell.showItemInFolder(file));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.whenReady().then(createWindow);
  app.on('window-all-closed', async () => { await shutdown(); app.quit(); });
}
