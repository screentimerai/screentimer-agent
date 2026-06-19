import { openDb, getActivitiesInWindow, WindowActivityRow } from '../db';
import { loadTagStore, saveTagStore, TagEntry } from '../tagStore';
import { resolveBillingWindow, formatDuration } from './billingShared';

/**
 * `tag` — attach an ad-hoc billing label to activities in a time window.
 *
 * Writes ONLY the CLI-owned JSON store. It never touches activity_logs or
 * user_categories, so a future agent running the normal export/apply
 * categorization loop will never see or disturb these billing tags.
 */
export function tagCommand(args: any) {
  try {
    runTag(args);
  } catch (e: any) {
    console.error(`❌ ${e?.message ?? e}`);
    process.exit(1);
  }
}

function runTag(args: any) {
  const label = typeof args.label === 'string' ? args.label.trim() : '';
  if (!label) {
    throw new Error('--label is required (e.g. --label "client:acme / Jan invoice").');
  }

  const { start, end, windowLabel } = resolveBillingWindow(args);
  const note = typeof args.note === 'string' && args.note.trim() ? args.note.trim() : null;
  const dryRun = Boolean(args.dryRun);

  const db = openDb({ readonly: true }, args.db);
  let candidates: WindowActivityRow[];
  try {
    candidates = getActivitiesInWindow(db, start, end, {
      app: args.app,
      urlContains: args['url-contains'],
      titleContains: args['title-contains'],
    });
  } finally {
    db.close();
  }

  const { store, path: storePath } = loadTagStore(args['tags-file']);

  // Dedupe: an activity already tagged with this label is a no-op.
  const existing = new Set(
    store.tags.filter((t) => t.label === label).map((t) => t.activity_id)
  );

  const taggedAt = new Date().toISOString();
  const added: TagEntry[] = [];
  let alreadyTagged = 0;

  for (const a of candidates) {
    if (existing.has(a.id)) {
      alreadyTagged += 1;
      continue;
    }
    added.push({
      label,
      activity_id: a.id,
      start_time: a.start_time,
      end_time: a.end_time,
      duration_seconds: Math.max(0, a.duration_seconds || 0),
      app_name: a.app_name,
      window_title: a.window_title,
      url: a.url,
      note,
      tagged_at: taggedAt,
    });
  }

  const addedSeconds = added.reduce((s, t) => s + t.duration_seconds, 0);

  const result = {
    label,
    window: { start: start ?? null, end: end ?? null, label: windowLabel },
    matched: candidates.length,
    tagged: added.length,
    already_tagged: alreadyTagged,
    tagged_seconds: Math.round(addedSeconds),
    tagged_human: formatDuration(addedSeconds),
    store: storePath,
    dry_run: dryRun,
  };

  if (dryRun) {
    console.error(
      `🧪 Dry run — would tag ${added.length} of ${candidates.length} activities in ${windowLabel} ` +
        `as "${label}" (${formatDuration(addedSeconds)})` +
        (alreadyTagged > 0 ? `, ${alreadyTagged} already tagged` : '') +
        '. Nothing written.'
    );
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (added.length > 0) {
    store.tags.push(...added);
    saveTagStore(store, storePath);
  }

  console.error(
    `✅ Tagged ${added.length} ${added.length === 1 ? 'activity' : 'activities'} as "${label}" ` +
      `(${formatDuration(addedSeconds)})` +
      (alreadyTagged > 0 ? `, ${alreadyTagged} already tagged` : '') +
      `. → ${storePath}`
  );
  console.log(JSON.stringify(result, null, 2));
  return result;
}
