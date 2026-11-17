// Bash scripts in ./scripts run on the Olympus login node. They are sent base64-encoded
// (`echo <b64> | base64 -d | bash -ls -- <args>`), so no quoting has to survive the trip
// through the local shell, ssh and the remote shell, on macOS, Linux or Windows.
const fs = require('fs');
const path = require('path');

// Strip \r in case the files were checked out with Windows line endings (bash would choke on them).
const load = f => fs.readFileSync(path.join(__dirname, 'scripts', f), 'utf8').replace(/\r/g, '');
const START = load('start.sh');
const STATUS = load('status.sh');
const STOP = load('stop.sh');

const TIME_RE = /^[0-9]+(-[0-9]+)?(:[0-9]+){0,2}$/;

// The returned command contains only [A-Za-z0-9+/= |:-] characters.
function remoteCommand(script, arg = '') {
  if (arg && !TIME_RE.test(arg)) throw new Error(`Invalid time limit "${arg}" (use e.g. 8:00:00 or 2-00:00:00)`);
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  return `echo ${b64} | base64 -d | bash -ls -- ${arg}`.trim();
}

const shQuote = s => `'${s.replace(/'/g, `'\\''`)}'`;
const psQuote = s => `'${s.replace(/'/g, `''`)}'`;

// How to launch the VS Code terminal that runs ssh (you type your password there).
// If teeFile is given, ssh's output is also copied to it so the extension can spot the tunnel name.
function terminalOptions(platform, target, remoteCmd, teeFile) {
  if (platform === 'win32') {
    // Windows PowerShell 5.1 (always present). The script goes in via -EncodedCommand
    // (base64 of UTF-16LE), so nothing has to survive Windows command-line quoting.
    // remoteCmd only contains [A-Za-z0-9+/= |:-], so it is safe inside "...".
    let ps = `ssh ${target} "${remoteCmd}"`;
    if (teeFile) ps += ` | Tee-Object -FilePath ${psQuote(teeFile)}`;
    ps += `\nWrite-Host ''\n$null = Read-Host 'Press Enter to close this terminal'`;
    return {
      shellPath: 'powershell.exe',
      shellArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
    };
  }
  // macOS / Linux
  let cmd = `ssh ${target} ${shQuote(remoteCmd)}`;
  if (teeFile) cmd += ` | tee ${shQuote(teeFile)}`;
  cmd += `; printf '\\nPress Enter to close this terminal...'; read _`;
  return { shellPath: '/bin/sh', shellArgs: ['-c', cmd] };
}

// Read the tee'd output. Windows PowerShell 5.1's Tee-Object writes UTF-16LE with a BOM.
function readText(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le');
  return buf.toString('utf8');
}

module.exports = { START, STATUS, STOP, TIME_RE, remoteCommand, terminalOptions, readText };
