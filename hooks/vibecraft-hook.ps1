# Vibecraft Hook - Captures Claude Code events for 3D visualization (Windows PowerShell)
#
# This script is called by Claude Code hooks and:
# 1. Reads the hook input from stdin
# 2. Transforms it into our event format
# 3. Appends to the events JSONL file
# 4. Optionally notifies the WebSocket server
#
# Installed to: ~/.vibecraft/hooks/vibecraft-hook.ps1
# Run `npx vibecraft setup` to install/update this hook.

# Stop on errors
$ErrorActionPreference = "Stop"

# =============================================================================
# Configuration
# =============================================================================

# Use environment variables or defaults
$DataDir = if ($env:VIBECRAFT_DATA_DIR) { $env:VIBECRAFT_DATA_DIR } else { Join-Path $env:USERPROFILE ".vibecraft\data" }
$EventsFile = if ($env:VIBECRAFT_EVENTS_FILE) { $env:VIBECRAFT_EVENTS_FILE } else { Join-Path $DataDir "events.jsonl" }
$WsNotifyUrl = if ($env:VIBECRAFT_WS_NOTIFY) { $env:VIBECRAFT_WS_NOTIFY } else { "http://localhost:4003/event" }
$EnableWsNotify = if ($env:VIBECRAFT_ENABLE_WS_NOTIFY -eq "false") { $false } else { $true }

# Ensure data directory exists
$null = New-Item -ItemType Directory -Path $DataDir -Force -ErrorAction SilentlyContinue

# =============================================================================
# Read and Parse Input
# =============================================================================

# Read JSON from stdin
# NOTE: Do NOT use $input as variable name - it's a reserved PowerShell automatic variable
$stdinContent = @($Input) -join "`n"

# If $Input was empty, try Console.In (for piped input)
if (-not $stdinContent) {
    $stdinContent = [Console]::In.ReadToEnd()
}

# Parse the JSON
try {
    $data = $stdinContent | ConvertFrom-Json
} catch {
    # Log error for debugging
    $errorLog = Join-Path $DataDir "hook-errors.log"
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $errorLog -Value "[$timestamp] Failed to parse JSON: $_" -Encoding UTF8
    Add-Content -Path $errorLog -Value "[$timestamp] Input was: $stdinContent" -Encoding UTF8
    exit 1
}

# Extract common fields
$hookEventName = if ($data.hook_event_name) { $data.hook_event_name } else { "unknown" }
$sessionId = if ($data.session_id) { $data.session_id } else { "unknown" }
$cwd = if ($data.cwd) { $data.cwd } else { "" }

# Generate unique event ID and timestamp
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$randomPart = Get-Random -Maximum 999999
$eventId = "$sessionId-$timestamp-$randomPart"

# =============================================================================
# Event Type Mapping
# =============================================================================

$eventType = switch ($hookEventName) {
    "PreToolUse"        { "pre_tool_use" }
    "PostToolUse"       { "post_tool_use" }
    "Stop"              { "stop" }
    "SubagentStop"      { "subagent_stop" }
    "SessionStart"      { "session_start" }
    "SessionEnd"        { "session_end" }
    "UserPromptSubmit"  { "user_prompt_submit" }
    "Notification"      { "notification" }
    "PreCompact"        { "pre_compact" }
    default             { "unknown" }
}

# =============================================================================
# Build Event Object
# =============================================================================

$event = @{
    id = $eventId
    timestamp = $timestamp
    type = $eventType
    sessionId = $sessionId
    cwd = $cwd
}

switch ($eventType) {
    "pre_tool_use" {
        $event.tool = if ($data.tool_name) { $data.tool_name } else { "unknown" }
        $event.toolInput = if ($data.tool_input) { $data.tool_input } else { @{} }
        $event.toolUseId = if ($data.tool_use_id) { $data.tool_use_id } else { "" }

        # Try to extract assistant text from transcript (if available)
        $event.assistantText = ""
        if ($data.transcript_path -and (Test-Path $data.transcript_path)) {
            try {
                $transcriptContent = Get-Content $data.transcript_path -Tail 30 -Raw | ConvertFrom-Json
                # Extract text from assistant messages after the last user message
                # This is a simplified version - full implementation would need more parsing
            } catch {
                # Silently ignore transcript parsing errors
            }
        }
    }

    "post_tool_use" {
        $event.tool = if ($data.tool_name) { $data.tool_name } else { "unknown" }
        $event.toolInput = if ($data.tool_input) { $data.tool_input } else { @{} }
        $event.toolResponse = if ($data.tool_response) { $data.tool_response } else { @{} }
        $event.toolUseId = if ($data.tool_use_id) { $data.tool_use_id } else { "" }
        $event.success = if ($null -ne $data.tool_response.success) { $data.tool_response.success } else { $true }
    }

    { $_ -in "stop", "subagent_stop" } {
        $event.stopHookActive = if ($data.stop_hook_active) { $data.stop_hook_active } else { $false }

        # Try to extract latest assistant response from transcript
        $event.response = ""
        if ($data.transcript_path -and (Test-Path $data.transcript_path)) {
            try {
                # Read last portion of transcript file
                $transcriptLines = Get-Content $data.transcript_path -Tail 200
                # Simplified parsing - join and look for assistant content
            } catch {
                # Silently ignore transcript parsing errors
            }
        }
    }

    "session_start" {
        $event.source = if ($data.source) { $data.source } else { "startup" }
    }

    "session_end" {
        $event.reason = if ($data.reason) { $data.reason } else { "other" }
    }

    "user_prompt_submit" {
        $event.prompt = if ($data.prompt) { $data.prompt } else { "" }
    }

    "notification" {
        $event.message = if ($data.message) { $data.message } else { "" }
        $event.notificationType = if ($data.notification_type) { $data.notification_type } else { "unknown" }
    }

    "pre_compact" {
        $event.trigger = if ($data.trigger) { $data.trigger } else { "manual" }
        $event.customInstructions = if ($data.custom_instructions) { $data.custom_instructions } else { "" }
    }

    default {
        # Unknown event - store raw input
        $event.raw = $data
    }
}

# =============================================================================
# Output Event
# =============================================================================

# Convert to compact JSON (single line for JSONL)
$eventJson = $event | ConvertTo-Json -Compress -Depth 10

# Append to JSONL file
Add-Content -Path $EventsFile -Value $eventJson -Encoding UTF8

# =============================================================================
# Notify WebSocket Server (fire and forget)
# =============================================================================

if ($EnableWsNotify) {
    # Use Start-Job to send notification without blocking
    Start-Job -ScriptBlock {
        param($url, $body)
        try {
            $null = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/json" -TimeoutSec 2
        } catch {
            # Silently ignore errors - server might not be running
        }
    } -ArgumentList $WsNotifyUrl, $eventJson | Out-Null
}

exit 0
