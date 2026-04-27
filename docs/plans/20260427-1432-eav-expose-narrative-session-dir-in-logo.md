# Plan: Narrative Log Location Clarification + Session Path in Logo

## Context

Two related issues with the narrative/session logging:

1. **Bug report**: user expected narrative logs at `~/.claude2/session-env/<sessionId>/` but found nothing there.
2. **Feature request**: show the narrative session dir path in the welcome logo area so it can be clicked/navigated to quickly.

---

## Issue 1: Why session-env shows nothing (no code change)

`~/.claude2/session-env/<sessionId>/` is for **hook environment variable scripts** — files like `sessionstart-hook-0.sh` written by Setup/SessionStart/CwdChanged/FileChanged hooks. It is NOT the narrative log location.

Narrative logs are at:
```
~/.claude2/narrative-logs/<workspace-hash>/<YYYYMMDD-HHmmss>-<session-id-8chars>/
  NARRATIVE.md
  turns/
  requests/
```

Session `b3e2e2c5` logs: `~/.claude2/narrative-logs/1355ca96/2026-04-27-0615-b3e2e2c5/`

No code fix needed — just a location mismatch in mental model.

---

## Issue 2: Show narrative session path in the logo prompt area

### Files to modify

| File | Change |
|------|--------|
| `src/utils/narrativeSession.ts` | Extract dir computation, add `getNarrativeDir()` export |
| `src/utils/logoV2Utils.ts` | Add `narrativeDir` to `getLogoDisplayData()` |
| `src/components/LogoV2/LogoV2.tsx` | Destructure + render narrative dir notice |

### 1. `src/utils/narrativeSession.ts`

Extract the session directory path computation out of `getNarrativeLogger` into a separately-memoized helper so the path can be read before the logger is initialized (e.g., at logo render time):

```ts
import { getClaudeConfigHomeDir } from './envUtils.js'

let _sessionDir: string | undefined = undefined

function computeNarrativeDir(): string {
  if (_sessionDir !== undefined) return _sessionDir
  const sessionId = getSessionId()
  const cwd = getCwd()
  const workspaceHash = createHash('sha256').update(cwd).digest('hex').slice(0, 8)
  const ts = new Date()
    .toISOString()
    .replace(/T/, '-')
    .replace(/:/g, '')
    .slice(0, 15)
  _sessionDir = join(
    getClaudeConfigHomeDir(),
    'narrative-logs',
    workspaceHash,
    `${ts}-${sessionId.slice(0, 8)}`,
  )
  return _sessionDir
}

export function getNarrativeDir(): string | null {
  if (!isNarrativeLoggingEnabled(process.env)) return null
  return computeNarrativeDir()
}
```

Update `getNarrativeLogger` to use `computeNarrativeDir()` instead of inline computation.

Update `resetNarrativeLogger` to also reset `_sessionDir = undefined`.

**Why separate from `getNarrativeLogger`**: the logger requires a `systemPrompt` arg; calling it early (at logo render) with an empty string would create a logger prematurely. The dir computation is cheap and has no such side effect.

### 2. `src/utils/logoV2Utils.ts`

Import `getNarrativeDir` and add it to `getLogoDisplayData()`:

```ts
import { getNarrativeDir } from './narrativeSession.js'

export function getLogoDisplayData() {
  // ... existing code ...
  return {
    version,
    cwd,
    billingType,
    agentName,
    narrativeDir: getNarrativeDir(),  // add this
  }
}
```

### 3. `src/components/LogoV2/LogoV2.tsx`

**Step A**: Destructure `narrativeDir` at line ~161:
```ts
const {
  version,
  cwd,
  billingType,
  agentName: agentNameFromSettings,
  narrativeDir,   // add
} = getLogoDisplayData();
```

**Step B**: In all 3 code paths, add the narrative dir notice **outside** the memoized logo box (i.e., alongside `{t32}` debug notice, `{t34}` TMUX notice, etc.). No changes to `_c(N)` cache allocation or existing cache indices needed since this is not memoized:

- **Condensed path** (no release notes, no onboarding — returns `t23`):
  ```tsx
  return <>{t23}{narrativeDir && <Box paddingLeft={2} flexDirection="column"><Text dimColor={true}>Session: {narrativeDir}</Text></Box>}</>;
  ```

- **Compact path** (narrow terminal — line 329 inline return):
  Append `{narrativeDir && <Box paddingLeft={2} flexDirection="column"><Text dimColor={true}>Session: {narrativeDir}</Text></Box>}` after `{t19}` in the return.

- **Full horizontal path** (normal — returns `t41`):
  ```tsx
  return <>{t41}{narrativeDir && <Box paddingLeft={2} flexDirection="column"><Text dimColor={true}>Session: {narrativeDir}</Text></Box>}</>;
  ```

### Display

The result renders below the logo box, consistent with how debug mode and TMUX session info appear:

```
╭─ Claude Code ──╮  │  Recent Activity
│ Welcome back!  │  │  ...
│   [clawd art]  │  │
│  Sonnet 4.6    │  │
│  ~/projects/x  │  │
╰────────────────╯
Session: ~/.claude2/narrative-logs/1355ca96/2026-04-27-0615-b3e2e2c5
```

---

## Verification

1. Build: `cd claude-code-source && bun run build` (or `pnpm build`)
2. Run Claude Code in the project dir — the session path should appear below the logo box
3. Confirm the displayed path matches the actual directory: `ls ~/.claude2/narrative-logs/**/<session-short-id>/`
4. Confirm `session-env/` and `narrative-logs/` are both documented correctly (README or inline comment in `sessionEnvironment.ts`)
