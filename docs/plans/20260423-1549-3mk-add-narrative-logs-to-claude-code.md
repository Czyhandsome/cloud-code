# Plan: Add Narrative Logs to Claude Code

## Context

The user has a modified copy of the Claude Code source at `claude-code-source/` and wants to add the same "Narrative Logs" pattern used by the reelweaver project. The goal: human-readable Markdown logs of every agent turn (what tools ran, what the model said, stop reasons) plus the **complete raw Anthropic API request+response payloads** as JSON files, so the two systems can be compared side-by-side on identical prompts.

**Hard constraint:** Touch as little of the existing agent loop logic as possible. No restructuring — pure additive logging hooks.

---

## What Reelweaver Does (reference implementation)

- `~/.reelweaver/sessions/<workspace>/<timestamp-session-id>/`
  - `NARRATIVE.md` — append-only Markdown log of all turns
  - `turns/turn-NNN.md` — per-turn snapshot (written at turn end)
  - `requests/turn-NNN-round-NNN.json` — full wire-format API request
- Controlled by `NARRATIVE_LOGGING` env var (default: **on**)
- All calls use optional-chaining (`logger?.method()`) so a null logger is a no-op
- 6 call sites total in the agent loop file

---

## Files to Create (2 new files)

### 1. `src/utils/narrativeLogger.ts`
Core logger class, adapted from `reelweaver/src/loop/narrative-logger.ts`:
- `NarrativeLogger` interface with same 7 methods: `startTurn`, `logModelRequest`, `logModelRound`, `logToolResult`, `finishTurn`, `finishSession`, `getTurnInfo`
- `FileNarrativeLogger` class — writes to session dir
- `createNarrativeLoggerFromEnv(env, options)` factory
- `isNarrativeLoggingEnabled(env)` — reads `NARRATIVE_LOGGING` env var
- Session dir: `~/.claude/narrative-logs/<workspace-hash>/<YYYYMMDD-HHMMSS-<sessionId>/`
  - Workspace hash: first 8 chars of SHA256 of `getCwd()`
  - Uses `homedir()` from `os` + `join` from `path`
- Types adapted for Claude Code:
  - `logModelRequest` takes `{ systemPrompt: string, model: string, messages: unknown[], toolNames: string[] }` (simplified vs raw wire format — the raw wire format is logged separately from `claude.ts`)
  - Tool kind: `'read' | 'mutating'` (no 'note' concept; use `tool.isReadOnly(input)` to classify)
  - Stop reason: `'completed' | 'interrupted' | 'model_error' | 'blocking_limit' | 'prompt_too_long' | 'image_error' | 'stop_hook_prevented'`

**Header written on init:**
```markdown
# Claude Code Agent Narrative
**Session:** <sessionId>
This directory is a human-readable log of agent turns.
---
```

### 2. `src/utils/narrativeSession.ts`
Module-level singleton accessor:
```typescript
import { homedir } from 'os'
import { join, createHash } from ...
import { getSessionId } from '../bootstrap/state.js'
import { getCwd } from '../utils/cwd.js'
import { createNarrativeLoggerFromEnv } from './narrativeLogger.js'
import type { NarrativeLogger } from './narrativeLogger.js'

let _logger: NarrativeLogger | null | undefined = undefined  // undefined = not yet initialized

export function getNarrativeLogger(systemPrompt?: string): NarrativeLogger | null {
  if (_logger !== undefined) return _logger

  const sessionId = getSessionId()
  const cwd = getCwd()
  const workspaceHash = createHash('sha256').update(cwd).digest('hex').slice(0, 8)
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const sessionDir = join(homedir(), '.claude', 'narrative-logs', workspaceHash, `${ts}-${sessionId.slice(0, 8)}`)

  _logger = createNarrativeLoggerFromEnv(process.env, {
    sessionId,
    sessionDir,
    systemPrompt: systemPrompt ?? '',
    modelName: null,  // updated at logModelRequest time
  })

  return _logger
}

export function resetNarrativeLogger(): void {
  _logger = undefined  // for tests / new sessions
}
```

---

## Files to Modify (minimal edits)

### 3. `src/query.ts` — 7 touch points, ~40 lines total added

**Import at top:**
```typescript
import { getNarrativeLogger } from './utils/narrativeSession.js'
```

**Touch point 1 — Turn start** (after `const config = buildQueryConfig()`, line ~295):
```typescript
let narrativeRound = 0
const narrativeLogger = getNarrativeLogger(systemPrompt.join('\n'))
const lastUserMsg = params.messages.findLast(m => m.type === 'user')
const promptText = (lastUserMsg?.type === 'user'
  ? lastUserMsg.message.content
  : []).filter((b): b is { type: 'text'; text: string } => b.type === 'text')
  .map(b => b.text).join('\n')
narrativeLogger?.startTurn(config.sessionId, promptText, {
  inheritedMessageCount: params.messages.length,
})
```

**Touch point 2 — Round counter** (at top of `while(true)` body, line ~308):
```typescript
narrativeRound++
const narrativeRoundStart = Date.now()
```

**Touch point 3 — Log model request** (just before `deps.callModel(...)` at line ~659):
```typescript
narrativeLogger?.logModelRequest(narrativeRound, {
  systemPrompt: fullSystemPrompt.join('\n'),
  model: currentModel,
  messages: prependUserContext(messagesForQuery, userContext),
  toolNames: toolUseContext.options.tools.map(t => t.name),
})
```

**Touch point 4 — Log model round** (just after `queryCheckpoint('query_api_streaming_end')` at line ~864):
```typescript
{
  const assistantText = assistantMessages
    .flatMap(m => m.message.content)
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text).join('\n')
  const toolCallsForLog = toolUseBlocks.map(b => ({
    name: b.name,
    kind: (toolUseContext.options.tools.find(t => t.name === b.name)?.isReadOnly(b.input) ? 'read' : 'mutating') as 'read' | 'mutating',
  }))
  narrativeLogger?.logModelRound(narrativeRound, assistantText, toolCallsForLog, Date.now() - narrativeRoundStart)
}
```

**Touch point 5 — Log tool results** (inside `for await (const update of toolUpdates)` loop, after `yield update.message`, line ~1386):
```typescript
if (update.message?.type === 'user') {
  for (const block of update.message.message.content) {
    if (block.type === 'tool_result') {
      const toolUseBlock = toolUseBlocks.find(b => b.id === block.tool_use_id)
      if (toolUseBlock) {
        const tool = toolUseContext.options.tools.find(t => t.name === toolUseBlock.name)
        const kind = tool?.isReadOnly(toolUseBlock.input) ? 'read' : 'mutating'
        const outputText = typeof block.content === 'string' ? block.content
          : Array.isArray(block.content) ? block.content.filter(c => c.type === 'text').map(c => c.text).join('\n') : ''
        narrativeLogger?.logToolResult(
          toolUseBlock.name,
          kind as 'read' | 'mutating',
          !block.is_error,
          outputText,
          0,  // per-tool timing not available here; batch timing captured elsewhere
          block.is_error ? outputText : undefined,
        )
      }
    }
  }
}
```

**Touch point 6 — Finish turn** (wrap each `return` in `queryLoop`, adding the finish call before each):

Before `return { reason: 'blocking_limit' }`:
```typescript
narrativeLogger?.finishTurn('blocking_limit', 'Hit token blocking limit')
```

Before `return { reason: 'completed' }` (multiple places):
```typescript
narrativeLogger?.finishTurn('completed', '')
```

Before `return { reason: 'model_error', error }`:
```typescript
narrativeLogger?.finishTurn('model_error', String(error))
```

Before `return { reason: 'prompt_too_long' }`:
```typescript
narrativeLogger?.finishTurn('prompt_too_long', '')
```

Before `return { reason: 'stop_hook_prevented' }`:
```typescript
narrativeLogger?.finishTurn('stop_hook_prevented', '')
```

Before `return { reason: 'image_error' }` (2 places):
```typescript
narrativeLogger?.finishTurn('image_error', '')
```

**Touch point 7 — Finish session** (at end of `query()` after `return terminal`, not inside `queryLoop`):
Actually `query()` calls `queryLoop()` and then runs `notifyCommandLifecycle`. Add at end of `query()`:
```typescript
// after the yield* queryLoop line resolves
narrativeLogger?.finishSession()
```
Wait — `query()` is a generator. The terminal return value is `return terminal`. Add `finishSession()` before returning:
```typescript
getNarrativeLogger()?.finishSession()
return terminal
```

### 4. `src/services/api/claude.ts` — 2 touch points, ~15 lines

**Purpose:** Log the **actual wire-format params** sent to Anthropic (the true raw HTTP request body) and the response metadata.

**Import at top:**
```typescript
import { getNarrativeLogger } from '../../utils/narrativeSession.js'
```

**Touch point 1 — Raw request** (right after `const params = paramsFromContext(context)` at line ~1797, inside the `withRetry` callback):
```typescript
// Log raw Anthropic API request for source-of-truth comparison
try {
  const nl = getNarrativeLogger()
  if (nl) {
    nl.writeRawAPIRequest(params)  // new method on logger
  }
} catch { /* never interrupt the API call */ }
```

**Touch point 2 — Raw response** (after streaming ends, when `stopReason` and `usage` are known — there's a `logAPISuccess(...)` call around line 463 in `logging.ts` which fires after streaming, we can hook there OR add directly after streaming completes in the `queryModel` generator exit path):

Actually, simpler: add to the `logAPISuccess` function in `logging.ts`... but that's already a third file. Instead, add at the bottom of `queryModel` generator's finally block / after the streaming loop:
```typescript
// After streaming loop, log response metadata
getNarrativeLogger()?.writeRawAPIResponse({
  stopReason,
  usage,
  requestId: streamRequestId ?? null,
  model: options.model,
})
```

**New method `writeRawAPIRequest` on the logger:**

The logger needs access to the requests directory to write raw JSON. Add to `FileNarrativeLogger`:
```typescript
writeRawAPIRequest(params: unknown): void {
  if (!this.turnNumber) return  // no active turn
  const fileName = `turn-${String(this.turnNumber).padStart(3,'0')}-round-${String(this.currentRound).padStart(3,'0')}-request.json`
  writeFileSync(join(this.requestsDir, fileName), JSON.stringify(params, null, 2) + '\n')
}

writeRawAPIResponse(info: { stopReason: string | null, usage: unknown, requestId: string | null, model: string }): void {
  if (!this.turnNumber) return
  const fileName = `turn-${String(this.turnNumber).padStart(3,'0')}-round-${String(this.currentRound).padStart(3,'0')}-response.json`
  writeFileSync(join(this.requestsDir, fileName), JSON.stringify(info, null, 2) + '\n')
}
```

Where `this.currentRound` is set in `logModelRequest()`.

---

## Output Directory Structure

```
~/.claude/narrative-logs/
└── <workspace-hash>/
    └── <YYYYMMDD-HHMMSS>-<session-id-prefix>/
        ├── NARRATIVE.md            # append-only full log
        ├── turns/
        │   ├── turn-001.md         # written at finishTurn()
        │   └── turn-002.md
        └── requests/
            ├── turn-001-round-001-request.json   # full Anthropic wire params
            ├── turn-001-round-001-response.json  # stop_reason, usage, request_id
            └── turn-001-round-002-request.json
```

---

## Verification

1. Build the project: `cd claude-code-source && pnpm build` (or `bun run build`)
2. Run with `NARRATIVE_LOGGING=1` (or just run, since it's on by default):
   ```
   NARRATIVE_LOGGING=1 node dist/cli.js "list the files in the current directory"
   ```
3. Check `~/.claude/narrative-logs/` — a new session directory should appear
4. Verify `NARRATIVE.md` shows turn headers, model rounds, tool results
5. Verify `requests/turn-001-round-001-request.json` contains the full Anthropic API params (messages, system, tools, model, max_tokens, etc.)
6. Disable: `NARRATIVE_LOGGING=0 node dist/cli.js "..."` → no directory created
7. Side-by-side comparison: run same prompt in reelweaver, compare narrative structure and raw request schemas

---

## Key Design Decisions

- **Singleton pattern** in `narrativeSession.ts` avoids threading logger through the deep call stack
- **Optional chaining** (`logger?.method()`) everywhere — null logger is a true no-op, zero overhead
- **`writeRawAPIRequest` in `claude.ts`** captures the actual wire-format params (including cache breakpoints, betas, thinking config, tool schemas) — not the simplified pre-processing view from `query.ts`
- **No changes to** `toolOrchestration.ts`, `toolExecution.ts`, `QueryEngine.ts`, `services/analytics/*`, or any other core logic files
- Tool kind classification: `tool.isReadOnly(input)` → `'read'`; otherwise `'mutating'`

---

## Critical Files

| File | Role | Change type |
|------|------|-------------|
| `src/utils/narrativeLogger.ts` | Logger class | **NEW** |
| `src/utils/narrativeSession.ts` | Singleton accessor | **NEW** |
| `src/query.ts` | Agent loop | Minimal additions (~40 lines) |
| `src/services/api/claude.ts` | API client | Minimal additions (~15 lines) |
