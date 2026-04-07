import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findAgentBinary, getExpandedPath } from '@/lib/platform';

const execFileAsync = promisify(execFile);

export interface CliModelInfo {
  id: string;
  label: string;
  isDefault: boolean;
  isCurrent: boolean;
}

let cachedModels: CliModelInfo[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Known Cursor Agent models — used as fallback when `--list-models` returns empty.
 */
const KNOWN_AGENT_MODELS: CliModelInfo[] = [
  { id: 'sonnet-4.6', label: 'Sonnet 4.6', isDefault: false, isCurrent: false },
  { id: 'sonnet-4.6-thinking', label: 'Sonnet 4.6 (Thinking)', isDefault: false, isCurrent: false },
  { id: 'opus-4.6', label: 'Opus 4.6', isDefault: false, isCurrent: false },
  { id: 'opus-4.6-thinking', label: 'Opus 4.6 (Thinking)', isDefault: false, isCurrent: false },
  { id: 'haiku-4.5', label: 'Haiku 4.5', isDefault: false, isCurrent: false },
  { id: 'gpt-5', label: 'GPT-5', isDefault: false, isCurrent: false },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini', isDefault: false, isCurrent: false },
  { id: 'gpt-5.4-medium', label: 'GPT-5.4', isDefault: false, isCurrent: false },
  { id: 'o3', label: 'o3', isDefault: false, isCurrent: false },
  { id: 'o4-mini', label: 'o4 Mini', isDefault: false, isCurrent: false },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', isDefault: false, isCurrent: false },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', isDefault: false, isCurrent: false },
];

/**
 * Parse the text output of `agent --list-models` into structured data.
 *
 * Example lines:
 *   opus-4.6-thinking - Claude 4.6 Opus (Thinking)  (default)
 *   sonnet-4.5 - Claude 4.5 Sonnet  (current)
 */
export function parseModelsOutput(output: string): CliModelInfo[] {
  const models: CliModelInfo[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const match = line.match(/^([a-zA-Z0-9._-]+)\s+-\s+(.+)$/);
    if (!match) continue;

    const id = match[1].trim();
    let label = match[2].trim();
    const isDefault = label.includes('(default)');
    const isCurrent = label.includes('(current)');

    label = label
      .replace(/\s*\(default\)\s*/g, '')
      .replace(/\s*\(current\)\s*/g, '')
      .trim();

    models.push({ id, label, isDefault, isCurrent });
  }

  return models;
}

/**
 * Read the current model from Cursor's cli-config.json.
 */
function readCursorCurrentModel(): string | null {
  try {
    const configPath = path.join(os.homedir(), '.cursor', 'cli-config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    return config?.model?.modelId || null;
  } catch {
    return null;
  }
}

/**
 * Fetch models from the agent CLI binary with module-level caching (5 min TTL).
 * Falls back to known model list if CLI discovery fails.
 */
export async function fetchCliModels(): Promise<CliModelInfo[] | null> {
  const now = Date.now();
  if (cachedModels && now - cacheTimestamp < CACHE_TTL) {
    return cachedModels;
  }

  const agentPath = findAgentBinary();
  if (!agentPath) return null;

  // Try fetching from CLI
  try {
    const { stdout, stderr } = await execFileAsync(agentPath, ['--list-models'], {
      timeout: 15000,
      env: { ...process.env, PATH: getExpandedPath() },
    });

    const raw = (stdout || stderr || '')
      .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

    const models = parseModelsOutput(raw);

    if (models.length > 0) {
      cachedModels = models;
      cacheTimestamp = now;
      return models;
    }
  } catch (error) {
    console.warn('[cli-models] Failed to fetch:', error instanceof Error ? error.message : error);
  }

  // Fallback: use known models list, mark current from Cursor config
  const currentModelId = readCursorCurrentModel();
  const fallback = KNOWN_AGENT_MODELS.map(m => ({
    ...m,
    isCurrent: m.id === currentModelId,
  }));
  cachedModels = fallback;
  cacheTimestamp = now;
  return fallback;
}
