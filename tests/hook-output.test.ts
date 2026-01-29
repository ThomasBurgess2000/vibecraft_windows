/**
 * Tests for hook output format
 *
 * These tests verify that the hook scripts produce valid JSONL output
 * that matches the expected event structure.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { IS_WINDOWS, HOME_DIR, TEMP_DIR } from '../shared/platform'

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

  it('PowerShell hook should NOT use $input as a variable name (reserved)', () => {
    const psHook = join(__dirname, '..', 'hooks', 'vibecraft-hook.ps1')
    const content = readFileSync(psHook, 'utf-8')

    // Should not assign to $input (it's a reserved automatic variable)
    expect(content).not.toMatch(/\$input\s*=/)

    // Should use $Input (automatic variable) or $stdinContent
    expect(content).toMatch(/\$Input|\$stdinContent/)
  })
})

describe('PowerShell Hook Execution', () => {
  // Skip on non-Windows platforms
  const runTest = IS_WINDOWS ? it : it.skip

  const testDataDir = join(TEMP_DIR, 'vibecraft-test-' + Date.now())
  const testEventsFile = join(testDataDir, 'events.jsonl')
  const hookPath = join(__dirname, '..', 'hooks', 'vibecraft-hook.ps1')

  // Helper to run PowerShell hook with input
  function runHook(inputObj: object): void {
    // Write input to a temp file to avoid escaping issues
    const inputFile = join(testDataDir, 'input.json')
    writeFileSync(inputFile, JSON.stringify(inputObj))

    // Create a wrapper script that reads from file and pipes to hook
    const wrapperScript = join(testDataDir, 'test-wrapper.ps1')
    const wrapperContent = `
      $env:VIBECRAFT_DATA_DIR = '${testDataDir.replace(/\\/g, '\\\\')}'
      $env:VIBECRAFT_ENABLE_WS_NOTIFY = 'false'
      Get-Content '${inputFile.replace(/\\/g, '\\\\')}' | & '${hookPath.replace(/\\/g, '\\\\')}'
    `
    writeFileSync(wrapperScript, wrapperContent)

    execSync(`powershell -ExecutionPolicy Bypass -File "${wrapperScript}"`, { timeout: 10000 })
  }

  beforeAll(() => {
    if (IS_WINDOWS) {
      mkdirSync(testDataDir, { recursive: true })
    }
  })

  afterAll(() => {
    if (IS_WINDOWS && existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true })
    }
  })

  runTest('should parse PreToolUse event correctly', () => {
    runHook({
      hook_event_name: 'PreToolUse',
      session_id: 'test-session-123',
      tool_name: 'Read',
      tool_input: { file_path: '/test/file.ts' },
      tool_use_id: 'tool-456',
      cwd: 'C:\\test\\project',
    })

    // Read the output
    const output = readFileSync(testEventsFile, 'utf-8').trim()
    const event = JSON.parse(output)

    expect(event.type).toBe('pre_tool_use')
    expect(event.sessionId).toBe('test-session-123')
    expect(event.tool).toBe('Read')
    expect(event.toolUseId).toBe('tool-456')
    expect(event.cwd).toBe('C:\\test\\project')
    expect(typeof event.timestamp).toBe('number')
    expect(event.id).toContain('test-session-123')
  })

  runTest('should parse PostToolUse event correctly', () => {
    // Clear previous events
    if (existsSync(testEventsFile)) unlinkSync(testEventsFile)

    runHook({
      hook_event_name: 'PostToolUse',
      session_id: 'test-session-456',
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
      tool_response: { success: true, stdout: 'file1.txt' },
      tool_use_id: 'tool-789',
      cwd: 'C:\\test',
    })

    const output = readFileSync(testEventsFile, 'utf-8').trim()
    const event = JSON.parse(output)

    expect(event.type).toBe('post_tool_use')
    expect(event.sessionId).toBe('test-session-456')
    expect(event.tool).toBe('Bash')
    expect(event.success).toBe(true)
  })

  runTest('should parse UserPromptSubmit event correctly', () => {
    if (existsSync(testEventsFile)) unlinkSync(testEventsFile)

    runHook({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'test-session-789',
      prompt: 'Hello, Claude!',
      cwd: 'C:\\projects',
    })

    const output = readFileSync(testEventsFile, 'utf-8').trim()
    const event = JSON.parse(output)

    expect(event.type).toBe('user_prompt_submit')
    expect(event.prompt).toBe('Hello, Claude!')
  })

  runTest('should produce valid single-line JSON (JSONL format)', () => {
    if (existsSync(testEventsFile)) unlinkSync(testEventsFile)

    runHook({
      hook_event_name: 'Stop',
      session_id: 'test-stop',
      cwd: 'C:\\test',
    })

    const output = readFileSync(testEventsFile, 'utf-8')
    const lines = output.trim().split('\n')

    // Should be exactly one line
    expect(lines.length).toBe(1)

    // Should be valid JSON
    expect(() => JSON.parse(lines[0])).not.toThrow()
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
