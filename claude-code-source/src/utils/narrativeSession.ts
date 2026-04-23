import { createHash } from 'crypto'
import { homedir } from 'os'
import { join } from 'path'
import { getSessionId } from '../bootstrap/state.js'
import { getCwd } from './cwd.js'
import {
  createNarrativeLoggerFromEnv,
  type NarrativeLogger,
} from './narrativeLogger.js'

// undefined = not yet initialized; null = disabled; NarrativeLogger = active
let _logger: NarrativeLogger | null | undefined = undefined

export function getNarrativeLogger(systemPrompt?: string): NarrativeLogger | null {
  if (_logger !== undefined) return _logger

  const sessionId = getSessionId()
  const cwd = getCwd()
  const workspaceHash = createHash('sha256').update(cwd).digest('hex').slice(0, 8)
  const ts = new Date()
    .toISOString()
    .replace(/T/, '-')
    .replace(/:/g, '')
    .slice(0, 15) // YYYYMMDD-HHmmss
  const sessionDir = join(
    homedir(),
    '.claude',
    'narrative-logs',
    workspaceHash,
    `${ts}-${sessionId.slice(0, 8)}`,
  )

  _logger = createNarrativeLoggerFromEnv(process.env, {
    sessionId,
    sessionDir,
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
}
