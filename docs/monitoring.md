# 自定义监控编程指南

SubWatch 的监控分两种类型，目标都是「取到若干数值指标 → 按阈值规则判断 → 触发通知」：

| 类型 | 数据来源 | 适合 |
|---|---|---|
| `http` | SubWatch 定时请求一个 URL，用 JSON 路径或受限 JS 提取指标 | 服务有 HTTP API（额度、余额、用量、健康检查） |
| `push` | 外部程序/脚本/CI 主动上报指标 | 服务只能用 CLI/数据库/内网接口取数，或取数环境无法被 SubWatch 访问 |

所有接口字段与端点见 [API 参考](api.md#监控-api)；本文只讲“怎么写配置”。

## HTTP 监控配置

`config` 的结构：

```json
{
  "type": "http",
  "request": {
    "url": "https://api.example.com/usage",
    "method": "GET",
    "headers": [{ "key": "Authorization", "value": "Bearer xxx", "secret": true }],
    "timeoutMs": 10000
  },
  "extract": {
    "mode": "json",
    "metrics": [{ "key": "remaining", "label": "剩余额度", "path": "data.remaining", "unit": "%" }]
  }
}
```

### request 字段

| 字段 | 默认 | 说明 |
|---|---|---|
| `url` | 必填 | http(s) URL，≤2000 字符 |
| `method` | `GET` | `GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD` |
| `headers` | `[]` | `[{key,value,secret}]`，≤50 个；`secret:true` 的值加密存储、API 返回掩码 |
| `query` | `[]` | `[{key,value}]`，≤50 个，自动拼到 URL |
| `bodyType` | `none` | `none`/`json`/`raw`/`form` |
| `body` | `""` | 请求体字符串，≤100000 字符 |
| `auth` | `{type:'none'}` | `{type:'basic', username, password}` 或 `{type:'bearer', token}`（与 headers 二选一即可） |
| `timeoutMs` | `10000` | 1000..60000 |
| `followRedirects` | `true` | 是否跟随 3xx |
| `verifyTls` | `true` | 是否校验证书（自签证书可关） |
| `maxResponseBytes` | `1048576` | 响应体上限 1024..5242880 |

### 响应如何判定成功 / 失败

- 只要 TCP/TLS/HTTP 请求完成，**任何 HTTP 状态码都算“成功探测”**（包括 4xx/5xx：状态码会记录在运行历史里）。
- 明确算失败的是：DNS/连接错误、TLS 握手失败、超时、响应体超限。
- 提取器执行失败（JSON 路径不存在、JS 抛错等）也算该次运行失败。
- 连续失败次数达到 `failureThreshold`（默认 2）会触发 `monitor.down`；恢复后触发 `monitor.recovered`。

## 声明式 JSON 提取

`extract.mode = "json"`，`metrics` 为 1..50 个定义：

```json
{
  "mode": "json",
  "metrics": [
    { "key": "remaining", "label": "剩余额度", "unit": "%", "path": "data.usage.remaining" },
    { "key": "used", "label": "已用", "path": "data.usage.used" },
    { "key": "limit", "label": "总量", "path": "data.usage.limit", "scale": 1, "offset": 0 }
  ]
}
```

- `path` 语法：点号分隔 + 数组下标，如 `data.items.0.remaining`、`balance_infos.0.total_balance`；
  也支持 `data.items[0].remaining` 写法。
- 取到的值会被强制转成数字；不是数字则提取失败（有具体错误信息）。
- `scale`/`offset`：最终值 = `原始值 * scale + offset`，可用于单位换算（例如把“分”变“元”）。
- `key` 规则：`^[a-zA-Z_][a-zA-Z0-9_.-]*$`，长度 ≤100；`label` ≤100、`unit` ≤20。
- 响应必须是合法 JSON。如果是 HTML/纯文本，改用 JS 提取器（如 `ctx.text`）。

### 常见示例

DeepSeek 余额（真实接口形态）：

```json
{
  "mode": "json",
  "metrics": [
    { "key": "balance", "label": "账户余额", "unit": "CNY", "path": "balance_infos.0.total_balance" }
  ]
}
```

OpenRouter 额度：

```json
{
  "mode": "json",
  "metrics": [
    { "key": "remaining", "label": "剩余额度", "unit": "USD", "path": "data.credits_remaining" }
  ]
}
```

## JS 表达式提取

`extract.mode = "javascript"`，`code` 为一段函数体（≤20000 字符，同步执行，超时 1 秒）：

- 运行在 `node:vm` 沙箱：**无网络、无文件系统、无 `require`/`process`**，禁用字符串代码生成。
- 可以直接 `return { metrics: ... }`，也可以使用 `ctx.*`。

### 沙箱可用变量

| 名称 | 类型 | 说明 |
|---|---|---|
| `data` / `ctx.data` | any | 解析后的 JSON 响应（非 JSON 时为 `undefined`） |
| `text` / `ctx.text` | string | 原始响应文本 |
| `headers` / `ctx.headers` | object | 响应头（key 小写） |
| `status` / `ctx.status` | number | HTTP 状态码 |
| `durationMs` / `ctx.durationMs` | number | 请求耗时 |
| `now` / `ctx.now` | string | 本次运行的 ISO 时间戳 |
| `get(path)` | any | 按 JSON 路径取值，如 `get(data, 'data.items.0.x')` |
| `num(value, fallback?)` | number | 转数字；失败返回 `NaN` 或 fallback |
| `pct(part, total)` | number | `part/total*100`；total 为 0 时返回 `NaN` |
| `clamp(value, min, max)` | number | 夹取区间 |
| `sum(...values)` / `sum(array)` | number | 求和（忽略非数字） |
| `log(...args)` | void | 记录日志（最多 50 条、每条 2000 字符；**只在测试接口返回**） |

### 返回结构

```js
return {
  // 必填：指标对象；值可以是数字/字符串/布尔，或 { value, label, unit }
  metrics: {
    remaining: { value: 12.5, label: '剩余额度', unit: '%' },
    healthy: true,
  },
  // 可选：'up' | 'down'；返回 down 会直接按“不可用”处理（即使指标正常）
  status: 'up',
  // 可选：附加说明（会进入运行记录/测试结果）
  message: 'ok',
};
```

约束：

- 必须是同步函数，不能返回 Promise。
- 最多 100 个指标；指标 key 规则同上；字符串值 ≤2000 字符。
- 若同时配置了阈值规则，规则引用的指标必须是**数字**，否则该次运行会被判失败（避免静默漏报）。
- 某条规则引用的指标不存在也会判失败。

### 示例：计算剩余百分比

```js
const used = ctx.num(ctx.get(ctx.data, 'usage.used'));
const limit = ctx.num(ctx.get(ctx.data, 'usage.limit'));
const remaining = Number.isFinite(used) && Number.isFinite(limit) && limit > 0
  ? Math.max(0, 100 - (used / limit) * 100)
  : NaN;

ctx.log('used', used, 'limit', limit, 'remaining', remaining);

return {
  metrics: {
    remaining: { value: remaining, label: '剩余额度', unit: '%' },
    used: { value: used, label: '已用', unit: 'GB' },
  },
  status: 'up',
};
```

### 示例：纯文本/HTML 接口

```js
// 例如某个只返回 "OK" / "FAIL" 的健康检查端点
const healthy = ctx.text.trim().toUpperCase() === 'OK';
if (!healthy) ctx.log('unexpected body', ctx.text.slice(0, 200));
return {
  metrics: { available: healthy ? 1 : 0 },
  status: healthy ? 'up' : 'down',
};
```

### 示例：非 2xx 也参与判断

```js
// 有的接口用 401/403 表示“额度耗尽/被封”，可以自行映射
if (ctx.status === 429) {
  return { metrics: { rate_limited: 1 }, status: 'down', message: 'rate limited' };
}
const remaining = ctx.num(ctx.get(ctx.data, 'quota.remaining'));
return { metrics: { remaining: { value: remaining, label: '剩余', unit: '%' } } };
```

## 阈值规则

规则挂在监控的 `rules` 数组里（≤50 条）。字段与默认值见 [RuleDto](api.md#ruledto)。

### 比较与阈值

- `operator`：`gt`（>）、`gte`（≥）、`lt`（<）、`lte`（≤）、`eq`（=）、`neq`（≠）。
- 至少提供 `warningValue` / `criticalValue` 之一。
- 两个都提供时，`criticalValue` 必须比 warning 更“严重”：
  - `gt/gte`：critical ≥ warning；`lt/lte`：critical ≤ warning。
- 判定瞬时值：先看 critical，再看 warning。

### 状态机（真实调度下的行为）

每次运行（HTTP 拉取或 Push 上报）都会推进一次状态机：

1. **ok → 触发**：连续 `durationChecks` 次满足阈值才从 ok 进入 warning/critical，并发 `monitor.firing`。
2. **warning ↔ critical**：等级变化时发新通知（受 `cooldownSeconds` 限制）。
3. **恢复**：
   - 没配 `recoveryOperator/recoveryValue`：值回到阈值内即开始计数，连续 `recoveryChecks` 次后恢复，发 `monitor.resolved`。
   - 配了显式恢复条件：按该条件计数，同样 `recoveryChecks` 次后恢复。
4. **持续告警**：仍在告警且 `repeatIntervalSeconds > 0` 时，按该间隔重复发通知（事件 key 带时间桶，去重）。
5. **冷却**：`cooldownSeconds` 内不会重复发同一规则的通知；恢复通知不受冷却限制。

事件 key 带 `monitorId + ruleId + level + since`，重启服务不会重复推送。

### 可用性规则（内置）

- 连续请求失败（或 JS/JSON 提取失败）达到 `failureThreshold` → `monitor.down`（critical）。
- 恢复 → `monitor.recovered`。
- 两种通知与指标规则的通知一起进入通知队列，按频道分发。

### 监控状态优先级

最终 `lastStatus`：`down` > `critical` > `warning` > `up`；从未运行是 `unknown`。
停用（`enabled=false`）的监控不由 API 返回 `paused`，WebUI 会按停用状态显示为「已暂停」且不参与告警调度。

### 测试与调试

- `POST /api/monitors/test` 用草稿 `{config, rules}` 试运行：返回提取结果、原始响应、规则瞬时评估与 `logs`，
  **不写库、不发通知、不推进状态机**。
- `POST /api/monitors/:id/run` 立即真实运行一次（会写运行历史、推进状态机、可能发通知）。
- 运行历史：`GET /api/monitors/:id/runs`；指标曲线：`GET /api/monitors/:id/metrics?range=24h|7d|30d`。

## Push 监控

1. 创建 `type: "push"` 的监控（`config: {"type":"push"}`），响应里会带一次性 `pushToken`。
2. 外部脚本上报：

```bash
curl -X POST "http://<subwatch>:8080/api/push/<TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "up",
    "metrics": {
      "remaining": { "value": 12.5, "label": "剩余额度", "unit": "%" }
    },
    "message": "from cron"
  }'
```

3. 之后按 `staleAfterSeconds`（默认 3600 秒）检查：超过该时间未上报，自动判 `down` 并通知。
4. 轮换 Token：`POST /api/monitors/:id/push-token/rotate`（旧 Token 立即失效）。
5. Token 在服务端只保存 SHA-256 哈希与展示用前缀；**明文只出现一次**。

注意：

- Push 上报同样会跑阈值规则，所以配置了规则时，每次上报要携带规则所需的数字指标。
- 上报频率建议 ≥ `staleAfterSeconds` 的 1/3，避免网络抖动误报。
- Token 放在 URL 里，若跨公网请务必使用 HTTPS 或内网/隧道。

## 接入配方

### 1. 任意 JSON 接口做额度监控（curl 一键创建）

见 [开发文档首页的 5 分钟示例](README.md)。

### 2. 健康检查（无需 JSON）

```json
{
  "name": "博客健康检查",
  "config": {
    "type": "http",
    "request": { "url": "https://blog.example.com/healthz", "timeoutMs": 5000 },
    "extract": {
      "mode": "javascript",
      "code": "return { metrics: {}, status: (status >= 200 && status < 400) ? 'up' : 'down' };"
    }
  },
  "intervalSeconds": 60,
  "failureThreshold": 3,
  "channelIds": []
}
```

### 3. 需要转单位的接口

```json
{
  "mode": "json",
  "metrics": [
    { "key": "balance", "label": "余额", "unit": "元", "path": "data.balance_cents", "scale": 0.01 }
  ]
}
```

### 4. 只有 CLI 能取数的服务

用 cron + Push（见上）；脚本示例：

```bash
#!/usr/bin/env bash
set -euo pipefail
remaining=$(my-cli quota --json | jq -r '.remaining')
curl -sf -X POST "http://subwatch:8080/api/push/$SUBWATCH_PUSH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"metrics\":{\"remaining\":{\"value\":$remaining,\"unit\":\"%\"}}}"
```

### 5. 多指标 + 双阈值 + 重复提醒

```json
{
  "metricKey": "remaining",
  "label": "剩余额度",
  "unit": "%",
  "operator": "lt",
  "warningValue": 20,
  "criticalValue": 5,
  "durationChecks": 2,
  "cooldownSeconds": 1800,
  "repeatIntervalSeconds": 21600,
  "enabled": true
}
```

含义：连续 2 次低于 20% 发预警、低于 5% 升级严重；同规则 30 分钟内不重复；持续告警每 6 小时重复一次。

## 安全边界

- 自定义 JS 由**管理员**编写并视为受信任代码；`node:vm` 沙箱用于防误操作/限制资源，不是对抗恶意管理员的强隔离。
- 监控请求头里的 `secret: true` 值、Push Token、通知渠道密钥都会加密存储（`data/.secret-key`），备份时必须带上该文件。
- Push 上报端点不需要登录，但需要正确 Token；Token 泄露等价于能让该监控上报任意数据。
