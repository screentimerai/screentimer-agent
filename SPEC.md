# ScreenTimer Agent CLI Spec

## Purpose

Create `screentimer-agent` as a complete external CLI tool for ScreenTimerAI, similar in shape to `postiz-agent`.

The CLI should let AI agents and humans inspect local ScreenTimerAI activity data, produce categorization decisions, preview the effect of those decisions, and apply category updates safely.

This is an external executable/package, not a hosted service. It reads and writes the local ScreenTimerAI SQLite database used by the desktop app.

## Goals

- Provide a standalone CLI that agents can call from Codex, Claude Code, shell scripts, or MCP-style workflows.
- Keep AI reasoning outside the CLI for the first version: the agent decides, the CLI validates and applies.
- Make categorization auditable, previewable, and reversible enough to avoid accidental broad edits.
- Reuse the existing ScreenTimerAI data model and activity logic where practical.
- Match the ergonomics of `postiz-agent`: installable CLI, JSON-first output, clear commands, small surface area.

## Non-Goals

- Do not build a new time tracker.
- Do not require the ScreenTimerAI desktop app to be running.
- Do not call OpenAI, Anthropic, Google, Ollama, or other AI providers in v1.
- Do not automatically create new categories while categorizing.
- Do not silently apply category changes without preview or explicit confirmation.
- Do not expose a network server in v1.

## Product Shape

Package name:

```text
screentimer-agent
```

CLI binary:

```text
screentimer
```

Example usage:

```bash
screentimer current --json
screentimer summary today --json
screentimer categories:list --json
screentimer activities:uncategorized --limit 50 --json
screentimer categorize:preview decisions.json
screentimer categorize:apply decisions.json --yes
```

The CLI should default to human-readable output for direct use and support `--json` for agents.

## Data Source

Default database path:

```text
~/Library/Application Support/com.indistractable.app/indistractable.db
```

Environment override:

```text
INDISTRACTABLE_DB_PATH=/path/to/indistractable.db
```

The CLI should use direct SQLite access, likely with `better-sqlite3` in the Node implementation.

The app already has useful read-side logic in:

```text
src/lib/activity/activityToolCore.ts
src/lib/activity/sqliteActivityLogStore.ts
src/lib/activity/activityLogStore.ts
```

The CLI should either reuse this logic through a shared package/export or copy the minimum needed logic at first and later extract shared core code if duplication becomes painful.

## Architecture

Recommended v1 architecture:

```text
screentimer-agent
  src/
    index.ts
    config.ts
    db/
      connection.ts
      schema.ts
    commands/
      current.ts
      summary.ts
      categories.ts
      activities.ts
      categorize.ts
    categorization/
      decisionSchema.ts
      preview.ts
      apply.ts
      audit.ts
    output/
      json.ts
      table.ts
```

Core responsibilities:

- `config`: resolves database path and global flags.
- `db`: owns SQLite connection, readonly/readwrite modes, busy timeout, and schema checks.
- `commands`: thin CLI entry points.
- `categorization`: validates agent decisions, expands scopes into affected rows, previews changes, applies transactions.
- `output`: keeps agent JSON output stable.

## Command Surface

### Activity Read Commands

```bash
screentimer current --json
screentimer summary <range> --json
screentimer focus <range> --json
screentimer trends <range> --json
screentimer logs --start <iso> --end <iso> --json
```

Supported natural ranges should initially be conservative:

```text
today
yesterday
last-24h
last-7d
```

ISO start/end should be supported for exact agent workflows.

### Category Commands

```bash
screentimer categories:list --json
screentimer categories:get <category_id> --json
```

Category output should include:

```json
{
  "id": 2,
  "name": "Distracting",
  "color": "#ef4444",
  "score": -1,
  "enabled": true
}
```

The exact fields should match the ScreenTimerAI category schema once implementation starts.

### Activity Selection Commands

```bash
screentimer activities:uncategorized --limit 100 --json
screentimer activities:search "youtube shorts" --limit 50 --json
screentimer activities:get <activity_id> --json
```

Activity JSON should include enough context for an AI agent to make a categorization decision:

```json
{
  "id": 812,
  "timestamp": "2026-06-18T09:13:22.000Z",
  "duration_seconds": 142,
  "app_name": "Arc",
  "bundle_id": "company.thebrowser.Browser",
  "window_title": "YouTube Shorts",
  "url": "https://youtube.com/shorts/abc",
  "domain": "youtube.com",
  "category_id": null
}
```

## Agent Categorization Flow

The agent should not be asked to mutate the database directly. The safe flow is:

1. CLI lists valid categories.
2. CLI lists uncategorized or matching activities.
3. Agent writes a decision file.
4. CLI previews the decision file.
5. Human or agent explicitly applies the decision file.

Example:

```bash
screentimer categories:list --json
screentimer activities:uncategorized --limit 50 --json > activities.json
```

The agent creates:

```json
[
  {
    "activity_id": 812,
    "category_id": 2,
    "scope": "same_domain",
    "reason": "YouTube Shorts is entertainment/distraction usage.",
    "confidence": "high"
  }
]
```

Then:

```bash
screentimer categorize:preview decisions.json
screentimer categorize:apply decisions.json --yes
```

## Decision Schema

Decision file format:

```json
[
  {
    "activity_id": 812,
    "category_id": 2,
    "scope": "exact",
    "reason": "Short explanation for audit trail.",
    "confidence": "high"
  }
]
```

Required fields:

- `activity_id`
- `category_id`
- `scope`
- `reason`

Optional fields:

- `confidence`: `low`, `medium`, or `high`
- `dry_run`: per-decision override, if needed later

Allowed scopes:

- `exact`: only this activity row.
- `same_url`: all rows with the same exact URL.
- `same_domain`: all rows with the same normalized domain.
- `same_app_window`: all rows with the same `bundle_id` and `window_title`.

The existing app behavior broadly applies category changes to similar logs. The CLI should make that scope explicit so an agent cannot accidentally update a large set by choosing one row.

## Preview Behavior

`categorize:preview` should:

- Validate every activity ID exists.
- Validate every category ID exists and is enabled.
- Validate every scope.
- Expand each scope into affected activity IDs.
- Show affected row count per decision.
- Show sample affected rows.
- Show old category distribution.
- Refuse dangerous changes by default.

Dangerous change examples:

- More than 100 affected rows from one decision.
- A decision that changes already-categorized rows.
- A `same_domain` decision for a broad domain like `google.com`, `apple.com`, or `github.com`.
- A decision missing a meaningful reason.

Preview should return a machine-readable summary with `--json`.

## Apply Behavior

`categorize:apply` should:

- Require `--yes` for non-interactive use.
- Run the same validation as preview.
- Use a short SQLite transaction.
- Apply category changes only to the previewed/resolved row set.
- Write an audit record for each changed activity.
- Emit a summary of changed, skipped, and failed rows.

Default behavior should skip already-categorized rows unless explicitly passed:

```bash
screentimer categorize:apply decisions.json --include-categorized --yes
```

This prevents an agent from overwriting previous human choices by accident.

## Audit Trail

Preferred v1 audit storage:

```text
~/.screentimer-agent/audit.jsonl
```

Reason:

- Avoids changing the app database schema in the first CLI version.
- Works even before the app knows about CLI audit records.
- Keeps every write traceable.

Each audit line:

```json
{
  "timestamp": "2026-06-18T10:30:00.000Z",
  "source": "screentimer-agent",
  "activity_id": 812,
  "old_category_id": null,
  "new_category_id": 2,
  "scope": "same_domain",
  "decision_reason": "YouTube Shorts is entertainment/distraction usage.",
  "decision_confidence": "high"
}
```

Later, audit records can move into the app database if the desktop UI should show them.

## AI Provider Position

`screentimer-agent` v1 should not call AI providers itself.

The agent using the CLI is the AI layer. That keeps the CLI deterministic and avoids duplicating the app's existing provider configuration for OpenAI, Anthropic, Google, and Ollama.

Future optional command:

```bash
screentimer categorize:suggest --provider app-settings --limit 50
```

This should only be added after the external CLI is stable.

## Error Handling

The CLI should return non-zero exit codes for:

- Missing database.
- Unsupported schema.
- Invalid date range.
- Invalid JSON decision file.
- Unknown activity/category IDs.
- Preview safety refusal.
- SQLite write conflict after retry.

All errors should have stable JSON form when `--json` is passed:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_CATEGORY_ID",
    "message": "Category 99 does not exist.",
    "details": {
      "category_id": 99
    }
  }
}
```

## Testing Strategy

Use fixture SQLite databases instead of the real user database.

Test layers:

- Unit tests for decision schema validation.
- Unit tests for scope expansion.
- Unit tests for preview safety rules.
- Integration tests against fixture SQLite DBs.
- CLI smoke tests for JSON output and exit codes.

Important test cases:

- Exact categorization updates one row.
- Same URL scope expands correctly.
- Same domain scope expands correctly.
- Already-categorized rows are skipped by default.
- Invalid category ID fails before writes.
- Broad scope over row limit fails unless explicitly allowed.
- Audit JSONL is written after successful apply.

## Implementation Phases

### Phase 1: Readonly CLI

- Create npm package scaffold.
- Add `screentimer` binary.
- Add config/database path resolution.
- Add `categories:list`.
- Add `activities:uncategorized`.
- Add `activities:get`.
- Add `summary today`.
- Add JSON output tests.

### Phase 2: Safe Categorization Preview

- Add decision file schema.
- Add `categorize:preview`.
- Implement scope expansion.
- Implement safety rules.
- Add fixture DB tests.

### Phase 3: Apply With Audit

- Add `categorize:apply`.
- Add readwrite SQLite transaction.
- Add audit JSONL writer.
- Add skip/include behavior for categorized rows.
- Add integration tests.

### Phase 4: Package Polish

- Add README usage examples.
- Add install instructions.
- Add examples for Codex/Claude agents.
- Add release build with `tsup`.
- Decide whether to publish as npm package or keep local.

## Open Questions For Review

1. Should the first package be Node/TypeScript like `postiz-agent`, or Rust like the Tauri sidecar?
2. Should audit records stay outside the app DB for v1, or should we add a proper app migration immediately?
3. Should `same_domain` be allowed in v1, or should the first write version only allow `exact`, `same_url`, and `same_app_window`?
4. Should the CLI package copy activity read logic first, or should we extract shared ScreenTimerAI core code before implementation?

## Recommended Decisions

- Use Node/TypeScript for v1 to match `postiz-agent` and reuse existing TypeScript activity logic.
- Keep audit records in `~/.screentimer-agent/audit.jsonl` for v1.
- Include `same_domain`, but make it safety-gated with preview row limits and broad-domain refusal.
- Start with a small amount of copied/readapted read logic, then extract shared core code only when the duplication becomes concrete.

## Review Criteria

This spec is ready for implementation planning when:

- The command names feel right.
- The agent categorization flow feels safe enough.
- The allowed scopes are approved.
- The audit approach is approved.
- The implementation phases match the desired MVP.
