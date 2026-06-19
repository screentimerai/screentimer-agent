import { writeFileSync } from 'node:fs';
import {
  openDb,
  listCategories,
  getUncategorizedActivities,
  getUniqueUncategorizedActivities,
  CategoryRow,
} from '../db';
import { resolveDbPath } from '../config';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function clampLimit(raw: any): number {
  const n = Number(raw ?? DEFAULT_LIMIT);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function formatCategory(row: CategoryRow) {
  return {
    id: row.id,
    category: row.category,
    description: row.description,
    color: row.color,
    group_id: row.group_id,
    group_name: row.group_name,
    group_color: row.group_color,
    group_is_disruptor:
      row.group_is_disruptor === null ? null : Boolean(row.group_is_disruptor),
    is_active: Boolean(row.is_active),
  };
}

export function exportCommand(args: any) {
  const dbPath = resolveDbPath(args.db);
  const db = openDb({ readonly: true }, args.db);
  try {
    const limit = clampLimit(args.limit);
    const categories = listCategories(db, false).map(formatCategory);
    const activityRows = args.unique
      ? getUniqueUncategorizedActivities(db, limit, args.start, args.end)
      : getUncategorizedActivities(db, limit, args.start, args.end);
    const activities = activityRows.map((r) => ({
      ...r,
      duration_seconds:
        r.duration_seconds === null ? null : Math.round(r.duration_seconds),
    }));

    const payload = {
      generated_at: new Date().toISOString(),
      db_path: dbPath,
      categories,
      activities,
      instructions:
        `Assign each activity${args.unique ? ' representative' : ''} a category_id chosen from \`categories\`. ` +
        'Respect group semantics: group_is_disruptor=true categories are distractions. ' +
        'Return JSON of shape {"assignments":[{"activity_id":<id>,"category_id":<id>}]} ' +
        'and pipe it to `screentimer apply`. ' +
        (args.unique
          ? 'Each activity includes similar_count and represents matching uncategorized rows that apply will update by default. '
          : '') +
        'Only assign categories you are confident about; leave uncertain activities unassigned.',
    };

    const json = JSON.stringify(payload, null, 2);

    if (args.out) {
      writeFileSync(args.out, json, 'utf-8');
      console.error(`📦 Exported ${activities.length} ${args.unique ? 'unique ' : ''}activities + ${categories.length} categories to ${args.out}`);
    } else {
      console.error(`📦 ${activities.length} ${args.unique ? 'unique ' : ''}activities, ${categories.length} categories`);
      console.log(json);
    }

    return payload;
  } finally {
    db.close();
  }
}
