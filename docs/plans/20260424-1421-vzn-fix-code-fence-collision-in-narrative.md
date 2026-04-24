# Plan: Fix code-fence collision in narrative logs

## Context

Both narrative loggers embed raw content (system prompts, JSON tool calls, tool results) inside Markdown code fences. When the content itself contains ` ``` `, the outer fence closes prematurely. The user observed this in Typora and asked whether `~~~~~~` is standard and whether a "multiform boundary" approach is feasible.

---

## Analysis of options

### Option A — Tilde fences (`~~~`)
Standard: yes. CommonMark spec §4.5 defines fences as "at least three consecutive backtick characters or tildes." GitHub GFM and Typora both render `~~~`. Since embedded content virtually never contains tilde fences, switching outer delimiters to `~~~` eliminates collisions in practice. Weakness: if content ever contains `~~~` (e.g. a shell heredoc), the problem recurs identically.

### Option B — Dynamic fence length (CommonMark-canonical)
The spec explicitly accommodates this: a closing fence must use the same character and be at least as long as the opening fence. So if content contains ` ``` `, use 4 backticks; if content contains 4 backticks, use 5, etc.

Algorithm:
1. Scan content for the longest consecutive backtick run.
2. Use `max(3, longestRun + 1)` backticks for both the opening and closing fence.

This is correct per spec, renders correctly in Typora, GitHub, VS Code preview, and Pandoc. It is the approach high-quality tools (pandoc, goldmark, etc.) use internally.

### Option C — Always use 4 backticks
Simplest: hardcode 4-backtick outer fences. Covers ~99% of real-world content. Fails only when content contains a 4+ backtick run — extremely rare for LLM I/O logs.

**Recommendation: Option B** (dynamic) — zero-defect, spec-canonical, negligible code cost.

---

## Files to change

### cloud-code
`cloud-code-source/src/utils/narrativeLogger.ts`
- `formatTextBlock()` — replace hardcoded ` ```text ` with dynamic `fenceFor()`.

### reelweaver
`src/loop/narrative-logger.ts`
- `formatTextBlock()` — same fix.
- `formatJsonBlock()` — same fix.

---

## Implementation

```typescript
function fenceFor(text: string): string {
  const runs = text.match(/`+/g) ?? []
  const longest = runs.reduce((m, s) => Math.max(m, s.length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}
```

---

## Verification

1. Re-run a session that embeds a system prompt containing backtick code examples.
2. Open NARRATIVE.md in Typora — outer fence should stay intact.
3. `grep -c '^\`\`\`' NARRATIVE.md` should be even (all fences matched).
