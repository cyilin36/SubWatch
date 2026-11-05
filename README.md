# SubWatch

自托管的**订阅管理 + 自定义监控提醒**工具：用一个 WebUI 管理订阅到期、服务额度/余额监控和 Webhook/邮件通知。

- **类似 Homepage 的自定义监控**：HTTP 请求 + 声明式 JSON 提取 + 受限 JS 表达式；任意服务都能自己接入。
- **推送监控兜底**：外部脚本/CLI 通过一次性 Token 上报指标，容器内不执行任意命令。
- **订阅模板**：内置常见订阅模板，也可自定义字段；填写起始/到期时间，一键续期，保留续期历史。
- **到期提醒**：按 7/3/1/0 天（可配置）提醒，服务停机错过的提醒会在恢复后合并发送，不重复轰炸。
- **通知渠道**：SMTP 邮件、通用 Webhook（HMAC 签名）以及 Discord/Slack/Telegram/企业微信/钉钉/飞书/Bark/ntfy 预设。
- **中英双语 WebUI**、深/浅色主题、响应式布局。
- **部署简单**：单进程 + SQLite，支持 Docker Compose 或 Node 直接运行。

> 需要 Node.js **24+**（使用内置 `node:sqlite`），或使用 Docker 镜像。

---

## 快速开始

### Docker Compose（推荐）

```bash
mkdir -p data
docker compose up -d --build
```

默认监听 `http://<主机>:8080`。**直接用浏览器打开 `http://<服务器IP>:8080` 即可使用，不需要域名、SSL 证书、反向代理或任何访问配置。** 首次打开会要求设置管理员密码。

如果宿主机用户不是 UID/GID 1000，请先调整：

```bash
PUID=$(id -u) PGID=$(id -g) docker compose up -d --build
# 并确保 ./data 属于该用户：
mkdir -p data && sudo chown -R "$(id -u):$(id -g)" data
```

### Docker Run

```bash
docker build -t subwatch:latest .
docker run -d --name subwatch \
  --restart unless-stopped \
  -p 8080:8080 \
  -e TZ=Asia/Shanghai \
  -v "$PWD/data:/app/data" \
  subwatch:latest
```

### 源码运行

```bash
pnpm install --frozen-lockfile
pnpm build
DATA_DIR=./data PORT=8080 TZ=Asia/Shanghai node apps/server/dist/index.js
```

开发模式（前端 HMR）：

```bash
pnpm dev
# 前端 http://localhost:5173，API http://localhost:8080
```

> 所有依赖、缓存、测试与产物都必须留在本仓库内；详见 [AGENTS.md](AGENTS.md)。

---

## 首次使用

1. 浏览器打开 `http://<服务器IP>:8080`（或者 `http://localhost:8080`），设置管理员密码（至少 8 位）。
2. 进入 **通知频道** 配置 SMTP 或 Webhook，并点击测试。
3. 进入 **监控** 创建监控，或进入 **订阅** 从模板创建第一条订阅。
4. 实例地址会自动记录你首次登录时使用的地址，仅用于通知里的深链，**不影响访问**；只有以后改用域名/反代时才需要去 **设置 → 通用** 修改。

如果忘记密码、或需要自动化初始化，可在首次启动前设置环境变量：

```bash
SUBWATCH_ADMIN_PASSWORD='a-long-password' ...
```

该变量只在尚未设置密码时生效；设置完成后建议移除。

---

## 自定义监控

监控有两种类型：`http` 与 `push`。支持执行间隔（最小 30 秒）、失败阈值、通知频道和多个阈值规则。

### 1. 声明式 JSON 提取

适合返回 JSON 的额度/余额/用量接口：

```json
{
  "type": "http",
  "request": {
    "url": "https://api.example.com/usage",
    "method": "GET",
    "headers": [{ "key": "Authorization", "value": "Bearer xxx", "secret": true }]
  },
  "extract": {
    "mode": "json",
    "metrics": [
      { "key": "remaining", "label": "剩余额度", "path": "data.usage.remaining", "unit": "%" }
    ]
  }
}
```

- 路径支持点号与数组下标，例如 `data.items.0.remaining`。
- 每个指标支持 `scale`（乘系数）与 `offset`（加偏移）。
- Header 中标记 `secret: true` 的值会加密存储，API 返回时以哨兵掩码表示。

### 2. JS 表达式提取

适合需要计算的场景，例如“剩余百分比”：

```js
const used = ctx.num(ctx.get(ctx.data, 'usage.used'));
const limit = ctx.num(ctx.get(ctx.data, 'usage.limit'));
return {
  metrics: {
    remaining: {
      value: Math.max(0, 100 - (used / limit) * 100),
      label: '剩余额度',
      unit: '%'
    }
  },
  status: 'up'
};
```

- 沙箱提供：`ctx.data` / `ctx.text` / `ctx.headers` / `ctx.status` / `ctx.durationMs` / `ctx.now`，
  以及 `ctx.get` / `ctx.num` / `ctx.pct` / `ctx.clamp` / `ctx.sum` / `ctx.log`。
- 无网络、无文件系统、无 `require`/`process`；单次执行 1 秒超时。
- 返回值必须包含 `metrics`；可返回 `status: 'up' | 'down'`。
- 在编辑页点击 **测试运行** 可查看原始响应、提取结果、规则评估与日志。

### 3. 推送监控

适合只能用 CLI/脚本取数的服务。创建 `push` 类型的监控后，会展示一次性的推送 Token：

```bash
curl -X POST "http://localhost:8080/api/push/<TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{"status":"up","metrics":{"remaining":{"value":12.5,"unit":"%"}},"message":"from cron"}'
```

- Token 只保存 SHA-256 哈希，可随时在监控详情页轮换。
- 超过 `staleAfterSeconds` 未上报会被判定为异常。
- 外部脚本可以放在任意机器上，容器内**不会**执行任意 Shell。

### 4. 阈值规则

对每个指标可设置 warning/critical 阈值：

| 字段 | 含义 |
|---|---|
| `operator` | `gt` / `gte` / `lt` / `lte` / `eq` / `neq` |
| `warningValue` / `criticalValue` | 预警/严重阈值 |
| `durationChecks` | 连续 N 次越界才触发 |
| `cooldownSeconds` | 两次通知最小间隔 |
| `repeatIntervalSeconds` | 持续告警的重复间隔（0 = 只发一次） |
| `recoveryOperator` / `recoveryValue` | 显式恢复条件；不填则条件消失即恢复 |

监控还内置可用性规则：连续请求失败达到 `failureThreshold` 会发 `monitor.down`，恢复后发 `monitor.recovered`。状态变化通知使用稳定事件 key 去重，重启不会重复发送。

---

## 订阅管理与续期

1. **模板**：内置云服务器/VPS、域名、ChatGPT Plus、Claude Pro、Netflix、Spotify、iCloud+、自定义；也可在模板页自定义字段（文本、数字、日期、下拉、开关、密钥等）。
2. **创建订阅**：选择模板 → 填写字段 → 起始/到期日期 → 周期（日/周/月/季/年/自定义天数）→ 金额/币种 → 提醒天数 → 通知频道。
3. **一键续期**：列表或详情页点击续期，默认从原到期日顺延一个周期（已过期则从今天起算），可切换自定义日期与金额；续期写入历史。
4. **到期提醒**：每天在设置的提醒时刻检查；默认提前 7/3/1/0 天发送。服务停机错过的提醒恢复后合并为一条。暂停/归档的订阅不发提醒。
5. **状态**：`active` / `expiring` / `expired` / `paused` / `archived`，仪表盘展示 30 天内到期与月度成本。

月末续期会夹取目标月最后一天（例如 1 月 31 日 + 1 个月 = 2 月 28/29 日）。

---

## 通知

### 邮件（SMTP）

在 **设置 → SMTP** 或 **通知频道** 中配置：服务器、端口、SSL/STARTTLS、用户名、密码、发件人、收件人。支持测试发送。密码加密存储，接口只返回 `passwordSet`。

### Webhook

支持自定义 URL、方法、Header、Content-Type、body 模板与 HMAC-SHA256 签名。默认 JSON：

```json
{
  "source": "subwatch",
  "event": "subscription.expiring",
  "title": "订阅即将到期：ChatGPT Plus",
  "message": "还有 3 天到期（2026-11-08）",
  "severity": "warning",
  "timestamp": "2026-11-05T02:00:00.000Z",
  "data": { "subscriptionId": "...", "expiryDate": "2026-11-08", "daysLeft": 3 },
  "appUrl": "https://subwatch.example.com/subscriptions/..."
}
```

Body 模板可用变量：`{{event}}`、`{{title}}`、`{{message}}`、`{{severity}}`、`{{timestamp}}`、`{{dataJson}}`、`{{appUrl}}`。配置签名密钥后附带：

```
X-SubWatch-Signature: sha256=<hex hmac of raw body>
```

发送失败会按 1m/5m/15m/1h/6h 退避重试，最多 6 次；通知日志页可查看状态并手动重试。相同事件/频道通过唯一键去重。

---

## 配置

复制 `.env.example` 为 `.env`（`.env` 已被 gitignore）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | HTTP 端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | SQLite、密钥、迁移备份所在目录 |
| `TZ` | `Asia/Shanghai` | 默认时区（也可在设置里改） |
| `SUBWATCH_SECRET_KEY` | 自动生成 | 32 字节密钥（64 hex 或 base64）；不设置则写入 `DATA_DIR/.secret-key` |
| `SUBWATCH_ADMIN_PASSWORD` | 无 | 仅首次启动时初始化管理员密码 |
| `SUBWATCH_BASE_URL` | 自动（首次登录地址） | 可选。仅用于通知里的深链，不影响访问 |
| `TRUST_PROXY` | `0` | 仅在使用反向代理时需要设为 `1` |
| `LOG_LEVEL` | `info` | pino 日志级别 |
| `SUBWATCH_WEB_DIR` | 自动推导 | 前端构建产物目录（Docker 已设置） |

时区、提醒时刻、默认提醒天数、保留天数、默认通知频道、语言、主题等可在 WebUI **设置** 中修改。

---

## 数据、备份与升级

- 全部运行数据在 `DATA_DIR/`：`subwatch.db`（SQLite WAL）、`.secret-key`、`backups/`。
- **备份必须包含 `.secret-key`**，否则加密的 SMTP 密码、Webhook 密钥、监控/订阅密钥字段无法解密。
- 简单备份：

```bash
docker compose stop
tar czf subwatch-backup-$(date +%F).tar.gz data/
docker compose start
```

- 升级：拉取新代码后 `docker compose up -d --build`，或 `pnpm install && pnpm build` 后重启。启动时自动执行迁移，迁移前会在 `data/backups/` 保留快照（默认保留最近 5 份）。不支持降级。

---

## 可选：域名与 HTTPS（不配置也能正常使用）

SubWatch 默认就是“**能访问端口即可访问程序**”：直接使用 `http://IP:8080`，不依赖域名、证书、反向代理或 `TRUST_PROXY`。

只有当你**主动希望**用域名/HTTPS 时才需要下面的配置；不做这些，直连 IP:端口仍然完全可用。

Caddy 示例：

```
subwatch.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Nginx 示例：

```nginx
server {
    listen 443 ssl;
    server_name subwatch.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

使用 HTTPS 时会话 Cookie 会自动带 `Secure` 标记；使用 HTTP 时不会，登录和全部功能照常工作。

---

## 安全说明

- 单管理员密码，scrypt 哈希；会话 Cookie `HttpOnly` + `SameSite=Lax`，7 天过期；登录限流。
- 变更类请求要求同源与 `X-Requested-With: subwatch` 头；CSP 限制外部资源。
- 敏感配置 AES-256-GCM 加密存储；API 返回掩码；日志脱敏。
- 监控目标 URL 由管理员配置（这是工具能力），请勿把管理权限开放给不可信用户；即使直接暴露端口，也请保留管理员密码。
- 自定义 JS 由管理员编写并受信任；沙箱用于防误操作，不是对抗恶意管理员的强安全边界。
- 不执行任意 Shell；外部脚本通过 Push API 上报。

---

## 开发与测试（重要）

本仓库有两条硬性规定（详见 [AGENTS.md](AGENTS.md)）：

1. 所有下载、依赖、测试、缓存、Docker 挂载/产物必须在本仓库内；
2. **测试代码、测试配置、设计文档与调研稿不得进入 git**。

因此生产代码与测试是隔离的：

```bash
# 生产构建
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck

# 测试（位于被 gitignore 的 dev/，独立依赖，不污染根 lockfile）
cd dev
pnpm install
pnpm test
```

测试工作区包含：日期/续期/提醒的单元测试、Fastify API 集成测试、本地 mock HTTP、fake SMTP、Webhook 接收器；测试数据写在 `dev/tmp/`。

常用本地环境变量（避免写到用户目录）：

```bash
export TMPDIR="$PWD/dev/tmp"
export XDG_CACHE_HOME="$PWD/.cache"
export npm_config_cache="$PWD/.cache/npm"
export PNPM_HOME="$PWD/.cache/pnpm-home"
```

---

## 常见问题

- **端口被占用**：改 `PORT` 或 compose 的端口映射。
- **502/无法登录**：确认服务健康检查通过；反代是否转发 `Host`/`X-Forwarded-Proto`。
- **收不到邮件**：先用设置页/频道页的“测试发送”；确认 SMTP 端口、SSL/STARTTLS、发件人权限（部分邮箱需要授权码）。
- **忘记管理员密码**：停止服务，删除/编辑 SQLite 中 `settings` 表的 `admin_password_hash`（或恢复备份），重启后重新初始化。操作前请备份 `data/`。
- **迁移后启动失败**：从 `data/backups/pre-migration-*.db` 恢复，并附日志反馈。
- **时间不对**：检查设置中的时区；订阅日期按日期语义存储，提醒按设置时刻当地时区计算。
