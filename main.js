/**
 * main.js - Electron 主进程
 * 透明无边框窗口 + 系统托盘 + 置顶 + 系统通知 + 靠边自动隐藏
 * 靠边隐藏时通过前台窗口检测避免被其他软件覆盖时误弹出
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, screen, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

let win = null;
let tray = null;
let quitting = false;

// ---- 靠边隐藏状态 ----
let edgeHide = false;   // 是否开启靠边自动隐藏
let docked = null;      // 'top' | 'left' | 'right' | null
let edgeHidden = false; // 当前是否已缩到边缘
let pinned = false;     // 用户置顶状态
let moveTimer = null;
let ignoreMove = false; // 程序自身移动窗口时忽略 move 事件
let pollTimer = null;
let edgeDwell = 0;      // 鼠标在唤出区停留的轮询次数
const PEEK = 4;         // 隐藏后留在屏幕内的像素

// ---- 前台窗口监视(判断停靠条带是否被其他软件覆盖) ----
let fgWatcher = null;
let fgInfo = null;      // { hwnd: BigInt, cls: string, rect: {x,y,width,height} DIP }
let myHwnd = null;
const DESKTOP_CLASSES = ['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd'];

function createWindow() {
  win = new BrowserWindow({
    width: 1060,
    height: 680,
    minWidth: 900,
    minHeight: 560,
    frame: false,
    transparent: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.setMenu(null);

  try {
    myHwnd = win.getNativeWindowHandle().readBigUInt64LE(0);
  } catch (e) { myHwnd = null; }

  // 点关闭按钮时隐藏到托盘,不退出
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  // 拖动结束后检测是否停靠到屏幕边缘
  win.on('move', () => {
    if (ignoreMove) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(onMoved, 350);
  });

  // 失去焦点后收起已停靠的窗口
  win.on('blur', () => {
    if (edgeHide && docked && !edgeHidden) {
      setTimeout(() => {
        if (win && edgeHide && docked && !edgeHidden && !win.isFocused()) hideToEdge();
      }, 250);
    }
  });
}

function workAreaOf() {
  return screen.getDisplayMatching(win.getBounds()).workArea;
}

function detectEdge() {
  const b = win.getBounds();
  const wa = workAreaOf();
  if (b.y <= wa.y + 3) return 'top';
  if (b.x <= wa.x + 3) return 'left';
  if (b.x + b.width >= wa.x + wa.width - 3) return 'right';
  return null;
}

// 拖动后把窗口限制在屏幕内:水平至少留 MIN_W 可见,标题栏不能跑出顶部/底部
function clampToScreen() {
  const b = win.getBounds();
  const wa = workAreaOf();
  const MIN_W = 120; // 水平方向至少留在屏幕内的宽度
  const MIN_H = 60;  // 底部方向至少留出的高度(保证标题栏可抓)
  let x = b.x, y = b.y;
  if (x + b.width < wa.x + MIN_W) x = wa.x + MIN_W - b.width;
  if (x > wa.x + wa.width - MIN_W) x = wa.x + wa.width - MIN_W;
  if (y < wa.y) y = wa.y;
  if (y > wa.y + wa.height - MIN_H) y = wa.y + wa.height - MIN_H;
  if (x !== b.x || y !== b.y) setPos(x, y);
}

function onMoved() {
  if (!win || edgeHidden) return;
  clampToScreen();
  if (!edgeHide) return;
  docked = detectEdge();
  if (docked) {
    // 停靠瞬间就贴齐边线并整体收进屏幕,隐藏条带与弹出位置都对齐
    const p = dockAlignedPos();
    setPos(p.x, p.y);
  }
  win.setAlwaysOnTop(docked ? true : pinned);
}

function setPos(x, y) {
  ignoreMove = true;
  win.setPosition(Math.round(x), Math.round(y));
  setTimeout(() => { ignoreMove = false; }, 80);
}

function hideToEdge() {
  if (edgeHidden || !docked) return;
  const b = win.getBounds();
  const wa = workAreaOf();
  if (docked === 'top') setPos(b.x, wa.y - b.height + PEEK);
  else if (docked === 'left') setPos(wa.x - b.width + PEEK, b.y);
  else if (docked === 'right') setPos(wa.x + wa.width - PEEK, b.y);
  edgeHidden = true;
  edgeDwell = 0;
}

// 停靠边对齐屏幕边线,另一方向整体收进屏幕内(贴角落时不再切掉内容)
function dockAlignedPos() {
  const b = win.getBounds();
  const wa = workAreaOf();
  let x = b.x, y = b.y;
  if (docked === 'top') {
    y = wa.y;
    x = Math.min(Math.max(x, wa.x), wa.x + wa.width - b.width);
  } else if (docked === 'left') {
    x = wa.x;
    y = Math.min(Math.max(y, wa.y), wa.y + wa.height - b.height);
  } else if (docked === 'right') {
    x = wa.x + wa.width - b.width;
    y = Math.min(Math.max(y, wa.y), wa.y + wa.height - b.height);
  }
  return { x: x, y: y };
}

function showFromEdge() {
  if (!edgeHidden || !docked) return;
  const p = dockAlignedPos();
  setPos(p.x, p.y);
  edgeHidden = false;
  edgeDwell = 0;
}

function cursorInWindow(margin) {
  const m = margin || 2;
  const c = screen.getCursorScreenPoint();
  const b = win.getBounds();
  return c.x >= b.x - m && c.x <= b.x + b.width + m &&
         c.y >= b.y - m && c.y <= b.y + b.height + m;
}

// 隐藏后留在屏幕内的条带区域
function stripRect() {
  const b = win.getBounds();
  const wa = workAreaOf();
  if (docked === 'top') return { x: b.x, y: wa.y, width: b.width, height: PEEK };
  if (docked === 'left') return { x: wa.x, y: b.y, width: PEEK, height: b.height };
  if (docked === 'right') return { x: wa.x + wa.width - PEEK, y: b.y, width: PEEK, height: b.height };
  return null;
}

// 鼠标是否顶到了停靠边缘(2px)且在条带纵/横向范围内
function inRevealZone() {
  const c = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const wa = workAreaOf();
  const E = 2;
  if (docked === 'right') return c.x >= wa.x + wa.width - E && c.y >= b.y && c.y <= b.y + b.height;
  if (docked === 'left') return c.x <= wa.x + E && c.y >= b.y && c.y <= b.y + b.height;
  if (docked === 'top') return c.y <= wa.y + E && c.x >= b.x && c.x <= b.x + b.width;
  return false;
}

function rectsIntersect(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
         a.y < b.y + b.height && a.y + a.height > b.y;
}

// 停靠条带是否被其他软件的前台窗口覆盖
function stripCovered() {
  if (!fgInfo) return false;
  if (myHwnd !== null && fgInfo.hwnd === myHwnd) return false;    // 前台是日历自己
  if (DESKTOP_CLASSES.indexOf(fgInfo.cls) !== -1) return false;   // 前台是桌面/任务栏
  const strip = stripRect();
  if (!strip) return false;
  return rectsIntersect(fgInfo.rect, strip);
}

function pollEdge() {
  if (!win || !edgeHide || !docked || !win.isVisible()) return;
  if (edgeHidden) {
    // 需要:鼠标顶到边缘 + 停留约0.5秒 + 条带未被其他软件覆盖
    if (inRevealZone() && !stripCovered()) {
      edgeDwell++;
      if (edgeDwell >= 2) showFromEdge();
    } else {
      edgeDwell = 0;
    }
  } else {
    if (!cursorInWindow(2) && !win.isFocused()) hideToEdge();
  }
}

function startPoll() {
  if (!pollTimer) pollTimer = setInterval(pollEdge, 250);
  startFgWatcher();
}
function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  stopFgWatcher();
}

// ---- 前台窗口监视进程:每400ms输出 "hwnd|class|l|t|r|b"(物理像素) ----
function startFgWatcher() {
  if (fgWatcher) return;
  const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
while ($true) {
  try {
    $h = [FG]::GetForegroundWindow()
    $r = New-Object FG+RECT
    [FG]::GetWindowRect($h, [ref]$r) | Out-Null
    $sb = New-Object System.Text.StringBuilder 256
    [FG]::GetClassName($h, $sb, 256) | Out-Null
    Write-Output ("{0}|{1}|{2}|{3}|{4}|{5}" -f [int64]$h, $sb.ToString(), $r.Left, $r.Top, $r.Right, $r.Bottom)
  } catch {}
  Start-Sleep -Milliseconds 400
}
`;
  try {
    // 用 EncodedCommand 避免命令行引号转义问题
    const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
    fgWatcher = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    const rl = readline.createInterface({ input: fgWatcher.stdout });
    rl.on('line', (line) => {
      const p = line.split('|');
      if (p.length !== 6) return;
      try {
        const phys = { x: +p[2], y: +p[3], width: +p[4] - +p[2], height: +p[5] - +p[3] };
        let dip = phys;
        if (screen.screenToDipRect) dip = screen.screenToDipRect(win, phys);
        fgInfo = { hwnd: BigInt.asUintN(64, BigInt(p[0])), cls: p[1], rect: dip };
      } catch (e) { /* 忽略解析失败的行 */ }
    });
    fgWatcher.on('exit', () => { fgWatcher = null; fgInfo = null; });
  } catch (e) {
    fgWatcher = null; // 监视进程启动失败时退化为不做覆盖检测
  }
}
function stopFgWatcher() {
  if (fgWatcher) { try { fgWatcher.kill(); } catch (e) {} fgWatcher = null; }
  fgInfo = null;
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('贾维斯桌面日历');
  const menu = Menu.buildFromTemplate([
    { label: '显示日历', click: () => { if (edgeHidden) showFromEdge(); win.show(); win.focus(); } },
    {
      label: '重置窗口位置', click: () => {
        const wa = screen.getPrimaryDisplay().workArea;
        const b = win.getBounds();
        edgeHidden = false;
        docked = null;
        win.setAlwaysOnTop(pinned);
        setPos(wa.x + Math.round((wa.width - b.width) / 2), wa.y + Math.round((wa.height - b.height) / 2));
        win.show();
        win.focus();
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => { if (edgeHidden) showFromEdge(); win.show(); win.focus(); });
}

// 单实例
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (edgeHidden) showFromEdge(); win.show(); win.focus(); }
  });

  app.whenReady().then(() => {
    // Windows 通知需要 AppUserModelID
    app.setAppUserModelId('com.jarvis.calendar');
    createWindow();
    createTray();
  });
}

app.on('window-all-closed', () => {
  // 常驻托盘,不因窗口关闭而退出
});
app.on('before-quit', () => {
  quitting = true;
  stopFgWatcher();
});

// ---------- IPC ----------
ipcMain.on('win-minimize', () => win && win.minimize());
ipcMain.on('win-hide', () => win && win.hide());
ipcMain.on('win-pin', (_e, flag) => {
  pinned = !!flag;
  if (win) win.setAlwaysOnTop(docked ? true : pinned);
});
ipcMain.on('edge-hide', (_e, flag) => {
  edgeHide = !!flag;
  if (!win) return;
  if (edgeHide) {
    docked = detectEdge();
    if (docked) win.setAlwaysOnTop(true);
    startPoll();
  } else {
    if (edgeHidden) showFromEdge();
    docked = null;
    edgeHidden = false;
    stopPoll();
    win.setAlwaysOnTop(pinned);
  }
});
// ---------- 本地数据文件(位置可自定义) ----------
const CONFIG_PATH = path.join(app.getPath('userData'), 'jarvis-config.json');
const DATA_FILENAME = 'jarvis-calendar-data.json';
let dataDir = app.getPath('userData');

function loadStorageConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    if (cfg.dataDir && fs.existsSync(cfg.dataDir)) dataDir = cfg.dataDir;
  } catch (e) { /* 无配置则用默认 userData 目录 */ }
}
loadStorageConfig();

function dataFilePath() { return path.join(dataDir, DATA_FILENAME); }

ipcMain.handle('load-data', () => {
  try { return fs.readFileSync(dataFilePath(), 'utf-8'); }
  catch (e) { return null; }
});
ipcMain.on('save-data', (_e, content) => {
  try { fs.writeFileSync(dataFilePath(), content, 'utf-8'); }
  catch (e) { /* 写入失败时 localStorage 仍有副本 */ }
});
ipcMain.handle('get-data-dir', () => dataDir);
ipcMain.handle('choose-data-dir', async (_e, currentContent) => {
  const res = await dialog.showOpenDialog(win, {
    title: '选择数据保存位置',
    defaultPath: dataDir,
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  const newDir = res.filePaths[0];
  if (newDir === dataDir) return { ok: true, path: newDir };
  try {
    const oldFile = dataFilePath();
    const newFile = path.join(newDir, DATA_FILENAME);
    // 把数据搬移到新位置:优先移动现有文件,没有则用当前内存数据写入
    if (fs.existsSync(oldFile)) {
      fs.copyFileSync(oldFile, newFile);
      fs.unlinkSync(oldFile);
    } else if (currentContent) {
      fs.writeFileSync(newFile, currentContent, 'utf-8');
    }
    dataDir = newDir;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ dataDir: newDir }), 'utf-8');
    return { ok: true, path: newDir };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

// 数据备份:导出/导入(用户自选位置)
ipcMain.handle('export-data', async (_e, content, filename) => {
  const res = await dialog.showSaveDialog(win, {
    title: '导出数据备份',
    defaultPath: filename,
    filters: [{ name: '贾维斯日历备份', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(res.filePath, content, 'utf-8');
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});
ipcMain.handle('import-data', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: '导入数据备份',
    filters: [{ name: '贾维斯日历备份', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  try {
    return { ok: true, content: fs.readFileSync(res.filePaths[0], 'utf-8') };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.on('notify', (_e, title, body) => {
  if (Notification.isSupported()) {
    const n = new Notification({ title, body, silent: false });
    n.on('click', () => { if (win) { if (edgeHidden) showFromEdge(); win.show(); win.focus(); } });
    n.show();
  }
});
