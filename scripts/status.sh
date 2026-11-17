out=$(squeue -u "$USER" -n vscode-tunnel -h -o "%i|%T|%L|%N")
if [ -z "$out" ]; then echo "No vscode-tunnel jobs running."; exit 0; fi
printf "%-10s %-10s %-14s %-12s %s\n" JOBID STATE TIME_LEFT NODE TUNNEL
echo "$out" | while IFS="|" read -r id st left node; do
  printf "%-10s %-10s %-14s %-12s %s\n" "$id" "$st" "$left" "${node:--}" "vscode-$id"
done
