import { spawn } from 'child_process';
import type { ClaudeStreamOptions, SSEEvent, FileAttachment } from '@/types';
import { isImageFile } from '@/types';
import { findAgentBinary, getExpandedPath } from './platform';
import os from 'os';
import fs from 'fs';
import path from 'path';

/**
 * Format an SSE line from an event object
 */
function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Strip ANSI escape codes and terminal control sequences from a string.
 */
function stripAnsi(data: string): string {
  return data
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')       // CSI sequences (colors, cursor)
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '') // OSC sequences
    .replace(/\x1B\([A-Z]/g, '')                   // Character set selection
    .replace(/\x1B[=>]/g, '')                       // Keypad mode
    .replace(/\x1B\[\?[0-9;]*[a-zA-Z]/g, '')       // Private CSI (e.g. ?25h cursor show)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Control chars (keep \t \n \r)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/**
 * Get file paths for non-image attachments. If the file already has a
 * persisted filePath (written by the uploads route), reuse it. Otherwise
 * fall back to writing the file to .codepilot-uploads/.
 */
function getUploadedFilePaths(files: FileAttachment[], workDir: string): string[] {
  const paths: string[] = [];
  let uploadDir: string | undefined;
  for (const file of files) {
    if (file.filePath) {
      paths.push(file.filePath);
    } else {
      if (!uploadDir) {
        uploadDir = path.join(workDir, '.codepilot-uploads');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
      }
      const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = path.join(uploadDir, `${Date.now()}-${safeName}`);
      const buffer = Buffer.from(file.data, 'base64');
      fs.writeFileSync(filePath, buffer);
      paths.push(filePath);
    }
  }
  return paths;
}

/**
 * Extract tool name and args from Cursor Agent CLI tool_call object.
 * The tool_call has a shape like { readToolCall: { args: {...} } }
 * or { writeToolCall: { args: {...} } }, etc.
 */
function extractToolInfo(toolCall: Record<string, unknown>): { name: string; args: Record<string, unknown> } {
  const keys = Object.keys(toolCall);
  if (keys.length === 0) return { name: 'unknown', args: {} };
  const key = keys[0];
  const inner = toolCall[key] as Record<string, unknown> | undefined;
  const name = key.replace(/ToolCall$/, '').replace(/^./, c => c.toUpperCase());
  return { name, args: (inner?.args as Record<string, unknown>) || {} };
}

/**
 * Extract tool result content from a completed tool_call.
 */
function extractToolResult(toolCall: Record<string, unknown>): { content: string; isError: boolean } {
  const keys = Object.keys(toolCall);
  if (keys.length === 0) return { content: '', isError: false };
  const key = keys[0];
  const inner = toolCall[key] as Record<string, unknown> | undefined;
  const result = inner?.result as Record<string, unknown> | undefined;

  if (!result) return { content: '', isError: false };

  if (result.success) {
    const success = result.success as Record<string, unknown>;
    if (typeof success.content === 'string') return { content: success.content, isError: false };
    return { content: JSON.stringify(success), isError: false };
  }

  if (result.error) {
    const errContent = typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
    return { content: errContent, isError: true };
  }

  return { content: JSON.stringify(result), isError: false };
}

/**
 * Process a single JSON message from the Cursor Agent CLI
 * and enqueue corresponding SSE events.
 */
function processAgentMessage(
  msg: Record<string, unknown>,
  controller: ReadableStreamDefaultController<string>,
) {
  const type = msg.type as string;

  switch (type) {
    case 'system': {
      if (msg.subtype === 'init') {
        controller.enqueue(formatSSE({
          type: 'status',
          data: JSON.stringify({
            session_id: msg.session_id,
            model: msg.model,
            tools: [],
          }),
        }));
      }
      break;
    }

    case 'thinking': {
      if (msg.subtype === 'delta' && msg.text) {
        controller.enqueue(formatSSE({ type: 'thinking', data: msg.text as string }));
      }
      break;
    }

    case 'assistant': {
      if (msg.timestamp_ms) {
        // Streaming delta (has timestamp_ms)
        const message = msg.message as { content?: Array<{ type: string; text?: string }> } | undefined;
        const text = message?.content?.[0]?.text || '';
        if (text) {
          controller.enqueue(formatSSE({ type: 'text', data: text }));
        }
      }
      // Final complete message (no timestamp_ms) is handled by sentStreamingDelta logic in caller
      else {
        const message = msg.message as { content?: Array<{ type: string; text?: string }> } | undefined;
        const text = message?.content?.[0]?.text || '';
        if (text) {
          controller.enqueue(formatSSE({ type: 'text', data: text }));
        }
      }
      break;
    }

    case 'tool_call': {
      const toolCall = msg.tool_call as Record<string, unknown> | undefined;
      if (!toolCall) break;

      if (msg.subtype === 'started') {
        const { name, args } = extractToolInfo(toolCall);
        controller.enqueue(formatSSE({
          type: 'tool_use',
          data: JSON.stringify({
            id: msg.call_id,
            name,
            input: args,
          }),
        }));
      } else if (msg.subtype === 'completed') {
        const { content, isError } = extractToolResult(toolCall);
        controller.enqueue(formatSSE({
          type: 'tool_result',
          data: JSON.stringify({
            tool_use_id: msg.call_id,
            content,
            is_error: isError,
          }),
        }));
      }
      break;
    }

    case 'result': {
      controller.enqueue(formatSSE({
        type: 'result',
        data: JSON.stringify({
          subtype: msg.subtype,
          is_error: msg.is_error,
          duration_ms: msg.duration_ms,
          session_id: msg.session_id,
          usage: null,
        }),
      }));
      break;
    }
  }
}

/**
 * Escape a string for safe embedding in a single-quoted shell argument.
 * 'hello "world"' → 'hello "world"'
 * "it's" → 'it'"'"'s'
 */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\"'\"'") + "'";
}

/**
 * Build the full shell command string for the agent invocation.
 * Each arg is individually shell-escaped.
 */
function buildShellCommand(agentPath: string, args: string[]): string {
  return [shellEscape(agentPath), ...args.map(shellEscape)].join(' ');
}

/**
 * Spawn the agent CLI with a PTY wrapper so that stdout is line-buffered
 * (real-time streaming). Without a PTY, Node.js-based CLIs buffer stdout
 * when it's a pipe, causing all output to arrive only on process exit.
 *
 * On Linux/macOS: `script -qec "command" /dev/null`
 * On Windows: direct spawn (no PTY wrapper available)
 */
function spawnAgentWithPty(
  agentPath: string,
  args: string[],
  env: Record<string, string>,
  cwd: string,
) {
  const shellCmd = buildShellCommand(agentPath, args);

  if (process.platform === 'linux') {
    // Linux: script -qec "command" /dev/null
    return spawn('script', ['-qec', shellCmd, '/dev/null'], {
      env: env as NodeJS.ProcessEnv,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } else if (process.platform === 'darwin') {
    // macOS: script -q /dev/null bash -c "command"
    return spawn('script', ['-q', '/dev/null', 'bash', '-c', shellCmd], {
      env: env as NodeJS.ProcessEnv,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } else {
    // Windows: direct spawn, no PTY wrapper
    return spawn(agentPath, args, {
      env: env as NodeJS.ProcessEnv,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
}

/**
 * Stream Cursor Agent responses by spawning the `agent` CLI in headless mode.
 * Uses `script` as a PTY wrapper to ensure real-time streaming output.
 * Returns a ReadableStream of SSE-formatted strings.
 */
export function streamClaude(options: ClaudeStreamOptions): ReadableStream<string> {
  const {
    prompt,
    sdkSessionId,
    model,
    systemPrompt,
    workingDirectory,
    abortController,
    permissionMode,
    files,
  } = options;

  return new ReadableStream<string>({
    async start(controller) {
      try {
        // Build command arguments
        const args: string[] = [
          '--print',
          '--output-format', 'stream-json',
          '--stream-partial-output',
          '--trust',
        ];

        const workDir = workingDirectory || os.homedir();
        args.push('--workspace', workDir);

        // Resume session if we have an ID from a previous conversation turn
        if (sdkSessionId) {
          args.push('--resume', sdkSessionId);
        }

        if (model) {
          args.push('--model', model);
        }

        // Map permission modes to agent CLI modes
        if (permissionMode === 'plan') {
          args.push('--mode', 'plan');
        } else if (permissionMode === 'default') {
          args.push('--mode', 'ask');
        }

        // Build the final prompt with file references
        let finalPrompt = prompt;

        if (files && files.length > 0) {
          const nonImageFiles = files.filter(f => !isImageFile(f.type));

          if (nonImageFiles.length > 0) {
            const savedPaths = getUploadedFilePaths(nonImageFiles, workDir);
            const fileReferences = savedPaths
              .map((p, i) => `[User attached file: ${p} (${nonImageFiles[i].name})]`)
              .join('\n');
            finalPrompt = `${fileReferences}\n\nPlease read the attached file(s) above, then respond to the user's message:\n\n${prompt}`;
          }

          const imageFiles = files.filter(f => isImageFile(f.type));
          if (imageFiles.length > 0) {
            finalPrompt = `[Note: ${imageFiles.length} image(s) were attached but cannot be displayed in CLI mode.]\n\n${finalPrompt}`;
          }
        }

        if (systemPrompt) {
          finalPrompt = `[System context: ${systemPrompt}]\n\n${finalPrompt}`;
        }

        args.push(finalPrompt);

        // Find agent binary
        const agentPath = findAgentBinary() || 'agent';

        // Build env with expanded PATH
        const spawnEnv: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
          if (typeof value === 'string') {
            spawnEnv[key] = value;
          }
        }
        spawnEnv.PATH = getExpandedPath();
        if (!spawnEnv.HOME) spawnEnv.HOME = os.homedir();
        if (!spawnEnv.USERPROFILE) spawnEnv.USERPROFILE = os.homedir();
        // Ensure agent doesn't try to render interactive UI
        spawnEnv.TERM = 'dumb';

        // Spawn with PTY wrapper for real-time streaming
        const proc = spawnAgentWithPty(agentPath, args, spawnEnv, workDir);

        // Handle abort — kill the process tree
        const onAbort = () => {
          if (!proc.killed) {
            // Kill process group on Unix
            try {
              if (proc.pid && process.platform !== 'win32') {
                process.kill(-proc.pid, 'SIGTERM');
              } else {
                proc.kill('SIGTERM');
              }
            } catch {
              proc.kill('SIGTERM');
            }
          }
        };
        abortController?.signal.addEventListener('abort', onAbort);

        // Buffer for incomplete lines from stdout
        let buffer = '';
        // Track whether we've sent any streaming deltas (for fallback detection)
        let sentStreamingDelta = false;

        proc.stdout.on('data', (data: Buffer) => {
          // Strip ANSI codes from PTY output
          const cleaned = stripAnsi(data.toString());
          buffer += cleaned;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('{')) continue;
            try {
              const msg = JSON.parse(trimmed) as Record<string, unknown>;

              // Track streaming deltas
              if (msg.type === 'assistant' && msg.timestamp_ms) {
                sentStreamingDelta = true;
              }
              // Skip final complete assistant message if we already sent deltas
              if (msg.type === 'assistant' && !msg.timestamp_ms && sentStreamingDelta) {
                sentStreamingDelta = false;
                continue;
              }

              processAgentMessage(msg, controller);
            } catch {
              // Skip non-JSON lines (script header/footer, ANSI leftovers, etc.)
            }
          }
        });

        // With PTY wrapper, stderr from agent also comes through stdout.
        // But proc.stderr still exists for the wrapper process itself.
        proc.stderr?.on('data', (data: Buffer) => {
          const cleaned = stripAnsi(data.toString()).trim();
          if (cleaned) {
            controller.enqueue(formatSSE({ type: 'tool_output', data: cleaned }));
          }
        });

        proc.on('close', (code) => {
          // Process remaining buffer
          if (buffer.trim() && buffer.trim().startsWith('{')) {
            try {
              const msg = JSON.parse(buffer.trim()) as Record<string, unknown>;
              processAgentMessage(msg, controller);
            } catch {
              // skip
            }
          }

          // script wrapper returns the exit code of the child command
          if (code !== 0 && code !== null) {
            controller.enqueue(formatSSE({
              type: 'error',
              data: `Agent process exited with code ${code}`,
            }));
          }
          controller.enqueue(formatSSE({ type: 'done', data: '' }));
          controller.close();
        });

        proc.on('error', (err) => {
          controller.enqueue(formatSSE({
            type: 'error',
            data: `Failed to start agent: ${err.message}`,
          }));
          controller.enqueue(formatSSE({ type: 'done', data: '' }));
          controller.close();
        });

        // Close stdin immediately
        proc.stdin?.end();

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        controller.enqueue(formatSSE({ type: 'error', data: errorMessage }));
        controller.enqueue(formatSSE({ type: 'done', data: '' }));
        controller.close();
      }
    },

    cancel() {
      abortController?.abort();
    },
  });
}
