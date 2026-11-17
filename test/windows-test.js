// Windows end-to-end test (run on a real Windows machine, e.g. GitHub Actions windows-latest).
// Launches the exact powershell.exe -EncodedCommand the extension uses, with a fake `ssh`
// that runs the remote command in Git Bash, and stub squeue/sbatch. Then checks the
// Tee-Object output file the extension reads to find the tunnel name.
// Usage: node test/windows-test.js
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const r = require('../remote');

if (process.platform !== 'win32') { console.log('SKIP (not Windows)'); process.exit(0); }

const gitBash = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find(fs.existsSync);
if (!gitBash) { console.log('FAIL  Git Bash not found (needed to fake the cluster side)'); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "olympus win'test-")); // apostrophe + space on purpose
const bin = path.join(tmp, 'bin');
const home = path.join(tmp, 'home');
fs.mkdirSync(bin); fs.mkdirSync(home);
const write = (name, body) => fs.writeFileSync(path.join(bin, name), body.replace(/\r/g, ''));

// Fake ssh: ssh.cmd -> node fake-ssh.js <target> "<remote command>" -> Git Bash runs the remote command.
fs.writeFileSync(path.join(bin, 'ssh.cmd'), `@"${process.execPath}" "%~dp0fake-ssh.js" %*\r\n`);
write('fake-ssh.js', `
const { spawnSync } = require('child_process');
const res = spawnSync(${JSON.stringify(gitBash)}, ['-c', process.argv[3]], { stdio: 'inherit' });
process.exit(res.status ?? 1);
`);
write('squeue', `#!/bin/bash
[ -f "$HOME/job" ] || exit 0
case "$*" in *"%T %L %N"*) echo "RUNNING 23:59:00 node07";; *"%i %L %N"*) echo "4242 23:59:00 node07";; *) echo 4242;; esac
`);
write('sbatch', `#!/bin/bash
echo "sbatch $*" >> "$HOME/calls"; touch "$HOME/job"
printf 'log into https://github.com/login/device and use code ABCD-1234\\nTunnel: vscode-4242\\n' > "$HOME/vscode-tunnel-4242.log"
echo 4242
`);

const toPosix = p => p.replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase()).replace(/\\/g, '/');
const env = { ...process.env, PATH: `${bin};${process.env.PATH}`, HOME: toPosix(home), USER: 'testuser' };

let fail = 0;
const check = (label, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra ? '\n' + extra : ''}`); if (!cond) fail++; };

const tee = path.join(tmp, 'last_run.log');
const o = r.terminalOptions('win32', 'netid@olympus.ece.tamu.edu', r.remoteCommand(r.START, '2-00:00:00'), tee);
const res = spawnSync(o.shellPath, o.shellArgs, { env, encoding: 'utf8', input: '\r\n', timeout: 120000 });
const shown = (res.stdout || '') + (res.stderr || '');
console.log('--- terminal output ---\n' + shown + '\n-----------------------');

check('powershell.exe ran', !res.error, String(res.error));
check('sbatch called with --time', fs.existsSync(path.join(home, 'calls')) && fs.readFileSync(path.join(home, 'calls'), 'utf8').includes('--time=2-00:00:00'));
check('terminal shows GitHub device code', shown.includes('ABCD-1234'));
check('terminal shows browser URL', shown.includes('https://vscode.dev/tunnel/vscode-4242'));
check('Tee-Object file exists', fs.existsSync(tee));
if (fs.existsSync(tee)) {
  const text = r.readText(tee);
  check('extension finds tunnel name in Tee-Object file', /VSTUNNEL_READY=(vscode-\d+)/.exec(text)?.[1] === 'vscode-4242', JSON.stringify(text.slice(0, 300)));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
