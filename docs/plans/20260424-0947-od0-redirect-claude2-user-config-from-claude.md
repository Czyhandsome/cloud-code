# Plan: Rename claude-code-source user config from `~/.claude` to `~/.claude2`

## Context

`claude2` (our locally-built binary) currently shares `~/.claude` with the real `claude`. Goal: full user-home-level isolation so the two binaries don't stomp each other's credentials, history, settings, etc. Project-level `.claude/` dirs are explicitly out of scope for now.

---

## Complete Inventory of User-Home Paths

### A. Centralized via `getClaudeConfigHomeDir()` (properly routed, 30+ subdirs)

All paths below are already controlled by the single function in `src/utils/envUtils.ts:10`.
They ALL go to `~/.claude/<subdir>` and would move to `~/.claude2/<subdir>` automatically:

| Subdir / File | Source location |
|---|---|
| `history.jsonl` | history.ts:115 |
| `keybindings.json` | loadUserBindings.ts:116 |
| `uploads/{sessionId}` | inboundAttachments.ts:61 |
| `projects/` | sessionStoragePortable.ts:326 |
| `cache/changelog.md` | releaseNotes.ts:38 |
| `cache/` (model capabilities) | modelCapabilities.ts:39 |
| `ide/` | ide.ts:463 |
| `local/` (native install) | localInstaller.ts:20 |
| `plans/` | plans.ts:94,100 |
| `debug/{sessionId}.txt` | debug.ts:234 |
| `tasks/` | tasks.ts:223 |
| `stats.json` | statsCache.ts:78 |
| `sessions/` | concurrentSessions.ts:22 |
| `backups/` | config.ts:1363 |
| `CLAUDE.md` | config.ts:1784 |
| `rules/` | config.ts:1806 |
| `startup-perf/` | startupProfiler.ts:152 |
| `shell-snapshots/` | ShellSnapshot.ts:439 |
| `chrome/` | claudeInChrome/setup.ts:310 |
| `.credentials.json` | auth.ts:1323, secureStorage/plainTextStorage.ts:15 |
| `agents/` | agentFileUtils.ts:65 |
| `jobs/` | filesystem.ts:1523 |
| `teams/` | envUtils.ts:17 |
| `skills/` | permissions/filesystem.ts:113 |
| `image-store/` | imageStore.ts:19 |
| `mcp-needs-auth-cache.json` | services/mcp/client.ts:262 |
| `traces/` | perfettoTracing.ts:273 |
| `telemetry/` | firstPartyEventLoggingExporter.ts:45 |
| `magic-docs/prompt.md` | services/MagicDocs/prompts.ts:68 |
| `policy-limits-cache.json` | services/policyLimits/index.ts:120 |
| `remote-settings-cache.json` | services/remoteManagedSettings/syncCacheState.ts:52 |
| `computer-use.lock` | computerUseLock.ts:45 |
| `copilot-clipboard/` | pasteStore.ts:14 |
| `file-history/` | fileHistory.ts:734 |

### B. The Edge Case: `~/.claude.json` (auth credential file)

**Critical**: `src/utils/env.ts:25`, function `getGlobalClaudeFile()`:

```ts
export const getGlobalClaudeFile = memoize((): string => {
  // Legacy: check ~/.claude/.config.json first
  if (getFsImplementation().existsSync(join(getClaudeConfigHomeDir(), '.config.json'))) {
    return join(getClaudeConfigHomeDir(), '.config.json')
  }
  const filename = `.claude${fileSuffixForOauthConfig()}.json`
  return join(process.env.CLAUDE_CONFIG_DIR || homedir(), filename)  // <-- line 25
})
```

This creates `~/.claude.json` (or `~/.claude_enterprise.json`) **directly in the home directory**, NOT inside `~/.claude/`. The `CLAUDE_CONFIG_DIR` env var IS respected here — so with env var set to `$HOME/.claude2`, the file goes to `~/.claude2/.claude.json` instead.

### C. Non-Claude home paths (do NOT touch)

These `homedir()` calls are for OS-standard files unrelated to claude config:
- `~/.npmrc` — npm auth (ide.ts:1394)
- `~/.npm/_cacache` — npm cache (cleanup.ts:460)
- `~/Library/Preferences/com.apple.Terminal.plist` — terminal backup (appleTerminalBackup.ts:34)
- `~/.config/git/ignore` — global gitignore (git/gitignore.ts:44)
- `~/.local/bin/claude`, `~/.local/share/claude` — native installer check (doctorDiagnostic.ts:175)
- `~/.ccr/ca-bundle.crt` — CA bundle for upstream proxy (upstreamproxy.ts:123)
- `~/Applications/{APP_NAME}` — macOS app registration (registerProtocol.ts:41)
- `~/Library/Application Support/ClaudeCode` — managed/MDM settings (managedPath.ts:19)

---

## Two Implementation Options

### Option A: Env Var in Wrapper (zero source changes, recommended for now)

The Makefile wrapper script already launches claude2. Simply add:

```bash
export CLAUDE_CONFIG_DIR="$HOME/.claude2"
```

before exec in the wrapper. This handles **both** centralized paths AND the `~/.claude.json` edge case (line 25 of env.ts respects `CLAUDE_CONFIG_DIR`).

**Files to change**: `Makefile` wrapper script only.

### Option B: Source Default Change (baked into binary, more permanent)

Change 3 things in src/, then rebuild:

**Change 1** — `src/utils/envUtils.ts:10`:
```ts
// Before
process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
// After
process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude2')
```

**Change 2** — `src/utils/env.ts:25` (route the auth JSON through the config dir):
```ts
// Before
return join(process.env.CLAUDE_CONFIG_DIR || homedir(), filename)
// After
return join(getClaudeConfigHomeDir(), filename)
```
This moves `~/.claude.json` → `~/.claude2/.claude.json` (fully isolated).

**Change 3** — `src/tools/FileEditTool/constants.ts` (permission pattern):
```ts
// Find: GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN = '~/.claude/**'
// Change to:
GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN = '~/.claude2/**'
```

Then rebuild: `cd claude-code-source && pnpm build && make install`.

---

## Recommendation

Use **Option B** (source change) — it's only 3 small edits, and it makes the isolation permanent regardless of how claude2 is launched (no dependency on env var being set correctly by callers). The env var `CLAUDE_CONFIG_DIR` still works as an override after these changes.

---

## Verification

1. Run `claude2` once, then check `ls ~/.claude2/` — confirm directory created with `history.jsonl`, etc.
2. Run `ls ~/.claude/` — should be unchanged (real claude still writes here)
3. Run `claude2` and authenticate — confirm `~/.claude2/.claude.json` (or `~/.claude2/.claude_enterprise.json`) created, NOT `~/.claude.json`
4. Run original `claude` — confirm it still reads `~/.claude/` and `~/.claude.json`
