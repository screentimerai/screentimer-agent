import { openDb, getCounts } from '../db';
import { resolveDbPath } from '../config';

export function dbStatusCommand(args: any) {
  const dbPath = resolveDbPath(args.db);
  const db = openDb({ readonly: true }, args.db);
  try {
    const counts = getCounts(db);
    const pct =
      counts.total > 0
        ? ((counts.uncategorized / counts.total) * 100).toFixed(1)
        : '0.0';

    console.error(`📊 ScreenTimerAI database status`);
    console.error(`   path:           ${dbPath}`);
    console.error(`   total activities:     ${counts.total}`);
    console.error(`   uncategorized:        ${counts.uncategorized} (${pct}%)`);
    console.error(`   active categories:    ${counts.categories}`);
    console.error(`   category groups:      ${counts.groups}`);
    if (counts.oldest_activity) console.error(`   oldest activity:      ${counts.oldest_activity}`);
    if (counts.most_recent_activity) console.error(`   most recent activity: ${counts.most_recent_activity}`);

    console.log(JSON.stringify({ db_path: dbPath, ...counts }, null, 2));
    return { db_path: dbPath, ...counts };
  } finally {
    db.close();
  }
}
