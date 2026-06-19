import { loadTagStore, saveTagStore } from '../tagStore';
import { resolveBillingWindow, formatDuration } from './billingShared';

/**
 * `untag` — remove billing tags. Reversibility for the `tag` command.
 *
 * Scope: a required --label, optionally narrowed to a [start, end] window
 * (by the tagged activity's start_time) or specific --activity-id values.
 * With no narrowing, removes the entire label.
 */
export function untagCommand(args: any) {
  try {
    runUntag(args);
  } catch (e: any) {
    console.error(`❌ ${e?.message ?? e}`);
    process.exit(1);
  }
}

function runUntag(args: any) {
  const label = typeof args.label === 'string' ? args.label.trim() : '';
  if (!label) {
    throw new Error('--label is required.');
  }

  const { start, end, windowLabel } = resolveBillingWindow(args);
  const hasWindow = Boolean(start || end);
  const ids = parseActivityIds(args['activity-id']);
  const dryRun = Boolean(args.dryRun);

  const { store, path: storePath } = loadTagStore(args['tags-file']);

  const shouldRemove = (t: { label: string; activity_id: number; start_time: string | null }) => {
    if (t.label !== label) return false;
    if (ids.size > 0 && !ids.has(t.activity_id)) return false;
    if (start && (t.start_time === null || t.start_time < start)) return false;
    if (end && (t.start_time === null || t.start_time > end)) return false;
    return true;
  };

  const removed = store.tags.filter(shouldRemove);
  const removedSeconds = removed.reduce((s, t) => s + t.duration_seconds, 0);

  const scope =
    ids.size > 0
      ? `${ids.size} activity id(s)`
      : hasWindow
        ? windowLabel
        : 'all of it';

  const result = {
    label,
    scope,
    removed: removed.length,
    removed_seconds: Math.round(removedSeconds),
    removed_human: formatDuration(removedSeconds),
    store: storePath,
    dry_run: dryRun,
  };

  if (dryRun) {
    console.error(
      `🧪 Dry run — would remove ${removed.length} tag(s) from "${label}" (${scope}, ${formatDuration(removedSeconds)}). Nothing written.`
    );
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (removed.length > 0) {
    store.tags = store.tags.filter((t) => !shouldRemove(t));
    saveTagStore(store, storePath);
  }

  console.error(
    `✅ Removed ${removed.length} tag(s) from "${label}" (${scope}, ${formatDuration(removedSeconds)}). → ${storePath}`
  );
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function parseActivityIds(raw: unknown): Set<number> {
  const out = new Set<number>();
  const push = (v: unknown) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) out.add(n);
  };
  if (Array.isArray(raw)) raw.forEach(push);
  else if (raw !== undefined) push(raw);
  return out;
}
