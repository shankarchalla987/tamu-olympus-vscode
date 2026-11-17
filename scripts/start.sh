T="$1"
info=$(squeue -u "$USER" -n vscode-tunnel -h -o "%i %L %N" | head -n 1)
if [ -n "$info" ]; then
  jid=${info%% *}
  echo "Reusing existing vscode-tunnel job $jid (not submitting a new one)."
else
  cd ~ || exit 1
  jid=$(sbatch --parsable --time="$T" /opt/coe/bin/start_vscode_tunnel.sh) || { echo "sbatch failed." >&2; exit 1; }
  jid=${jid%%;*}
  echo "Submitted vscode-tunnel job $jid (time limit $T)."
fi
log="$HOME/vscode-tunnel-$jid.log"
echo "Waiting for the tunnel (up to 3 min)..."
ready=0; shown=""
for i in $(seq 1 60); do
  if [ -f "$log" ]; then
    dev=$(grep "github.com/login/device" "$log" | tail -n 1)
    if [ -n "$dev" ] && [ "$dev" != "$shown" ]; then
      echo; echo ">>> GitHub sign-in needed. Open the link and enter the code:"; echo "$dev"; echo
      shown="$dev"
    fi
    if grep -q "Tunnel:" "$log"; then ready=1; break; fi
  fi
  if [ -z "$(squeue -h -j "$jid" -o "%i" 2>/dev/null)" ]; then
    echo "Job $jid is no longer in the queue. Last lines of $log:"
    tail -n 20 "$log" 2>/dev/null
    exit 1
  fi
  sleep 3
done
read -r st left node <<< "$(squeue -h -j "$jid" -o "%T %L %N")"
echo
[ "$ready" = 1 ] || echo "WARNING: no \"Tunnel:\" line yet (job state: $st). It may still be starting; click Start again in a minute."
echo "Tunnel name : vscode-$jid"
echo "Node        : ${node:-(not assigned yet)}"
echo "Time left   : $left"
echo "Browser URL : https://vscode.dev/tunnel/vscode-$jid"
[ "$ready" = 1 ] && echo "VSTUNNEL_READY=vscode-$jid"
exit 0
