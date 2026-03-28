# Session Memories — Private Development Notes

**PRIVATE** — never commit to `main`. Only exists on the `dev` branch.

Use this file to record context, decisions, and notes that shouldn't be in git history.

---

## Session Notes

### Date: 2026-03-28

**What we did:**

- Session continuation with --session flag for conversation continuity
- Provider-based model filtering (only show providers with API keys)
- Fix unstable_resumeSession return type
- Restore --data-dir isolation for Zed
- Add MiniMax-M2.7 to opencode-go-minimax provider
- Clean up crush.json trailing garbage

**Repo strategy:**

- main = clean release branch (2 commits)
- dev = WIP branch with private notes
