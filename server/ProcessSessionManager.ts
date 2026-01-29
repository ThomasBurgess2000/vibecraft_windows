/**
 * ProcessSessionManager - Windows session management via child_process
 *
 * On Windows, tmux is not available. This manager spawns Claude Code
 * processes directly and manages them via stdin/stdout.
 */

import { spawn, ChildProcess, execSync } from 'child_process'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { IS_WINDOWS, getExtendedPath, HOME_DIR } from '../shared/platform.js'
import { join } from 'path'

export interface ManagedProcess {
  id: string
  name: string
  process: ChildProcess
  status: 'idle' | 'working' | 'waiting' | 'offline'
  cwd: string
  createdAt: number
  lastActivity: number
  outputBuffer: string[]
  claudeSessionId?: string
  currentTool?: string
}

export interface CreateProcessOptions {
  name?: string
  cwd?: string
  flags?: {
    continue?: boolean
    skipPermissions?: boolean
    chrome?: boolean
  }
}

interface ProcessManagerEvents {
  output: (sessionId: string, data: string) => void
  exit: (sessionId: string, code: number | null) => void
  error: (sessionId: string, error: Error) => void
  statusChange: (sessionId: string, status: ManagedProcess['status']) => void
}

const MAX_OUTPUT_BUFFER_LINES = 500

/**
 * ProcessSessionManager - Manages Claude Code sessions as child processes
 *
 * Used on Windows where tmux is not available. Provides similar functionality
 * by spawning processes and managing their stdin/stdout directly.
 */
export class ProcessSessionManager extends EventEmitter {
  private sessions = new Map<string, ManagedProcess>()
  private sessionCounter = 0
  private extendedPath: string

  constructor() {
    super()
    this.extendedPath = getExtendedPath()
  }

  /**
   * Get all managed sessions
   */
  getSessions(): ManagedProcess[] {
    return Array.from(this.sessions.values())
  }

  /**
   * Get a session by ID
   */
  getSession(id: string): ManagedProcess | undefined {
    return this.sessions.get(id)
  }

  /**
   * Create a new Claude session
   */
  async createSession(options: CreateProcessOptions = {}): Promise<ManagedProcess> {
    this.sessionCounter++
    const id = randomUUID()
    const name = options.name || `Claude ${this.sessionCounter}`
    const cwd = options.cwd || process.cwd()

    // Build command arguments
    const args: string[] = []
    const flags = options.flags || {}

    // Defaults: continue=true, skipPermissions=true
    if (flags.continue !== false) {
      args.push('-c')
    }
    if (flags.skipPermissions !== false) {
      args.push('--permission-mode=bypassPermissions')
      args.push('--dangerously-skip-permissions')
    }
    if (flags.chrome) {
      args.push('--chrome')
    }

    // Find Claude CLI
    const claudePath = this.findClaudePath()
    if (!claudePath) {
      throw new Error('Claude CLI not found. Please ensure it is installed and in PATH.')
    }

    // Spawn the process
    const proc = spawn(claudePath, args, {
      cwd,
      env: {
        ...process.env,
        PATH: this.extendedPath,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    })

    const session: ManagedProcess = {
      id,
      name,
      process: proc,
      status: 'idle',
      cwd,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      outputBuffer: [],
    }

    // Handle stdout
    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      this.appendOutput(session, text)
      session.lastActivity = Date.now()
      this.emit('output', id, text)
    })

    // Handle stderr (also capture for debugging)
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      this.appendOutput(session, `[stderr] ${text}`)
      session.lastActivity = Date.now()
    })

    // Handle process exit
    proc.on('exit', (code) => {
      session.status = 'offline'
      this.emit('exit', id, code)
      this.emit('statusChange', id, 'offline')
    })

    // Handle errors
    proc.on('error', (error) => {
      session.status = 'offline'
      this.emit('error', id, error)
      this.emit('statusChange', id, 'offline')
    })

    this.sessions.set(id, session)
    console.log(`[ProcessSessionManager] Created session: ${name} (${id.slice(0, 8)})`)

    return session
  }

  /**
   * Send input to a session's stdin
   */
  sendInput(id: string, input: string): boolean {
    const session = this.sessions.get(id)
    if (!session || !session.process.stdin) {
      return false
    }

    try {
      // Write to stdin followed by newline
      session.process.stdin.write(input + '\n')
      session.lastActivity = Date.now()
      return true
    } catch (error) {
      console.error(`[ProcessSessionManager] Failed to send input: ${error}`)
      return false
    }
  }

  /**
   * Interrupt a session (send Ctrl+C equivalent)
   */
  interrupt(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session || !session.process) {
      return false
    }

    try {
      if (IS_WINDOWS) {
        // On Windows, we need to use a different approach
        // The taskkill command with /T kills the process tree
        // But for Claude, we want to send a soft interrupt first
        // Try sending Ctrl+C character to stdin
        session.process.stdin?.write('\x03')
        session.lastActivity = Date.now()
      } else {
        // On Unix, send SIGINT
        session.process.kill('SIGINT')
      }
      return true
    } catch (error) {
      console.error(`[ProcessSessionManager] Failed to interrupt: ${error}`)
      return false
    }
  }

  /**
   * Kill a session
   */
  async kill(id: string): Promise<boolean> {
    const session = this.sessions.get(id)
    if (!session) {
      return false
    }

    try {
      if (IS_WINDOWS) {
        // On Windows, kill the process tree
        try {
          execSync(`taskkill /pid ${session.process.pid} /T /F`, { stdio: 'ignore' })
        } catch {
          // Process may already be dead
        }
      } else {
        session.process.kill('SIGTERM')
      }

      this.sessions.delete(id)
      console.log(`[ProcessSessionManager] Killed session: ${session.name}`)
      return true
    } catch (error) {
      console.error(`[ProcessSessionManager] Failed to kill session: ${error}`)
      return false
    }
  }

  /**
   * Get recent output from a session
   */
  getOutput(id: string, lines?: number): string {
    const session = this.sessions.get(id)
    if (!session) {
      return ''
    }

    const output = lines
      ? session.outputBuffer.slice(-lines)
      : session.outputBuffer

    return output.join('\n')
  }

  /**
   * Check health of all sessions
   */
  checkHealth(): void {
    for (const session of this.sessions.values()) {
      // Check if process is still running
      const isAlive = session.process && !session.process.killed && session.process.exitCode === null

      if (!isAlive && session.status !== 'offline') {
        // Session died - mark as offline
        session.status = 'offline'
        this.emit('statusChange', session.id, 'offline')
      } else if (isAlive && session.status === 'offline') {
        // Session came back - mark as idle
        session.status = 'idle'
        this.emit('statusChange', session.id, 'idle')
      }
    }
  }

  /**
   * Update session status
   */
  updateStatus(id: string, status: ManagedProcess['status']): void {
    const session = this.sessions.get(id)
    if (session && session.status !== status) {
      session.status = status
      this.emit('statusChange', id, status)
    }
  }

  /**
   * Set the Claude session ID for a managed session
   */
  linkClaudeSession(managedId: string, claudeSessionId: string): void {
    const session = this.sessions.get(managedId)
    if (session) {
      session.claudeSessionId = claudeSessionId
    }
  }

  /**
   * Find managed session by Claude session ID
   */
  findByClaudeSession(claudeSessionId: string): ManagedProcess | undefined {
    for (const session of this.sessions.values()) {
      if (session.claudeSessionId === claudeSessionId) {
        return session
      }
    }
    return undefined
  }

  /**
   * Restart an offline session
   */
  async restart(id: string): Promise<ManagedProcess | null> {
    const existing = this.sessions.get(id)
    if (!existing) {
      return null
    }

    // Kill existing process if any
    await this.kill(id)

    // Create new session with same settings
    const session = await this.createSession({
      name: existing.name,
      cwd: existing.cwd,
    })

    // Update the ID to match the original
    this.sessions.delete(session.id)
    session.id = id
    this.sessions.set(id, session)

    return session
  }

  /**
   * Clean up all sessions
   */
  async cleanup(): Promise<void> {
    for (const id of this.sessions.keys()) {
      await this.kill(id)
    }
  }

  // Private methods

  private appendOutput(session: ManagedProcess, text: string): void {
    const lines = text.split('\n')
    session.outputBuffer.push(...lines)

    // Trim buffer if too large
    if (session.outputBuffer.length > MAX_OUTPUT_BUFFER_LINES) {
      session.outputBuffer = session.outputBuffer.slice(-MAX_OUTPUT_BUFFER_LINES)
    }
  }

  private findClaudePath(): string | null {
    // Try to find Claude CLI in common locations
    const possiblePaths = IS_WINDOWS
      ? [
          'claude.exe',
          join(HOME_DIR, 'AppData', 'Local', 'Programs', 'Claude', 'claude.exe'),
          join(HOME_DIR, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'claude.exe'),
          join(HOME_DIR, '.local', 'bin', 'claude.exe'),
        ]
      : [
          'claude',
          join(HOME_DIR, '.local', 'bin', 'claude'),
          '/opt/homebrew/bin/claude',
          '/usr/local/bin/claude',
        ]

    // First try 'where' or 'which' to find in PATH
    try {
      if (IS_WINDOWS) {
        const result = execSync('where claude.exe', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
        return result.trim().split('\n')[0]
      } else {
        const result = execSync('which claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
        return result.trim()
      }
    } catch {
      // Not found in PATH, try specific locations
    }

    // Check specific locations
    for (const path of possiblePaths) {
      try {
        // Just try to get the version to verify it works
        execSync(`"${path}" --version`, { stdio: 'ignore' })
        return path
      } catch {
        // Not found at this location
      }
    }

    return null
  }
}

// Export singleton instance for convenience
export const processSessionManager = new ProcessSessionManager()
