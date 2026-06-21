---
name: screentimer-agent
description: screentimer-agent is a CLI that lets an AI agent harness (Claude Code, Codex, Cursor, Cline) read the ScreenTimerAI activity log database and mass-categorize uncategorized activities by writing category assignments back to the local SQLite database with propagation to similar activities.
homepage: https://screentimerai.com
metadata: {"openclaw":{"emoji":"⏱️","requires":{"bins":["screentimer"],"env":[]}}}
---

# screentimer-agent

A CLI for categorizing ScreenTimerAI activity logs with an agent harness.

## Install

Install the skill into Claude Code with one command (no clone, no build):

```bash
npx -y screentimer-agent install
```

This copies this SKILL.md into `~/.claude/skills/screentimer-agent/`. Re-run with `--force` to update it.

All commands below run via `npx`, which fetches the published CLI on demand:

```bash
npx -y screentimer-agent <command>
```

No global install or local build is required. (For local development from a clone: `pnpm install && pnpm build`, then `node dist/index.js <command>`.)

The CLI reads the ScreenTimerAI SQLite database directly at:
`~/Library/Application Support/com.indistractable.app/indistractable.db`

Override with `INDISTRACTABLE_DB_PATH` or `--db <path>`.

| Property | Value |
|----------|-------|
| **name** | screentimer-agent |
| **description** | Categorize ScreenTimerAI activity logs via an agent harness |
| **allowed-tools** | Bash(screentimer:*) |

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
screentimer db:status                 # counts, paths, most recent activity
screentimer categories                # all active categories + group metadata
screentimer uncategorized --limit 50  # recent rows where category_id IS NULL
screentimer uncategorized --unique    # one representative per similar activity group
screentimer export --limit 100        # deduped payload: unique activities + taxonomy
screentimer export --no-unique        # include duplicate activity rows if needed
screentimer apply --in assignments.json
screentimer time                       # ASCII bar chart of today's time by category
screentimer time --days 7 --top 8      # last 7 days, top 8 buckets (rest → "Other")
screentimer time --by group            # group by category group (shows ⚠ disruptors)
screentimer time --by app              # group by app instead of category
```

`time` prints a colored ASCII chart to stderr and a JSON breakdown (`buckets`, `total_seconds`, `human`) to stdout. Window defaults to today (since local midnight); use `--days N`, or `--start`/`--end` ISO timestamps for a custom range. Disruptor categories/groups are marked `⚠`.

### Billing tags (ad-hoc, NOT system categories)

```bash
screentimer tag --label "client:acme / Jun" --start 2026-06-01T00:00:00Z --end 2026-06-30T23:59:59Z
screentimer tag --label "client:acme / Jun" --days 1 --app Slack   # narrow by app/url/title
screentimer tags                                                    # list labels + totals
screentimer billing --label "client:acme / Jun" --round 15 --rate 90   # invoice breakdown
screentimer untag --label "client:acme / Jun" --activity-id 123        # reverse a mistake
```

> [!IMPORTANT]
> **Billing tags are a separate overlay from system categorization. Do not confuse the two.**
> - **Categorization** (`export` → `apply`) writes `activity_logs.category_id` in the *app database*. This is what `time` and the app's stats read. When asked to "categorize", "clean up uncategorized", or "tidy the backlog", use *only* this path.
> - **Billing tags** (`tag`/`untag`/`tags`/`billing`) live in a CLI-owned JSON file (`~/.screentimer-agent/tags.json`, override `--tags-file`/`$SCREENTIMER_TAGS_FILE`) and never touch the app database. They exist for ad-hoc invoicing of hours worked in a time frame. An activity can be both system-categorized *and* billing-tagged, independently.
> - Never use `apply` to "categorize for billing", and never create a `user_categories` row for a client/invoice. Use `tag`.
>
> **When the user's intent is ambiguous, ASK before acting.** A request like "categorize my Acme work this week", "label these hours", or "sort out my time" could mean either path. Do not assume. Ask one question:
> > "Should this go into the app's categories (shows up in your ScreenTimerAI stats), or is it an ad-hoc billing tag for invoicing (kept separate, in the CLI)?"
>
> Decide without asking only when the request is unambiguous: words like *invoice, billing, client, hours worked, rate, export for a customer* → `tag`/`billing`; words like *uncategorized, backlog, clean up, productivity stats, distraction* → `export`/`apply`.

`tag` reads the app DB read-only, selects activities by `--start`/`--end` (or `--days N`) plus optional `--app` / `--url-contains` / `--title-contains` filters, and snapshots each activity's tracked duration into the JSON store. It's idempotent per label (re-tagging the same activity is a no-op) and supports `--dry-run`. `billing` sums the snapshots for one label, rounds up to `--round` minutes (0 = none), and multiplies by `--rate` if given. Because durations are snapshotted at tag time, billing totals stay correct even if the app DB is later re-tracked or wiped.

`apply` reads JSON of shape:

```json
{
  "assignments": [
    { "activity_id": 90417, "category_id": 1 }
  ]
}
```

Either `{ "assignments": [...] }` or a bare `[...]` array is accepted. Can also be piped via stdin: `cat assignments.json | screentimer apply`.

## Core Workflow

1. **Assess** the backlog:
   ```bash
   screentimer db:status
   ```
2. **Export** a batch — uncategorized activities plus the full category taxonomy in one document:
   ```bash
   screentimer export --limit 100 > batch.json
   ```
3. **Reason** over `batch.json`. For each activity, pick exactly one `category_id` from `categories`. Respect group semantics: categories with `group_is_disruptor: true` are distractions. Only assign categories you are confident about — leave uncertain activities unassigned rather than guessing.
4. **Write** assignments:
   ```bash
   screentimer apply --in assignments.json
   ```
   Use `--dry-run` first if you want to preview the effect.
5. **Repeat** until `db:status` shows the uncategorized count at your target (zero, or clean for a specific time range via `export --start ... --end ...`).

## Category taxonomy (typical)

ScreenTimerAI categories belong to groups. Common structure:

- **Work** (non-disruptor): Email/Chat, Planning/Organization, Coding/Programming, Code Review, General Work
- **Distraction** (disruptor): Social Media, Video Streaming, News & Current Events, Gaming, Entertainment Content, Adult Content
- **Ungrouped**: Other (fallback when nothing else fits)

Always confirm the live taxonomy with `screentimer categories` rather than assuming — the user may have added or archived categories.

## Categorization guidance

- **Same URL** activities belong to the same category (the CLI propagates this automatically).
- **Same bundle_id + window_title** belong to the same category (also auto-propagated).
- `export` dedupes by default when categorizing a backlog, so you categorize one representative per similar activity group. The output includes `similar_count`, and normal `apply` propagation updates the matching uncategorized rows. Use `export --no-unique` only when raw duplicate rows are needed.
- Treat work tools (Linear, Figma, GitHub, VS Code, terminal) as Work categories.
- Treat YouTube/Netflix/social feeds/news as Distraction unless clearly work-related (e.g. a work-related YouTube tutorial may still be Entertainment Content — defer to the user's stated preference).
- When in doubt, use the **Other** category rather than a wrong specific one, or leave unassigned.

## Safety

- `apply` only writes `activity_logs.category_id`. It does not delete categories, does not run arbitrary SQL, and does not touch other tables.
- By default it will not overwrite rows that already have a category (use `--overwrite` to override, carefully).
- Writes are atomic (single transaction) and use `WHERE category_id IS NULL` so the app's own background categorizer cannot be clobbered.
- `--propagate false` disables spreading to similar uncategorized rows for a given call.
