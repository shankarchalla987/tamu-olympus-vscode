jids=$(squeue -u "$USER" -n vscode-tunnel -h -o "%i")
if [ -z "$jids" ]; then echo "No vscode-tunnel jobs to cancel."; exit 0; fi
scancel $jids && echo "Cancelled vscode-tunnel job(s): $(echo $jids)"
