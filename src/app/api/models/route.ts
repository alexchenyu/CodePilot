import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { findAgentBinary, getExpandedPath } from '@/lib/platform';

const execFileAsync = promisify(execFile);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ModelInfo {
  id: string;
  label: string;
  isDefault: boolean;
  isCurrent: boolean;
}

// Cache models for 5 minutes to avoid repeated slow CLI calls
let cachedModels: ModelInfo[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Parse the text output of `agent models` or `agent --list-models` into structured data.
 *
 * Example lines:
 *   opus-4.6-thinking - Claude 4.6 Opus (Thinking)  (default)
 *   sonnet-4.5 - Claude 4.5 Sonnet  (current)
 *   gpt-5.3-codex - GPT-5.3 Codex
 */
function parseModelsOutput(output: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Match: "model-id - Model Label  (default)" or "model-id - Model Label"
    const match = line.match(/^([a-zA-Z0-9._-]+)\s+-\s+(.+)$/);
    if (!match) continue;

    const id = match[1].trim();
    let label = match[2].trim();
    const isDefault = label.includes('(default)');
    const isCurrent = label.includes('(current)');

    // Clean up the label
    label = label
      .replace(/\s*\(default\)\s*/g, '')
      .replace(/\s*\(current\)\s*/g, '')
      .trim();

    models.push({ id, label, isDefault, isCurrent });
  }

  return models;
}

export async function GET() {
  try {
    const now = Date.now();
    if (cachedModels && now - cacheTimestamp < CACHE_TTL) {
      return NextResponse.json({ models: cachedModels });
    }

    const agentPath = findAgentBinary();
    if (!agentPath) {
      return NextResponse.json(
        { error: 'Cursor Agent CLI not found' },
        { status: 503 },
      );
    }

    // Use `agent models` to get available models
    // The CLI writes ANSI escape codes, so we strip them
    // Note: this command can take 60-90s on first run (loading models from server)
    const { stdout, stderr } = await execFileAsync(agentPath, ['models'], {
      timeout: 120000,
      env: { ...process.env, PATH: getExpandedPath(), HOME: process.env.HOME || '' },
    });

    const raw = (stdout || stderr || '')
      // Strip ANSI escape codes
      .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

    const models = parseModelsOutput(raw);

    if (models.length > 0) {
      cachedModels = models;
      cacheTimestamp = now;
    }

    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch models';
    console.error('[GET /api/models]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
