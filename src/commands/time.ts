import { openDb, getTimeBreakdown, TimeBucketRow, TimeDimension } from '../db';

// Resolve [start, end] ISO strings from the time-window flags. Defaults to today.
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
    // "today" = since local midnight
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

// #rrggbb (or #rgb) -> ANSI truecolor foreground; null when not a TTY/no color.
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

function renderChart(rows: TimeBucketRow[], windowLabel: string, useColor: boolean): string {
  const lines: string[] = [];
  const totalSeconds = rows.reduce((acc, r) => acc + r.seconds, 0);

  lines.push(BOLD(`⏱  Screen time — ${windowLabel}`, useColor));
  lines.push(DIM(`total: ${formatDuration(totalSeconds)}  ·  ${rows.length} buckets`, useColor));
  lines.push('');

  if (rows.length === 0) {
    lines.push(DIM('  (no tracked activity in this window)', useColor));
    return lines.join('\n');
  }

  const max = rows[0].seconds || 1;
  const labelWidth = Math.min(
    22,
    Math.max(...rows.map((r) => r.label.length))
  );
  const barWidth = 28;

  for (const r of rows) {
    const filled = Math.max(1, Math.round((r.seconds / max) * barWidth));
    const pct = totalSeconds > 0 ? ((r.seconds / totalSeconds) * 100).toFixed(0) : '0';
    const rawLabel = r.label.length > labelWidth ? r.label.slice(0, labelWidth - 1) + '…' : r.label;
    const label = rawLabel.padEnd(labelWidth);
    const disruptor = r.is_disruptor ? ' ⚠' : '';
    lines.push(
      `  ${colorize(r.color, label, useColor)} ${colorize(r.color, '█'.repeat(filled), useColor)}${DIM('·'.repeat(barWidth - filled), useColor)} ` +
        `${formatDuration(r.seconds).padStart(8)} ${DIM(`${pct.padStart(3)}%`, useColor)}${disruptor}`
    );
  }

  return lines.join('\n');
}

export function timeCommand(args: any) {
  const by: TimeDimension =
    args.by === 'group' || args.by === 'app' ? args.by : 'category';
  const { start, end, label } = resolveWindow(args);

  const db = openDb({ readonly: true }, args.db);
  try {
    let rows = getTimeBreakdown(db, by, start, end);
    const topN = typeof args.top === 'number' && args.top > 0 ? Math.floor(args.top) : 0;
    if (topN > 0 && rows.length > topN) {
      const head = rows.slice(0, topN);
      const restSeconds = rows.slice(topN).reduce((a, r) => a + r.seconds, 0);
      const restActivities = rows.slice(topN).reduce((a, r) => a + r.activities, 0);
      head.push({
        key: '__other__',
        label: `Other (${rows.length - topN})`,
        color: null,
        is_disruptor: 0,
        seconds: restSeconds,
        activities: restActivities,
      });
      rows = head;
    }

    const useColor = Boolean(process.stderr.isTTY) && !args['no-color'];
    console.error(renderChart(rows, `${label} · by ${by}`, useColor));

    const totalSeconds = rows.reduce((acc, r) => acc + r.seconds, 0);
    const payload = {
      window: { start: start ?? null, end: end ?? null, label },
      by,
      total_seconds: Math.round(totalSeconds),
      total_human: formatDuration(totalSeconds),
      buckets: rows.map((r) => ({
        key: r.key,
        label: r.label,
        color: r.color,
        is_disruptor: r.is_disruptor === null ? null : Boolean(r.is_disruptor),
        seconds: Math.round(r.seconds),
        human: formatDuration(r.seconds),
        activities: r.activities,
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  } finally {
    db.close();
  }
}
