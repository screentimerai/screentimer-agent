import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { Argv } from 'yargs';

import { listCategoriesCommand } from './commands/categories';
import { uncategorizedCommand } from './commands/uncategorized';
import { exportCommand } from './commands/exportBatch';
import { applyCommand } from './commands/apply';
import { dbStatusCommand } from './commands/dbStatus';
import { timeCommand } from './commands/time';
import { timelineCommand } from './commands/timeline';
import { tagCommand } from './commands/tag';
import { untagCommand } from './commands/untag';
import { tagsListCommand } from './commands/tagsList';
import { billingCommand } from './commands/billing';
import { installCommand } from './commands/install';

// Shared --db option for overriding the DB path on any command.
const dbOption = (y: Argv) =>
  y.option('db', {
    describe: 'Path to indistractable.db (default: ~/Library/Application Support/com.indistractable.app/indistractable.db, or $INDISTRACTABLE_DB_PATH)',
    type: 'string',
  });

// Shared --tags-file option for the billing-tag commands (CLI-owned JSON store).
const tagsFileOption = (y: Argv) =>
  y.option('tags-file', {
    describe: 'Path to the billing-tags JSON store (default: ~/.screentimer-agent/tags.json, or $SCREENTIMER_TAGS_FILE)',
    type: 'string',
  });

yargs(hideBin(process.argv))
  .scriptName('screentimer')
  .usage('$0 <command> [options]')
  .command(
    'db:status',
    'Show ScreenTimerAI database status (counts, paths, most recent activity).',
    (y: Argv) => dbOption(y),
    dbStatusCommand as any
  )
  .command(
    'categories',
    'List all user categories with group metadata (for the agent to pick from).',
    (y: Argv) =>
      dbOption(y).option('include-inactive', {
        describe: 'Include inactive categories',
        type: 'boolean',
        default: false,
      }),
    listCategoriesCommand as any
  )
  .command(
    'uncategorized',
    'List recent uncategorized activities.',
    (y: Argv) =>
      dbOption(y)
        .option('limit', {
          describe: 'Max activities to return (default 50, max 200)',
          type: 'number',
          default: 50,
        })
        .option('unique', {
          describe: 'Return one representative per URL or app/window title similarity key',
          type: 'boolean',
          default: false,
        })
        .option('start', {
          describe: 'ISO timestamp; only activities with start_time >= this',
          type: 'string',
        })
        .option('end', {
          describe: 'ISO timestamp; only activities with start_time <= this',
          type: 'string',
        }),
    uncategorizedCommand as any
  )
  .command(
    'export',
    'Export a self-contained batch payload (uncategorized activities + category taxonomy) for an agent harness to categorize.',
    (y: Argv) =>
      dbOption(y)
        .option('limit', {
          describe: 'Max activities to include (default 50, max 200)',
          type: 'number',
          default: 50,
        })
        .option('unique', {
          describe: 'Export one representative per URL or app/window title similarity key; use --no-unique to include duplicate rows',
          type: 'boolean',
          default: true,
        })
        .option('start', {
          describe: 'ISO timestamp; only activities with start_time >= this',
          type: 'string',
        })
        .option('end', {
          describe: 'ISO timestamp; only activities with start_time <= this',
          type: 'string',
        })
        .option('out', {
          describe: 'Write payload to this file instead of stdout',
          type: 'string',
        }),
    exportCommand as any
  )
  .command(
    'apply',
    'Apply category assignments (JSON via stdin or --in) to the activity log, with validation, concurrency guard, and propagation to similar uncategorized activities.',
    (y: Argv) =>
      dbOption(y)
        .option('in', {
          describe: 'Read assignments JSON from this file (default: stdin)',
          type: 'string',
        })
        .option('propagate', {
          describe: 'Propagate each assignment to similar uncategorized activities (default: true)',
          type: 'boolean',
          default: true,
        })
        .option('overwrite', {
          describe: 'Overwrite activities that already have a category (default: false — already-categorized rows are skipped)',
          type: 'boolean',
          default: false,
        })
        .option('dry-run', {
          describe: 'Report what would change without writing',
          type: 'boolean',
          default: false,
        }),
    applyCommand as any
  )
  .command(
    'time',
    'Show a beautiful ASCII bar chart of your tracked time, grouped by category, group, or app.',
    (y: Argv) =>
      dbOption(y)
        .option('by', {
          describe: 'Dimension to group by',
          choices: ['category', 'group', 'app'] as const,
          default: 'category',
        })
        .option('days', {
          describe: 'Window: last N days (1 = today since midnight). Ignored if --start/--end given.',
          type: 'number',
          default: 1,
        })
        .option('start', {
          describe: 'ISO timestamp; only activities with start_time >= this',
          type: 'string',
        })
        .option('end', {
          describe: 'ISO timestamp; only activities with start_time <= this',
          type: 'string',
        })
        .option('top', {
          describe: 'Show only the top N buckets, collapsing the rest into "Other"',
          type: 'number',
        })
        .option('no-color', {
          describe: 'Disable ANSI colors in the chart',
          type: 'boolean',
          default: false,
        }),
    timeCommand as any
  )
  .command(
    'timeline',
    'Show a chronological timeline of what was on screen (focus blocks with app, category, and time span). Use --start/--end to cross-reference an external time range, e.g. an agent session.',
    (y: Argv) =>
      dbOption(y)
        .option('days', {
          describe: 'Window: last N days (1 = today since midnight). Ignored if --start/--end given.',
          type: 'number',
          default: 1,
        })
        .option('start', {
          describe: 'ISO timestamp; only activities with start_time >= this',
          type: 'string',
        })
        .option('end', {
          describe: 'ISO timestamp; only activities with start_time <= this',
          type: 'string',
        })
        .option('app', {
          describe: 'Only include activities from this app (exact, case-insensitive)',
          type: 'string',
        })
        .option('merge-gap', {
          describe: 'Merge consecutive same-app+category activities separated by <= N seconds into one block (default 300). Ignored with --raw.',
          type: 'number',
          default: 300,
        })
        .option('min-seconds', {
          describe: 'Drop blocks shorter than this many seconds (default 0 = keep all)',
          type: 'number',
          default: 0,
        })
        .option('raw', {
          describe: 'Do not merge into focus blocks; emit one row per raw activity',
          type: 'boolean',
          default: false,
        })
        .option('limit', {
          describe: 'Show only the first N blocks',
          type: 'number',
        })
        .option('no-color', {
          describe: 'Disable ANSI colors',
          type: 'boolean',
          default: false,
        }),
    timelineCommand as any
  )
  .command(
    'tag',
    'Ad-hoc billing tag: label activities in a time window for invoicing. Writes a CLI-owned JSON store only — never touches app categories.',
    (y: Argv) =>
      tagsFileOption(dbOption(y))
        .option('label', {
          describe: 'Billing label to attach (e.g. "client:acme / Jan invoice"). Required.',
          type: 'string',
        })
        .option('start', {
          describe: 'ISO timestamp; only activities with start_time >= this',
          type: 'string',
        })
        .option('end', {
          describe: 'ISO timestamp; only activities with start_time <= this',
          type: 'string',
        })
        .option('days', {
          describe: 'Convenience window: last N days (1 = today). Ignored if --start/--end given.',
          type: 'number',
        })
        .option('app', {
          describe: 'Only tag activities from this app (exact, case-insensitive)',
          type: 'string',
        })
        .option('url-contains', {
          describe: 'Only tag activities whose URL contains this substring',
          type: 'string',
        })
        .option('title-contains', {
          describe: 'Only tag activities whose window title contains this substring',
          type: 'string',
        })
        .option('note', {
          describe: 'Optional note stored on each tagged activity',
          type: 'string',
        })
        .option('dry-run', {
          describe: 'Report what would be tagged without writing',
          type: 'boolean',
          default: false,
        }),
    tagCommand as any
  )
  .command(
    'untag',
    'Remove billing tags for a label, optionally scoped to a window or activity ids.',
    (y: Argv) =>
      tagsFileOption(y)
        .option('label', {
          describe: 'Billing label to remove from. Required.',
          type: 'string',
        })
        .option('start', { describe: 'ISO timestamp; only tags with start_time >= this', type: 'string' })
        .option('end', { describe: 'ISO timestamp; only tags with start_time <= this', type: 'string' })
        .option('days', { describe: 'Convenience window: last N days. Ignored if --start/--end given.', type: 'number' })
        .option('activity-id', {
          describe: 'Only remove these activity id(s) (repeatable)',
          type: 'number',
          array: true,
        })
        .option('dry-run', {
          describe: 'Report what would be removed without writing',
          type: 'boolean',
          default: false,
        }),
    untagCommand as any
  )
  .command(
    'tags',
    'List all billing labels with activity counts and total tracked time.',
    (y: Argv) => tagsFileOption(y),
    tagsListCommand as any
  )
  .command(
    'billing',
    'Produce an invoice-ready breakdown (billable hours, line items, optional amount) for one billing label.',
    (y: Argv) =>
      tagsFileOption(y)
        .option('label', {
          describe: 'Billing label to invoice. Required.',
          type: 'string',
        })
        .option('round', {
          describe: 'Round total up to the nearest N minutes (e.g. 15). 0 = no rounding.',
          type: 'number',
          default: 0,
        })
        .option('rate', {
          describe: 'Hourly rate; if given, output includes the amount',
          type: 'number',
        })
        .option('currency', {
          describe: 'Currency label for the amount (default EUR)',
          type: 'string',
          default: 'EUR',
        }),
    billingCommand as any
  )
  .command(
    'install',
    'Install the screentimer-agent skill into Claude Code (~/.claude/skills/). Run via: npx -y screentimer-agent install',
    (y: Argv) =>
      y
        .option('force', {
          describe: 'Overwrite an existing installed SKILL.md',
          type: 'boolean',
          default: false,
        })
        .option('dir', {
          describe: 'Skills base directory (default: ~/.claude/skills)',
          type: 'string',
        }),
    installCommand as any
  )
  .demandCommand(1, 'You need at least one command')
  .help()
  .alias('h', 'help')
  .version()
  .alias('v', 'version')
  .epilogue(
    'ScreenTimerAI activity categorization CLI.\n\n' +
      'Typical agent workflow:\n' +
      '  screentimer db:status\n' +
      '  screentimer export --limit 100 > batch.json\n' +
      '  # agent picks category_id for each activity, writes assignments.json\n' +
      '  screentimer apply --in assignments.json\n\n' +
      'DB path override: export INDISTRACTABLE_DB_PATH=... or pass --db <path>'
  )
  .parse();
