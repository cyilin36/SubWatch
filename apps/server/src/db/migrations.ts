export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('email', 'webhook')),
  config TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  builtin_key TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '[]',
  default_cycle TEXT NOT NULL DEFAULT 'month',
  default_cycle_days INTEGER,
  default_amount_cents INTEGER,
  default_currency TEXT NOT NULL DEFAULT 'CNY',
  default_reminder_offsets TEXT NOT NULL DEFAULT '[7,3,1,0]',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '{}',
  start_date TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  cycle TEXT NOT NULL DEFAULT 'month',
  cycle_days INTEGER,
  amount_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'CNY',
  reminder_offsets TEXT NOT NULL DEFAULT '[7,3,1,0]',
  channel_ids TEXT NOT NULL DEFAULT '[]',
  linked_monitor_ids TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  paused INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_expiry ON subscriptions(expiry_date);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(archived, paused, expiry_date);

CREATE TABLE IF NOT EXISTS renewals (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  amount_cents INTEGER,
  currency TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_renewals_subscription ON renewals(subscription_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscription_reminders (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  expiry_date TEXT NOT NULL,
  offset_days INTEGER NOT NULL,
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'suppressed')),
  notification_id TEXT,
  sent_at TEXT,
  UNIQUE (subscription_id, expiry_date, offset_days)
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON subscription_reminders(status, scheduled_for);

CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('http', 'push')),
  config TEXT NOT NULL,
  interval_seconds INTEGER NOT NULL DEFAULT 300,
  failure_threshold INTEGER NOT NULL DEFAULT 2,
  stale_after_seconds INTEGER NOT NULL DEFAULT 3600,
  channel_ids TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_status TEXT NOT NULL DEFAULT 'unknown',
  last_metrics TEXT NOT NULL DEFAULT '{}',
  last_checked_at TEXT,
  last_error TEXT,
  last_notified_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT,
  push_token_hash TEXT,
  push_token_prefix TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_monitors_due ON monitors(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_monitors_push_token ON monitors(push_token_hash);

CREATE TABLE IF NOT EXISTS monitor_rules (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  operator TEXT NOT NULL,
  warning_value REAL,
  critical_value REAL,
  duration_checks INTEGER NOT NULL DEFAULT 1,
  cooldown_seconds INTEGER NOT NULL DEFAULT 3600,
  repeat_interval_seconds INTEGER NOT NULL DEFAULT 0,
  recovery_operator TEXT,
  recovery_value REAL,
  recovery_checks INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rules_monitor ON monitor_rules(monitor_id);

CREATE TABLE IF NOT EXISTS monitor_runs (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  duration_ms INTEGER NOT NULL,
  metrics TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  trigger_kind TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_monitor_time ON monitor_runs(monitor_id, started_at DESC);

CREATE TABLE IF NOT EXISTS alert_states (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ok',
  severity TEXT,
  value REAL,
  breach_count INTEGER NOT NULL DEFAULT 0,
  since TEXT NOT NULL,
  last_notified_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (monitor_id, kind, rule_id)
);
CREATE INDEX IF NOT EXISTS idx_alert_states_firing ON alert_states(state);

CREATE TABLE IF NOT EXISTS notification_queue (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL,
  channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped_no_channel')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE (event_key, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notification_queue(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notification_queue(created_at DESC);
`,
  },
  {
    version: 2,
    name: 'simplify_subscriptions',
    sql: `
-- The subscription model is reduced to one simple reminder template: a name, an
-- optional link, an expiry date, a renewal cycle, reminder offsets and channels.
-- Custom template fields, start dates, money tracking, linked monitors and the
-- archive state are dropped. Existing rows are migrated losslessly where possible.

ALTER TABLE subscriptions RENAME TO subscriptions_v1_legacy;
ALTER TABLE renewals RENAME TO renewals_v1_legacy;
ALTER TABLE subscription_reminders RENAME TO subscription_reminders_v1_legacy;

-- Index names are global in SQLite and stay attached to the renamed legacy
-- tables, so free them before creating the new schema's indexes.
DROP INDEX IF EXISTS idx_subscriptions_expiry;
DROP INDEX IF EXISTS idx_subscriptions_status;
DROP INDEX IF EXISTS idx_renewals_subscription;
DROP INDEX IF EXISTS idx_reminders_due;

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT,
  expiry_date TEXT NOT NULL,
  cycle TEXT NOT NULL DEFAULT 'month',
  reminder_offsets TEXT NOT NULL DEFAULT '[7,3,1,0]',
  channel_ids TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_subscriptions_expiry ON subscriptions(expiry_date);
CREATE INDEX idx_subscriptions_status ON subscriptions(paused, expiry_date);

CREATE TABLE renewals (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_renewals_subscription ON renewals(subscription_id, created_at DESC);

CREATE TABLE subscription_reminders (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  expiry_date TEXT NOT NULL,
  offset_days INTEGER NOT NULL,
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'suppressed')),
  notification_id TEXT,
  sent_at TEXT,
  UNIQUE (subscription_id, expiry_date, offset_days)
);
CREATE INDEX idx_reminders_due ON subscription_reminders(status, scheduled_for);

INSERT INTO subscriptions (id, name, url, expiry_date, cycle, reminder_offsets, channel_ids, notes, paused, created_at, updated_at)
SELECT
  id,
  name,
  COALESCE(
    json_extract(fields, '$.renewUrl'),
    json_extract(fields, '$.consoleUrl'),
    json_extract(fields, '$.billingUrl'),
    json_extract(fields, '$.manageUrl'),
    json_extract(fields, '$.profileUrl'),
    json_extract(fields, '$.webUrl')
  ),
  expiry_date,
  CASE WHEN cycle IN ('day', 'week', 'month', 'quarter', 'year') THEN cycle ELSE 'month' END,
  reminder_offsets,
  channel_ids,
  notes,
  paused,
  created_at,
  updated_at
FROM subscriptions_v1_legacy;

INSERT INTO renewals (id, subscription_id, from_date, to_date, created_at)
SELECT id, subscription_id, from_date, to_date, created_at FROM renewals_v1_legacy;

INSERT INTO subscription_reminders (id, subscription_id, expiry_date, offset_days, scheduled_for, status, notification_id, sent_at)
SELECT id, subscription_id, expiry_date, offset_days, scheduled_for, status, notification_id, sent_at
FROM subscription_reminders_v1_legacy;

DROP TABLE subscription_reminders_v1_legacy;
DROP TABLE renewals_v1_legacy;
DROP TABLE subscriptions_v1_legacy;
DROP TABLE templates;
`,
  },
  {
    version: 3,
    name: 'subscription_expiry_time',
    sql: `
-- Expiry becomes minute-precise. The calendar date stays in expiry_date so the
-- existing indexes, reminder unique key and renewal history keep working; the
-- time of day is a separate local wall-clock column. Existing rows keep the old
-- "expires at the end of the day" semantics.
ALTER TABLE subscriptions ADD COLUMN expiry_time TEXT NOT NULL DEFAULT '23:59';
`,
  },
  {
    version: 4,
    name: 'user_templates',
    sql: `
-- User-defined templates: reusable blueprints for creating subscriptions and
-- monitors. v2 removed the old built-in template catalogue; these templates are
-- purely user-authored, carry typed parameter definitions and a payload with
-- {{placeholders}}. Nothing is seeded here.
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('subscription', 'monitor')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '[]',
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_templates_kind ON templates(kind, name);

-- Subscription field values are encrypted JSON; field_defs is the definition
-- snapshot taken from the template at creation time so deleting or editing the
-- template never breaks existing subscriptions. template_name is a snapshot too.
ALTER TABLE subscriptions ADD COLUMN template_id TEXT REFERENCES templates(id) ON DELETE SET NULL;
ALTER TABLE subscriptions ADD COLUMN template_name TEXT;
ALTER TABLE subscriptions ADD COLUMN field_defs TEXT NOT NULL DEFAULT '[]';
ALTER TABLE subscriptions ADD COLUMN fields TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_subscriptions_template ON subscriptions(template_id);

-- Monitors keep only the provenance of the template that produced them.
ALTER TABLE monitors ADD COLUMN template_id TEXT REFERENCES templates(id) ON DELETE SET NULL;
ALTER TABLE monitors ADD COLUMN template_name TEXT;
CREATE INDEX idx_monitors_template ON monitors(template_id);
`,
  },
  {
    version: 5,
    name: 'template_sources',
    sql: `
-- Template repositories: a git repository of subscription/monitor templates
-- that SubWatch clones and installs. Each installed template carries the
-- source id and its file path inside the repository, which is the stable key
-- used to update or prune it across syncs. source_id NULL means the template
-- was authored locally rather than pulled from a repository.
CREATE TABLE template_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  last_commit TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_template_sources_url ON template_sources(url, branch);

ALTER TABLE templates ADD COLUMN source_id TEXT REFERENCES template_sources(id) ON DELETE SET NULL;
ALTER TABLE templates ADD COLUMN source_path TEXT;
ALTER TABLE templates ADD COLUMN source_revision TEXT;
CREATE UNIQUE INDEX idx_templates_source_path ON templates(source_id, source_path);
CREATE INDEX idx_templates_source ON templates(source_id);
`,
  },
  {
    version: 6,
    name: 'template_version',
    sql: `
-- Templates may declare an optional author version (e.g. a semver string).
-- Empty string means "no version declared". Used for display in the template
-- library and in a repository's preview catalogue.
ALTER TABLE templates ADD COLUMN version TEXT NOT NULL DEFAULT '';
`,
  },
];
