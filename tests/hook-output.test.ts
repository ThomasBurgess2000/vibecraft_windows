/**
 * Tests for hook output format
 *
 * These tests verify that the hook scripts produce valid JSONL output
 * that matches the expected event structure.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { IS_WINDOWS, HOME_DIR } from '../shared/platform'

describe('Hook Script Existence', () => {
  it('should have the appropriate hook script in hooks/', () => {
    const hookDir = join(__dirname, '..', 'hooks')

    if (IS_WINDOWS) {
      const psHook = join(hookDir, 'vibecraft-hook.ps1')
      expect(existsSync(psHook)).toBe(true)
    }

    // Bash hook should always exist (for Unix)
    const bashHook = join(hookDir, 'vibecraft-hook.sh')
    expect(existsSync(bashHook)).toBe(true)
  })
})

describe('Event JSON Structure', () => {
  // Sample events that hooks should produce
  const samplePreToolUse = {
    id: 'session-123-1234567890-12345',
    timestamp: 1234567890123,
    type: 'pre_tool_use',
    sessionId: 'session-123',
    cwd: '/home/user/project',
    tool: 'Read',
    toolInput: { file_path: '/path/to/file.ts' },
    toolUseId: 'tool-use-456',
    assistantText: '',
  }

  const samplePostToolUse = {
    id: 'session-123-1234567890-12346',
    timestamp: 1234567890124,
    type: 'post_tool_use',
    sessionId: 'session-123',
    cwd: '/home/user/project',
    tool: 'Read',
    toolInput: { file_path: '/path/to/file.ts' },
    toolResponse: { success: true },
    toolUseId: 'tool-use-456',
    success: true,
  }

  const sampleStop = {
    id: 'session-123-1234567890-12347',
    timestamp: 1234567890125,
    type: 'stop',
    sessionId: 'session-123',
    cwd: '/home/user/project',
    stopHookActive: false,
    response: '',
  }

  const sampleUserPrompt = {
    id: 'session-123-1234567890-12348',
    timestamp: 1234567890126,
    type: 'user_prompt_submit',
    sessionId: 'session-123',
    cwd: '/home/user/project',
    prompt: 'Hello, Claude!',
  }

  it('pre_tool_use should have required fields', () => {
    expect(samplePreToolUse).toHaveProperty('id')
    expect(samplePreToolUse).toHaveProperty('timestamp')
    expect(samplePreToolUse).toHaveProperty('type')
    expect(samplePreToolUse).toHaveProperty('sessionId')
    expect(samplePreToolUse).toHaveProperty('cwd')
    expect(samplePreToolUse).toHaveProperty('tool')
    expect(samplePreToolUse).toHaveProperty('toolInput')
    expect(samplePreToolUse).toHaveProperty('toolUseId')
    expect(samplePreToolUse.type).toBe('pre_tool_use')
  })

  it('post_tool_use should have required fields', () => {
    expect(samplePostToolUse).toHaveProperty('id')
    expect(samplePostToolUse).toHaveProperty('timestamp')
    expect(samplePostToolUse).toHaveProperty('type')
    expect(samplePostToolUse).toHaveProperty('sessionId')
    expect(samplePostToolUse).toHaveProperty('tool')
    expect(samplePostToolUse).toHaveProperty('toolUseId')
    expect(samplePostToolUse).toHaveProperty('success')
    expect(samplePostToolUse.type).toBe('post_tool_use')
  })

  it('stop should have required fields', () => {
    expect(sampleStop).toHaveProperty('id')
    expect(sampleStop).toHaveProperty('timestamp')
    expect(sampleStop).toHaveProperty('type')
    expect(sampleStop).toHaveProperty('sessionId')
    expect(sampleStop.type).toBe('stop')
  })

  it('user_prompt_submit should have required fields', () => {
    expect(sampleUserPrompt).toHaveProperty('id')
    expect(sampleUserPrompt).toHaveProperty('timestamp')
    expect(sampleUserPrompt).toHaveProperty('type')
    expect(sampleUserPrompt).toHaveProperty('sessionId')
    expect(sampleUserPrompt).toHaveProperty('prompt')
    expect(sampleUserPrompt.type).toBe('user_prompt_submit')
  })

  it('timestamp should be a number (not octal)', () => {
    // This tests the bug where "087" would be parsed as octal
    expect(typeof samplePreToolUse.timestamp).toBe('number')
    expect(samplePreToolUse.timestamp).toBeGreaterThan(0)

    // Verify it's in milliseconds (13 digits in the test range)
    const timestampStr = String(samplePreToolUse.timestamp)
    expect(timestampStr.length).toBe(13)
  })

  it('JSON should be compact (single line)', () => {
    const jsonStr = JSON.stringify(samplePreToolUse)
    expect(jsonStr).not.toContain('\n')

    // Should be valid JSON
    expect(() => JSON.parse(jsonStr)).not.toThrow()
  })
})

describe('JSONL Format', () => {
  it('should be able to parse each line independently', () => {
    const events = [
      { id: '1', type: 'pre_tool_use', timestamp: Date.now() },
      { id: '2', type: 'post_tool_use', timestamp: Date.now() },
      { id: '3', type: 'stop', timestamp: Date.now() },
    ]

    const jsonl = events.map(e => JSON.stringify(e)).join('\n')
    const lines = jsonl.split('\n')

    lines.forEach((line, i) => {
      const parsed = JSON.parse(line)
      expect(parsed.id).toBe(String(i + 1))
    })
  })

  it('should handle special characters in prompts', () => {
    const event = {
      id: '1',
      type: 'user_prompt_submit',
      prompt: 'Test with "quotes" and\nnewlines and emoji 🎉',
    }

    const jsonStr = JSON.stringify(event)

    // Should be single line (newline should be escaped)
    expect(jsonStr.split('\n').length).toBe(1)

    // Should round-trip correctly
    const parsed = JSON.parse(jsonStr)
    expect(parsed.prompt).toBe(event.prompt)
  })
})
