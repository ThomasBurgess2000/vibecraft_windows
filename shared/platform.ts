/**
 * Vibecraft - Platform Abstraction Layer
 *
 * Cross-platform utilities for file paths, tool detection, and environment.
 * Used throughout the codebase to support both Unix and Windows.
 */

import { homedir, tmpdir, platform } from 'os'
import { join, sep } from 'path'
import { execSync } from 'child_process'

/** Platform detection */
export const IS_WINDOWS = platform() === 'win32'
export const IS_MAC = platform() === 'darwin'
export const IS_LINUX = platform() === 'linux'

/** Common directories */
export const HOME_DIR = homedir()
export const TEMP_DIR = tmpdir()

/** Path separators */
export const PATH_SEP = sep
export const ENV_PATH_SEP = IS_WINDOWS ? ';' : ':'

/**
 * Expand ~ to home directory in paths.
 * Handles both ~/path and ~ by itself.
 */
export function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return join(HOME_DIR, p.slice(p === '~' ? 1 : 2))
  }
  // Handle Windows-style backslash too
  if (p.startsWith('~\\')) {
    return join(HOME_DIR, p.slice(2))
  }
  return p
}

/**
 * Get the vibecraft data directory path.
 * Always uses ~/.vibecraft/data/ regardless of platform.
 */
export function getDataDir(): string {
  return join(HOME_DIR, '.vibecraft', 'data')
}

/**
 * Get the vibecraft hooks directory path.
 * Always uses ~/.vibecraft/hooks/ regardless of platform.
 */
export function getHooksDir(): string {
  return join(HOME_DIR, '.vibecraft', 'hooks')
}

/**
 * Get the appropriate hook script filename for the current platform.
 */
export function getHookScriptName(): string {
  return IS_WINDOWS ? 'vibecraft-hook.ps1' : 'vibecraft-hook.sh'
}

/**
 * Get the full command string to execute the hook script.
 * On Windows, wraps in PowerShell with execution policy bypass.
 */
export function getHookCommand(hookPath: string): string {
  if (IS_WINDOWS) {
    // Use PowerShell with bypass to run the script
    return `powershell.exe -ExecutionPolicy Bypass -File "${hookPath}"`
  }
  return hookPath
}

/**
 * Check if a command-line tool exists on the system.
 * Uses 'where' on Windows, 'which' on Unix.
 */
export function checkToolExists(tool: string): boolean {
  try {
    if (IS_WINDOWS) {
      execSync(`where ${tool}`, { stdio: 'ignore' })
    } else {
      execSync(`which ${tool}`, { stdio: 'ignore' })
    }
    return true
  } catch {
    return false
  }
}

/**
 * Get the extended PATH for exec operations.
 * Includes common tool locations for each platform.
 */
export function getExtendedPath(): string {
  if (IS_WINDOWS) {
    // Windows: Add common install locations
    const paths = [
      join(HOME_DIR, 'AppData', 'Local', 'Programs', 'Claude'),
      join(HOME_DIR, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links'),
      join(HOME_DIR, '.local', 'bin'),
      process.env.PATH || '',
    ]
    return paths.filter(p => p).join(';')
  } else {
    // Unix: Add Homebrew and user paths
    const paths = [
      join(HOME_DIR, '.local', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      process.env.PATH || '',
    ]
    return paths.filter(p => p).join(':')
  }
}

/**
 * Get the signal to send for interrupting a process.
 * On Windows, we use a different approach (see ProcessSessionManager).
 */
export function getInterruptSignal(): NodeJS.Signals {
  return IS_WINDOWS ? 'SIGTERM' : 'SIGINT'
}

/**
 * Normalize a path for display (shorten home directory to ~).
 */
export function shortenPath(p: string): string {
  if (p.startsWith(HOME_DIR)) {
    return '~' + p.slice(HOME_DIR.length).replace(/\\/g, '/')
  }
  return p.replace(/\\/g, '/')
}

/**
 * Check if a path looks like a home directory path.
 * Works cross-platform (handles both /home/user and C:\Users\user).
 */
export function isHomePath(p: string): boolean {
  const normalized = p.replace(/\\/g, '/')
  // Unix: /home/username/...
  if (normalized.startsWith('/home/')) return true
  // macOS: /Users/username/...
  if (normalized.startsWith('/Users/')) return true
  // Windows: C:\Users\username\...
  if (/^[A-Za-z]:\/Users\//i.test(normalized)) return true
  // Tilde notation
  if (normalized.startsWith('~/')) return true
  return false
}
