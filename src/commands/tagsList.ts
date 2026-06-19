import { loadTagStore, summarizeByLabel } from '../tagStore';
import { formatDuration } from './billingShared';

/**
 * `tags` — list all billing labels with activity counts and total time.
 * A quick overview of what's been tagged, and a reminder that these are
 * billing overlays distinct from the app's categories.
 */
export function tagsListCommand(args: any) {
  try {
    runTagsList(args);
  } catch (e: any) {
    console.error(`❌ ${e?.message ?? e}`);
    process.exit(1);
  }
}

function runTagsList(args: any) {
  const { store, path: storePath } = loadTagStore(args['tags-file']);
  const summary = summarizeByLabel(store);

  const lines: string[] = [];
  lines.push(`🏷  Billing tags — ${store.tags.length} tagged activities · ${summary.length} labels`);
  lines.push(`   store: ${storePath}`);
  lines.push('');
  if (summary.length === 0) {
    lines.push('   (no billing tags yet — create one with `screentimer tag --label ...`)');
  } else {
    const width = Math.min(36, Math.max(...summary.map((s) => s.label.length)));
    for (const s of summary) {
      lines.push(
        `   ${s.label.padEnd(width)}  ${formatDuration(s.seconds).padStart(9)}  ` +
          `${String(s.activities).padStart(4)} activities`
      );
    }
  }
  console.error(lines.join('\n'));

  const payload = {
    store: storePath,
    total_tagged_activities: store.tags.length,
    labels: summary.map((s) => ({
      label: s.label,
      activities: s.activities,
      seconds: Math.round(s.seconds),
      human: formatDuration(s.seconds),
    })),
  };
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}
