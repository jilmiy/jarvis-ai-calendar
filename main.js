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
let dockDisplayId = null; // 贴靠时锁定的显示器 id,隐藏/弹出都用它计算(多屏一致)
let edgeHidden = false; // 当前是否已缩到边缘
let pinned = false;     // 用户置顶状态
let moveTimer = null;
let ignoreMove = false; // 程序自身移动窗口时忽略 move 事件
let pollTimer = null;
let edgeDwell = 0;      // 鼠标在唤出区停留的轮询次数
const PEEK = 4;         // 隐藏后留在屏幕内的像素

// ---- 前台窗口监视(判断停靠条带是否被其他软件覆盖) ----
let fgWatcher = null;
let fgInfo = null;      // { hwnd: BigInt, cls: string } 当前前台窗口
let mouseDown = false;  // 鼠标左键是否按下(用于判断是否仍在拖动)
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

  // 拖动结束后检测是否停靠到屏幕边缘(短防抖 + 松手判定,避免拖动中途误处理)
  win.on('move', () => {
    if (ignoreMove) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(onMoved, 140);
  });

  // 失去焦点后收起已停靠的窗口
  win.on('blur', () => {
    if (edgeHide && docked && !edgeHidden) {
      setTimeout(() => {
        if (win && !win.isDestroyed() && edgeHide && docked && !edgeHidden && !win.isFocused()) hideToEdge();
      }, 250);
    }
  });
}

// 贴靠所属显示器:已贴靠时用锁定的那个(多屏下隐藏/弹出保持一致),否则用窗口所在显示器
function dockDisplay() {
  if (dockDisplayId != null) {
    const d = screen.getAllDisplays().find(x => x.id === dockDisplayId);
    if (d) return d;
  }
  return screen.getDisplayMatching(win.getBounds());
}
function workAreaOf() {
  return dockDisplay().workArea;
}

function displayContains(d, x, y) {
  const b = d.bounds;
  return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
}
// 该显示器在 side 方向外侧是否还有相邻显示器(有则是两屏之间的内侧边界,不应贴靠)
function hasAdjacentDisplay(disp, side) {
  const b = disp.bounds;
  const midX = b.x + b.width / 2, midY = b.y + b.height / 2;
  let px, py;
  if (side === 'right') { px = b.x + b.width + 8; py = midY; }
  else if (side === 'left') { px = b.x - 8; py = midY; }
  else if (side === 'top') { px = midX; py = b.y - 8; }
  else return false;
  return screen.getAllDisplays().some(d => d.id !== disp.id && displayContains(d, px, py));
}

const DOCK_SNAP = 22; // 贴边判定阈值:窗口边缘距屏幕边缘 22px 内即视为贴边(放宽,避免拖近却不触发)
// 在指定显示器上检测贴靠边;只认外侧边界(两屏之间的内侧边界不贴靠,避免跳屏)
function detectEdgeOn(disp) {
  const b = win.getBounds();
  const wa = disp.workArea;
  const c = screen.getCursorScreenPoint();
  const CE = 3; // 光标顶到屏幕边缘也算(用力拖到边角时更可靠)
  if ((b.y <= wa.y + DOCK_SNAP || c.y <= wa.y + CE) && !hasAdjacentDisplay(disp, 'top')) return 'top';
  if ((b.x <= wa.x + DOCK_SNAP || c.x <= wa.x + CE) && !hasAdjacentDisplay(disp, 'left')) return 'left';
  if ((b.x + b.width >= wa.x + wa.width - DOCK_SNAP || c.x >= wa.x + wa.width - CE) && !hasAdjacentDisplay(disp, 'right')) return 'right';
  return null;
}

// 拖动后把窗口限制在屏幕内:水平至少留 MIN_W 可见,标题栏不能跑出顶部/底部
// 用窗口当前所在显示器(不受贴靠锁定影响),多屏下允许跨屏移动
function clampToScreen() {
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
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
  if (!win || win.isDestroyed() || edgeHidden) return;
  // 仍按住鼠标(还在拖动)时不处理,推迟到松手后再判定,避免中途把窗口拽回打断拖动
  if (edgeHide && mouseDown) {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(onMoved, 150);
    return;
  }
  clampToScreen();
  if (!edgeHide) return;
  // 用光标所在显示器判定贴靠(拖动意图更准),只贴外侧边界
  const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  docked = detectEdgeOn(disp);
  dockDisplayId = docked ? disp.id : null;
  if (docked) {
    // 松手后停靠:贴齐边线并整体收进屏幕,隐藏条带与弹出位置都对齐
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
  // 隐藏后:取消置顶 + 主动压到 z 轴最底层,露出的边条位于所有其他软件底下,不再遮挡/误触
  win.setAlwaysOnTop(false);
  sendToBottom();
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

function showFromEdge(focusIt) {
  if (!edgeHidden || !docked) return;
  // 弹出时升到最前并置顶,盖过其他软件
  win.setAlwaysOnTop(true);
  win.moveTop();
  const p = dockAlignedPos();
  setPos(p.x, p.y);
  edgeHidden = false;
  edgeDwell = 0;
  // focusIt 为真时才抢焦点(托盘/通知点开);悬停弹出不抢焦点,便于鼠标移走自动收起
  if (focusIt) { win.show(); win.focus(); }
}

function cursorInWindow(margin) {
  const m = margin || 2;
  const c = screen.getCursorScreenPoint();
  const b = win.getBounds();
  return c.x >= b.x - m && c.x <= b.x + b.width + m &&
         c.y >= b.y - m && c.y <= b.y + b.height + m;
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

// 前台是否为"其他应用"(既不是日历自己,也不是桌面/任务栏)
// 用类名+句柄判断,比像素级矩形相交稳健:不受全屏应用是否精确覆盖条带影响
function foregroundIsOther() {
  if (!fgInfo) return false;                                     // 监视未就绪:按"非其他"处理
  if (myHwnd !== null && fgInfo.hwnd === myHwnd) return false;   // 前台是日历自己
  if (DESKTOP_CLASSES.indexOf(fgInfo.cls) !== -1) return false;  // 前台是桌面/任务栏
  return true;                                                   // 其他真实应用
}

function pollEdge() {
  if (!win || win.isDestroyed() || !edgeHide || !docked || !win.isVisible()) return;
  const overWindow = cursorInWindow(2);
  if (edgeHidden) {
    // 弹出条件:鼠标顶到停靠边缘 + 停留约0.5秒 + 当前不在使用其他应用
    // (只在桌面/日历自身处于前台时才弹出,避免全屏应用下误弹)
    // 弹出后不抢焦点:保持"未聚焦",这样鼠标一移走就能自动收起
    if (inRevealZone() && !foregroundIsOther()) {
      edgeDwell++;
      if (edgeDwell >= 2) showFromEdge(false);
    } else {
      edgeDwell = 0;
    }
  } else {
    // 收起条件:
    // 1) 前台切到其他应用(点击其他软件 / 全屏应用启动)→ 立即收起,即使鼠标恰在日历上
    //    (仅悬停不会改变前台窗口,所以不会把正要点的日历收掉)
    // 2) 兜底:日历未聚焦且鼠标已离开 → 收起
    if (foregroundIsOther() || (!overWindow && !win.isFocused())) hideToEdge();
  }
}

function startPoll() {
  if (!pollTimer) pollTimer = setInterval(pollEdge, 250);
  startFgWatcher();
  startZHelper();
}
function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  stopFgWatcher();
  stopZHelper();
}

// ---- 层级助手进程:阻塞读 stdin,每收到一个 hwnd 就把它压到 z 轴最底层(HWND_BOTTOM) ----
let zHelper = null;
function startZHelper() {
  if (zHelper) return;
  const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ZO {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int X, int Y, int cx, int cy, uint flags);
}
"@
$BOTTOM = [IntPtr]1
$FLAGS = [uint32](0x0001 -bor 0x0002 -bor 0x0010)  # SWP_NOSIZE|SWP_NOMOVE|SWP_NOACTIVATE
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $line = $line.Trim()
  if ($line -ne '') {
    try { [ZO]::SetWindowPos([IntPtr][int64]$line, $BOTTOM, 0, 0, 0, 0, $FLAGS) | Out-Null } catch {}
  }
}
`;
  try {
    const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
    zHelper = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64], {
      windowsHide: true, stdio: ['pipe', 'ignore', 'ignore']
    });
    zHelper.on('exit', () => { zHelper = null; });
  } catch (e) { zHelper = null; }
}
function stopZHelper() {
  if (zHelper) { try { zHelper.kill(); } catch (e) {} zHelper = null; }
}
// 把日历窗口压到所有窗口最底层
function sendToBottom() {
  if (zHelper && zHelper.stdin.writable && myHwnd !== null) {
    try { zHelper.stdin.write(myHwnd.toString() + '\n'); } catch (e) {}
  }
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
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@
while ($true) {
  try {
    $h = [FG]::GetForegroundWindow()
    $sb = New-Object System.Text.StringBuilder 256
    [FG]::GetClassName($h, $sb, 256) | Out-Null
    $down = if ((([FG]::GetAsyncKeyState(1)) -band 0x8000) -ne 0) { 1 } else { 0 }
    Write-Output ("{0}|{1}|{2}" -f [int64]$h, $sb.ToString(), $down)
  } catch {}
  Start-Sleep -Milliseconds 250
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
      if (p.length !== 3) return;
      try {
        fgInfo = { hwnd: BigInt.asUintN(64, BigInt(p[0])), cls: p[1] };
        mouseDown = p[2] === '1';
      } catch (e) { /* 忽略解析失败的行 */ }
    });
    fgWatcher.on('exit', () => { fgWatcher = null; fgInfo = null; mouseDown = false; });
  } catch (e) {
    fgWatcher = null; // 监视进程启动失败时退化为不做覆盖检测
  }
}
function stopFgWatcher() {
  if (fgWatcher) { try { fgWatcher.kill(); } catch (e) {} fgWatcher = null; }
  fgInfo = null;
  mouseDown = false;
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('贾维斯 AI 桌面日历');
  const menu = Menu.buildFromTemplate([
    { label: '显示日历', click: () => { if (edgeHidden) showFromEdge(); win.show(); win.focus(); } },
    {
      label: '重置窗口位置', click: () => {
        const wa = screen.getPrimaryDisplay().workArea;
        const b = win.getBounds();
        edgeHidden = false;
        docked = null;
        dockDisplayId = null;
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
  // 停掉轮询与后台助手进程,避免定时器在窗口销毁后仍访问 win 而报错
  stopPoll();
  clearTimeout(moveTimer);
});

// ---------- IPC ----------
ipcMain.on('win-minimize', () => win && win.minimize());
ipcMain.on('win-hide', () => win && win.hide());
ipcMain.on('win-pin', (_e, flag) => {
  pinned = !!flag;
  // 已隐藏到边缘时保持在底层,不因置顶切换把边条拉回最前
  if (win) win.setAlwaysOnTop(edgeHidden ? false : (docked ? true : pinned));
});
ipcMain.on('edge-hide', (_e, flag) => {
  edgeHide = !!flag;
  if (!win) return;
  if (edgeHide) {
    // 开启时若窗口已在某屏外侧边缘,直接进入贴靠(锁定该显示器)
    const disp = screen.getDisplayMatching(win.getBounds());
    docked = detectEdgeOn(disp);
    dockDisplayId = docked ? disp.id : null;
    if (docked) win.setAlwaysOnTop(true);
    startPoll();
  } else {
    if (edgeHidden) showFromEdge();
    docked = null;
    dockDisplayId = null;
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
  const fp = dataFilePath();
  try {
    if (!fs.existsSync(fp)) return { missing: true };   // 文件不存在:首次运行
    return { ok: true, content: fs.readFileSync(fp, 'utf-8') };
  } catch (e) {
    return { error: String(e.message || e) };           // 读取失败:绝不能当成"空数据"
  }
});
ipcMain.on('save-data', (_e, content) => {
  // 原子写入:先写临时文件再重命名,避免进程被杀在写一半时留下空/损坏文件
  try {
    if (!content || content.length < 2) return;          // 拒绝写入空内容,防止误清空
    const fp = dataFilePath();
    const tmp = fp + '.tmp';
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, fp);
  } catch (e) { /* 写入失败时 localStorage 仍有副本 */ }
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
