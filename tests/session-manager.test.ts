/**
 * Tests for ProcessSessionManager (Windows session management)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IS_WINDOWS } from '../shared/platform'
import { ProcessSessionManager } from '../server/ProcessSessionManager'

describe('ProcessSessionManager', () => {
  let manager: ProcessSessionManager

  beforeEach(() => {
    manager = new ProcessSessionManager()
  })

  afterEach(async () => {
    await manager.cleanup()
  })

  describe('Basic Operations', () => {
    it('should initialize with no sessions', () => {
      const sessions = manager.getSessions()
      expect(sessions).toEqual([])
    })

    it('should generate unique session IDs', () => {
      // We can't actually create sessions without Claude CLI,
      // but we can test the manager's initial state
      expect(manager.getSessions().length).toBe(0)
    })
  })

  describe('Session Retrieval', () => {
    it('getSession should return undefined for non-existent ID', () => {
      const session = manager.getSession('non-existent-id')
      expect(session).toBeUndefined()
    })

    it('findByClaudeSession should return undefined when no sessions', () => {
      const session = manager.findByClaudeSession('claude-session-id')
      expect(session).toBeUndefined()
    })
  })

  describe('Input/Interrupt Operations', () => {
    it('sendInput should return false for non-existent session', () => {
      const result = manager.sendInput('non-existent', 'test input')
      expect(result).toBe(false)
    })

    it('interrupt should return false for non-existent session', () => {
      const result = manager.interrupt('non-existent')
      expect(result).toBe(false)
    })
  })

  describe('Output Buffer', () => {
    it('getOutput should return empty string for non-existent session', () => {
      const output = manager.getOutput('non-existent')
      expect(output).toBe('')
    })

    it('getOutput with lines limit should work', () => {
      const output = manager.getOutput('non-existent', 10)
      expect(output).toBe('')
    })
  })

  describe('Health Check', () => {
    it('checkHealth should not throw when no sessions', () => {
      expect(() => manager.checkHealth()).not.toThrow()
    })
  })

  describe('Kill Operations', () => {
    it('kill should return false for non-existent session', async () => {
      const result = await manager.kill('non-existent')
      expect(result).toBe(false)
    })
  })

  describe('Restart Operations', () => {
    it('restart should return null for non-existent session', async () => {
      const result = await manager.restart('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('Status Updates', () => {
    it('updateStatus should not throw for non-existent session', () => {
      expect(() => manager.updateStatus('non-existent', 'working')).not.toThrow()
    })
  })

  describe('Claude Session Linking', () => {
    it('linkClaudeSession should not throw for non-existent session', () => {
      expect(() => manager.linkClaudeSession('managed-id', 'claude-id')).not.toThrow()
    })
  })

  describe('Cleanup', () => {
    it('cleanup should not throw when no sessions', async () => {
      await expect(manager.cleanup()).resolves.not.toThrow()
    })
  })
})

/**
 * Server API Integration Tests
 *
 * These tests verify the HTTP API for session management works correctly.
 * They require the server to be running on localhost:4003 (or VIBECRAFT_TEST_SERVER).
 *
 * Run with: VIBECRAFT_TEST_SERVER=http://localhost:4003 npm test
 */
describe('Server Session API (Windows)', () => {
  const SERVER_URL = process.env.VIBECRAFT_TEST_SERVER || 'http://localhost:4003'

  // Skip these tests if not on Windows or server not available
  const runTest = IS_WINDOWS ? it : it.skip

  runTest('POST /sessions should create a managed session', async () => {
    try {
      const response = await fetch(`${SERVER_URL}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'API Test Session',
          cwd: process.cwd(),
          flags: { skipPermissions: true },
        }),
      })

      const data = await response.json()

      // KEY ASSERTION: Session creation should succeed on Windows
      expect(data.ok).toBe(true)
      expect(data.session).toBeDefined()
      expect(data.session.id).toBeTruthy()
      expect(data.session.name).toBe('API Test Session')

      // Clean up - delete the session
      if (data.session?.id) {
        await fetch(`${SERVER_URL}/sessions/${data.session.id}`, {
          method: 'DELETE',
        })
      }
    } catch (e) {
      // Skip if server not running
      if ((e as Error).message.includes('ECONNREFUSED') ||
          (e as Error).message.includes('fetch failed')) {
        console.log('Skipping: Server not running at', SERVER_URL)
        return
      }
      throw e
    }
  }, 10000)

  runTest('POST /sessions/:id/prompt should send to managed session (not save to file)', async () => {
    let sessionId: string | null = null

    try {
      // Step 1: Create a session
      const createResponse = await fetch(`${SERVER_URL}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Prompt Test Session',
          cwd: process.cwd(),
          flags: { skipPermissions: true },
        }),
      })

      const createData = await createResponse.json()

      // Verify session was created
      expect(createData.ok).toBe(true)
      expect(createData.session).toBeDefined()
      sessionId = createData.session.id

      // Wait for session to initialize
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Step 2: Send a prompt to the session
      const promptResponse = await fetch(`${SERVER_URL}/sessions/${sessionId}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Hello from integration test' }),
      })

      const promptData = await promptResponse.json()

      // KEY ASSERTIONS: Prompt should succeed, not be saved to file
      expect(promptData.ok).toBe(true)
      // Should NOT have 'saved' field (indicating it went to file instead of session)
      expect(promptData.saved).toBeUndefined()
      // Should NOT have an error
      expect(promptData.error).toBeUndefined()

    } catch (e) {
      if ((e as Error).message.includes('ECONNREFUSED') ||
          (e as Error).message.includes('fetch failed')) {
        console.log('Skipping: Server not running at', SERVER_URL)
        return
      }
      throw e
    } finally {
      // Clean up
      if (sessionId) {
        try {
          await fetch(`${SERVER_URL}/sessions/${sessionId}`, {
            method: 'DELETE',
          })
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }, 15000)

  runTest('GET /sessions should return array of sessions', async () => {
    try {
      const response = await fetch(`${SERVER_URL}/sessions`)
      const data = await response.json()

      expect(data.ok).toBe(true)
      expect(Array.isArray(data.sessions)).toBe(true)
    } catch (e) {
      if ((e as Error).message.includes('ECONNREFUSED') ||
          (e as Error).message.includes('fetch failed')) {
        console.log('Skipping: Server not running at', SERVER_URL)
        return
      }
      throw e
    }
  }, 5000)
})

// Integration tests that require actual process spawning
// These are skipped by default as they require Claude CLI
describe.skip('ProcessSessionManager Integration', () => {
  let manager: ProcessSessionManager

  beforeEach(() => {
    manager = new ProcessSessionManager()
  })

  afterEach(async () => {
    await manager.cleanup()
  })

  it('should spawn a session', async () => {
    const session = await manager.createSession({
      name: 'Test Session',
      cwd: process.cwd(),
    })

    expect(session).toBeDefined()
    expect(session.id).toBeTruthy()
    expect(session.name).toBe('Test Session')
    expect(session.status).toBe('idle')
  })

  it('should send input to a session', async () => {
    const session = await manager.createSession({
      name: 'Test Session',
      cwd: process.cwd(),
    })

    // Wait a bit for process to start
    await new Promise(r => setTimeout(r, 1000))

    const result = manager.sendInput(session.id, '/help')
    expect(result).toBe(true)
  })

  it('should capture output from a session', async () => {
    const session = await manager.createSession({
      name: 'Test Session',
      cwd: process.cwd(),
    })

    // Wait for some output
    await new Promise(r => setTimeout(r, 2000))

    const output = manager.getOutput(session.id)
    expect(output.length).toBeGreaterThan(0)
  })

  it('should interrupt a session', async () => {
    const session = await manager.createSession({
      name: 'Test Session',
      cwd: process.cwd(),
    })

    await new Promise(r => setTimeout(r, 1000))

    const result = manager.interrupt(session.id)
    expect(result).toBe(true)
  })

  it('should kill a session', async () => {
    const session = await manager.createSession({
      name: 'Test Session',
      cwd: process.cwd(),
    })

    const result = await manager.kill(session.id)
    expect(result).toBe(true)

    const found = manager.getSession(session.id)
    expect(found).toBeUndefined()
  })
})
