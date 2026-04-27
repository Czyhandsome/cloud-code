import { createHash } from 'crypto'
import { join } from 'path'
import { getSessionId } from '../bootstrap/state.js'
import { getCwd } from './cwd.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import {
  createNarrativeLoggerFromEnv,
  isNarrativeLoggingEnabled,
  type NarrativeLogger,
} from './narrativeLogger.js'

// undefined = not yet initialized; null = disabled; NarrativeLogger = active
let _logger: NarrativeLogger | null | undefined = undefined
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
    .slice(0, 15) // YYYYMMDD-HHmmss
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

export function getNarrativeLogger(systemPrompt?: string): NarrativeLogger | null {
  if (_logger !== undefined) return _logger

  _logger = createNarrativeLoggerFromEnv(process.env, {
    sessionId: getSessionId(),
    sessionDir: computeNarrativeDir(),
    systemPrompt: systemPrompt ?? '',
    modelName: null,
  })

  if (_logger) {
    // Write session analytics when the process exits cleanly
    process.once('beforeExit', () => {
      try {
        _logger?.finishSession()
      } catch {
        // ignore
      }
    })
  }

  return _logger
}

// Reset between tests or when a new session starts
export function resetNarrativeLogger(): void {
  _logger = undefined
  _sessionDir = undefined
}
