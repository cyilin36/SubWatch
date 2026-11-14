# SubWatch 开发文档

面向「想用代码把自定义服务接进来」的用户。SubWatch 的 WebUI 只是 HTTP API 的一个客户端：
**监控、订阅、通知渠道都能通过 API 管理**，因此你可以用任何语言/脚本接入尚未内置的服务。

- [API 参考](api.md)：认证、限流、错误格式、全部端点、字段表、DTO 示例
- [自定义监控编程指南](monitoring.md)：HTTP 拉模式、JSON 路径提取、受限 JS 提取器、阈值规则状态机、Push 上报
- [通知与 Webhook 集成](notifications.md)：邮件/Webhook 渠道、事件 payload、模板变量、HMAC 签名、重试队列、通知记录
- [数据与档案结构](storage.md)：数据目录、SQLite 表结构、迁移/备份/保留策略
- [用户自定义模板](templates.md)：订阅/监控模板的参数类型、占位符、渲染、导入导出与安全语义
- [从 Git 导入模板](template-import.md)：在模板页从 git 仓库（需清单文件）拉取并导入模板，导入后可编辑并按来源更新

## 三种接入方式

| 方式 | 适合场景 | 入口 |
|---|---|---|
| HTTP 拉模式 | 目标服务有 HTTP API，返回 JSON（或可由 JS 计算） | `POST /api/monitors` |
| Push 推模式 | 目标服务只能用 CLI/脚本取数，或机器无法被反向访问 | `POST /api/push/:token` |
| 通知回传 | 把 SubWatch 的提醒接到自己的系统（IM Bot、自建服务等） | Webhook 通知渠道 |

以上三种方式都可用「模板」复用配置：在 WebUI 中为订阅或监控定义参数化模板，新建时选择模板并填写参数，
服务端渲染后预填表单，详见[用户自定义模板](templates.md)。

## 5 分钟上手（curl）

```bash
BASE=http://localhost:8080

# 1. 登录，把会话 Cookie 存进 cookies.txt
curl -s -c cookies.txt -H 'Content-Type: application/json' \
  -H 'X-Requested-With: subwatch' -H "Origin: $BASE" \
  -d '{"password":"你的管理员密码"}' "$BASE/api/auth/login"

# 2. 创建一个"剩余额度 <20% 预警、<5% 严重"的 HTTP 监控
curl -s -b cookies.txt -H 'Content-Type: application/json' \
  -H 'X-Requested-With: subwatch' -H "Origin: $BASE" \
  -d '{
    "name": "示例服务额度",
    "config": {
      "type": "http",
      "request": {
        "url": "https://api.example.com/usage",
        "method": "GET",
        "headers": [{"key": "Authorization", "value": "Bearer xxx", "secret": true}]
      },
      "extract": {
        "mode": "json",
        "metrics": [{"key": "remaining", "label": "剩余额度", "path": "data.remaining", "unit": "%"}]
      }
    },
    "intervalSeconds": 300,
    "rules": [{
      "metricKey": "remaining",
      "label": "剩余额度",
      "unit": "%",
      "operator": "lt",
      "warningValue": 20,
      "criticalValue": 5
    }]
  }' "$BASE/api/monitors"

# 3. 立刻试跑一次，确认提取和阈值都正确
curl -s -b cookies.txt -X POST -H 'X-Requested-With: subwatch' -H "Origin: $BASE" \
  "$BASE/api/monitors/<返回的 id>/run"

# 4. 看最近的监控运行记录
curl -s -b cookies.txt "$BASE/api/monitors/<返回的 id>/runs?limit=10"
```

> 所有非 GET 的 `/api` 请求都要带 `X-Requested-With: subwatch` 且 `Origin`（如果发送）必须与服务同源；
> 详见 [认证与请求约定](api.md#认证与请求约定)。

## 约定

- API 无版本前缀（`/api/...`），随版本演进；当前版本见 `GET /api/meta`。
- 所有请求/响应均为 JSON（`Content-Type: application/json`），请求体上限 2 MB。
- 日期字段为 `YYYY-MM-DD`；订阅到期时间另有 `expiryTime`（`HH:mm`），两者都按实例时区解释；
  时间戳为 ISO 8601 UTC（如 `2026-11-08T03:00:00.000Z`）。
- 不建议直接读写 SQLite 来做自动化；表结构随迁移变化，请使用 API（见 [storage.md](storage.md)）。
