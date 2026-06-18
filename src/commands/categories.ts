import { openDb, listCategories, CategoryRow } from '../db';

function formatCategory(row: CategoryRow) {
  const group = row.group_name
    ? `${row.group_name}${row.group_is_disruptor ? ' (disruptor)' : ''}`
    : '—';
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
    _group_display: group,
  };
}

export function listCategoriesCommand(args: any) {
  const db = openDb({ readonly: true }, args.db);
  try {
    const rows = listCategories(db, args.includeInactive);
    const categories = rows.map(formatCategory);

    console.error(`📋 ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`);
    console.log(JSON.stringify({ categories }, null, 2));
    return { categories };
  } finally {
    db.close();
  }
}
