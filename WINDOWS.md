# Windows Compatibility Notes

This document covers the Windows-specific implementation details for crush-acp, particularly where behavior differs from macOS/Linux.

## SQLite WAL Corruption on Windows

### The Problem

When crush runs in Zed on Windows, it uses SQLite for session data. Under certain conditions (process crash, forceful termination, or stdout/stderr pipe issues), the SQLite WAL (Write-Ahead Log) file can become out of sync with the main database, causing:

```
database disk image is malformed (11)
```

### The Solution

crush-acp uses two strategies:

1. **Isolated data directory** — Zed and TUI crush use separate `--data-dir` paths to avoid database conflicts:
   - Zed: `%APPDATA%\.crush-acp\zed-crush\`
   - TUI: crush's default location

2. **WAL-only cleanup** — Before each prompt, only the WAL and SHM files are removed. The main `crush.db` is kept intact so session continuity works.

### Why not delete the whole database?

Deleting `crush.db` would break session continuity — each prompt would start a completely fresh conversation. By cleaning only WAL/SHM, we:

- Remove corruption-prone files
- Preserve existing sessions
- Allow crush to continue the same conversation

### File Paths on Windows

| Purpose               | Path                                          |
| --------------------- | --------------------------------------------- |
| crush-acp sessions    | `%APPDATA%\.crush-acp\sessions\sessions.json` |
| Zed crush isolated DB | `%APPDATA%\.crush-acp\zed-crush\`             |
| crush config          | `%LOCALAPPDATA%\crush\crush.json`             |
| crush logs            | `%APPDATA%\.crush\logs\`                      |

## Process Spawning

### Windows-Specific Considerations

- Uses `spawn()` from Node.js with `stdio: ["ignore", "pipe", "pipe"]`
- `ignore` on stdin prevents TTY detection issues
- Working directory set to `session.workingDir` from Zed

### If Crush Crashes

1. The WAL file may be left in an inconsistent state
2. Next run triggers "database disk image is malformed"
3. Fix: delete `crush.db-wal` and `crush.db-shm` in the data directory

```powershell
Remove-Item "$env:APPDATA\.crush-acp\zed-crush\crush.db-wal"
Remove-Item "$env:APPDATA\.crush-acp\zed-crush\crush.db-shm"
```

## crush.json Location

On Windows, crush reads its config from:

1. `%LOCALAPPDATA%\crush\crush.json` (primary)
2. `%APPDATA%\crush\crush.json` (fallback)

The adapter reads from both paths to detect configured providers.

## Session Persistence

Session configs (model, mode, thinking, yolo settings) are persisted to:

```
%APPDATA%\.crush-acp\sessions\sessions.json
```

This is independent of crush's own session storage and survives across crush-acp restarts.

## Comparison: macOS/Linux

| Aspect          | macOS/Linux                  | Windows                             |
| --------------- | ---------------------------- | ----------------------------------- |
| Config location | `~/.config/crush/crush.json` | `%LOCALAPPDATA%\crush\crush.json`   |
| Data directory  | `~/.crush/`                  | `%APPDATA%\.crush\`                 |
| Session path    | `~/.crush/sessions/`         | Same structure                      |
| WAL corruption  | Rare                         | More common due to process handling |
| Working dir     | TUI cwd                      | `session.workingDir` from Zed       |

## Debugging

To diagnose issues on Windows:

1. **ACP logs**: `Ctrl+Shift+P` → `dev: open acp logs`
2. **crush-acp stderr**: Check Zed's output pane for `[crush-acp]` prefixed logs
3. **crush logs**: `%APPDATA%\.crush\logs\crush.log`
4. **Manual config test**: Run `crush models` in PowerShell/CMD to verify API keys work
