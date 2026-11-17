// TAMU Olympus: one-click VS Code on an Olympus compute node.
// Guide: https://docs.ao.tamu.edu/docs/hpc/olympus.ece.tamu.edu/vscode-compute
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const remote = require('./remote');

const TERM_NAME = 'TAMU Olympus';
const GUIDE_URL = 'https://docs.ao.tamu.edu/docs/hpc/olympus.ece.tamu.edu/vscode-compute';
let ctx;
let starting = false; // ignore extra clicks while a start is in progress

// ---------- settings & state ----------
const cfg = () => vscode.workspace.getConfiguration('tamuOlympus');
const stateFile = name => path.join(ctx.globalStorageUri.fsPath, name);

function readLastTunnel() {
  try {
    const f = stateFile('last_tunnel');
    return { name: fs.readFileSync(f, 'utf8').trim(), mtime: fs.statSync(f).mtimeMs };
  } catch {
    return null;
  }
}

async function getNetId() {
  let id = cfg().get('netid', '').trim();
  if (!id) {
    id = (await vscode.window.showInputBox({
      prompt: 'Your TAMU NetID (your Olympus username)',
      placeHolder: 'netid',
      ignoreFocusOut: true,
      validateInput: v => /^[A-Za-z0-9._-]+$/.test(v.trim()) ? null : 'Letters, digits, ".", "_" or "-" only',
    }))?.trim();
    if (!id) return undefined;
    await cfg().update('netid', id, vscode.ConfigurationTarget.Global);
  }
  return id;
}

// ---------- running ssh in a terminal (you type your password there) ----------
async function runSsh(remoteCmd, teeFile) {
  const user = await getNetId();
  if (!user) return undefined;
  const host = cfg().get('host', 'olympus.ece.tamu.edu').trim();
  if (!/^[A-Za-z0-9.-]+$/.test(host)) { vscode.window.showErrorMessage(`Invalid host "${host}"`); return undefined; }
  const target = `${user}@${host}`;

  if (!hasSsh()) {
    const msg = process.platform === 'win32'
      ? 'ssh was not found. Install the OpenSSH Client: Settings > System > Optional features > Add a feature > "OpenSSH Client", then restart VS Code.'
      : 'ssh was not found on your PATH. Install OpenSSH and restart VS Code.';
    vscode.window.showErrorMessage(msg);
    return undefined;
  }

  vscode.window.terminals.filter(t => t.name === TERM_NAME).forEach(t => t.dispose());
  const options = remote.terminalOptions(process.platform, target, remoteCmd, teeFile);
  const term = vscode.window.createTerminal({ name: TERM_NAME, ...options });
  term.show();
  return term;
}

function hasSsh() {
  try {
    const r = require('child_process').spawnSync('ssh', ['-V'], { timeout: 5000, windowsHide: true });
    return !r.error;
  } catch {
    return false;
  }
}

// ---------- commands ----------
async function start() {
  const time = cfg().get('time', '1-00:00:00').trim();
  let cmd;
  try { cmd = remote.remoteCommand(remote.START, time); }
  catch (e) { vscode.window.showErrorMessage(e.message); return; }

  fs.mkdirSync(ctx.globalStorageUri.fsPath, { recursive: true });
  const out = stateFile('last_run.log');
  try { fs.unlinkSync(out); } catch { /* none yet */ }
  const startedAt = Date.now();
  const term = await runSsh(cmd, out);
  if (!term) return;
  vscode.window.setStatusBarMessage('$(sync~spin) Olympus: enter your password in the terminal, then wait for the tunnel...', 20000);

  const name = await new Promise(resolve => {
    let closed = false;
    const sub = vscode.window.onDidCloseTerminal(t => { if (t === term) closed = true; });
    const timer = setInterval(() => {
      let m = null;
      try { m = remote.readText(out).match(/VSTUNNEL_READY=(vscode-\d+)/); } catch { /* not written yet */ }
      if (m) done(m[1]);
      else if (closed || Date.now() - startedAt > 6 * 60 * 1000) done(null);
    }, 1500);
    function done(v) { clearInterval(timer); sub.dispose(); resolve(v); }
  });

  if (!name) {
    vscode.window.showWarningMessage('The tunnel did not report ready. Check the "TAMU Olympus" terminal.');
    return;
  }
  fs.writeFileSync(stateFile('last_tunnel'), name);
  vscode.window.setStatusBarMessage(`$(check) Olympus: tunnel ${name} ready, connecting...`, 10000);
  await connect(name); // one click: connect straight away
}

async function startOnce() {
  if (starting) {
    vscode.window.showInformationMessage('Olympus tunnel is already starting. Check the "TAMU Olympus" terminal.');
    return;
  }
  starting = true;
  try { await start(); } finally { starting = false; }
}

async function connect(name) {
  if (!name) {
    vscode.window.showWarningMessage('No tunnel yet. Click Olympus > Start first.');
    return;
  }
  const newWindow = cfg().get('connectInNewWindow', true);
  const folder = projectPath();
  try {
    if (folder) {
      const uri = vscode.Uri.from({ scheme: 'vscode-remote', authority: `tunnel+${name}`, path: folder });
      await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: newWindow });
    } else {
      await vscode.commands.executeCommand('vscode.newWindow', { remoteAuthority: `tunnel+${name}`, reuseWindow: !newWindow });
    }
  } catch (e) {
    vscode.window.showErrorMessage(`Could not open tunnel ${name}: ${e.message}`);
  }
}

async function setFolder() {
  const v = await vscode.window.showInputBox({
    prompt: 'Absolute path on Olympus to open on every tunnel (folder or .code-workspace file). Empty = the last folder you opened.',
    value: projectPath(),
    placeHolder: '/mnt/research/... or /home/<netid>/project',
  });
  if (v === undefined) return;
  if (v && !v.startsWith('/')) { vscode.window.showErrorMessage('Use an absolute path starting with "/" (no ~).'); return; }
  await cfg().update('folder', v, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(v ? `Olympus tunnels will open ${v}` : 'Olympus tunnels will open the last folder you used.');
}

async function menu() {
  const last = readLastTunnel();
  const items = [
    { label: '$(play) Start / reuse tunnel and connect', id: 'start' },
    ...(last ? [{ label: `$(plug) Connect to ${last.name}`, description: 'last tunnel (no password needed)', id: 'connect' }] : []),
    { label: '$(folder) Set project folder', description: projectPath() || '(none yet)', id: 'setFolder' },
    { label: '$(list-unordered) Status', id: 'status' },
    { label: '$(debug-stop) Stop tunnel job', id: 'stop' },
    { label: '$(book) Olympus VS Code guide', description: 'docs.ao.tamu.edu', id: 'openGuide' },
  ];
  const choice = await vscode.window.showQuickPick(items, { placeHolder: 'TAMU Olympus VS Code tunnel' });
  if (choice) vscode.commands.executeCommand(`tamuOlympus.${choice.id}`);
}

// ---------- project folder memory ----------
function projectPath() {
  return cfg().get('folder', '').trim() || ctx.globalState.get('lastRemotePath', '');
}

function currentFolderUri() {
  const ws = vscode.workspace.workspaceFile;
  return ws && ws.scheme === 'vscode-remote' ? ws : vscode.workspace.workspaceFolders?.[0]?.uri;
}

function rememberCurrentFolder() {
  const uri = currentFolderUri();
  if (uri && uri.scheme === 'vscode-remote' && uri.authority.startsWith('tunnel+vscode-')) {
    ctx.globalState.update('lastRemotePath', uri.path);
  }
}

// Runs in every tunnel window: empty window -> open the project folder;
// window from an OLD tunnel job -> move it to the current tunnel.
async function fixTunnelWindow() {
  if (vscode.env.remoteName !== 'tunnel') return;
  const current = readLastTunnel()?.name;
  const uri = currentFolderUri();
  const stale = uri && current && uri.authority !== `tunnel+${current}`;
  if (uri && !stale) {
    rememberCurrentFolder();
    await restoreTabs(uri);
    startSavingTabs(uri);
    return;
  }
  const folder = stale ? uri.path : projectPath();
  if (!current || !folder) return;
  if (Date.now() - ctx.globalState.get('autoOpenAt', 0) < 30000) return; // avoid reopen loops
  await ctx.globalState.update('autoOpenAt', Date.now());
  const target = vscode.Uri.from({ scheme: 'vscode-remote', authority: `tunnel+${current}`, path: folder });
  await vscode.commands.executeCommand('vscode.openFolder', target, { forceNewWindow: false });
}

// ---------- keep open tabs across tunnels ----------
let restoring = false;

function tabUri(tab) {
  const i = tab.input;
  if (i instanceof vscode.TabInputText || i instanceof vscode.TabInputNotebook || i instanceof vscode.TabInputCustom) return i.uri;
  return undefined;
}

function saveTabs(folderUri) {
  if (restoring || !cfg().get('restoreTabs', true)) return;
  const tabs = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const u = tabUri(tab);
      if (u && u.scheme === 'vscode-remote' && u.authority === folderUri.authority) {
        tabs.push({ path: u.path, column: group.viewColumn, active: tab.isActive && group.isActive, pinned: tab.isPinned });
      }
    }
  }
  const all = ctx.globalState.get('tabsByFolder', {});
  all[folderUri.path] = { authority: folderUri.authority, tabs };
  ctx.globalState.update('tabsByFolder', all);
}

function startSavingTabs(folderUri) {
  let timer;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => saveTabs(folderUri), 1000); };
  ctx.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(schedule), vscode.window.tabGroups.onDidChangeTabGroups(schedule));
  schedule();
}

async function restoreTabs(folderUri) {
  if (!cfg().get('restoreTabs', true)) return;
  const saved = ctx.globalState.get('tabsByFolder', {})[folderUri.path];
  if (!saved || saved.authority === folderUri.authority || !saved.tabs.length) return; // same tunnel: VS Code restores tabs itself
  restoring = true;
  try {
    let active;
    for (const t of saved.tabs) {
      const uri = vscode.Uri.from({ scheme: 'vscode-remote', authority: folderUri.authority, path: t.path });
      try {
        await vscode.commands.executeCommand('vscode.open', uri, { preview: false, preserveFocus: true, viewColumn: t.column || 1 });
        if (t.pinned) await vscode.commands.executeCommand('workbench.action.pinEditor');
        if (t.active) active = { uri, column: t.column || 1 };
      } catch { /* deleted or moved: skip */ }
    }
    if (active) await vscode.commands.executeCommand('vscode.open', active.uri, { preview: false, viewColumn: active.column });
  } finally {
    restoring = false;
  }
}

// ---------- remove old vscode-<jobid> tunnels from File > Open Recent ----------
async function cleanRecent() {
  const keep = `tunnel+${readLastTunnel()?.name}`;
  try {
    const r = await vscode.commands.executeCommand('_workbench.getRecentlyOpened');
    const entries = [
      ...(r?.workspaces || []).map(w => w.folderUri || w.workspace?.configPath),
      ...(r?.files || []).map(f => f.fileUri),
    ].filter(Boolean);
    for (const u of entries) {
      if (u.scheme === 'vscode-remote' && u.authority?.startsWith('tunnel+vscode-') && u.authority !== keep) {
        await vscode.commands.executeCommand('vscode.removeFromRecentlyOpened',
          vscode.Uri.from({ scheme: u.scheme, authority: u.authority, path: u.path, query: u.query || '', fragment: u.fragment || '' }));
      }
    }
  } catch (e) {
    console.error('tamu-olympus: could not clean recent list', e);
  }
}

// ---------- activation ----------
function activate(context) {
  ctx = context;
  fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
  fixTunnelWindow().catch(e => console.error('tamu-olympus', e));
  if (cfg().get('cleanRecent', true)) cleanRecent();
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(rememberCurrentFolder));

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.text = '$(remote-explorer) Olympus';
  // One click starts (or reuses) the tunnel and connects. Hover for the other actions.
  item.command = 'tamuOlympus.start';
  const tip = new vscode.MarkdownString(
    '**TAMU Olympus**: click to start your tunnel and connect\n\n' +
    '[$(list-unordered) Status](command:tamuOlympus.status) · ' +
    '[$(debug-stop) Stop](command:tamuOlympus.stop) · ' +
    '[$(folder) Project folder](command:tamuOlympus.setFolder) · ' +
    '[$(ellipsis) More](command:tamuOlympus.menu)\n\n' +
    `[$(book) Olympus VS Code guide](${GUIDE_URL})`,
    true,
  );
  tip.isTrusted = true;
  item.tooltip = tip;
  item.show();

  context.subscriptions.push(
    item,
    vscode.commands.registerCommand('tamuOlympus.menu', menu),
    vscode.commands.registerCommand('tamuOlympus.start', startOnce),
    vscode.commands.registerCommand('tamuOlympus.openGuide', () => vscode.env.openExternal(vscode.Uri.parse(GUIDE_URL))),
    vscode.commands.registerCommand('tamuOlympus.connect', () => connect(readLastTunnel()?.name)),
    vscode.commands.registerCommand('tamuOlympus.setFolder', setFolder),
    vscode.commands.registerCommand('tamuOlympus.status', () => runSsh(remote.remoteCommand(remote.STATUS))),
    vscode.commands.registerCommand('tamuOlympus.stop', async () => {
      const ok = await vscode.window.showWarningMessage('Cancel your vscode-tunnel job(s) on Olympus?', { modal: true }, 'Stop');
      if (ok === 'Stop') runSsh(remote.remoteCommand(remote.STOP));
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
