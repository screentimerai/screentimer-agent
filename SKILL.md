---
name: screentimer-agent
description: screentimer-agent is a CLI that lets an AI agent harness (Claude Code, Codex, Cursor, Cline) read the ScreenTimerAI activity log database and mass-categorize uncategorized activities by writing category assignments back to the local SQLite database with propagation to similar activities.
homepage: https://screentimerai.com
---

# screentimer-agent

A CLI for categorizing ScreenTimerAI activity logs with an agent harness.

## Install screentimer-agent if it doesn't exist

```bash
cd ~/code/screentimer-agent
pnpm install && pnpm build
# Optionally link globally:
pnpm link --global
```

If not linked, invoke via `node ~/code/screentimer-agent/dist/index.js <command>` (or alias it as `screentimer-agent`).

The CLI reads the ScreenTimerAI SQLite database directly at:
`~/Library/Application Support/com.indistractable.app/indistractable.db`

Override with `INDISTRACTABLE_DB_PATH` or `--db <path>`.

| Property | Value |
|----------|-------|
| **name** | screentimer-agent |
| **description** | Categorize ScreenTimerAI activity logs via an agent harness |
| **allowed-tools** | Bash(screentimer-agent:*) |

---

## ⚠️ One Hard Rule (Read First)

**Never run `apply` without reviewing the assignments.** `apply` writes to the live database. Default behavior refuses to overwrite already-categorized rows and propagates each assignment to *similar uncategorized* rows (same URL, or same bundle_id + window_title). A wrong assignment can therefore spread. Always `--dry-run` first when unsure.

---

## What this CLI does

It does **not** call any LLM. The reasoning happens in the connected harness (you). The CLI provides:

1. **Reads** — the activity log and the user's category taxonomy.
2. **Writes** — validated category assignments back to `activity_logs.category_id`, with propagation.

This keeps it provider-agnostic and API-key-free.

## Commands

```bash
screentimer-agent db:status                 # counts, paths, most recent activity
screentimer-agent categories                # all active categories + group metadata
screentimer-agent uncategorized --limit 50  # recent rows where category_id IS NULL
screentimer-agent export --limit 100        # combined payload: activities + taxonomy
screentimer-agent apply --in assignments.json
```

`apply` reads JSON of shape:

```json
{
  "assignments": [
    { "activity_id": 90417, "category_id": 1 }
  ]
}
```

Either `{ "assignments": [...] }` or a bare `[...]` array is accepted. Can also be piped via stdin: `cat assignments.json | screentimer-agent apply`.

## Core Workflow

1. **Assess** the backlog:
   ```bash
   screentimer-agent db:status
   ```
2. **Export** a batch — uncategorized activities plus the full category taxonomy in one document:
   ```bash
   screentimer-agent export --limit 100 > batch.json
   ```
3. **Reason** over `batch.json`. For each activity, pick exactly one `category_id` from `categories`. Respect group semantics: categories with `group_is_disruptor: true` are distractions. Only assign categories you are confident about — leave uncertain activities unassigned rather than guessing.
4. **Write** assignments:
   ```bash
   screentimer-agent apply --in assignments.json
   ```
   Use `--dry-run` first if you want to preview the effect.
5. **Repeat** until `db:status` shows the uncategorized count at your target (zero, or clean for a specific time range via `export --start ... --end ...`).

## Category taxonomy (typical)

ScreenTimerAI categories belong to groups. Common structure:

- **Work** (non-disruptor): Email/Chat, Planning/Organization, Coding/Programming, Code Review, General Work
- **Distraction** (disruptor): Social Media, Video Streaming, News & Current Events, Gaming, Entertainment Content, Adult Content
- **Ungrouped**: Other (fallback when nothing else fits)

Always confirm the live taxonomy with `screentimer-agent categories` rather than assuming — the user may have added or archived categories.

## Categorization guidance

- **Same URL** activities belong to the same category (the CLI propagates this automatically).
- **Same bundle_id + window_title** belong to the same category (also auto-propagated).
- Treat work tools (Linear, Figma, GitHub, VS Code, terminal) as Work categories.
- Treat YouTube/Netflix/social feeds/news as Distraction unless clearly work-related (e.g. a work-related YouTube tutorial may still be Entertainment Content — defer to the user's stated preference).
- When in doubt, use the **Other** category rather than a wrong specific one, or leave unassigned.

## Safety

- `apply` only writes `activity_logs.category_id`. It does not delete categories, does not run arbitrary SQL, and does not touch other tables.
- By default it will not overwrite rows that already have a category (use `--overwrite` to override, carefully).
- Writes are atomic (single transaction) and use `WHERE category_id IS NULL` so the app's own background categorizer cannot be clobbered.
- `--propagate false` disables spreading to similar uncategorized rows for a given call.
