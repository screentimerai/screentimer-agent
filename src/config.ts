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

/**
 * Plain-JSON store for ad-hoc billing tags.
 *
 * This lives OUTSIDE the ScreenTimerAI app database on purpose: billing tags
 * are a CLI-owned overlay, not system categories. The CLI owns this file
 * entirely — the app never reads it, and routine categorization
 * (export/apply) never touches it. It's plain JSON so you can open, inspect,
 * and hand-edit it.
 */
export const DEFAULT_TAGS_STORE_PATH = path.join(
  os.homedir(),
  '.screentimer-agent',
  'tags.json'
);

/**
 * Resolve the billing-tags JSON store path.
 *
 * Priority:
 *   1. explicit argument (--tags-file)
 *   2. SCREENTIMER_TAGS_FILE env var
 *   3. default ~/.screentimer-agent/tags.json
 */
export function resolveTagsStorePath(explicitPath?: string): string {
  return (
    explicitPath ||
    process.env.SCREENTIMER_TAGS_FILE ||
    DEFAULT_TAGS_STORE_PATH
  );
}
