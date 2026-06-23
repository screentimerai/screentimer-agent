import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveDbPath } from './config';

export interface OpenDbOptions {
  readonly?: boolean;
}

/**
 * Open the ScreenTimerAI database.
 *
 * Read commands use readonly=true (matches the app's SqliteActivityLogStore).
 * The `apply` write command opens read-write and sets a busy_timeout so it
 * coexists with the running app without immediately failing on lock
 * contention.
 */
export function openDb(options: OpenDbOptions = {}, explicitPath?: string): Database.Database {
  const dbPath = resolveDbPath(explicitPath);

  if (!existsSync(dbPath)) {
    // Was the path chosen by the user (flag/env) or did we fall back to the
    // default app-support location? The fix differs: a user-supplied path that's
    // missing is a typo; a missing default almost always means the app isn't
    // installed (or hasn't run yet to create its DB).
    const userSuppliedPath = Boolean(explicitPath || process.env.INDISTRACTABLE_DB_PATH);

    if (userSuppliedPath) {
      console.error(`❌ ScreenTimerAI database not found at: ${dbPath}`);
      console.error('   Check the path you passed via --db / INDISTRACTABLE_DB_PATH.');
    } else if (!existsSync(dirname(dbPath))) {
      console.error("❌ ScreenTimerAI doesn't appear to be installed.");
      console.error(`   No app data found at: ${dirname(dbPath)}`);
      console.error('   Install it from https://screentimerai.com and run it once to');
      console.error('   start logging activity, or point at an existing database with');
      console.error('   --db <path> or INDISTRACTABLE_DB_PATH.');
    } else {
      // App dir exists but no DB yet — installed but never logged anything.
      console.error(`❌ ScreenTimerAI database not found at: ${dbPath}`);
      console.error('   The app looks installed but has no database yet — open');
      console.error('   ScreenTimerAI and let it track some activity, then retry.');
      console.error('   Or point at another database with --db / INDISTRACTABLE_DB_PATH.');
    }
    process.exit(1);
  }

  const db = new Database(dbPath, {
    readonly: options.readonly ?? true,
    fileMustExist: true,
  });

  // Give write operations room to wait on the app's write lock.
  if (!options.readonly) {
    db.pragma('busy_timeout = 5000');
  }

  return db;
}

export interface CategoryRow {
  id: number;
  category: string;
  description: string;
  color: string;
  group_id: number | null;
  group_name: string | null;
  group_color: string | null;
  group_is_disruptor: number | null;
  is_active: number;
}

const CATEGORY_SELECT = `SELECT c.id, c.category, c.description, c.color, c.group_id,
       g.name AS group_name, g.color AS group_color, g.is_disruptor AS group_is_disruptor,
       c.is_active
FROM user_categories c
LEFT JOIN user_category_groups g ON c.group_id = g.id`;

export function listCategories(db: Database.Database, includeInactive = false): CategoryRow[] {
  const where = includeInactive ? '' : 'WHERE c.is_active = 1';
  return db.prepare(`${CATEGORY_SELECT} ${where} ORDER BY c.created_at ASC`).all() as CategoryRow[];
}

export interface UncategorizedActivityRow {
  id: number;
  app_name: string;
  bundle_id: string | null;
  window_title: string | null;
  url: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_seconds: number | null;
  similar_count?: number;
}

const UNCAT_SELECT = `SELECT id, app_name, bundle_id, window_title, url, start_time, end_time,
       (julianday(COALESCE(end_time, start_time)) - julianday(start_time)) * 86400 AS duration_seconds
FROM activity_logs
WHERE category_id IS NULL`;

export function getUncategorizedActivities(
  db: Database.Database,
  limit: number,
  start?: string,
  end?: string
): UncategorizedActivityRow[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (start) {
    conditions.push('start_time >= ?');
    params.push(start);
  }
  if (end) {
    conditions.push('start_time <= ?');
    params.push(end);
  }

  const where =
    conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
  params.push(limit);

  return db
    .prepare(`${UNCAT_SELECT}${where} ORDER BY start_time DESC LIMIT ?`)
    .all(...params) as UncategorizedActivityRow[];
}

export function getUniqueUncategorizedActivities(
  db: Database.Database,
  limit: number,
  start?: string,
  end?: string
): UncategorizedActivityRow[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (start) {
    conditions.push('start_time >= ?');
    params.push(start);
  }
  if (end) {
    conditions.push('start_time <= ?');
    params.push(end);
  }

  const where =
    conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
  params.push(limit);

  return db
    .prepare(
      `WITH base AS (
         SELECT id, app_name, bundle_id, window_title, url, start_time, end_time,
                (julianday(COALESCE(end_time, start_time)) - julianday(start_time)) * 86400 AS duration_seconds,
                CASE
                  WHEN url IS NOT NULL AND url != '' THEN 'url:' || url
                  WHEN bundle_id IS NOT NULL AND bundle_id != ''
                    AND window_title IS NOT NULL AND window_title != ''
                    THEN 'window:' || bundle_id || char(31) || window_title
                  ELSE 'activity:' || id
                END AS similarity_key
         FROM activity_logs
         WHERE category_id IS NULL${where}
       ),
       ranked AS (
         SELECT id, app_name, bundle_id, window_title, url, start_time, end_time,
                duration_seconds,
                COUNT(*) OVER (PARTITION BY similarity_key) AS similar_count,
                ROW_NUMBER() OVER (
                  PARTITION BY similarity_key
                  ORDER BY start_time DESC, id DESC
                ) AS rn
         FROM base
       )
       SELECT id, app_name, bundle_id, window_title, url, start_time, end_time,
              duration_seconds, similar_count
       FROM ranked
       WHERE rn = 1
       ORDER BY start_time DESC, id DESC
       LIMIT ?`
    )
    .all(...params) as UncategorizedActivityRow[];
}

export interface Counts {
  total: number;
  uncategorized: number;
  categories: number;
  groups: number;
  most_recent_activity: string | null;
  oldest_activity: string | null;
}

export function getCounts(db: Database.Database): Counts {
  const total = (
    db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get() as { n: number }
  ).n;
  const uncategorized = (
    db
      .prepare('SELECT COUNT(*) AS n FROM activity_logs WHERE category_id IS NULL')
      .get() as { n: number }
  ).n;
  const categories = (
    db
      .prepare('SELECT COUNT(*) AS n FROM user_categories WHERE is_active = 1')
      .get() as { n: number }
  ).n;
  const groups = (
    db.prepare('SELECT COUNT(*) AS n FROM user_category_groups').get() as { n: number }
  ).n;
  const recent = db
    .prepare('SELECT start_time AS t FROM activity_logs ORDER BY start_time DESC LIMIT 1')
    .get() as { t: string | null };
  const oldest = db
    .prepare('SELECT start_time AS t FROM activity_logs ORDER BY start_time ASC LIMIT 1')
    .get() as { t: string | null };

  return {
    total,
    uncategorized,
    categories,
    groups,
    most_recent_activity: recent?.t ?? null,
    oldest_activity: oldest?.t ?? null,
  };
}

export interface TimeBucketRow {
  key: string;
  label: string;
  color: string | null;
  is_disruptor: number | null;
  seconds: number;
  activities: number;
}

export type TimeDimension = 'category' | 'group' | 'app';

/**
 * Aggregate total tracked time within an optional [start, end] window, grouped
 * by category, category group, or app. Uncategorized activities collapse into a
 * single "Uncategorized" bucket for the category/group dimensions.
 */
export function getTimeBreakdown(
  db: Database.Database,
  by: TimeDimension,
  start?: string,
  end?: string
): TimeBucketRow[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (start) {
    conditions.push('a.start_time >= ?');
    params.push(start);
  }
  if (end) {
    conditions.push('a.start_time <= ?');
    params.push(end);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const dur = `(julianday(COALESCE(a.end_time, a.start_time)) - julianday(a.start_time)) * 86400`;

  let select: string;
  if (by === 'app') {
    select = `SELECT a.app_name AS key,
                     COALESCE(NULLIF(a.app_name, ''), 'Unknown app') AS label,
                     NULL AS color, NULL AS is_disruptor,
                     SUM(${dur}) AS seconds, COUNT(*) AS activities
              FROM activity_logs a ${where}
              GROUP BY a.app_name`;
  } else if (by === 'group') {
    select = `SELECT CAST(COALESCE(g.id, -1) AS TEXT) AS key,
                     COALESCE(g.name, 'Uncategorized') AS label,
                     g.color AS color, g.is_disruptor AS is_disruptor,
                     SUM(${dur}) AS seconds, COUNT(*) AS activities
              FROM activity_logs a
              LEFT JOIN user_categories c ON a.category_id = c.id
              LEFT JOIN user_category_groups g ON c.group_id = g.id
              ${where}
              GROUP BY COALESCE(g.id, -1)`;
  } else {
    select = `SELECT CAST(COALESCE(c.id, -1) AS TEXT) AS key,
                     COALESCE(c.category, 'Uncategorized') AS label,
                     COALESCE(c.color, g.color) AS color, g.is_disruptor AS is_disruptor,
                     SUM(${dur}) AS seconds, COUNT(*) AS activities
              FROM activity_logs a
              LEFT JOIN user_categories c ON a.category_id = c.id
              LEFT JOIN user_category_groups g ON c.group_id = g.id
              ${where}
              GROUP BY COALESCE(c.id, -1)`;
  }

  return db
    .prepare(`${select} HAVING seconds > 0 ORDER BY seconds DESC`)
    .all(...params) as TimeBucketRow[];
}

export interface WindowActivityRow {
  id: number;
  app_name: string | null;
  bundle_id: string | null;
  window_title: string | null;
  url: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_seconds: number;
}

export interface WindowFilters {
  app?: string;
  urlContains?: string;
  titleContains?: string;
}

/**
 * Fetch activities whose start_time falls in [start, end], optionally filtered
 * by app name (exact, case-insensitive) and url/title substrings. Used by the
 * billing `tag` command to select which activities to label. Read-only.
 */
export function getActivitiesInWindow(
  db: Database.Database,
  start: string | undefined,
  end: string | undefined,
  filters: WindowFilters = {}
): WindowActivityRow[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (start) {
    conditions.push('start_time >= ?');
    params.push(start);
  }
  if (end) {
    conditions.push('start_time <= ?');
    params.push(end);
  }
  if (filters.app) {
    conditions.push('LOWER(COALESCE(app_name, \'\')) = LOWER(?)');
    params.push(filters.app);
  }
  if (filters.urlContains) {
    conditions.push('url IS NOT NULL AND LOWER(url) LIKE LOWER(?)');
    params.push(`%${filters.urlContains}%`);
  }
  if (filters.titleContains) {
    conditions.push('window_title IS NOT NULL AND LOWER(window_title) LIKE LOWER(?)');
    params.push(`%${filters.titleContains}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db
    .prepare(
      `SELECT id, app_name, bundle_id, window_title, url, start_time, end_time,
              (julianday(COALESCE(end_time, start_time)) - julianday(start_time)) * 86400 AS duration_seconds
       FROM activity_logs
       ${where}
       ORDER BY start_time ASC, id ASC`
    )
    .all(...params) as WindowActivityRow[];
}

export interface TimelineActivityRow {
  id: number;
  app_name: string | null;
  bundle_id: string | null;
  window_title: string | null;
  url: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_seconds: number;
  category: string | null;
  group_name: string | null;
  color: string | null;
  is_disruptor: number | null;
}

/**
 * Fetch activities in an optional [start, end] window in CHRONOLOGICAL order,
 * with their category + group joined. Unlike getTimeBreakdown (which aggregates)
 * this returns the raw per-activity sequence so a caller can reconstruct what
 * was on screen minute-by-minute and cross-reference against external time
 * ranges (e.g. agent session windows). Read-only.
 */
export function getTimelineActivities(
  db: Database.Database,
  start?: string,
  end?: string,
  appFilter?: string
): TimelineActivityRow[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (start) {
    conditions.push('a.start_time >= ?');
    params.push(start);
  }
  if (end) {
    conditions.push('a.start_time <= ?');
    params.push(end);
  }
  if (appFilter) {
    conditions.push("LOWER(COALESCE(a.app_name, '')) = LOWER(?)");
    params.push(appFilter);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const dur = `(julianday(COALESCE(a.end_time, a.start_time)) - julianday(a.start_time)) * 86400`;

  return db
    .prepare(
      `SELECT a.id, a.app_name, a.bundle_id, a.window_title, a.url,
              a.start_time, a.end_time, ${dur} AS duration_seconds,
              c.category AS category,
              g.name AS group_name,
              COALESCE(c.color, g.color) AS color,
              g.is_disruptor AS is_disruptor
       FROM activity_logs a
       LEFT JOIN user_categories c ON a.category_id = c.id
       LEFT JOIN user_category_groups g ON c.group_id = g.id
       ${where}
       ORDER BY a.start_time ASC, a.id ASC`
    )
    .all(...params) as TimelineActivityRow[];
}

export interface SourceRow {
  id: number;
  url: string | null;
  bundle_id: string | null;
  window_title: string | null;
}

export function getActivitySource(db: Database.Database, activityId: number): SourceRow | undefined {
  return db
    .prepare('SELECT id, url, bundle_id, window_title FROM activity_logs WHERE id = ?')
    .get(activityId) as SourceRow | undefined;
}

export function categoryExists(db: Database.Database, categoryId: number): boolean {
  const row = db
    .prepare('SELECT 1 FROM user_categories WHERE id = ?')
    .get(categoryId);
  return row !== undefined;
}

export function activityExists(db: Database.Database, activityId: number): boolean {
  const row = db
    .prepare('SELECT 1 FROM activity_logs WHERE id = ?')
    .get(activityId);
  return row !== undefined;
}
