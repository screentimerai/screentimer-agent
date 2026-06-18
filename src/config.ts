import os from 'node:os';
import path from 'node:path';

export const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'com.indistractable.app',
  'indistractable.db'
);

/**
 * Resolve the ScreenTimerAI SQLite database path.
 *
 * Priority:
 *   1. explicit argument
 *   2. INDISTRACTABLE_DB_PATH env var (same var the app's
 *      resolveIndistractableDbPath reads)
 *   3. default macOS app-support location
 */
export function resolveDbPath(explicitPath?: string): string {
  return (
    explicitPath ||
    process.env.INDISTRACTABLE_DB_PATH ||
    DEFAULT_DB_PATH
  );
}
