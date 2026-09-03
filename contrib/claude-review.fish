# Start a Claude Code session that receives sticky-notes events. Both flags
# are needed; keeping them together is the point. To upgrade a running
# session: /exit, then `claude-review --resume <id>` (the id is printed at
# exit). Not --continue: from ~ it picks whichever conversation was last.
# Install: ln -sf ~/projects/sticky-notes/contrib/claude-review.fish ~/.config/fish/functions/
function claude-review --description "Claude Code with the sticky-notes channel"
    claude --mcp-config ~/projects/sticky-notes/mcp.json \
        --dangerously-load-development-channels server:sticky-notes $argv
end
