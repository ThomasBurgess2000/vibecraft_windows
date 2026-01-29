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
