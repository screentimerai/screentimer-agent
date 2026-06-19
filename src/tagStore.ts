import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { resolveTagsStorePath } from './config';

/**
 * One billing tag = one app activity snapshotted at tag time, plus the label
 * it was billed under. We snapshot start/end/duration/app/title so the store
 * is fully self-contained: billing totals stay correct even if the app DB is
 * later wiped, re-tracked, or unavailable.
 *
 * This is deliberately NOT the app's category model. It never references
 * user_categories or activity_logs.category_id. It is a CLI-owned overlay.
 */
export interface TagEntry {
  label: string;
  activity_id: number;
  start_time: string | null;
  end_time: string | null;
  duration_seconds: number;
  app_name: string | null;
  window_title: string | null;
  url: string | null;
  note: string | null;
  tagged_at: string;
}

export interface TagStore {
  /** Schema marker so a future reader/agent never mistakes this for app data. */
  kind: 'screentimer-agent/billing-tags';
  version: 1;
  tags: TagEntry[];
}

function emptyStore(): TagStore {
  return { kind: 'screentimer-agent/billing-tags', version: 1, tags: [] };
}

export function loadTagStore(explicitPath?: string): { store: TagStore; path: string } {
  const filePath = resolveTagsStorePath(explicitPath);
  if (!existsSync(filePath)) {
    return { store: emptyStore(), path: filePath };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (e: any) {
    throw new Error(`Tag store at ${filePath} is not valid JSON: ${e.message}`);
  }

  if (parsed?.kind !== 'screentimer-agent/billing-tags' || !Array.isArray(parsed.tags)) {
    throw new Error(
      `Tag store at ${filePath} is missing the expected billing-tags shape. ` +
        `Refusing to use it to avoid corrupting unrelated data.`
    );
  }

  return { store: parsed as TagStore, path: filePath };
}

/** Atomic write: serialize to a temp file then rename into place. */
export function saveTagStore(store: TagStore, filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', 'utf-8');
  renameSync(tmp, filePath);
}

export interface LabelSummary {
  label: string;
  activities: number;
  seconds: number;
}

/** Per-label rollup of tagged time, sorted by total time descending. */
export function summarizeByLabel(store: TagStore): LabelSummary[] {
  const byLabel = new Map<string, LabelSummary>();
  for (const t of store.tags) {
    const s = byLabel.get(t.label) ?? { label: t.label, activities: 0, seconds: 0 };
    s.activities += 1;
    s.seconds += t.duration_seconds;
    byLabel.set(t.label, s);
  }
  return [...byLabel.values()].sort((a, b) => b.seconds - a.seconds);
}
