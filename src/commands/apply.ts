import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  openDb,
  categoryExists,
  activityExists,
  SourceRow,
} from '../db';

interface Assignment {
  activity_id: number;
  category_id: number;
}

interface ApplyInput {
  assignments?: Assignment[];
  propagate_to_similar?: boolean;
}

interface InvalidAssignment {
  activity_id: number;
  category_id: number;
  reason: string;
}

interface ApplyResult {
  updated_count: number;
  skipped_count: number;
  invalid_assignments: InvalidAssignment[];
  propagated_count: number;
  dry_run: boolean;
}

function readInput(args: any): ApplyInput {
  let raw: string;

  if (args.in) {
    raw = readFileSync(args.in, 'utf-8');
  } else {
    // Read from stdin (fd 0). When piped, readFileSync blocks until EOF.
    // When stdin is a TTY (no piped input), it throws EAGAIN/EIO — surface
    // a helpful message.
    try {
      raw = readFileSync(0, 'utf-8');
    } catch {
      throw new Error('No input: pipe assignments JSON to stdin or use --in <file>.');
    }
  }

  if (!raw.trim()) {
    throw new Error('Input is empty. Pipe assignments JSON to stdin or use --in <file>.');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`Failed to parse JSON input: ${e.message}`);
  }

  // Accept either { assignments: [...] } or a bare [...] array.
  if (Array.isArray(parsed)) {
    return { assignments: parsed, propagate_to_similar: true };
  }

  return {
    assignments: parsed.assignments,
    propagate_to_similar:
      parsed.propagate_to_similar === undefined ? true : parsed.propagate_to_similar,
  };
}

function isNumber(v: any): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function applyCommand(args: any) {
  try {
    runApply(args);
  } catch (e: any) {
    // Surface the real error instead of letting yargs mangle it.
    console.error(`❌ ${e?.message ?? e}`);
    process.exit(1);
  }
}

function runApply(args: any) {
  const dryRun = Boolean(args.dryRun);
  const overwrite = Boolean(args.overwrite);

  let input: ApplyInput;
  try {
    input = readInput(args);
  } catch (e: any) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  const assignments = input.assignments;
  if (!Array.isArray(assignments) || assignments.length === 0) {
    console.error('❌ No assignments provided. Expected { "assignments": [ { "activity_id": n, "category_id": m } ] }.');
    process.exit(1);
  }

  const propagate =
    args.propagate === undefined
      ? input.propagate_to_similar !== false
      : args.propagate !== false;

  const db = openDb({ readonly: false }, args.db);

  try {
    const result: ApplyResult = {
      updated_count: 0,
      skipped_count: 0,
      invalid_assignments: [],
      propagated_count: 0,
      dry_run: dryRun,
    };

    // Pre-validate and dedupe assignments so a single bad entry doesn't abort
    // the whole batch. Keep the first assignment per activity_id.
    const seenActivities = new Set<number>();
    const valid: Assignment[] = [];

    for (const a of assignments) {
      if (!a || !isNumber(a.activity_id) || !isNumber(a.category_id)) {
        result.invalid_assignments.push({
          activity_id: a?.activity_id,
          category_id: a?.category_id,
          reason: 'activity_id and category_id must be numbers',
        });
        continue;
      }
      if (seenActivities.has(a.activity_id)) {
        result.skipped_count += 1;
        continue;
      }
      seenActivities.add(a.activity_id);

      if (!categoryExists(db, a.category_id)) {
        result.invalid_assignments.push({
          activity_id: a.activity_id,
          category_id: a.category_id,
          reason: 'category_id does not exist in user_categories',
        });
        continue;
      }
      if (!activityExists(db, a.activity_id)) {
        result.invalid_assignments.push({
          activity_id: a.activity_id,
          category_id: a.category_id,
          reason: 'activity_id does not exist in activity_logs',
        });
        continue;
      }
      valid.push(a);
    }

    if (valid.length === 0) {
      console.error(`⚠️  No valid assignments to apply. ${result.invalid_assignments.length} invalid, ${result.skipped_count} skipped.`);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    // Prepared once and reused across every assignment (and shared with the
    // dry-run preview below) so the same SQL is not re-compiled per iteration.
    const sourceStmt = db.prepare(
      'SELECT id, url, bundle_id, window_title FROM activity_logs WHERE id = ?'
    );

    const doWrite = db.transaction(() => {
      const updateStmt = db.prepare(
        overwrite
          ? 'UPDATE activity_logs SET category_id = ? WHERE id = ?'
          : 'UPDATE activity_logs SET category_id = ? WHERE id = ? AND category_id IS NULL'
      );
      // Propagation statements, prepared once outside the per-assignment loop.
      const propUrlStmt = db.prepare(
        `UPDATE activity_logs SET category_id = ?
         WHERE category_id IS NULL AND url IS NOT NULL AND url = ?`
      );
      const propAppTitleStmt = db.prepare(
        `UPDATE activity_logs SET category_id = ?
         WHERE category_id IS NULL
           AND bundle_id IS NOT NULL AND window_title IS NOT NULL
           AND bundle_id = ? AND window_title = ?`
      );

      for (const a of valid) {
        const info = updateStmt.run(a.category_id, a.activity_id);
        if (info.changes > 0) {
          result.updated_count += 1;

          if (propagate && !dryRun) {
            const source = sourceStmt.get(a.activity_id) as SourceRow | undefined;
            if (source) {
              result.propagated_count += propagateToSimilar(
                propUrlStmt,
                propAppTitleStmt,
                a.category_id,
                source
              );
            }
          }
        } else {
          result.skipped_count += 1;
        }
      }
    });

    if (dryRun) {
      // Report what *would* be written without mutating. An activity is
      // writable if it is uncategorized (or overwrite is on). We also
      // simulate propagation so the preview reflects the real fan-out:
      // each representative would categorize its similar uncategorized rows
      // (excluding itself, deduped so shared keys are not double-counted).
      const checkStmt = db.prepare(
        overwrite
          ? 'SELECT 1 FROM activity_logs WHERE id = ?'
          : 'SELECT 1 FROM activity_logs WHERE id = ? AND category_id IS NULL'
      );
      const countUrlStmt = db.prepare(
        `SELECT COUNT(*) AS n FROM activity_logs
         WHERE category_id IS NULL AND url IS NOT NULL AND url = ? AND id != ?`
      );
      const countAppTitleStmt = db.prepare(
        `SELECT COUNT(*) AS n FROM activity_logs
         WHERE category_id IS NULL
           AND bundle_id IS NOT NULL AND window_title IS NOT NULL
           AND bundle_id = ? AND window_title = ? AND id != ?`
      );
      const seenKeys = new Set<string>();
      for (const a of valid) {
        if (checkStmt.get(a.activity_id)) {
          result.updated_count += 1;

          if (propagate) {
            const source = sourceStmt.get(a.activity_id) as SourceRow | undefined;
            if (source) {
              let key: string | null = null;
              if (source.url) {
                key = `u|${source.url}`;
              } else if (source.bundle_id && source.window_title) {
                key = `b|${source.bundle_id}|${source.window_title}`;
              }
              if (key && !seenKeys.has(key)) {
                seenKeys.add(key);
                const row = source.url
                  ? (countUrlStmt.get(source.url, source.id) as { n: number })
                  : (countAppTitleStmt.get(
                      source.bundle_id,
                      source.window_title,
                      source.id
                    ) as { n: number });
                result.propagated_count += row.n;
              }
            }
          }
        } else {
          result.skipped_count += 1;
        }
      }
      console.error(
        `🧪 Dry run — no changes written. Would update ${result.updated_count}` +
          (result.propagated_count > 0
            ? `, propagate to ~${result.propagated_count} similar`
            : '') +
          `, skip ${result.skipped_count}.`
      );
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    doWrite();

    const verb = result.updated_count === 1 ? 'activity' : 'activities';
    console.error(
      `✅ Updated ${result.updated_count} ${verb}` +
        (result.propagated_count > 0 ? `, propagated to ${result.propagated_count} similar` : '') +
        (result.skipped_count > 0 ? `, skipped ${result.skipped_count}` : '') +
        (result.invalid_assignments.length > 0 ? `, ${result.invalid_assignments.length} invalid` : '') +
        '.'
    );
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    db.close();
  }
}

/**
 * Propagate a category to uncategorized similar activities.
 * Mirrors the app's applyCategoryToSimilarLogs rules:
 *   - same url, OR
 *   - same bundle_id AND same window_title
 * Never overwrites already-categorized rows (WHERE category_id IS NULL).
 * Returns the number of additional rows updated.
 */
function propagateToSimilar(
  propUrlStmt: Database.Statement,
  propAppTitleStmt: Database.Statement,
  categoryId: number,
  source: SourceRow
): number {
  if (source.url) {
    return Number(propUrlStmt.run(categoryId, source.url).changes);
  }

  if (source.bundle_id && source.window_title) {
    return Number(
      propAppTitleStmt.run(categoryId, source.bundle_id, source.window_title).changes
    );
  }

  return 0;
}
