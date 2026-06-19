import {
  openDb,
  getUncategorizedActivities,
  getUniqueUncategorizedActivities,
} from '../db';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function clampLimit(raw: any): number {
  const n = Number(raw ?? DEFAULT_LIMIT);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export function uncategorizedCommand(args: any) {
  const db = openDb({ readonly: true }, args.db);
  try {
    const limit = clampLimit(args.limit);
    const rows = args.unique
      ? getUniqueUncategorizedActivities(db, limit, args.start, args.end)
      : getUncategorizedActivities(db, limit, args.start, args.end);
    const activities = rows.map((r) => ({
      ...r,
      duration_seconds:
        r.duration_seconds === null ? null : Math.round(r.duration_seconds),
    }));

    console.error(`🔍 ${activities.length} ${args.unique ? 'unique ' : ''}uncategorized activit${activities.length === 1 ? 'y' : 'ies'} (limit ${limit})`);
    console.log(JSON.stringify({ activities }, null, 2));
    return { activities };
  } finally {
    db.close();
  }
}
