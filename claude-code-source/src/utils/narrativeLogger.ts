import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'

// Stop reasons surfaced by queryLoop()
export type NarrativeStopReason =
  | 'completed'
  | 'model_error'
  | 'blocking_limit'
  | 'prompt_too_long'
  | 'image_error'
  | 'stop_hook_prevented'
  | 'interrupted'

export interface NarrativeLogger {
  readonly narrativeDir: string
  startTurn(
    turnId: string,
    prompt: string,
    options?: { inheritedMessageCount?: number },
  ): void
  logModelRequest(
    round: number,
    info: {
      systemPrompt: string
      model: string
      messages: unknown[]
      toolNames: string[]
    },
  ): void
  logModelRound(
    round: number,
    assistantText: string,
    toolCalls: Array<{ name: string; kind: 'read' | 'mutating' }>,
    latencyMs: number,
  ): void
  logToolResult(
    toolName: string,
    kind: 'read' | 'mutating',
    ok: boolean,
    outputSummary: string,
    durationMs: number,
    error?: string,
  ): void
  writeRawAPIRequest(params: unknown): void
  writeRawAPIResponse(info: {
    stopReason: string | null
    usage: unknown
    requestId: string | null
    model: string
  }): void
  finishTurn(stopReason: NarrativeStopReason, summary: string): void
  finishSession(): void
}

interface FileNarrativeLoggerOptions {
  sessionId: string
  sessionDir: string
  systemPrompt: string
  modelName?: string | null
}

const EXPLICITLY_DISABLED_VALUES = new Set([
  '0',
  'false',
  'off',
  'no',
  'disable',
  'disabled',
])

export function isNarrativeLoggingEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env['NARRATIVE_LOGGING']?.trim().toLowerCase()
  if (!value) return true
  return !EXPLICITLY_DISABLED_VALUES.has(value)
}

function toBlockquote(text: string): string {
  const normalized = text.trim() || '[no text]'
  return normalized
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
}

function quoteHeading(text: string): string {
  const normalized = text.trim() || 'untitled prompt'
  return `"${normalized.replace(/\s+/g, ' ').slice(0, 120)}"`
}

function summarizeRound(toolCalls: Array<{ name: string }>): string {
  if (toolCalls.length === 0) {
    return 'end_turn — no tool calls, turn complete'
  }
  return `tool_use — ${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'} requested`
}

function stopReasonText(stopReason: NarrativeStopReason): string {
  switch (stopReason) {
    case 'completed':
      return 'agent returned text with no further tool calls'
    case 'model_error':
      return 'model call failed'
    case 'blocking_limit':
      return 'context hit the hard blocking token limit'
    case 'prompt_too_long':
      return 'prompt exceeded context window'
    case 'image_error':
      return 'image size or resize error'
    case 'stop_hook_prevented':
      return 'stop hook prevented continuation'
    case 'interrupted':
      return 'process interrupted before completion'
  }
}

function fenceFor(text: string): string {
  const runs = text.match(/`+/g) ?? []
  const longest = runs.reduce((m, s) => Math.max(m, s.length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

function formatTextBlock(text: string): string {
  const normalized = text.length > 0 ? text : '[empty]'
  const fence = fenceFor(normalized)
  return [`${fence}text`, normalized, fence].join('\n')
}

function readTurnNumber(turnsDir: string): number {
  try {
    const nums = readdirSync(turnsDir)
      .map(name => /^turn-(\d+)\.md$/.exec(name)?.[1] ?? null)
      .filter((v): v is string => v !== null)
      .map(v => Number.parseInt(v, 10))
      .filter(v => Number.isFinite(v))
    return nums.length === 0 ? 0 : Math.max(...nums)
  } catch {
    return 0
  }
}

class FileNarrativeLogger implements NarrativeLogger {
  readonly narrativeDir: string

  private readonly narrativePath: string
  private readonly turnsDir: string
  private readonly requestsDir: string
  private readonly sessionId: string
  private readonly systemPromptHash: string

  private turnNumber = 0
  private currentRound = 0
  private lastTurnNumber = 0
  private totalRounds = 0
  private totalToolCalls = 0
  private totalMutatingToolCalls = 0
  private totalModelLatencyMs = 0
  private turnToolCalls = 0
  private toolsOpenedForTurn = false
  private sawOnlyReadToolsThisTurn = true
  private turnBuffer = ''
  private turnSnapshotPath: string | null = null
  private hasLoggedSharedConfig = false

  constructor(options: FileNarrativeLoggerOptions) {
    const narrativeDir = options.sessionDir
    const turnsDir = `${narrativeDir}/turns`
    const requestsDir = `${narrativeDir}/requests`

    mkdirSync(turnsDir, { recursive: true })
    mkdirSync(requestsDir, { recursive: true })

    this.narrativeDir = narrativeDir
    this.turnsDir = turnsDir
    this.requestsDir = requestsDir
    this.sessionId = options.sessionId
    this.systemPromptHash = createHash('sha256')
      .update(options.systemPrompt)
      .digest('hex')
      .slice(0, 12)

    this.narrativePath = `${narrativeDir}/NARRATIVE.md`
    this.lastTurnNumber = readTurnNumber(this.turnsDir)

    if (!existsSync(this.narrativePath)) {
      writeFileSync(
        this.narrativePath,
        [
          '# Claude Code Agent Narrative',
          `**Session:** ${options.sessionId}`,
          '',
          'This directory is a human-readable log of agent turns.',
          '',
          '---',
          '',
        ].join('\n'),
      )
    }
  }

  startTurn(
    _turnId: string,
    prompt: string,
    options: { inheritedMessageCount?: number } = {},
  ): void {
    this.turnNumber = this.lastTurnNumber + 1
    this.lastTurnNumber = this.turnNumber
    this.currentRound = 0
    this.toolsOpenedForTurn = false
    this.turnToolCalls = 0
    this.sawOnlyReadToolsThisTurn = true

    this.turnSnapshotPath = join(
      this.turnsDir,
      `turn-${String(this.turnNumber).padStart(3, '0')}.md`,
    )

    const turnHeader = [
      `## Turn ${this.turnNumber} — ${quoteHeading(prompt)}`,
      '',
      `**Session:** ${this.sessionId}`,
      `**System prompt hash:** ${this.systemPromptHash}`,
      `**Context messages inherited:** ${options.inheritedMessageCount ?? 0}`,
      '',
      `**Prompt:** ${prompt.trim() || '[empty prompt]'}`,
      '',
    ].join('\n')

    this.turnBuffer = [
      '# Claude Code Agent Turn Snapshot',
      `**Session:** ${this.sessionId}`,
      `**System prompt hash:** ${this.systemPromptHash}`,
      '',
      '---',
      '',
      turnHeader,
    ].join('\n')

    appendFileSync(this.narrativePath, `${turnHeader}\n`)
  }

  logModelRequest(
    round: number,
    info: {
      systemPrompt: string
      model: string
      messages: unknown[]
      toolNames: string[]
    },
  ): void {
    this.currentRound = round

    // Log system prompt + tool list once per session
    if (!this.hasLoggedSharedConfig) {
      this.hasLoggedSharedConfig = true
      const toolRows = info.toolNames.map(n => `| \`${n}\` |`)
      const sharedSection = [
        `## Shared Config (session ${this.sessionId})`,
        '',
        `**System prompt hash:** \`${this.systemPromptHash}\``,
        '',
        formatTextBlock(info.systemPrompt),
        '',
        `**Tool Registry** (${info.toolNames.length} tools)`,
        '',
        '| Tool |',
        '| --- |',
        ...toolRows,
        '',
      ].join('\n')
      this.appendTurnSection(sharedSection)
    }

    const section = [
      `### Round ${round} — Request`,
      '',
      `**Model:** \`${info.model}\``,
      `**Messages in context:** ${info.messages.length}`,
      `**Raw request file:** \`requests/turn-${String(this.turnNumber).padStart(3, '0')}-round-${String(round).padStart(3, '0')}-request.json\``,
      '',
    ].join('\n')

    this.appendTurnSection(section)
  }

  logModelRound(
    round: number,
    assistantText: string,
    toolCalls: Array<{ name: string; kind: 'read' | 'mutating' }>,
    latencyMs: number,
  ): void {
    this.totalRounds += 1
    this.totalModelLatencyMs += latencyMs

    const requestedTools =
      toolCalls.length > 0
        ? [
            '**Requested:**',
            ...toolCalls.map(t => `- \`${t.name}\` (${t.kind})`),
          ].join('\n')
        : ''

    const section = [
      `### Round ${round} — Model (${latencyMs}ms)`,
      '',
      `**Stop reason this round:** ${summarizeRound(toolCalls)}`,
      '',
      toBlockquote(assistantText),
      requestedTools ? '' : null,
      requestedTools || null,
      '',
    ]
      .filter((v): v is string => v !== null)
      .join('\n')

    this.appendTurnSection(section)
  }

  logToolResult(
    toolName: string,
    kind: 'read' | 'mutating',
    ok: boolean,
    outputSummary: string,
    _durationMs: number,
    error?: string,
  ): void {
    this.turnToolCalls += 1
    this.totalToolCalls += 1
    if (kind === 'mutating') {
      this.totalMutatingToolCalls += 1
      this.sawOnlyReadToolsThisTurn = false
    }

    if (!this.toolsOpenedForTurn) {
      this.appendTurnSection(['### Tools', ''].join('\n'))
      this.toolsOpenedForTurn = true
    }

    const MAX_RESULT_LINES = 10
    const lines = outputSummary.split('\n')
    const truncated =
      lines.length > MAX_RESULT_LINES
        ? `${lines.slice(0, MAX_RESULT_LINES).join('\n')}\n... (${lines.length - MAX_RESULT_LINES} more lines — see raw request file)`
        : outputSummary

    const summaryText = ok
      ? truncated.trim() || 'Tool completed without output.'
      : error?.trim() || truncated.trim() || 'Tool failed without an error message.'

    const section = [
      `#### \`${toolName}\` — ${kind} | ${ok ? 'ok' : 'error'}`,
      toBlockquote(summaryText),
      '',
    ].join('\n')

    this.appendTurnSection(section)
  }

  writeRawAPIRequest(params: unknown): void {
    if (!this.turnNumber) return
    const fileName = `turn-${String(this.turnNumber).padStart(3, '0')}-round-${String(this.currentRound).padStart(3, '0')}-request.json`
    try {
      writeFileSync(
        join(this.requestsDir, fileName),
        `${JSON.stringify(params, null, 2)}\n`,
      )
    } catch {
      // Never let logging errors interrupt the API call
    }
  }

  writeRawAPIResponse(info: {
    stopReason: string | null
    usage: unknown
    requestId: string | null
    model: string
  }): void {
    if (!this.turnNumber) return
    const fileName = `turn-${String(this.turnNumber).padStart(3, '0')}-round-${String(this.currentRound).padStart(3, '0')}-response.json`
    try {
      writeFileSync(
        join(this.requestsDir, fileName),
        `${JSON.stringify(info, null, 2)}\n`,
      )
    } catch {
      // Never let logging errors interrupt the API call
    }
  }

  finishTurn(stopReason: NarrativeStopReason, summary: string): void {
    const heuristics = this.buildHeuristics(stopReason)
    const section = [
      '---',
      '',
      `**Stop:** \`${stopReason}\` — ${stopReasonText(stopReason)}`,
      `**Summary:** ${summary.trim() || '[no summary]'}`,
      '',
      ...heuristics,
      '---',
      '',
    ].join('\n')

    this.appendTurnSection(section)

    if (this.turnSnapshotPath) {
      writeFileSync(this.turnSnapshotPath, this.turnBuffer)
    }
  }

  finishSession(): void {
    const section = [
      '## Session Analytics',
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Turns | ${this.turnNumber} |`,
      `| Model rounds | ${this.totalRounds} |`,
      `| Tool calls | ${this.totalToolCalls} |`,
      `| Mutating tool calls | ${this.totalMutatingToolCalls} |`,
      `| Total model latency | ${this.totalModelLatencyMs}ms |`,
      '',
    ].join('\n')

    appendFileSync(this.narrativePath, section)
  }

  private appendTurnSection(section: string): void {
    const content = section.endsWith('\n') ? section : `${section}\n`
    this.turnBuffer += content
    appendFileSync(this.narrativePath, content)
  }

  private buildHeuristics(stopReason: NarrativeStopReason): string[] {
    const heuristics: string[] = []
    if (this.turnToolCalls === 0 && stopReason === 'completed') {
      heuristics.push(
        '> **Heuristic:** Agent resolved the turn with reasoning alone, no tools needed.',
        '',
      )
    }
    if (this.totalToolCalls > 0 && this.sawOnlyReadToolsThisTurn) {
      heuristics.push(
        '> **Heuristic:** Agent used read-only tools exclusively — inspect before act.',
        '',
      )
    }
    return heuristics
  }
}

export function createNarrativeLoggerFromEnv(
  env: NodeJS.ProcessEnv,
  options: FileNarrativeLoggerOptions,
): NarrativeLogger | null {
  if (!isNarrativeLoggingEnabled(env)) {
    return null
  }
  return new FileNarrativeLogger(options)
}
