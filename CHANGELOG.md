# Changelog

All notable changes to crush-acp will be documented in this file.

## [0.3.3] - 2026-03-27

### Changed
- Slash commands now match Crush TUI naming for consistency
- `/clear` renamed to `/new` (matches Crush "New Session")
- Command descriptions simplified to brief 1-phrase format

### Added
- **Thinking toggle** - Added as dropdown option in session config (also available via `/thinking`)
- **Yolo toggle** - Added as dropdown option in session config (also available via `/yolo`)
- `/status` now shows Thinking and Yolo states
- `/help` now shows current toggle states

## [0.3.2] - 2026-03-27

### Added
- `/status` - Show current session info (model, mode, working dir)
- `/export` - Export session to markdown (with terminal command tip)
- `/init` - Generate AGENTS.md rules file from codebase
- `/review` - Review git changes, branches, or uncommitted code
- Reorganized slash commands by category (Session, Model/Mode, Development, CLI)
- Combined best commands from OpenCode without duplication

## [0.3.1] - 2026-03-27

### Added
- Crush CLI slash commands: `/models`, `/logs`, `/projects`, `/stats`, `/dirs`
- All slash commands now registered with Zed's command palette
- `/help` shows all available commands organized by category

## [0.3.0] - 2026-03-27

### Added
- Mode selector with 4 modes: Code, Ask, Architect, Yolo
- Model selector dynamically populated from `crush models`
- Slash commands support (`/clear`, `/compact`, `/help`, `/model`, `/mode`)
- ACP `configOptions` API for mode/model selection
- Backwards compatibility with legacy `modes`/`models` API

### Fixed
- Removed invalid `-y` flag (crush CLI doesn't support it)
- Removed redundant `yolo_mode` boolean toggle
- Fixed mode sync bug when switching to/from yolo mode
- Limited model list to prevent UI issues (zhipu-coding and zai providers only)

## [0.2.0] - Initial Release

### Added
- Basic ACP adapter for Crush CLI
- Session management
- Prompt handling with model selection
- Tool call pattern matching
- Vision model detection for image handling
