# 通知与 Webhook 集成

SubWatch 通过「通知渠道」把提醒发出去。渠道分两种：`email`（SMTP）和 `webhook`（HTTP 回调）。
接口字段与端点见 [API 参考](api.md#通知渠道-api)。

## 渠道配置

### 邮件（SMTP）

```json
{
  "name": "运维邮件",
  "type": "email",
  "enabled": true,
  "config": {
    "host": "smtp.example.com",
    "port": 587,
    "secure": false,
    "requireTls": true,
    "rejectUnauthorized": true,
    "user": "bot@example.com",
    "password": "授权码",
    "from": "bot@example.com",
    "fromName": "SubWatch",
    "to": ["ops@example.com"]
  }
}
```

- `secure: true` 直接使用 TLS（常见 465）；`requireTls: true` 表示强制 STARTTLS（常见 587）。
- 密码加密存储；API 只返回掩码。
- 「设置 → SMTP」里也有一份全局 SMTP 配置，与通知渠道里的邮件渠道相互独立（两者都能用来发邮件）。

### Webhook

```json
{
  "name": "自建通知服务",
  "type": "webhook",
  "enabled": true,
  "config": {
    "url": "https://example.com/subwatch-hook",
    "method": "POST",
    "headers": [{ "key": "Authorization", "value": "Bearer xxx", "secret": true }],
    "contentType": "application/json",
    "bodyTemplate": "",
    "signingSecret": "your-hmac-secret",
    "timeoutMs": 10000
  }
}
```

- `bodyTemplate` 为空时发送默认 JSON 信封（见下）；非空时按模板渲染。
- `signingSecret` 非空时，每个请求会附带 `X-SubWatch-Signature`。
- 超时 1..60 秒；非 2xx 视为失败（错误信息会带上响应片段）。

## 发送测试消息

两种方式，都不会写入通知记录、不会保存配置：

| 场景 | 接口 / 界面 |
|---|---|
| 草稿配置（还没保存） | `POST /api/channels/test`，body `{type, config, id?}`；界面「通知渠道 → 新建/编辑 → 测试发送」 |
| 已保存的渠道 | `POST /api/channels/:id/test`；渠道卡片上的「测试已保存的配置」 |
| 设置页 SMTP | `POST /api/settings/smtp/test`，可选 `{config}`；界面「设置 → SMTP → 发送测试邮件」 |

编辑已有渠道时，草稿里未修改的密码/签名密钥/加密 Header 仍是 `__SUBWATCH_KEEP__` 哨兵；
测试时把渠道 `id` 一并传入，服务端会从存储中取出真实密钥再发送。

## Webhook 请求格式

### 默认 JSON 信封

```http
POST /your-hook HTTP/1.1
Content-Type: application/json
User-Agent: SubWatch/0.1.0
X-SubWatch-Signature: sha256=<hex>

{
  "source": "subwatch",
  "event": "subscription.expiring",
  "title": "订阅即将到期：VPS 续费",
  "message": "还有 3 天到期（2026-11-11）",
  "severity": "warning",
  "timestamp": "2026-11-08T03:00:00.000Z",
  "data": {
    "subscriptionId": "...",
    "expiryDate": "2026-11-11",
    "daysLeft": 3,
    "offsetDays": 3
  },
  "appUrl": "http://192.168.1.10:8080/subscriptions/..."
}
```

- `severity`：`info` / `success` / `warning` / `critical`。
- `appUrl` 指向详情页，便于通知里带跳转链接。
- 等待响应：2xx 视为成功；否则按失败重试。

### 模板模式

`bodyTemplate` 非空时，用 `{{变量}}` 渲染（未知变量原样保留）：

| 变量 | 说明 |
|---|---|
| `{{event}}` | 事件类型，如 `monitor.firing` |
| `{{title}}` / `{{message}}` | 标题 / 正文 |
| `{{severity}}` | 级别 |
| `{{timestamp}}` | ISO 时间 |
| `{{dataJson}}` | 事件 data 的原始 JSON（不转义，用于拼进 JSON） |
| `{{appUrl}}` | 详情页链接 |

- `Content-Type` 含 `json` 时，除 `{{dataJson}}` 外的变量会被 **JSON 字符串转义**，保证拼出来的 Body 仍是合法 JSON。
- 表单/纯文本产线（如 ntfy）按原文替换。

示例（通用 JSON）：

```json
{
  "text": "{{title}}\n{{message}}",
  "level": "{{severity}}",
  "link": "{{appUrl}}"
}
```

示例（AstrBot push_lite）：

```json
{
  "content": "{{title}}\n{{message}}",
  "umo": "<UMO，用 /sid 查看>",
  "message_type": "text"
}
```

### HMAC 签名

配置 `signingSecret` 后：

```
X-SubWatch-Signature: sha256=<hex(HMAC-SHA256(secret, 原始请求体))>
```

校验示例（Node.js）：

```js
import crypto from 'node:crypto';

function verify(rawBody /* string */, signature /* header value */, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature ?? '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

校验示例（Python）：

```python
import hmac, hashlib, base64

def verify(raw_body: bytes, signature: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")
```

> 校验必须使用**原始请求体字节**，不要先 `JSON.parse` 再序列化。

### 发送行为与重试

- 通知先写入持久化队列，后台每 30 秒批量发送（每次最多 20 条）。
- 失败按 **1m / 5m / 15m / 1h / 6h** 退避重试，最多 6 次；第 6 次失败后标记 `failed`，可在通知记录页手动重试。
- 去重键为 `(event_key, channel_id)`：相同事件同一频道只入队一次，服务重启不会重复发送。
- 没有可用频道时会记录一条 `skipped_no_channel`，不会报错中断调度。
- 通知记录保留 90 天（可在设置中改），监控运行历史默认保留 30 天。

## 事件类型

| eventType | 触发时机 | `data` 中常用字段 |
|---|---|---|
| `monitor.firing` | 指标阈值触发/升级/重复 | `monitorId`, `monitorName`, `ruleId`, `metricKey`, `metricLabel`, `value`, `unit`, `state`, `severity`, `since`, `repeat` |
| `monitor.resolved` | 指标告警恢复 | `monitorId`, `monitorName`, `ruleId`, `metricKey`, `metricLabel`, `value`, `unit`, `state`, `severity` |
| `monitor.down` | 连续失败达到阈值 / Push 超时 | `monitorId`, `monitorName`, `state`, `severity`, `status`, `consecutiveFailures`, `failureThreshold`, `error`, `since` |
| `monitor.recovered` | 监控恢复 | `monitorId`, `monitorName`, `state`, `severity`, `status` |
| `monitor.test` | 预留（当前 WebUI 的「试运行」不发送通知） | — |
| `subscription.expiring` | 到期前提前提醒 | `subscriptionId`, `expiryDate`, `daysLeft`, `offsetDays` |
| `subscription.expired` | 已过期 | `subscriptionId`, `expiryDate`, `daysLeft`, `offsetDays` |
| `subscription.renewed` | 续期成功 | `subscriptionId`, `fromDate`, `toDate`, `expiryDate` |
| `subscription.test` | 手动「测试提醒」 | `subscriptionId`, `expiryDate`, `daysLeft` |
| `channel.test` | 渠道/ SMTP 测试发送 | 无（或测试标识） |

## 内置 Webhook 预设

WebUI 的 Webhook 渠道里有「预设」下拉框，选中后自动填充方法/Content-Type/Header/Body 模板，
你只需替换 URL 与占位符：

| 预设 | 说明 |
|---|---|
| 通用 JSON | 默认信封，适合自建接收端 |
| Discord / Slack / Telegram | 常见 IM 的 Incoming Webhook 文本格式 |
| 企业微信 / 钉钉 / 飞书 | 群机器人文本格式 |
| Bark / ntfy | 手机推送 |
| AstrBot push_lite | `POST /send` + `Authorization: Bearer <token>`，Body 为 `{content, umo, message_type}`；插件见 <https://github.com/Raven95676/astrbot_plugin_push_lite>（默认端口 9966，`umo` 用 `/sid` 查看） |

预设只是 UI 侧的模板，最终都等价于上一节的 Webhook 请求格式，可以随意改。

## 通知记录 API

```bash
# 最近 20 条失败的通知
curl -s -b cookies.txt "http://localhost:8080/api/notifications?status=failed&limit=20"

# 手动重试
curl -s -b cookies.txt -X POST -H 'X-Requested-With: subwatch' -H "Origin: http://localhost:8080" \
  "http://localhost:8080/api/notifications/<id>/retry"
```
