# screentimer-agent

[![skills.sh](https://skills.sh/b/screentimerai/screentimer-agent)](https://skills.sh/screentimerai/screentimer-agent)

A CLI that lets an AI agent harness ([Claude Code](https://claude.com/claude-code), Codex, Cursor, Cline) **mass-categorize uncategorized activities** in the [ScreenTimerAI](https://screentimerai.com) activity log.

It does **not** call any LLM itself. The connected harness supplies the reasoning; this CLI provides the data contract (read the activity log + category taxonomy) and the persistence layer (write validated category assignments back to the local SQLite DB, with propagation to similar activities).

Built with the same tech stack as [postiz-agent](https://github.com/gitroomhq/postiz-agent): TypeScript + yargs + tsup + better-sqlite3, plus a `SKILL.md` and `.claude-plugin/` so it loads as a Claude Code skill.

## Install

```bash
npm install -g screentimer-agent     # installs the `screentimer` command
# or
pnpm install -g screentimer-agent
```

> The package is named `screentimer-agent` but the command it installs is `screentimer`.
> `better-sqlite3` is a native module, so install needs build tools (or a prebuilt binary) on your machine.

As a skill for your agent harness ([skills.sh](https://skills.sh) ecosystem — Claude Code, Cursor, Codex, Cline, …):

```bash
npx skills add screentimerai/screentimer-agent          # project-level
npx skills add screentimerai/screentimer-agent -g        # global
```

As a Claude Code plugin:

```bash
/plugin marketplace add screentimerai/screentimer-agent
/plugin install screentimer-agent@screentimer-agent
```

Local dev:

```bash
cd ~/code/screentimer-agent
pnpm install && pnpm build
pnpm link --global   # optional, makes `screentimer` available on PATH
```

The CLI reads the ScreenTimerAI database directly:

```
~/Library/Application Support/com.indistractable.app/indistractable.db
```

Override with `INDISTRACTABLE_DB_PATH` or `--db <path>`.

## Commands

```bash
screentimer db:status                 # counts, paths, most recent activity
screentimer categories                # all active categories + group metadata
screentimer uncategorized --limit 50  # recent rows where category_id IS NULL
screentimer uncategorized --unique    # one representative per similar activity group
screentimer export --limit 100        # deduped payload: unique activities + taxonomy
screentimer export --no-unique        # include duplicate activity rows if needed
screentimer apply --in assignments.json
screentimer time                       # ASCII bar chart of today's time by category
screentimer time --days 7 --top 8      # last 7 days, top 8 buckets (rest → "Other")
screentimer time --by group            # by category group; --by app for per-app
```

`time` renders a colored ASCII bar chart to stderr and a JSON breakdown to stdout. Defaults to today; use `--days N` or `--start`/`--end` ISO timestamps. Disruptor categories/groups are flagged `⚠`.

```
╔════════════════════════════════════════════════════════╗
║ ⏱  Screen time — last 7 days · by category             ║
║ total: 61h 01m  ·  9 buckets                           ║
╚════════════════════════════════════════════════════════╝

  Coding/Programming    ████████████████████████████  31h 26m  52%
  General Work          ███████████░░░░░░░░░░░░░░░░░  12h 43m  21%
  Gaming                █████░░░░░░░░░░░░░░░░░░░░░░░   6h 06m  10% ⚠
```

`apply` accepts JSON via `--in <file>` or stdin, shape:

```json
{
  "assignments": [
    { "activity_id": 90417, "category_id": 1 }
  ]
}
```

A bare `[...]` array is also accepted.

## Agent workflow

```bash
# 1. See the backlog
screentimer db:status

# 2. Export a batch (uncategorized activities + category taxonomy)
screentimer export --limit 100 > batch.json

# 3. Harness reasons over batch.json, picks a category_id for each activity,
#    writes assignments.json:
#    { "assignments": [ { "activity_id": 90417, "category_id": 4 }, ... ] }

# 4. Apply (dry-run first, then for real)
screentimer apply --dry-run --in assignments.json
screentimer apply --in assignments.json

# 5. Repeat until db:status shows the uncategorized count at your target
```

## Safety

- `apply` only writes `activity_logs.category_id` — no other tables, no arbitrary SQL, no category deletion.
- By default it **will not overwrite** rows that already have a category (use `--overwrite` to override).
- Writes are atomic (single transaction) and use `WHERE category_id IS NULL`, so the app's own background categorizer can't be clobbered.
- Each assignment **propagates** to similar uncategorized rows (same URL, or same `bundle_id` + `window_title`) unless `--propagate false`.
- `--dry-run` previews the effect without writing.
- `export` dedupes by default so agents categorize one representative per similar activity group. The output includes `similar_count`, and normal `apply` propagation updates the matching uncategorized rows. Use `export --no-unique` only when you need raw duplicate rows.

## Development

```bash
pnpm dev      # tsup --watch
pnpm build    # tsup
pnpm start    # node ./dist/index.js
```

## License

MIT
