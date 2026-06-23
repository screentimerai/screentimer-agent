import { openDb, getTimelineActivities, TimelineActivityRow } from '../db';

// Resolve [start, end] ISO strings from the time-window flags. Defaults to today.
// (Same semantics as the `time` command.)
function resolveWindow(args: any): { start?: string; end?: string; label: string } {
  if (args.start || args.end) {
    const label =
      args.start && args.end
        ? `${args.start} → ${args.end}`
        : args.start
          ? `since ${args.start}`
          : `until ${args.end}`;
    return { start: args.start, end: args.end, label };
  }

  const days = typeof args.days === 'number' && args.days > 0 ? Math.floor(args.days) : 1;
  const now = new Date();
  const startDate = new Date(now);
  if (days === 1) {
    startDate.setHours(0, 0, 0, 0);
    return { start: startDate.toISOString(), label: 'today' };
  }
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);
  return { start: startDate.toISOString(), label: `last ${days} days` };
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

// HH:MM in local time from an ISO/SQLite timestamp; '??:??' if unparseable.
function clock(ts: string | null): string {
  if (!ts) return '??:??';
  const d = new Date(ts.includes('T') || ts.includes('Z') ? ts : ts.replace(' ', 'T'));
  if (isNaN(d.getTime())) return '??:??';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function colorize(hex: string | null, text: string, useColor: boolean): string {
  if (!useColor || !hex) return text;
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return text;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

const BOLD = (t: string, on: boolean) => (on ? `\x1b[1m${t}\x1b[0m` : t);
const DIM = (t: string, on: boolean) => (on ? `\x1b[2m${t}\x1b[0m` : t);

interface Block {
  start_time: string | null;
  end_time: string | null;
  seconds: number;
  app: string;
  category: string;
  group: string | null;
  color: string | null;
  is_disruptor: boolean | null;
  window_title: string | null;
  url: string | null;
  segments: number;
}

function msBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const da = new Date(a.includes('T') ? a : a.replace(' ', 'T')).getTime();
  const dbt = new Date(b.includes('T') ? b : b.replace(' ', 'T')).getTime();
  if (isNaN(da) || isNaN(dbt)) return null;
  return dbt - da;
}

// Collapse the raw per-activity rows into focus blocks: consecutive activities
// sharing the same app + category, separated by a gap no larger than
// mergeGapSeconds, fold into a single block (durations summed).
function toBlocks(rows: TimelineActivityRow[], mergeGapSeconds: number): Block[] {
  const blocks: Block[] = [];
  for (const r of rows) {
    const app = r.app_name || 'Unknown app';
    const category = r.category || 'Uncategorized';
    const prev = blocks[blocks.length - 1];
    const gapMs = prev ? msBetween(prev.end_time, r.start_time) : null;
    const contiguous =
      prev &&
      prev.app === app &&
      prev.category === category &&
      gapMs !== null &&
      gapMs <= mergeGapSeconds * 1000;

    if (contiguous) {
      prev.end_time = r.end_time ?? prev.end_time;
      prev.seconds += r.duration_seconds;
      prev.segments += 1;
      // keep the longest-looking title as representative
      if ((r.window_title?.length ?? 0) > (prev.window_title?.length ?? 0)) {
        prev.window_title = r.window_title;
        prev.url = r.url;
      }
    } else {
      blocks.push({
        start_time: r.start_time,
        end_time: r.end_time,
        seconds: r.duration_seconds,
        app,
        category,
        group: r.group_name,
        color: r.color,
        is_disruptor: r.is_disruptor === null ? null : Boolean(r.is_disruptor),
        window_title: r.window_title,
        url: r.url,
        segments: 1,
      });
    }
  }
  return blocks;
}

function render(blocks: Block[], windowLabel: string, useColor: boolean): string {
  const lines: string[] = [];
  const totalSeconds = blocks.reduce((a, b) => a + b.seconds, 0);
  lines.push(BOLD(`🕐 Timeline — ${windowLabel}`, useColor));
  lines.push(DIM(`total: ${formatDuration(totalSeconds)}  ·  ${blocks.length} blocks`, useColor));
  lines.push('');
  if (blocks.length === 0) {
    lines.push(DIM('  (no tracked activity in this window)', useColor));
    return lines.join('\n');
  }

  const appW = Math.min(16, Math.max(...blocks.map((b) => b.app.length)));
  for (const b of blocks) {
    const span = `${clock(b.start_time)}–${clock(b.end_time)}`;
    const appRaw = b.app.length > appW ? b.app.slice(0, appW - 1) + '…' : b.app;
    const app = appRaw.padEnd(appW);
    const disruptor = b.is_disruptor ? ' ⚠' : '';
    const title = b.window_title ? DIM(` — ${b.window_title.slice(0, 40)}`, useColor) : '';
    lines.push(
      `  ${DIM(span, useColor)}  ${colorize(b.color, app, useColor)}  ` +
        `${colorize(b.color, b.category, useColor)}${disruptor}  ${DIM(formatDuration(b.seconds), useColor)}${title}`
    );
  }
  return lines.join('\n');
}

export function timelineCommand(args: any) {
  const { start, end, label } = resolveWindow(args);
  const mergeGap =
    typeof args['merge-gap'] === 'number' && args['merge-gap'] >= 0 ? args['merge-gap'] : 300;
  const minSeconds = typeof args['min-seconds'] === 'number' && args['min-seconds'] > 0 ? args['min-seconds'] : 0;
  const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 0;

  const db = openDb({ readonly: true }, args.db);
  try {
    const rows = getTimelineActivities(db, start, end, args.app);
    let blocks = args.raw
      ? rows.map<Block>((r) => ({
          start_time: r.start_time,
          end_time: r.end_time,
          seconds: r.duration_seconds,
          app: r.app_name || 'Unknown app',
          category: r.category || 'Uncategorized',
          group: r.group_name,
          color: r.color,
          is_disruptor: r.is_disruptor === null ? null : Boolean(r.is_disruptor),
          window_title: r.window_title,
          url: r.url,
          segments: 1,
        }))
      : toBlocks(rows, mergeGap);

    if (minSeconds > 0) blocks = blocks.filter((b) => b.seconds >= minSeconds);
    if (limit > 0 && blocks.length > limit) blocks = blocks.slice(0, limit);

    const useColor = Boolean(process.stderr.isTTY) && !args['no-color'];
    console.error(render(blocks, label, useColor));

    const totalSeconds = blocks.reduce((a, b) => a + b.seconds, 0);
    const payload = {
      window: { start: start ?? null, end: end ?? null, label },
      merged: !args.raw,
      merge_gap_seconds: args.raw ? null : mergeGap,
      total_seconds: Math.round(totalSeconds),
      total_human: formatDuration(totalSeconds),
      blocks: blocks.map((b) => ({
        start_time: b.start_time,
        end_time: b.end_time,
        seconds: Math.round(b.seconds),
        human: formatDuration(b.seconds),
        app: b.app,
        category: b.category,
        group: b.group,
        is_disruptor: b.is_disruptor,
        window_title: b.window_title,
        url: b.url,
        segments: b.segments,
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  } finally {
    db.close();
  }
}
