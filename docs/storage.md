# 数据与档案结构

SubWatch 是单进程 + SQLite，所有运行数据都在 `DATA_DIR`（默认 `./data`）里。

## 数据目录

```
data/
├── subwatch.db            # SQLite 主库（WAL 模式，运行时还会出现 -wal / -shm）
├── .secret-key            # AES-256-GCM 主密钥，权限 0600
├── .lock                  # 进程锁（防止同一数据目录被多个实例使用）
└── backups/
    └── pre-migration-v<版本>-<时间>.db   # 自动迁移前快照（最多保留 5 份）
```

- **备份必须包含整个 `data/`，尤其是 `.secret-key`**；否则 SMTP 密码、Webhook 签名密钥、监控加密 Header、Push Token 等无法解密。
- 恢复时停服务后整体替换 `data/` 即可，注意保持目录权限。
- SQLite 开启 `WAL`、`foreign_keys=ON`、`busy_timeout=5000`、`synchronous=NORMAL`。

## SQLite 表结构（当前版本）

> 迁移版本记录在 `schema_migrations`。表结构可能随版本继续演进；自动化请优先用 API，不建议直接依赖列名写库。

### settings

全局设置键值表。

| 列 | 说明 |
|---|---|
| `key` | 主键，如 `general`、`smtp`、`admin_password_hash` |
| `value` | JSON 或字符串；`general`/`smtp` 为 JSON（smtp 加密） |
| `updated_at` | 时间戳 |

### sessions

登录会话。

| 列 | 说明 |
|---|---|
| `id` | 主键 |
| `token_hash` | 会话 Token 的哈希（唯一） |
| `created_at` / `expires_at` | 创建/过期时间（7 天） |
| `user_agent` / `ip` | 登录来源 |

### channels

通知渠道（邮件/Webhook）。

| 列 | 说明 |
|---|---|
| `id` | 主键 |
| `name` | 名称 |
| `type` | `email` / `webhook` |
| `config` | 加密后的 JSON 配置 |
| `enabled` | 0/1 |
| `created_at` / `updated_at` | 时间戳 |

### templates

用户自定义模板（v4；v5 增加模板仓库来源列；v6 增加版本列）。模板是订阅/监控的创建蓝图，本身不产生业务实体。

| 列 | 说明 |
|---|---|
| `id` | 主键 |
| `kind` | `subscription` / `monitor` |
| `name` / `description` / `icon` / `color` / `category` | 展示信息 |
| `version` | 可选作者版本号，空字符串表示未声明 |
| `fields` | `TemplateField[]` JSON，参数定义 |
| `payload` | 渲染草稿 JSON，可含 `{{参数}}` 占位符 |
| `source_id` | 来源模板仓库，`NULL` 表示本地创建 |
| `source_path` | 仓库内相对路径，来源为仓库时非空 |
| `source_revision` | 上次同步的 commit |
| `created_at` / `updated_at` | 时间戳 |

索引：`(kind, name)`、`(source_id, source_path)` 唯一、`(source_id)`。

### template_sources

模板仓库（v5）。记录可拉取模板的 git 仓库与上次同步状态。

| 列 | 说明 |
|---|---|
| `id` | 主键 |
| `name` / `url` / `branch` | 展示名、git 地址、分支 |
| `enabled` | 是否启用 |
| `last_synced_at` | 上次同步时间 |
| `last_commit` | 上次同步的 commit |
| `last_error` | 上次同步错误（凭据已脱敏） |
| `created_at` / `updated_at` | 时间戳 |

索引：`(url, branch)` 唯一。

### subscriptions

订阅/提醒（v2 精简 + v3 到期时间 + v4 模板快照）。

| 列 | 说明 |
|---|---|
| `id` | 主键 |
| `name` | 名称 |
| `url` | 可选续费/跳转链接 |
| `expiry_date` | 到期日期 `YYYY-MM-DD` |
| `expiry_time` | 到期时间 `HH:mm`（实例时区，默认 `23:59`） |
| `cycle` | 续期周期 `day/week/month/quarter/year` |
| `reminder_offsets` | JSON 数组，提前提醒天数 |
| `channel_ids` | JSON 数组 |
| `notes` | 备注 |
| `paused` | 0/1 |
| `template_id` | 创建来源模板，外键 → `templates`；模板删除时置 `NULL` |
| `template_name` | 创建时的模板名快照（模板删除后仍保留） |
| `field_defs` | 模板字段定义快照 JSON，默认 `[]` |
| `fields` | 整体加密的模板参数值 JSON 密文，默认空串 |
| `created_at` / `updated_at` | 时间戳 |

索引：`expiry_date`；`(paused, expiry_date)`；`template_id`。到期状态由 `expiry_date` + `expiry_time` 计算。
`fields` 解密后含完整参数值，但 API 只返回 `secret` 字段的掩码 `__SUBWATCH_KEEP__`；`field_defs` 与 `template_name` 只在创建时快照，模板后续修改或删除都不影响已存订阅。

### renewals

续期历史（一键续期写入）。

| 列 | 说明 |
|---|---|
| `id` | 主键 |
| `subscription_id` | 外键 → subscriptions，级联删除 |
| `from_date` / `to_date` | 原/新到期日 |
| `created_at` | 续期时间 |

### subscription_reminders

待发/已发提醒计划。

| 列 | 说明 |
|---|---|
| `id` | 主键 |
| `subscription_id` | 外键，级联删除 |
| `expiry_date` | 该批提醒对应的到期日 |
| `offset_days` | 提前天数 |
| `scheduled_for` | 绝对 UTC 触发时间 |
| `status` | `pending` / `sent` / `suppressed` |
| `notification_id` / `sent_at` | 关联通知与发送时间 |

唯一键：`(subscription_id, expiry_date, offset_days)` —— 保证同一提醒只发一次。

### monitors

监控（HTTP / Push）。

| 列 | 说明 |
|---|---|
| `id` | 主键 |
| `name` / `description` | 名称/描述 |
| `type` | `http` / `push` |
| `config` | 监控配置 JSON（请求/提取器），字段见 [监控指南](monitoring.md) |
| `interval_seconds` | 检查间隔（秒） |
| `failure_threshold` | 连续失败阈值 |
| `stale_after_seconds` | Push 超时阈值 |
| `channel_ids` / `tags` | JSON 数组 |
| `enabled` | 0/1 |
| `last_status` | `unknown/up/warning/critical/down` |
| `last_metrics` | 最近一次指标 JSON |
| `last_checked_at` / `last_error` | 最近运行时间/错误 |
| `last_notified_at` | 最近通知时间 |
| `consecutive_failures` | 连续失败次数 |
| `next_run_at` | 下次计划运行时间（HTTP） |
| `push_token_hash` / `push_token_prefix` | Push Token 哈希/展示前缀 |
| `template_id` | 创建来源模板，外键 → `templates`；模板删除时置 `NULL` |
| `template_name` | 创建时的模板名快照（仅用于展示） |
| `created_at` / `updated_at` | 时间戳 |

索引：`(enabled, next_run_at)`、`push_token_hash`、`template_id`。模板参数不单独存储，渲染结果即 `config`。

### monitor_rules

阈值规则。

| 列 | 说明 |
|---|---|
| `id` | 主键 |
| `monitor_id` | 外键，级联删除 |
| `metric_key` / `label` / `unit` | 指标与展示 |
| `operator` | 比较符 |
| `warning_value` / `critical_value` | 阈值（可空） |
| `duration_checks` / `cooldown_seconds` / `repeat_interval_seconds` | 状态机参数 |
| `recovery_operator` / `recovery_value` / `recovery_checks` | 恢复条件 |
| `enabled` | 0/1 |
| `created_at` / `updated_at` | 时间戳 |

### monitor_runs

运行历史（默认保留 30 天，自动清理）。

| 列 | 说明 |
|---|---|
| `id` / `monitor_id` | 主键 / 外键 |
| `started_at` / `finished_at` | 起止时间 |
| `ok` | 本次运行是否成功（提取器/传输层） |
| `status` | 该次运行后的监控状态 |
| `http_status` / `duration_ms` | HTTP 状态码/耗时 |
| `metrics` | 提取到的指标 JSON |
| `error` | 错误信息 |
| `trigger_kind` | `schedule` / `manual` / `test` / `push` |

索引：`(monitor_id, started_at DESC)`。

### alert_states

告警状态机持久化（每个 monitor + 规则/可用性一行），用于跨重启去重与恢复判定。

| 列 | 说明 |
|---|---|
| `id` / `monitor_id` | 主键 / 外键 |
| `rule_id` | 规则 id；可用性规则固定为 `availability` |
| `kind` | `metric` / `availability` |
| `state` | `ok` / `warning` / `critical` |
| `severity` | `warning` / `critical` / `down` / null |
| `value` / `breach_count` | 最近值/连续次数 |
| `since` / `last_notified_at` | 状态开始/最近通知时间 |
| `updated_at` | 时间戳 |

唯一键：`(monitor_id, kind, rule_id)`。

### notification_queue

持久化通知队列。

| 列 | 说明 |
|---|---|
| `id` | 主键 |
| `event_type` | 事件类型（见[事件表](notifications.md#事件类型)） |
| `event_key` | 去重键 |
| `channel_id` | 外键 → channels（删除渠道后为 NULL） |
| `payload` | 通知内容 JSON（title/message/severity/data/appUrl） |
| `status` | `pending` / `sent` / `failed` / `skipped_no_channel` |
| `attempts` / `next_attempt_at` | 重试次数/下次尝试时间 |
| `last_error` | 最近错误 |
| `created_at` / `sent_at` | 时间戳 |

唯一键：`(event_key, channel_id)` —— 同一事件同一频道只入队一次。

### schema_migrations

| 列 | 说明 |
|---|---|
| `version` | 迁移版本（主键） |
| `name` | 迁移名称 |
| `applied_at` | 应用时间 |

## 迁移与升级

- 启动时自动执行未应用的迁移；执行前会先复制一份数据库到 `data/backups/`（最多保留 5 份）。
- 升级：拉代码 → `pnpm install && pnpm build`（或 `docker compose up -d --build`）→ 重启。
- **不支持降级**；要回退请恢复迁移前备份。
- v2 迁移要点（从旧版升级）：删除 `templates` 表；`subscriptions` 去掉模板/金额/起始日期/归档等列，
  旧模板里的续费链接（`renewUrl`/`consoleUrl`/`billingUrl`/`manageUrl`/`profileUrl`/`webUrl`）会提取为 `url`；
  `custom_days` 周期归一为 `month`；续期历史与提醒历史保留。
- v3 迁移要点：`subscriptions` 增加 `expiry_time`（`HH:mm`，默认 `23:59`）；旧数据保持“当天结束到期”的语义，
  到期状态从按日期判断改为按分钟判断，提醒计划表不变。
- v4 迁移要点：新增用户模板表 `templates`（v2 删除的是旧内置模板目录，二者无数据继承）；`subscriptions` 增加
  `template_id`（外键 → `templates`，`ON DELETE SET NULL`）、`template_name`、`field_defs`、`fields`；
  `monitors` 增加 `template_id`、`template_name`。既有订阅/监控的模板列为空值，不做数据回填。
  删除模板只会清空引用行的 `template_id`，模板名与字段/参数快照保留。
- v5 迁移要点：新增 `template_sources` 表（模板仓库）；`templates` 增加 `source_id`（外键 → `template_sources`，
  `ON DELETE SET NULL`）、`source_path`、`source_revision` 与 `(source_id, source_path)` 唯一索引。
  既有模板的来源列为空，视为本地模板，不做数据回填。删除仓库会移除其托管模板，订阅/监控的模板快照按既有语义保留。
- v6 迁移要点：`templates` 增加 `version`（`TEXT NOT NULL DEFAULT ''`），用于展示模板版本；既有模板为空串。

## 运维提示

- 数据量很小：普通家庭/小团队实例通常只有几 MB。长期运行主要增长的是 `monitor_runs` 与 `notification_queue`，
  两者都有保留期自动清理。
- 想外部备份：定期复制整个 `data/` 目录即可；WAL 模式下建议先停服务或使用 SQLite 在线备份命令。
- 忘记管理员密码：停服务后删除 `settings` 表中 `admin_password_hash` 行（或恢复备份），重启进入初始化流程；
  操作前务必备份 `data/`。
