# SubWatch API 参考

Base URL：`http://<主机>:<端口>`（默认 `http://localhost:8080`）。
所有接口返回 JSON；请求体上限 2 MB；API 不提供 CORS，供同源 WebUI 或服务端脚本调用。

## 认证与请求约定

### 公开接口（无需登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查：`{ok, version, uptimeSeconds}` |
| GET | `/api/meta` | 实例元信息：`{version, locale, timezone, appName, baseUrl, setupRequired}` |
| GET | `/api/auth/status` | 未登录也可调用：`{setupRequired, authenticated}` |
| POST | `/api/auth/setup` | 首次初始化管理员密码（已初始化则 409） |
| POST | `/api/auth/login` | 登录，返回会话 Cookie |
| POST | `/api/push/:token` | Push 监控上报（Token 在路径里，见 [监控 API](#push-上报-api)） |

其余 `/api/*` 都需要登录会话。

### 登录与 Cookie

- 会话 Cookie 名：`subwatch_session`；`HttpOnly` + `SameSite=Lax`；有效期 **7 天**；HTTPS 下带 `Secure`。
- 修改密码会使**全部会话失效**。
- 脚本登录示例（后续请求用同一 cookie jar）：

```bash
BASE=http://localhost:8080
curl -s -c cookies.txt \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: subwatch' \
  -H "Origin: $BASE" \
  -d '{"password":"你的管理员密码"}' \
  "$BASE/api/auth/login"
```

### CSRF 头（重要）

所有**非 GET/HEAD/OPTIONS** 的 `/api/*` 请求（`/api/push/*` 除外）必须：

1. 带请求头 `X-Requested-With: subwatch`；
2. 如果请求带 `Origin`，其 host 必须与 `Host` 一致（`Origin: null` 会被拒绝）。

`GET /api/auth/login` 不存在——登录是 POST，所以登录/登出/改密码同样要带 `X-Requested-With`。

### 限流（按 IP）

| 范围 | 限制 |
|---|---|
| 全局 | 600 次/分钟 |
| `POST /api/auth/login` | 10 次/5 分钟 |
| `POST /api/auth/setup` | 5 次/分钟 |
| `POST /api/monitors/test` | 20 次/分钟 |
| `POST /api/monitors/:id/run` | 30 次/分钟 |
| `POST /api/templates/:id/render` | 60 次/分钟 |
| `POST /api/channels/test`、`POST /api/channels/:id/test` | 20 次/5 分钟 |
| `POST /api/settings/smtp/test` | 10 次/5 分钟 |
| `POST /api/push/:token` | 120 次/分钟 |

超限返回 `429`，错误码 `too_many_requests`。

### 错误格式

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": { "fieldErrors": { "name": ["Required"] } }
  }
}
```

| HTTP | code | 常见原因 |
|---|---|---|
| 400 | `validation_error` | 请求体/查询参数不符合 schema（`details` 为 `error.flatten()`） |
| 400 | `bad_request` | 语义校验失败（如 URL 非法、规则阈值顺序错误） |
| 401 | `unauthorized` | 未登录或会话过期 |
| 403 | `forbidden` | 缺少 `X-Requested-With` / 跨源 |
| 404 | `not_found` | 资源不存在（也用于无效 Push Token） |
| 409 | `conflict` | 续期并发冲突、重复初始化、重复账号状态等 |
| 422 | `unprocessable_entity` | 暂未使用，保留 |
| 429 | `too_many_requests` | 触发限流 |
| 500 | `internal_error` | 服务端异常（不返回堆栈） |

---

## 通用数据结构

### MonitorDto

```json
{
  "id": "5d6f…",
  "name": "示例服务额度",
  "description": "",
  "type": "http",
  "config": { "type": "http", "request": { "...": "..." }, "extract": { "...": "..." } },
  "intervalSeconds": 300,
  "failureThreshold": 2,
  "staleAfterSeconds": 3600,
  "channelIds": [],
  "tags": [],
  "enabled": true,
  "lastStatus": "up",
  "lastMetrics": { "remaining": { "value": 42, "label": "剩余额度", "unit": "%" } },
  "lastCheckedAt": "2026-11-08T03:00:00.000Z",
  "lastError": null,
  "nextRunAt": "2026-11-08T03:05:00.000Z",
  "consecutiveFailures": 0,
  "pushTokenPrefix": null,
  "templateId": null,
  "templateName": null,
  "rules": [ { "...": "RuleDto" } ],
  "createdAt": "2026-11-01T00:00:00.000Z",
  "updatedAt": "2026-11-01T00:00:00.000Z"
}
```

- `type`：`http` | `push`。
- `lastStatus`：`unknown`（从未运行） / `up` / `warning` / `critical` / `down`。
  API 不返回 `paused`；停用的监控用 `enabled=false` 表示（WebUI 会显示为「已暂停」）。
- `pushTokenPrefix`：仅 push 监控有值；**明文 Token 只在创建/轮换时返回一次**。
- `templateId` / `templateName`：创建自用户模板时的来源快照；模板删除后 `templateId` 为 `null`，名称保留。
  仅创建时写入，更新请求中的 `templateId` 被忽略。
- `rules` 的字段见 [RuleDto](#ruledto)。

### RuleDto

| 字段 | 类型/默认 | 说明 |
|---|---|---|
| `id` | string | 规则 id（创建时可省略，服务端生成） |
| `metricKey` | string(1..100) | 要检查的指标 key |
| `label` | string ≤100 | 展示名 |
| `unit` | string ≤20 | 单位（仅展示/通知用） |
| `operator` | `gt` `gte` `lt` `lte` `eq` `neq` | 与阈值的比较方式 |
| `warningValue` / `criticalValue` | number \| null | 至少填一个；critical 必须比 warning 更严重 |
| `durationChecks` | int 1..100，默认 1 | 连续 N 次满足才触发 |
| `cooldownSeconds` | int 0..2592000，默认 3600 | 同一规则两次触发通知的最小间隔 |
| `repeatIntervalSeconds` | int 0..2592000，默认 0 | 持续告警的重复间隔；0 = 只发一次 |
| `recoveryOperator` / `recoveryValue` | 可空，必须成对出现 | 显式恢复条件；不填则回到 ok 即恢复 |
| `recoveryChecks` | int 1..100，默认 1 | 连续 N 次满足恢复条件才恢复 |
| `enabled` | bool，默认 true | 关闭后不评估、不发通知 |

### SubscriptionDto

```json
{
  "id": "a1b2…",
  "name": "VPS 续费",
  "url": "https://console.example.com/renew",
  "expiryDate": "2027-01-09",
  "expiryTime": "18:30",
  "cycle": "month",
  "reminderOffsets": [7, 3, 1, 0],
  "channelIds": [],
  "notes": "",
  "paused": false,
  "status": "active",
  "daysLeft": 62,
  "templateId": null,
  "templateName": null,
  "fieldDefs": [],
  "fields": {},
  "renewals": [ { "id": "…", "subscriptionId": "…", "fromDate": "2026-12-09", "toDate": "2027-01-09", "createdAt": "…" } ],
  "createdAt": "2026-11-01T00:00:00.000Z",
  "updatedAt": "2026-11-01T00:00:00.000Z"
}
```

- `expiryDate` + `expiryTime`：到期日期与到期时间（`HH:mm`，按实例时区解释，精确到分钟）；`expiryTime` 默认 `23:59`，表示当天结束。
- `status`：`active` / `expiring` / `expired` / `paused`；`expired` 从到期时刻（日期 + 时间）那一分钟起算。
- `renewals` 只在 `GET /api/subscriptions/:id` 返回；列表接口不返回。
- `templateId` / `templateName`：创建自用户订阅模板时的来源；模板删除后 `templateId` 为 `null`，名称保留。
- `fieldDefs`：创建时的模板字段定义快照，模板后续修改或删除不影响该快照。
- `fields`：模板参数值。`secret` 类型字段在 API 中固定为 `__SUBWATCH_KEEP__`，数据库中以密文存储。
- `cycle`：`day` / `week` / `month` / `quarter` / `year`。

### ChannelDto

```json
{
  "id": "c3d4…",
  "name": "运维群 Webhook",
  "type": "webhook",
  "enabled": true,
  "config": {
    "url": "https://example.com/hook",
    "method": "POST",
    "headers": [ { "key": "Authorization", "value": "__SUBWATCH_KEEP__", "secret": true } ],
    "contentType": "application/json",
    "bodyTemplate": "",
    "signingSecret": "__SUBWATCH_KEEP__",
    "timeoutMs": 10000
  },
  "createdAt": "…",
  "updatedAt": "…"
}
```

- `type`：`email` | `webhook`。
- 敏感字段（email `password`、webhook `signingSecret`、`secret: true` 的 header 值）出于安全永远不返回明文，
  而是返回哨兵字符串 `__SUBWATCH_KEEP__`；更新时原样传回即表示“保持原值”。详见 [通知与 Webhook 集成](notifications.md)。

### NotificationDto

| 字段 | 说明 |
|---|---|
| `id` | 通知队列行 id |
| `eventType` | 事件类型（见[事件表](notifications.md#事件类型)） |
| `eventKey` | 去重键 |
| `channelId` / `channelName` | 目标频道（为空表示没有可用频道） |
| `status` | `pending` / `sent` / `failed` / `skipped_no_channel` |
| `attempts` | 已尝试次数 |
| `lastError` | 最近一次失败原因（已截断/脱敏） |
| `payload` | 入队时的通知内容快照 |
| `createdAt` / `sentAt` | 时间戳 |

### SettingsDto

```json
{
  "general": {
    "appName": "SubWatch",
    "locale": "zh-CN",
    "timezone": "Asia/Shanghai",
    "reminderTime": "09:00",
    "defaultReminderOffsets": [7, 3, 1, 0],
    "runRetentionDays": 30,
    "notificationRetentionDays": 90,
    "baseUrl": "http://192.168.1.10:8080",
    "defaultChannelIds": [],
    "theme": "system"
  },
  "smtp": null,
  "version": "0.1.0",
  "timezone": "Asia/Shanghai"
}
```

- `smtp` 为掩码后的配置（`passwordSet: boolean`），未配置时为 `null`。
- `theme`：`light` / `dark` / `system`。

### 分页响应

`GET /api/monitors/:id/runs`、`GET /api/notifications` 返回：

```json
{ "items": [], "total": 0, "limit": 50, "offset": 0 }
```

---

## 端点总表

| 分组 | 方法 + 路径 | 说明 |
|---|---|---|
| 元信息 | `GET /api/health`、`GET /api/meta` | 公开 |
| 认证 | `GET /api/auth/status`、`POST /api/auth/setup`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`、`POST /api/auth/password` | 见[认证](#认证与请求约定) |
| 监控 | `GET/POST /api/monitors`、`GET/PUT/DELETE /api/monitors/:id`、`POST /api/monitors/:id/run`、`POST /api/monitors/test`、`GET /api/monitors/:id/runs`、`GET /api/monitors/:id/metrics`、`POST /api/monitors/:id/push-token/rotate` | 见[监控 API](#监控-api) |
| Push | `POST /api/push/:token` | 公开（Token 鉴权） |
| 订阅 | `GET/POST /api/subscriptions`、`GET/PUT/DELETE /api/subscriptions/:id`、`POST /api/subscriptions/:id/renew`、`POST /api/subscriptions/:id/pause`、`POST /api/subscriptions/:id/resume`、`POST /api/subscriptions/:id/test-reminder` | 见[订阅 API](#订阅-api) |
| 模板 | `GET/POST /api/templates`、`GET/PUT/DELETE /api/templates/:id`、`POST /api/templates/:id/render`、`GET /api/templates/:id/export`、`POST /api/templates/import` | 见[模板 API](#模板-api) |
| 通知渠道 | `GET/POST /api/channels`、`PUT/DELETE /api/channels/:id`、`POST /api/channels/:id/test`、`POST /api/channels/test` | 见[通知渠道 API](#通知渠道-api) |
| 通知记录 | `GET /api/notifications`、`POST /api/notifications/:id/retry` | 见[通知记录 API](#通知记录-api) |
| 设置 | `GET/PATCH /api/settings`、`POST /api/settings/smtp/test`、`GET /api/settings/version` | 见[设置 API](#设置与元信息-api) |

---

## 监控 API

### 创建监控 `POST /api/monitors`

请求体字段（`monitorInputSchema`）：

| 字段 | 类型/默认 | 说明 |
|---|---|---|
| `name` | string(1..100) 必填 | 名称 |
| `description` | string ≤500，默认 `""` | 描述 |
| `config` | object 必填 | `http` 或 `push` 配置，见[监控编程指南](monitoring.md) |
| `intervalSeconds` | int 30..2678400，默认 300 | HTTP 拉取间隔（秒） |
| `failureThreshold` | int 1..20，默认 2 | 连续失败多少次判定不可用 |
| `staleAfterSeconds` | int 60..2678400，默认 3600 | Push 监控多久没上报判定异常 |
| `channelIds` | string[]（≤100 个） | 通知频道；为空时用设置里的默认频道 |
| `tags` | string[]（≤20 个，每个 ≤50） | 标签 |
| `enabled` | bool，默认 true | 是否启用 |
| `rules` | RuleInput[]（≤50） | 阈值规则 |
| `templateId` | string \| null，可选 | 创建自用户监控模板时传模板 id；服务端校验模板 `kind` 并快照 `templateName` |

响应 `201` + MonitorDto；push 监控的响应会多一个 `pushToken` 字段（明文只出现这一次）。

### 其它监控端点

| 方法与路径 | 说明 |
|---|---|
| `GET /api/monitors` | MonitorDto 数组（不分页） |
| `GET /api/monitors/:id` | 单个 MonitorDto |
| `PUT /api/monitors/:id` | 全量更新（同样的请求体；设置变更后按需重排调度） |
| `DELETE /api/monitors/:id` | 删除；返回 `204` 无正文 |
| `POST /api/monitors/:id/run` | 立即运行一次（仅 HTTP 监控；push 监控返回 400）。响应 `{run, monitor}` |
| `POST /api/monitors/test` | 试运行草稿配置，不落库、不通知。请求体 `{config, rules?}`，响应见下 |
| `GET /api/monitors/:id/runs?limit&offset` | 运行历史，分页（默认 50，最多 500） |
| `GET /api/monitors/:id/metrics?range=24h\|7d\|30d&metric=<key>` | 指标时间序列，最多 500 个点 |
| `POST /api/monitors/:id/push-token/rotate` | 轮换 push Token，响应 `{pushToken, pushTokenPrefix}`；旧 Token 立即失效 |

`POST /api/monitors/test` 响应（`MonitorTestResult`）：

```json
{
  "ok": true,
  "status": "warning",
  "httpStatus": 200,
  "durationMs": 342,
  "metrics": { "remaining": { "value": 12.5, "label": "剩余额度", "unit": "%" } },
  "rawBody": { "data": { "remaining": 12.5 } },
  "rawText": "{\"data\":{\"remaining\":12.5}}",
  "error": null,
  "evaluations": [{ "ruleId": "draft-1", "metricKey": "remaining", "level": "warning", "value": 12.5 }],
  "logs": []
}
```

> 测试接口只做**瞬时**阈值评估，不经过告警状态机（`durationChecks`/`cooldown` 等只在真实调度运行中生效），
> 但可以用于验证请求配置、提取结果和日志。

---

## Push 上报 API

`POST /api/push/:token`（公开，无需 Cookie；`/api/push/*` 不受 CSRF 头限制）。

请求体（`pushPayloadSchema`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | `"up"` \| `"down"`，可选 | `down` 直接判定目标不可用 |
| `metrics` | object，可选 | `{ "<key>": {"value": number\|string\|boolean, "label"?: string, "unit"?: string} }` |
| `message` | string ≤2000，可选 | 附加说明（进入运行记录/错误列） |
| `timestamp` | ISO 8601，可选 | 数据时间戳（仅供参考） |

响应：

```json
{
  "ok": true,
  "status": "up",
  "metrics": { "remaining": { "value": 12.5 } },
  "evaluations": [{ "ruleId": "…", "metricKey": "remaining", "level": "warning", "value": 12.5 }],
  "error": null,
  "receivedAt": "2026-11-08T03:00:00.000Z"
}
```

说明：

- 每次上报都会触发规则状态机并可能发通知（与 HTTP 拉取完全一致）。
- 如果监控配置了启用中的规则，而本次上报缺少数值型指标，该次运行会被记为失败（避免“静默漏报”）。
- 超过 `staleAfterSeconds` 没有上报，会被自动判定为 `down` 并发 `monitor.down`。
- 示例：

```bash
# 每 5 分钟由 cron 上报一次
*/5 * * * * curl -s -X POST "http://subwatch:8080/api/push/<TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{"status":"up","metrics":{"remaining":{"value":42.5,"unit":"%"}},"message":"from cron"}'
```

---

## 订阅 API

### 创建订阅 `POST /api/subscriptions`

| 字段 | 类型/默认 | 说明 |
|---|---|---|
| `name` | string(1..100) 必填 | 名称（如「VPS 续费」「吃药提醒」） |
| `url` | string ≤2000，默认 `""` | 可选，续费/跳转链接；空串存为 `null` |
| `expiryDate` | `YYYY-MM-DD` 必填 | 到期日期 |
| `expiryTime` | `HH:mm`，默认 `23:59` | 到期时间（实例时区，精确到分钟）；`23:59` = 当天结束 |
| `cycle` | `day`/`week`/`month`/`quarter`/`year`，默认 `month` | 点击「续期」时的顺延周期 |
| `reminderOffsets` | int[]（0..3650，≤20 个），默认 `[7,3,1,0]` | 提前多少天提醒；空数组时使用设置里的默认值 |
| `channelIds` | string[]（≤100） | 通知频道；空 = 默认频道 |
| `notes` | string ≤2000，默认 `""` | 备注 |
| `paused` | bool，默认 false | 暂停后不排提醒 |
| `templateId` | string \| null，可选 | 创建自用户订阅模板时传模板 id；服务端校验模板 `kind` 并快照字段定义 |
| `fields` | object，可选 | 模板参数值；带 `templateId` 时按模板字段校验并加密保存，不带模板却传非空 `fields` 返回 `400` |

响应 `201` + SubscriptionDto。

`PUT /api/subscriptions/:id` 是全量更新：`expiryTime` 省略时会重置为默认 `23:59`，客户端应始终回传当前值。模板相关语义：

- `templateId` 创建后不可修改；传入与当前不同的值返回 `400`，省略表示保持。
- `fields` 省略时保留已存参数值；提交时 `secret` 字段传 `__SUBWATCH_KEEP__` 表示保持旧值。
- 无模板的订阅提交非空 `fields` 返回 `400`；`templateName`、`fieldDefs`、`fields` 均为服务端维护的只读快照。

### 其它订阅端点

| 方法与路径 | 说明 |
|---|---|
| `GET /api/subscriptions?search=<kw>` | 列表（按到期日升序；不带 renewals） |
| `GET /api/subscriptions/:id` | 详情（含 `renewals`） |
| `PUT /api/subscriptions/:id` | 全量更新 |
| `DELETE /api/subscriptions/:id` | 删除，响应 `{ok:true}` |
| `POST /api/subscriptions/:id/renew` | 一键续期，见下 |
| `POST /api/subscriptions/:id/pause` / `resume` | 暂停/恢复提醒 |
| `POST /api/subscriptions/:id/test-reminder` | 立即发一条测试提醒，响应 `{ok:true}` |

### 续期 `POST /api/subscriptions/:id/renew`

```json
{ "expectedExpiryDate": "2027-01-09", "date": "2027-02-09" }
```

- `expectedExpiryDate` 必填，用于并发保护：与服务端当前到期日不一致时返回 `409`。
- `date` 可选：不传则由服务端计算 `max(今天, 当前到期日) + cycle`；传了必须晚于当前到期日（否则 `400`）。
- 续期成功会写入一条 `renewals` 记录，并发 `subscription.renewed` 通知。

### 状态与提醒语义

- `status` 推导：`paused` → `expired`（已到/已过到期时刻）→ `expiring`（剩余天数 ≤ max(7, 最大提醒偏移)）→ `active`。
- 到期时刻 = `expiryDate` + `expiryTime`（实例时区，精确到分钟）；到期当天在到期时刻之前仍算 `expiring`。
- 提醒在「到期日 - 提前天数」的当天、按设置里的 `reminderTime`（默认 09:00，实例时区）触发；`expiryTime` 只影响到期状态与展示，不改变提醒的发送时刻。
- 服务停机错过多个提醒时，恢复后只发最紧急的一条，其余标记为已抑制，避免轰炸。
- 修改到期日/暂停会重建该订阅的待发提醒；已发送过的提醒记录不会重复发送。

---

## 模板 API

用户自定义模板用于复用订阅/监控配置。模板定义、占位符规则、完整示例与安全语义见[用户自定义模板](templates.md)。

### 模板摘要与详情

`GET /api/templates?kind=subscription|monitor` 返回摘要列表：

```json
[
  {
    "id": "9c1f…",
    "kind": "subscription",
    "name": "VPS 续费模板",
    "description": "按服务名生成续费提醒",
    "icon": "🖥️",
    "color": "#3366ff",
    "category": "基础设施",
    "fieldCount": 6,
    "usageCount": 2,
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
]
```

- `fieldCount`：字段数量；`usageCount`：当前引用该模板的订阅（订阅模板）或监控（监控模板）数量。
- 不带 `kind` 时返回全部模板，按 `kind`、`name` 排序。

`GET /api/templates/:id` 返回完整 `TemplateDto`：

```json
{
  "id": "9c1f…",
  "kind": "subscription",
  "name": "VPS 续费模板",
  "description": "按服务名生成续费提醒",
  "icon": "🖥️",
  "color": "#3366ff",
  "category": "基础设施",
  "fields": [
    { "key": "service", "label": "服务名", "type": "text", "required": true }
  ],
  "payload": { "name": "{{service}} 续费" },
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

### 端点

| 方法与路径 | 说明 |
|---|---|
| `GET /api/templates?kind=` | 模板摘要列表（见上） |
| `POST /api/templates` | 创建，请求体为 `TemplateInput`，`201` + `TemplateDto` |
| `GET /api/templates/:id` | 模板详情 |
| `PUT /api/templates/:id` | 全量更新；`kind` 不可修改（否则 `400 bad_request`） |
| `DELETE /api/templates/:id` | 删除，`204` 无正文；订阅/监控的模板快照保留 |
| `POST /api/templates/:id/render` | 渲染，见下；限流 60 次/分钟 |
| `GET /api/templates/:id/export` | 导出信封 |
| `POST /api/templates/import` | 导入信封，创建新模板，`201` |

`TemplateInput` 字段：`kind`、`name`、`description`、`icon`、`color`、`category`、`fields`、`payload`。
`POST /api/templates` 不校验渲染后的目标实体 schema，渲染校验发生在 `render` 接口。

### 渲染 `POST /api/templates/:id/render`

请求体：

```json
{
  "values": {
    "service": "vps",
    "seats": "7",
    "extra": "{\"region\":\"cn\"}"
  }
}
```

- `values` 可省略（等同 `{}`）；按模板字段做类型转换、默认值补齐、必填与约束校验。
- `number` 接受数字字符串，`switch` 接受布尔值或 `"true"`/`"false"`，`json` 接受 JSON 字符串或已解析值。

响应 `200`：

```json
{
  "kind": "subscription",
  "values": { "service": "vps", "seats": 7, "extra": { "region": "cn" } },
  "payload": {
    "name": "vps 续费",
    "notes": "account=bob, plan=yearly, seats=7"
  }
}
```

- `values` 为类型化后的参数值（含默认值）。
- `payload` 为通过目标 schema 校验的草稿：订阅模板为 `SubscriptionInput` 的子集，监控模板为完整 `MonitorInput`（不含 `templateId`）。
- 监控模板中的 `secret` 参数会以明文出现在渲染结果中，仅通过本登录接口返回。

错误：

| HTTP | `code` | 说明 |
|---|---|---|
| 400 | `bad_request` | 参数校验失败，`details.fieldErrors` 为 `{字段: [消息]}`；渲染后 payload 不合法时 `details.issues` 为 `error.flatten()` |
| 404 | `not_found` | 模板不存在 |
| 429 | `too_many_requests` | 超过 60 次/分钟 |

### 导出 `GET /api/templates/:id/export`

```json
{
  "format": "subwatch-template",
  "version": 1,
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "template": {
    "kind": "subscription",
    "name": "VPS 续费模板",
    "description": "",
    "icon": "🖥️",
    "color": "#3366ff",
    "category": "基础设施",
    "fields": [],
    "payload": {}
  }
}
```

### 导入 `POST /api/templates/import`

请求体为上述信封。服务端按 `templateInputSchema` 校验并创建新模板（生成新 `id`），响应 `201` + `TemplateDto`。
`format`、`version` 不匹配或 `template` 非法时返回 `400 validation_error`；`exportedAt` 仅作参考。

---

## 通知渠道 API

### 渠道配置对象

创建/更新（`channelInputSchema`）：

```json
{
  "name": "运维群 Webhook",
  "enabled": true,
  "type": "webhook",
  "config": { "...": "见下" }
}
```

Email 渠道 `config`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `host` / `port` | 必填 / 587 | SMTP 服务器与端口 |
| `secure` | false | 直接使用 TLS（常见 465） |
| `requireTls` | false | 强制 STARTTLS |
| `rejectUnauthorized` | true | 校验证书 |
| `user` / `password` | `""` | 认证信息；密码加密存储、API 掩码 |
| `from` / `fromName` | 必填 / `SubWatch` | 发件地址/名称 |
| `to` | 必填，1..50 个 | 收件人列表 |

Webhook 渠道 `config`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `url` | 必填 | 目标 URL |
| `method` | `POST` | `POST`/`PUT`/`PATCH` |
| `headers` | `[]` | `[{key, value, secret}]`，≤50 个；`secret: true` 的值加密存储并在 API 中掩码 |
| `contentType` | `application/json` | 请求 Content-Type |
| `bodyTemplate` | `""` | 为空时发送默认 JSON 信封，见[通知文档](notifications.md#webhook-请求格式) |
| `signingSecret` | `""` | 配置后附加 HMAC-SHA256 签名头；加密存储 |
| `timeoutMs` | 10000 | 1000..60000 |

### 端点

| 方法与路径 | 说明 |
|---|---|
| `GET /api/channels` | 渠道列表（敏感值掩码为 `__SUBWATCH_KEEP__`） |
| `POST /api/channels` | 创建，`201` + ChannelDto |
| `PUT /api/channels/:id` | 全量更新；配置里传回哨兵表示保留已存密钥 |
| `DELETE /api/channels/:id` | 删除，响应 `{ok:true}` |
| `POST /api/channels/:id/test` | 用**已保存**的配置发送测试消息，响应 `{ok, error}` |
| `POST /api/channels/test` | 用**草稿**配置发送测试消息，不落库 |

草稿测试请求体：

```json
{ "type": "webhook", "config": { "...": "与渠道 config 相同" }, "id": "可选，已存在的渠道 id" }
```

- 传 `id` 时，config 里值为 `__SUBWATCH_KEEP__` 的字段会从已保存的渠道配置里取出真实值再发送
  （用于“编辑已有渠道、不改密码/签名密钥、先测试”的场景）。
- `id` 不存在 → `404`；`id` 与 `type` 不匹配 → `400`。
- 测试发送不写入通知记录；成功条件为 HTTP 2xx / SMTP 投递成功。

---

## 通知记录 API

| 方法与路径 | 说明 |
|---|---|
| `GET /api/notifications?status=&eventType=&limit=&offset=` | 分页查询；`limit` 1..500 默认 50，`offset` ≥0 |
| `POST /api/notifications/:id/retry` | 手动重试；仅 `failed`/`pending` 状态可重试 |

`status` 取值：`pending` / `sent` / `failed` / `skipped_no_channel`。
`eventType` 取值见[通知文档的事件表](notifications.md#事件类型)。

---

## 设置与元信息 API

| 方法与路径 | 说明 |
|---|---|
| `GET /api/meta` | 公开。实例信息（见上） |
| `GET /api/health` | 公开。健康检查 |
| `GET /api/settings` | SettingsDto |
| `PATCH /api/settings` | 部分更新：`{ "general": {...}, "smtp": {...} }`，两段都可选 |
| `POST /api/settings/smtp/test` | 测试 SMTP：`{config?}`（不传用已保存配置；传了用草稿配置，密码可为 `__SUBWATCH_KEEP__`），返回 `{ok,error}` |
| `GET /api/settings/version` | `{version, schemaVersion}` |

`general` 可更新字段：

| 字段 | 取值 | 说明 |
|---|---|---|
| `appName` | 1..100 | 应用名 |
| `locale` | `zh-CN` / `en` | 实例语言 |
| `timezone` | IANA 时区 | 日期与提醒时区 |
| `reminderTime` | `HH:mm` | 每日提醒时刻 |
| `defaultReminderOffsets` | int[]（同订阅） | 新订阅的默认提前提醒天数 |
| `runRetentionDays` | 1..3650，默认 30 | 监控运行历史保留天数 |
| `notificationRetentionDays` | 1..3650，默认 90 | 通知记录保留天数 |
| `baseUrl` | 空或 http(s) URL | 通知深链使用；留空自动记录首次登录地址 |
| `defaultChannelIds` | string[] | 未显式选择频道时使用的默认频道 |
| `theme` | `light` / `dark` / `system` | 默认主题 |

`smtp` 可更新字段：`host`、`port`、`secure`、`requireTls`、`rejectUnauthorized`、`user`、`password`、`from`、`fromName`、`to`（均可选；密码可为 `__SUBWATCH_KEEP__`）。

---

## 枚举值速查

| 枚举 | 取值 |
|---|---|
| Monitor `type` | `http`、`push` |
| Monitor `lastStatus` | `unknown`、`up`、`warning`、`critical`、`down`、`paused` |
| Monitor `config.extract.mode` | `json`、`javascript` |
| 比较符 `operator` | `gt`、`gte`、`lt`、`lte`、`eq`、`neq` |
| HTTP `method` | `GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD` |
| HTTP `bodyType` | `none`、`json`、`raw`、`form` |
| HTTP `auth.type` | `none`、`basic`、`bearer` |
| Subscription `status` | `active`、`expiring`、`expired`、`paused` |
| Subscription `cycle` | `day`、`week`、`month`、`quarter`、`year` |
| Channel `type` | `email`、`webhook` |
| Webhook `method` | `POST`、`PUT`、`PATCH` |
| Notification `status` | `pending`、`sent`、`failed`、`skipped_no_channel` |
| 通知事件 `eventType` | 见[事件表](notifications.md#事件类型) |
| 模板 `kind` | `subscription`、`monitor` |
| 模板字段 `type` | `text`、`textarea`、`url`、`number`、`date`、`time`、`select`、`switch`、`secret`、`json` |
| 模板导出 `format` | `subwatch-template`（`version` 固定为 `1`） |
| 敏感值哨兵 | `__SUBWATCH_KEEP__` |
