/**
 * Tests for the platform abstraction layer
 */

import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from 'fs'
import { join } from 'path'
import {
  IS_WINDOWS,
  IS_MAC,
  IS_LINUX,
  HOME_DIR,
  TEMP_DIR,
  PATH_SEP,
  ENV_PATH_SEP,
  expandHome,
  getDataDir,
  getHooksDir,
  getHookScriptName,
  getHookCommand,
  checkToolExists,
  getExtendedPath,
  shortenPath,
  isHomePath,
} from '../shared/platform'

describe('Platform Detection', () => {
  it('should detect exactly one platform', () => {
    const platforms = [IS_WINDOWS, IS_MAC, IS_LINUX].filter(Boolean)
    expect(platforms.length).toBe(1)
  })

  it('should match process.platform', () => {
    if (process.platform === 'win32') {
      expect(IS_WINDOWS).toBe(true)
    } else if (process.platform === 'darwin') {
      expect(IS_MAC).toBe(true)
    } else if (process.platform === 'linux') {
      expect(IS_LINUX).toBe(true)
    }
  })
})

describe('Directory Constants', () => {
  it('HOME_DIR should be a valid directory', () => {
    expect(HOME_DIR).toBeTruthy()
    expect(existsSync(HOME_DIR)).toBe(true)
  })

  it('TEMP_DIR should be a valid directory', () => {
    expect(TEMP_DIR).toBeTruthy()
    expect(existsSync(TEMP_DIR)).toBe(true)
  })

  it('TEMP_DIR should be writable', () => {
    const testFile = join(TEMP_DIR, `vibecraft-test-${Date.now()}.txt`)
    writeFileSync(testFile, 'test')
    expect(existsSync(testFile)).toBe(true)
    unlinkSync(testFile)
  })
})

describe('Path Separators', () => {
  it('PATH_SEP should be correct for platform', () => {
    if (IS_WINDOWS) {
      expect(PATH_SEP).toBe('\\')
    } else {
      expect(PATH_SEP).toBe('/')
    }
  })

  it('ENV_PATH_SEP should be correct for platform', () => {
    if (IS_WINDOWS) {
      expect(ENV_PATH_SEP).toBe(';')
    } else {
      expect(ENV_PATH_SEP).toBe(':')
    }
  })
})

describe('expandHome', () => {
  it('should expand ~/path correctly', () => {
    const result = expandHome('~/test/path')
    expect(result).toBe(join(HOME_DIR, 'test', 'path'))
    expect(result).not.toContain('~')
  })

  it('should expand ~ alone correctly', () => {
    const result = expandHome('~')
    expect(result).toBe(HOME_DIR)
  })

  it('should not modify absolute paths', () => {
    if (IS_WINDOWS) {
      const result = expandHome('C:\\Users\\test')
      expect(result).toBe('C:\\Users\\test')
    } else {
      const result = expandHome('/usr/local/bin')
      expect(result).toBe('/usr/local/bin')
    }
  })

  it('should handle Windows backslash tilde paths', () => {
    const result = expandHome('~\\test')
    expect(result).toBe(join(HOME_DIR, 'test'))
  })
})

describe('getDataDir', () => {
  it('should return a path under home directory', () => {
    const dataDir = getDataDir()
    expect(dataDir.startsWith(HOME_DIR)).toBe(true)
  })

  it('should include .vibecraft/data', () => {
    const dataDir = getDataDir()
    expect(dataDir).toContain('.vibecraft')
    expect(dataDir).toContain('data')
  })
})

describe('getHooksDir', () => {
  it('should return a path under home directory', () => {
    const hooksDir = getHooksDir()
    expect(hooksDir.startsWith(HOME_DIR)).toBe(true)
  })

  it('should include .vibecraft/hooks', () => {
    const hooksDir = getHooksDir()
    expect(hooksDir).toContain('.vibecraft')
    expect(hooksDir).toContain('hooks')
  })
})

describe('getHookScriptName', () => {
  it('should return correct extension for platform', () => {
    const name = getHookScriptName()
    if (IS_WINDOWS) {
      expect(name).toBe('vibecraft-hook.ps1')
    } else {
      expect(name).toBe('vibecraft-hook.sh')
    }
  })
})

describe('getHookCommand', () => {
  it('should wrap with PowerShell on Windows', () => {
    const cmd = getHookCommand('C:\\path\\to\\hook.ps1')
    if (IS_WINDOWS) {
      expect(cmd).toContain('powershell.exe')
      expect(cmd).toContain('-ExecutionPolicy Bypass')
      expect(cmd).toContain('-File')
    }
  })

  it('should return path directly on Unix', () => {
    if (!IS_WINDOWS) {
      const cmd = getHookCommand('/path/to/hook.sh')
      expect(cmd).toBe('/path/to/hook.sh')
    }
  })
})

describe('checkToolExists', () => {
  it('should find node (since we are running in node)', () => {
    expect(checkToolExists('node')).toBe(true)
  })

  it('should not find a non-existent tool', () => {
    expect(checkToolExists('this-tool-does-not-exist-12345')).toBe(false)
  })
})

describe('getExtendedPath', () => {
  it('should return a non-empty string', () => {
    const path = getExtendedPath()
    expect(path).toBeTruthy()
    expect(typeof path).toBe('string')
  })

  it('should use correct separator', () => {
    const path = getExtendedPath()
    if (IS_WINDOWS) {
      expect(path).toContain(';')
    } else {
      expect(path).toContain(':')
    }
  })

  it('should include original PATH', () => {
    const path = getExtendedPath()
    const originalPath = process.env.PATH || ''
    // At least part of the original PATH should be included
    expect(path).toContain(originalPath.slice(0, 20))
  })
})

describe('shortenPath', () => {
  it('should shorten home directory to ~', () => {
    const fullPath = join(HOME_DIR, 'projects', 'test')
    const short = shortenPath(fullPath)
    expect(short).toContain('~')
    expect(short).not.toContain(HOME_DIR)
  })

  it('should normalize backslashes to forward slashes', () => {
    const path = 'C:\\Users\\test\\path'
    const short = shortenPath(path)
    expect(short).not.toContain('\\')
  })

  it('should not modify paths outside home', () => {
    if (IS_WINDOWS) {
      const short = shortenPath('C:\\Windows\\System32')
      expect(short).toBe('C:/Windows/System32')
    } else {
      const short = shortenPath('/usr/local/bin')
      expect(short).toBe('/usr/local/bin')
    }
  })
})

describe('isHomePath', () => {
  it('should detect Unix home paths', () => {
    expect(isHomePath('/home/user/projects')).toBe(true)
    expect(isHomePath('/Users/user/Documents')).toBe(true)
  })

  it('should detect Windows home paths', () => {
    expect(isHomePath('C:/Users/user/Documents')).toBe(true)
    expect(isHomePath('C:\\Users\\user\\Documents')).toBe(true)
  })

  it('should detect tilde paths', () => {
    expect(isHomePath('~/projects')).toBe(true)
  })

  it('should reject non-home paths', () => {
    expect(isHomePath('/usr/local/bin')).toBe(false)
    expect(isHomePath('/var/log')).toBe(false)
    if (IS_WINDOWS) {
      expect(isHomePath('C:\\Windows\\System32')).toBe(false)
    }
  })
})
