---
"@kilocode/cli": patch
---

Add extension path resolution for F5 debug workflow

- CLI resolves extension from src/dist/ when KILOCODE_DEV_CLI_PATH is set
- Emit session_created event for Agent Manager integration
- Add watch:cli:setup and watch:cli:deps tasks for reliable CLI builds
