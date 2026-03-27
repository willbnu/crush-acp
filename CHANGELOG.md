# Changelog

All notable changes to crush-acp will be documented in this file.

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
