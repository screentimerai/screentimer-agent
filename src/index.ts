import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { Argv } from 'yargs';

import { listCategoriesCommand } from './commands/categories';
import { uncategorizedCommand } from './commands/uncategorized';
import { exportCommand } from './commands/exportBatch';
import { applyCommand } from './commands/apply';
import { dbStatusCommand } from './commands/dbStatus';

// Shared --db option for overriding the DB path on any command.
const dbOption = (y: Argv) =>
  y.option('db', {
    describe: 'Path to indistractable.db (default: ~/Library/Application Support/com.indistractable.app/indistractable.db, or $INDISTRACTABLE_DB_PATH)',
    type: 'string',
  });

yargs(hideBin(process.argv))
  .scriptName('screentimer-agent')
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
  .demandCommand(1, 'You need at least one command')
  .help()
  .alias('h', 'help')
  .version()
  .alias('v', 'version')
  .epilogue(
    'ScreenTimerAI activity categorization CLI.\n\n' +
      'Typical agent workflow:\n' +
      '  screentimer-agent db:status\n' +
      '  screentimer-agent export --limit 100 > batch.json\n' +
      '  # agent picks category_id for each activity, writes assignments.json\n' +
      '  screentimer-agent apply --in assignments.json\n\n' +
      'DB path override: export INDISTRACTABLE_DB_PATH=... or pass --db <path>'
  )
  .parse();
