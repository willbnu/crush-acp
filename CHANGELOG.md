# Changelog

All notable changes to crush-acp will be documented in this file.

## [0.4.4] - 2026-03-28

### Added

- **Windows compatibility notes** — detailed WINDOWS.md explaining SQLite WAL corruption fix, Windows-specific file paths, and debugging guide

## [0.4.3] - 2026-03-28

### Added

- **Provider-based model filtering**: Model list now only shows providers with API keys configured in `crush.json`. Removes the `zhipu` provider (no API key) from the Zed dropdown, leaving only: `zai`, `zhipu-coding`, `opencode-go`, `opencode-go-minimax`, `local-qwen`
- **Free model tagging**: OpenCode Go models (`glm-5`, `kimi-k2.5`, `minimax-m2.5`, `minimax-m2.7`) are tagged with "Free" in the model description for easy identification
- **MiniMax-M2.7 model**: Added to `opencode-go-minimax` provider configuration for access to the latest MiniMax model
- **Session continuation**: Captures crush's internal session ID after each successful run and reuses it on subsequent prompts via `--session` flag, enabling proper conversation continuity
- **Session resume**: Fixed `unstable_resumeSession()` to return `ResumeSessionResponse` instead of `NewSessionResponse` — Zed can now properly resume past sessions from the sidebar

### Changed

- `--data-dir` isolation restored: Zed's crush instances now use an isolated data directory (`AppData/Roaming/.crush-acp/zed-crush/`) separate from TUI crush
- WAL/SHM cleanup: Only cleans `crush.db-wal` and `crush.db-shm` before each run (keeps `crush.db` intact for session continuity)
- Default model updated to `zai/glm-5.1` to match the Z.AI Coding Plan API key

### Fixed

- **Corrupted `crush.json`**: Removed trailing garbage characters that caused `invalid character ']' after top-level value` errors
- **Missing `zai` provider**: Added `zai` provider with Z.AI API key to make `zai/glm-5.1` model available
- **Method name mismatch**: `resumeSession` renamed to `unstable_resumeSession` to match ACP SDK interface
- **Resume response type**: Return type changed from `NewSessionResponse` to `ResumeSessionResponse`

## [0.4.2] - 2026-03-28

### Added

- **Smart Auto-Routing**: When images are detected in a prompt and the current model doesn't support vision, crush-acp automatically switches to the best available vision model (GLM-4.6V > GLM-4.5V > GPT-4o > Claude > Gemini)
- `hasImages()` function to detect image content in prompts
- `findBestVisionModel()` function to select optimal vision model by priority
- Auto-routing notification sent to Zed to update the model dropdown

### Added

- **Session listing support**: Implemented `listSessions()` ACP method so Zed can show active sessions
- Changed `sessionCapabilities.list` from `null` to `{}` to advertise session listing support
- Updated `/new` and `/session` commands to inform users about starting new sessions

### Changed

- `runCrush()` now accepts an optional `effectiveModelId` parameter for auto-routed vision models
- Vision model selection follows priority: GLM-4.6V > GLM-4.5V > GPT-4o > Claude > Gemini

### Fixed

- package.json repository URL updated to point to willbnu/crush-acp fork

## [0.4.1] - 2026-03-27

### Fixed

- Removed all provider-specific/personal references from docs and source
- `isVisionModel()` now detects vision models from all major providers (OpenAI, Anthropic, Google, Mistral, Qwen, GLM)
- CHANGELOG.md corrected default model reference to match source code
- DEVELOPMENT.md cleaned of personal provider references
- Vision warning system prompt added for non-vision models

## [0.4.0] - 2026-03-27

### Changed

- **All models from all providers** now appear in the model dropdown (not just Zhipu)
- Model list fetched dynamically from `crush models` with no provider filtering
- Default model changed to `openai/gpt-5.1` (provider-neutral)
- Improved model display names showing `provider/model-name` format

### Added

- **Windows Setup Guide** (`WINDOWS.md`) — complete instructions for Windows + Zed
- Thinking and Yolo toggle dropdowns with labeled options ("Thinking: On/Off", "Yolo: On/Off")
- Tooltip descriptions on all config options
- Updated README with complete provider/model reference table
- Slash commands reference in README

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
