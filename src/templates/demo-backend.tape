# VHS tape for backend demo — issue #{{issue_number}}
# https://github.com/charmbracelet/vhs

Output .rig-reviews/issue-{{issue_number}}/demo.gif

Set FontSize 14
Set Width 1280
Set Height 720
Set Theme "Catppuccin Mocha"

Type "# Rig CLI — Issue #{{issue_number}} Demo"
Enter
Sleep 1s

Type "cd backend && go test ./... -v -run TestNew"
Enter
Sleep 5s

Type "# API endpoint test"
Enter
Sleep 500ms

Type "curl -s http://localhost:8080/api/v1/health | jq ."
Enter
Sleep 2s

Type "# Done!"
Enter
Sleep 1s
