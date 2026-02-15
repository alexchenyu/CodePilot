/**
 * Permission registry for Cursor Agent.
 *
 * Note: In the Cursor Agent CLI `--print` mode, permission handling is managed
 * by the agent process itself (default permission mode). This registry is kept
 * as a minimal stub for API compatibility with the permission route, but the
 * actual permission flow is handled by the agent CLI internally.
 */

export interface PermissionResult {
  behavior: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
  updatedPermissions?: unknown[];
  message?: string;
}

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  createdAt: number;
  abortSignal?: AbortSignal;
  toolInput: Record<string, unknown>;
}

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Use globalThis to ensure the Map is shared across all module instances.
const globalKey = '__pendingPermissions__' as const;

function getMap(): Map<string, PendingPermission> {
  if (!(globalThis as Record<string, unknown>)[globalKey]) {
    (globalThis as Record<string, unknown>)[globalKey] = new Map<string, PendingPermission>();
  }
  return (globalThis as Record<string, unknown>)[globalKey] as Map<string, PendingPermission>;
}

/**
 * Lazily clean up expired entries (older than TIMEOUT_MS).
 */
function cleanupExpired() {
  const map = getMap();
  const now = Date.now();
  for (const [id, entry] of map) {
    if (now - entry.createdAt > TIMEOUT_MS) {
      entry.resolve({ behavior: 'deny', message: 'Permission request timed out' });
      map.delete(id);
    }
  }
}

/**
 * Register a pending permission request.
 * Returns a Promise that resolves when the user responds.
 */
export function registerPendingPermission(
  id: string,
  toolInput: Record<string, unknown>,
  abortSignal?: AbortSignal,
): Promise<PermissionResult> {
  cleanupExpired();

  const map = getMap();

  return new Promise<PermissionResult>((resolve) => {
    map.set(id, {
      resolve,
      createdAt: Date.now(),
      abortSignal,
      toolInput,
    });

    if (abortSignal) {
      const onAbort = () => {
        if (map.has(id)) {
          resolve({ behavior: 'deny', message: 'Request aborted' });
          map.delete(id);
        }
      };
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Resolve a pending permission request with the user's decision.
 * Returns true if the permission was found and resolved, false otherwise.
 */
export function resolvePendingPermission(
  id: string,
  result: PermissionResult,
): boolean {
  const map = getMap();
  const entry = map.get(id);
  if (!entry) return false;

  if (result.behavior === 'allow' && !result.updatedInput) {
    result = { ...result, updatedInput: entry.toolInput };
  }

  entry.resolve(result);
  map.delete(id);
  return true;
}
