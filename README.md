# TAMU Olympus

One click to open VS Code on a compute node of the Texas A&M ECE **Olympus** cluster.

📖 Olympus VS Code guide: https://docs.ao.tamu.edu/docs/hpc/olympus.ece.tamu.edu/vscode-compute

## What it does

Click **Olympus** in the status bar. That's it:

1. A terminal opens. Type your Olympus password.
2. If you already have a `vscode-tunnel` job, it's reused. Otherwise one is submitted with `/opt/coe/bin/start_vscode_tunnel.sh` (partition `cpu-research`).
3. When the tunnel is ready, VS Code connects and opens your project folder on the compute node.

Hover over the button for **Status**, **Stop**, **Project folder** and the guide.

For cluster problems, contact linux-engr-helpdesk@tamu.edu. For problems with this extension, open an issue at https://github.com/shankarchalla987/tamu-olympus-vscode/issues.

It also:

- **Remembers your project folder.** Every new tunnel opens the last folder you used, or the one you set with **Set project folder**.
- **Restores your open tabs.** Files you had open on your previous tunnel job reopen on the new one.
- **Keeps Open Recent tidy.** Old `vscode-<jobid>` entries are removed.
- **Status / Stop.** See your tunnel jobs and the time left, or cancel them.

## Requirements

- An Olympus account (your TAMU NetID) and SSH access to `olympus.ece.tamu.edu`.
- The **Remote - Tunnels** extension. It's installed automatically with this one.
- `ssh` on your computer:
  - **macOS / Linux:** built in.
  - **Windows 10/11:** the built-in **OpenSSH Client**. If the extension says `ssh` wasn't found, go to **Settings → System → Optional features → Add a feature → OpenSSH Client**, then restart VS Code. The terminal uses Windows PowerShell, which every Windows machine has.
- GitHub sign-in for tunnels. The first time, the terminal shows a `github.com/login/device` code. Enter it, then sign in to VS Code with the **same** GitHub account.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `tamuOlympus.netid` | (asked on first use) | Your NetID |
| `tamuOlympus.time` | `1-00:00:00` | Time limit for new jobs (max `7-00:00:00`) |
| `tamuOlympus.folder` | (last used) | Folder to open on every tunnel |
| `tamuOlympus.restoreTabs` | `true` | Reopen your files on new tunnels |
| `tamuOlympus.connectInNewWindow` | `true` | Open the tunnel in a new window |
| `tamuOlympus.cleanRecent` | `true` | Remove old tunnels from Open Recent |
| `tamuOlympus.host` | `olympus.ece.tamu.edu` | Login host |

### Tip: get your extensions on every tunnel automatically

Add this to your VS Code user settings to install the extensions you need on each new tunnel:

```json
"remote.defaultExtensionsIfInstalledLocally": [
  "anthropic.claude-code",
  "ms-python.python"
]
```

### Tip: skip the password

Set up an SSH key once and the terminal won't ask for your password:

- **macOS / Linux:** `ssh-copy-id <netid>@olympus.ece.tamu.edu`
- **Windows (PowerShell):** run `ssh-keygen` (press Enter at each prompt), then:
  ```powershell
  type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh <netid>@olympus.ece.tamu.edu "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
  ```

## Notes

- Stop your job when you're done (**Olympus → Stop tunnel job**) so you don't hold a node you aren't using.
- Terminals and undo history don't carry over between tunnel jobs. Each job gets a new tunnel name.
