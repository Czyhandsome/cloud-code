## Historical Prompt — 20260424-0947-od0

**Type:** User prompt (direct)

**Original prompt:**
> Here's a very tough job: the @claude-code-source/ is from the leaked Claude Code code, and it is also using the "~/.claude" and other hard coded settings. Well, could we make it use "~/.claude2" instead, and help me find other hard coded config-like files to all rename like this? Is it feasible to do this?

**Follow-up clarification:**
> 1. Well, project level can skip for now, focus on user level. I'm very afraid we may miss files/dirs, so please check carefully! I recall some "~/.claude.json" like files? Please check deeper and make sure all user-level config dir/files are found!

**What was done:**
- Explored the full codebase for all user-home-level claude path references using parallel Explore agents
- Found that all 30+ user-home subdirectories route through the single function `getClaudeConfigHomeDir()` in `src/utils/envUtils.ts`
- Found the critical edge case: `getGlobalClaudeFile()` in `src/utils/env.ts` had a separate `homedir()` fallback that would create `~/.claude.json` outside the main config dir
- Made 3 targeted source edits, rebuilt from source (`bun run build`), reinstalled via `make install`
