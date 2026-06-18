# screentimer-agent

A CLI that lets an AI agent harness ([Claude Code](https://claude.com/claude-code), Codex, Cursor, Cline) **mass-categorize uncategorized activities** in the [ScreenTimerAI](https://screentimerai.com) activity log.

It does **not** call any LLM itself. The connected harness supplies the reasoning; this CLI provides the data contract (read the activity log + category taxonomy) and the persistence layer (write validated category assignments back to the local SQLite DB, with propagation to similar activities).

Built with the same tech stack as [postiz-agent](https://github.com/gitroomhq/postiz-agent): TypeScript + yargs + tsup + better-sqlite3, plus a `SKILL.md` and `.claude-plugin/` so it loads as a Claude Code skill.

## Install

```bash
cd ~/code/screentimer-agent
pnpm install && pnpm build
pnpm link --global   # optional, makes `screentimer-agent` available on PATH
```

The CLI reads the ScreenTimerAI database directly:

```
~/Library/Application Support/com.indistractable.app/indistractable.db
```

Override with `INDISTRACTABLE_DB_PATH` or `--db <path>`.

## Commands

```bash
screentimer-agent db:status                 # counts, paths, most recent activity
screentimer-agent categories                # all active categories + group metadata
screentimer-agent uncategorized --limit 50  # recent rows where category_id IS NULL
screentimer-agent export --limit 100        # combined payload: activities + taxonomy
screentimer-agent apply --in assignments.json
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
screentimer-agent db:status

# 2. Export a batch (uncategorized activities + category taxonomy)
screentimer-agent export --limit 100 > batch.json

# 3. Harness reasons over batch.json, picks a category_id for each activity,
#    writes assignments.json:
#    { "assignments": [ { "activity_id": 90417, "category_id": 4 }, ... ] }

# 4. Apply (dry-run first, then for real)
screentimer-agent apply --dry-run --in assignments.json
screentimer-agent apply --in assignments.json

# 5. Repeat until db:status shows the uncategorized count at your target
```

## Safety

- `apply` only writes `activity_logs.category_id` — no other tables, no arbitrary SQL, no category deletion.
- By default it **will not overwrite** rows that already have a category (use `--overwrite` to override).
- Writes are atomic (single transaction) and use `WHERE category_id IS NULL`, so the app's own background categorizer can't be clobbered.
- Each assignment **propagates** to similar uncategorized rows (same URL, or same `bundle_id` + `window_title`) unless `--propagate false`.
- `--dry-run` previews the effect without writing.

## Development

```bash
pnpm dev      # tsup --watch
pnpm build    # tsup
pnpm start    # node ./dist/index.js
```

## License

MIT
