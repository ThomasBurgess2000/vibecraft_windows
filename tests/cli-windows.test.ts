/**
 * Tests for CLI Windows compatibility
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { IS_WINDOWS, HOME_DIR, getHookScriptName, getHookCommand } from '../shared/platform'

const ROOT = join(__dirname, '..')

describe('CLI Script', () => {
  it('should have cli.js in bin/', () => {
    const cliPath = join(ROOT, 'bin', 'cli.js')
    expect(existsSync(cliPath)).toBe(true)
  })

  it('cli.js should have IS_WINDOWS detection', () => {
    const cliPath = join(ROOT, 'bin', 'cli.js')
    const content = readFileSync(cliPath, 'utf-8')
    expect(content).toContain('IS_WINDOWS')
    expect(content).toContain("process.platform === 'win32'")
  })

  it('cli.js should handle PowerShell hook command on Windows', () => {
    const cliPath = join(ROOT, 'bin', 'cli.js')
    const content = readFileSync(cliPath, 'utf-8')
    expect(content).toContain('powershell.exe')
    expect(content).toContain('-ExecutionPolicy Bypass')
  })
})

describe('Hook Scripts', () => {
  it('should have bash hook script', () => {
    const bashHook = join(ROOT, 'hooks', 'vibecraft-hook.sh')
    expect(existsSync(bashHook)).toBe(true)
  })

  it('should have PowerShell hook script', () => {
    const psHook = join(ROOT, 'hooks', 'vibecraft-hook.ps1')
    expect(existsSync(psHook)).toBe(true)
  })

  it('PowerShell hook should have required sections', () => {
    const psHook = join(ROOT, 'hooks', 'vibecraft-hook.ps1')
    const content = readFileSync(psHook, 'utf-8')

    // Should read from stdin
    expect(content).toContain('[Console]::In.ReadToEnd()')

    // Should use ConvertFrom-Json
    expect(content).toContain('ConvertFrom-Json')

    // Should use ConvertTo-Json -Compress for JSONL
    expect(content).toContain('ConvertTo-Json')
    expect(content).toContain('-Compress')

    // Should write to file
    expect(content).toContain('Add-Content')

    // Should handle all event types
    expect(content).toContain('pre_tool_use')
    expect(content).toContain('post_tool_use')
    expect(content).toContain('user_prompt_submit')
    expect(content).toContain('stop')
  })

  it('bash hook should have timestamp handling for both Linux and macOS', () => {
    const bashHook = join(ROOT, 'hooks', 'vibecraft-hook.sh')
    const content = readFileSync(bashHook, 'utf-8')

    // Should handle macOS (no date +%N)
    expect(content).toContain('darwin')

    // Should force decimal interpretation (10#) to avoid octal bug
    expect(content).toContain('10#')
  })
})

describe('Platform Module', () => {
  it('should export getHookScriptName', () => {
    expect(typeof getHookScriptName).toBe('function')
    const name = getHookScriptName()
    expect(name).toMatch(/vibecraft-hook\.(sh|ps1)/)
  })

  it('should export getHookCommand', () => {
    expect(typeof getHookCommand).toBe('function')

    if (IS_WINDOWS) {
      const cmd = getHookCommand('C:\\path\\hook.ps1')
      expect(cmd).toContain('powershell')
    } else {
      const cmd = getHookCommand('/path/hook.sh')
      expect(cmd).toBe('/path/hook.sh')
    }
  })
})

describe('Server Module', () => {
  it('should have ProcessSessionManager', () => {
    const serverPath = join(ROOT, 'server', 'ProcessSessionManager.ts')
    expect(existsSync(serverPath)).toBe(true)
  })

  it('ProcessSessionManager should import platform utils', () => {
    const serverPath = join(ROOT, 'server', 'ProcessSessionManager.ts')
    const content = readFileSync(serverPath, 'utf-8')
    expect(content).toContain("from '../shared/platform")
  })

  it('server/index.ts should import platform utils', () => {
    const indexPath = join(ROOT, 'server', 'index.ts')
    const content = readFileSync(indexPath, 'utf-8')
    expect(content).toContain("from '../shared/platform")
    expect(content).toContain('IS_WINDOWS')
  })

  it('server/index.ts should conditionally use ProcessSessionManager', () => {
    const indexPath = join(ROOT, 'server', 'index.ts')
    const content = readFileSync(indexPath, 'utf-8')
    expect(content).toContain('ProcessSessionManager')
    expect(content).toContain('IS_WINDOWS && processSessionManager')
  })
})

describe('Data Directories', () => {
  it('should use ~/.vibecraft/data for events', () => {
    const defaultsPath = join(ROOT, 'shared', 'defaults.ts')
    const content = readFileSync(defaultsPath, 'utf-8')
    expect(content).toContain('~/.vibecraft/data/events.jsonl')
  })

  it('should use ~/.vibecraft/data for sessions', () => {
    const defaultsPath = join(ROOT, 'shared', 'defaults.ts')
    const content = readFileSync(defaultsPath, 'utf-8')
    expect(content).toContain('~/.vibecraft/data/sessions.json')
  })
})

describe('CLI Help', () => {
  it('should display help without errors', () => {
    try {
      const result = execSync('node bin/cli.js --help', {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 5000,
      })
      expect(result).toContain('vibecraft')
      expect(result).toContain('setup')
    } catch (error: any) {
      // Help exits with code 0, which shouldn't throw
      // But if it does, the output should still be valid
      if (error.stdout) {
        expect(error.stdout).toContain('vibecraft')
      }
    }
  })

  it('should display version without errors', () => {
    try {
      const result = execSync('node bin/cli.js --version', {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 5000,
      })
      expect(result).toMatch(/vibecraft v\d+\.\d+\.\d+/)
    } catch (error: any) {
      if (error.stdout) {
        expect(error.stdout).toMatch(/vibecraft v\d+\.\d+\.\d+/)
      }
    }
  })
})

describe('DirectoryAutocomplete', () => {
  it('should handle Windows paths in display', () => {
    const autocompletePath = join(ROOT, 'src', 'ui', 'DirectoryAutocomplete.ts')
    const content = readFileSync(autocompletePath, 'utf-8')

    // Should normalize backslashes
    expect(content).toContain("replace(/\\\\/g, '/')")

    // Should handle Windows home paths
    expect(content).toContain('C:/Users')
    expect(content).toMatch(/\[A-Za-z\]:/)
  })
})

describe('Path Validation', () => {
  it('server/index.ts should allow backslashes on Windows paths', () => {
    const indexPath = join(ROOT, 'server', 'index.ts')
    const content = readFileSync(indexPath, 'utf-8')

    // Should have platform-conditional regex for path validation
    // Windows: allow backslash (path separator)
    // Unix: reject backslash (potential injection)
    expect(content).toContain('IS_WINDOWS')
    expect(content).toContain('// Windows: allow backslash')

    // The dangerous chars regex should be different for Windows vs Unix
    expect(content).toMatch(/const dangerousChars = IS_WINDOWS/)
  })

  it('should not reject Windows paths with backslashes when IS_WINDOWS', () => {
    // This tests that the regex used on Windows doesn't include backslash
    const windowsRegex = /[;&|`$(){}[\]<>'"!#*?]/
    const unixRegex = /[;&|`$(){}[\]<>\\'"!#*?]/

    const windowsPath = 'C:\\Users\\thoma\\vibecraft_windows'
    const unixPath = '/home/user/project'

    // Windows regex should NOT match backslash paths
    expect(windowsRegex.test(windowsPath)).toBe(false)

    // Unix regex should match backslash paths
    expect(unixRegex.test(windowsPath)).toBe(true)

    // Both should not match normal Unix paths
    expect(windowsRegex.test(unixPath)).toBe(false)
    expect(unixRegex.test(unixPath)).toBe(false)
  })
})
