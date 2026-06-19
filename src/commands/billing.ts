import { loadTagStore, TagEntry } from '../tagStore';
import { formatDuration, billableHours } from './billingShared';

/**
 * `billing` — produce an invoice-ready breakdown for one billing label.
 *
 * Sums the snapshotted tracked time of every activity tagged with the label,
 * rounds to a billing increment, and (optionally) multiplies by an hourly
 * rate. Self-contained: reads only the CLI-owned JSON store, never the app DB.
 */
export function billingCommand(args: any) {
  try {
    runBilling(args);
  } catch (e: any) {
    console.error(`❌ ${e?.message ?? e}`);
    process.exit(1);
  }
}

function runBilling(args: any) {
  const label = typeof args.label === 'string' ? args.label.trim() : '';
  if (!label) {
    throw new Error('--label is required (use `screentimer tags` to see labels).');
  }

  const roundMinutes = typeof args.round === 'number' ? args.round : 0;
  const rate = typeof args.rate === 'number' ? args.rate : null;
  const currency = typeof args.currency === 'string' ? args.currency : 'EUR';

  const { store, path: storePath } = loadTagStore(args['tags-file']);
  const entries = store.tags
    .filter((t) => t.label === label)
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''));

  if (entries.length === 0) {
    throw new Error(`No activities tagged "${label}". Run \`screentimer tags\` to list labels.`);
  }

  const totalSeconds = entries.reduce((s, t) => s + t.duration_seconds, 0);
  const hours = billableHours(totalSeconds, roundMinutes);
  const amount = rate !== null ? Math.round(hours * rate * 100) / 100 : null;

  // Group line items by app so the invoice reads as work areas, not raw rows.
  const byApp = new Map<string, { app: string; seconds: number; activities: number }>();
  for (const t of entries) {
    const app = t.app_name || 'Unknown app';
    const g = byApp.get(app) ?? { app, seconds: 0, activities: 0 };
    g.seconds += t.duration_seconds;
    g.activities += 1;
    byApp.set(app, g);
  }
  const lineItems = [...byApp.values()].sort((a, b) => b.seconds - a.seconds);

  const dates = entries
    .map((t) => t.start_time)
    .filter((d): d is string => Boolean(d))
    .sort();
  const periodStart = dates[0] ?? null;
  const periodEnd = dates[dates.length - 1] ?? null;

  renderInvoice({
    label,
    entries,
    lineItems,
    totalSeconds,
    hours,
    rate,
    amount,
    currency,
    roundMinutes,
    periodStart,
    periodEnd,
  });

  const payload = {
    label,
    store: storePath,
    period: { start: periodStart, end: periodEnd },
    activities: entries.length,
    tracked_seconds: Math.round(totalSeconds),
    tracked_human: formatDuration(totalSeconds),
    rounding_minutes: roundMinutes || null,
    billable_hours: hours,
    rate,
    currency: rate !== null ? currency : null,
    amount,
    line_items: lineItems.map((g) => ({
      app: g.app,
      activities: g.activities,
      seconds: Math.round(g.seconds),
      human: formatDuration(g.seconds),
      hours: billableHours(g.seconds, roundMinutes),
    })),
  };
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

interface InvoiceView {
  label: string;
  entries: TagEntry[];
  lineItems: { app: string; seconds: number; activities: number }[];
  totalSeconds: number;
  hours: number;
  rate: number | null;
  amount: number | null;
  currency: string;
  roundMinutes: number;
  periodStart: string | null;
  periodEnd: string | null;
}

function renderInvoice(v: InvoiceView): void {
  const lines: string[] = [];
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');

  lines.push(`🧾 Billing — ${v.label}`);
  lines.push(`   period: ${day(v.periodStart)} → ${day(v.periodEnd)}  ·  ${v.entries.length} activities`);
  lines.push('');

  const width = Math.min(32, Math.max(8, ...v.lineItems.map((g) => g.app.length)));
  for (const g of v.lineItems) {
    lines.push(`   ${g.app.padEnd(width)}  ${formatDuration(g.seconds).padStart(9)}`);
  }
  lines.push('   ' + '─'.repeat(width + 11));
  lines.push(
    `   ${'Tracked'.padEnd(width)}  ${formatDuration(v.totalSeconds).padStart(9)}`
  );
  const roundNote = v.roundMinutes ? ` (rounded up to ${v.roundMinutes}m)` : '';
  lines.push(`   ${'Billable'.padEnd(width)}  ${(v.hours + 'h').padStart(9)}${roundNote}`);
  if (v.amount !== null) {
    lines.push(
      `   ${`@ ${v.rate}/h`.padEnd(width)}  ${`${v.amount} ${v.currency}`.padStart(9)}`
    );
  }
  console.error(lines.join('\n'));
}
