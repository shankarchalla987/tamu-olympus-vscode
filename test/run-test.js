// Offline test: builds the same /bin/sh command lines the extension uses (with tee),
// runs them with a fake `ssh` and stub squeue/sbatch/scancel, and checks the output.
// Usage: node test/run-test.js
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const r = require('../remote');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olympus-test-'));
const bin = path.join(tmp, 'bin');
const home = path.join(tmp, 'home');
fs.mkdirSync(bin); fs.mkdirSync(home);
const stub = (name, body) => fs.writeFileSync(path.join(bin, name), '#!/bin/bash\n' + body, { mode: 0o755 });
stub('ssh', 'shift; exec /bin/sh -c "$1"\n'); // drop user@host, run the remote command like a login shell
stub('squeue', `[ -f "$HOME/job" ] || exit 0
case "$*" in *"%i|%T|%L|%N"*) echo "4242|RUNNING|23:59:00|node07";; *"%T %L %N"*) echo "RUNNING 23:59:00 node07";;
  *"%i %L %N"*) echo "4242 23:59:00 node07";; *) echo 4242;; esac\n`);
stub('sbatch', `echo "sbatch $*" >> "$HOME/calls"; touch "$HOME/job"
( sleep 3; echo "log into https://github.com/login/device and use code ABCD-1234" > "$HOME/vscode-tunnel-4242.log"
  sleep 3; echo "Tunnel: vscode-4242" >> "$HOME/vscode-tunnel-4242.log" ) >/dev/null 2>&1 &
echo 4242\n`);
stub('scancel', 'echo "scancel $*" >> "$HOME/calls"; rm -f "$HOME/job"\n');

const env = { ...process.env, HOME: home, USER: 'testuser', PATH: `${bin}:${process.env.PATH}` };
// Runs exactly what the extension's macOS/Linux terminal runs (the final `read` gets EOF and returns).
const run = (remoteCmd, tee) => {
  const o = r.terminalOptions('darwin', 'netid@olympus.ece.tamu.edu', remoteCmd, tee);
  // The trailing "Press Enter" read hits EOF here and exits 1; that's expected, so use spawnSync.
  return spawnSync(o.shellPath, o.shellArgs, { env, encoding: 'utf8', input: '' }).stdout;
};

let fail = 0;
const check = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fail++; };

check('status with no job', run(r.remoteCommand(r.STATUS)).includes('No vscode-tunnel jobs running'));
const tee = path.join(home, 'out.log');
const out = run(r.remoteCommand(r.START, '2-00:00:00'), tee);
check('submits with --time', fs.readFileSync(path.join(home, 'calls'), 'utf8').includes('--parsable --time=2-00:00:00 /opt/coe/bin/start_vscode_tunnel.sh'));
check('shows GitHub device code', out.includes('github.com/login/device and use code ABCD-1234'));
check('prints node/time/URL', out.includes('node07') && out.includes('23:59:00') && out.includes('https://vscode.dev/tunnel/vscode-4242'));
check('tee file has READY marker', /VSTUNNEL_READY=vscode-4242/.test(fs.readFileSync(tee, 'utf8')));
const again = run(r.remoteCommand(r.START, '8:00:00'));
check('reuses existing job', again.includes('Reusing existing vscode-tunnel job 4242') && (fs.readFileSync(path.join(home, 'calls'), 'utf8').match(/sbatch/g) || []).length === 1);
check('status lists job', run(r.remoteCommand(r.STATUS)).includes('vscode-4242'));
check('stop cancels job', run(r.remoteCommand(r.STOP)).includes('Cancelled vscode-tunnel job(s): 4242'));
let rejected = false; try { r.remoteCommand(r.START, 'x; rm -rf ~'); } catch { rejected = true; }
check('rejects bad time value', rejected);
check('command uses only safe characters', /^[A-Za-z0-9+/= |:-]+$/.test(r.remoteCommand(r.START, '7-00:00:00')));

// ---- Windows: check the PowerShell command the extension would launch ----
const winTee = "C:\\Users\\O'Brien\\AppData\\Roaming\\Code\\User\\globalStorage\\shankarchalla987.tamu-olympus\\last_run.log";
const startCmd = r.remoteCommand(r.START, '1-00:00:00');
const w = r.terminalOptions('win32', 'netid@olympus.ece.tamu.edu', startCmd, winTee);
const ps = Buffer.from(w.shellArgs[w.shellArgs.length - 1], 'base64').toString('utf16le');
check('win: launches powershell.exe -EncodedCommand', w.shellPath === 'powershell.exe' && w.shellArgs.includes('-EncodedCommand'));
check('win: ssh line carries remote command intact', ps.split('\n')[0].startsWith(`ssh netid@olympus.ece.tamu.edu "${startCmd}" | Tee-Object -FilePath `));
check("win: tee path with apostrophe is quoted", ps.includes(`-FilePath 'C:\\Users\\O''Brien\\AppData`));
check('win: command line under Windows 32767-char limit', w.shellArgs.join(' ').length < 32000);
// The remote command decodes back to the exact script on the cluster side.
const b64 = startCmd.match(/^echo (\S+) \|/)[1];
check('win/mac: base64 payload decodes to start.sh', Buffer.from(b64, 'base64').toString('utf8') === r.START);

// ---- Line endings / encodings ----
check('scripts have no \\r (CRLF-safe)', ![r.START, r.STATUS, r.STOP].some(s => s.includes('\r')));
const u16 = path.join(tmp, 'u16.log');
fs.writeFileSync(u16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Tunnel name : vscode-1\r\nVSTUNNEL_READY=vscode-4242\r\n', 'utf16le')]));
check('reads UTF-16 Tee-Object output (PowerShell 5.1)', /VSTUNNEL_READY=(vscode-\d+)/.exec(r.readText(u16))?.[1] === 'vscode-4242');
const u8 = path.join(tmp, 'u8.log');
fs.writeFileSync(u8, 'VSTUNNEL_READY=vscode-77\r\n');
check('reads UTF-8 output (macOS tee / PowerShell 7)', /VSTUNNEL_READY=(vscode-\d+)/.exec(r.readText(u8))?.[1] === 'vscode-77');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
