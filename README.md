# SubWatch

自托管的**订阅提醒 + 自定义监控**工具：一个 WebUI 管理订阅到期、服务额度/余额监控，以及 Webhook/邮件通知。

- **订阅与监控合在一页**：打开就是「订阅与监控」，顶部只有三个数字：全部、临近到期/额度告警、已过期/额度见底。
- **极简提醒**：新建提醒只要名称 + 日期，可选一个续费/跳转链接；吃药提醒、VPS 续费提醒一分钟建好，支持一键续期。
- **自定义监控**：HTTP 请求 + 声明式 JSON 提取或受限 JS 表达式，支持 Push 上报，任意服务都能自己接入。
- **到期提醒**：按可配置的提前天数提醒；服务停机错过的提醒会在恢复后合并发送，不重复轰炸。
- **通知渠道**：SMTP 邮件、通用 Webhook（支持模板与 HMAC 签名），内置常见 IM/推送预设。
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

默认监听 `http://<主机>:8080`。直接用浏览器打开 `http://<服务器IP>:8080` 即可，不需要域名、证书或反向代理。
首次打开会要求设置管理员密码。

如果宿主机用户不是 UID/GID 1000，请先调整：

```bash
PUID=$(id -u) PGID=$(id -g) docker compose up -d --build
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

---

## 首次使用

1. 浏览器打开 `http://<服务器IP>:8080`，设置管理员密码（至少 8 位）。
2. 首页「订阅与监控」→ **新建提醒**：填名称和日期（可选续费链接），保存即可；需要额度/余额监控时点 **新建监控**。
3. 进入 **通知渠道** 配置 SMTP 或 Webhook，并点「测试发送」验证。
4. 实例地址会自动记录首次登录时使用的地址，仅用于通知里的深链，不影响访问；改用域名/反代时可在 **设置 → 通用** 修改。

如果忘记密码、或需要自动化初始化，可在首次启动前设置环境变量：

```bash
SUBWATCH_ADMIN_PASSWORD='a-long-password' ...
```

该变量只在尚未设置密码时生效；设置完成后建议移除。

---

## 订阅与提醒

- 订阅字段只有：名称、到期/提醒日期、链接（可选）、续期周期、提前提醒天数、通知渠道、备注。
- **一键续期**：默认顺延一个周期（已过期则从今天起算），也可手动改日期；续期写入历史。
- **提醒**：在「到期日 − 提前天数」的当天，按设置里的时刻（默认 09:00）提醒；暂停的订阅不发提醒。
- **状态**：`active` / `expiring` / `expired` / `paused`。

## 自定义监控

监控有两种类型：

- **HTTP 拉取**：定时请求 URL，用 JSON 路径或受限 JS 提取指标，再按 warning/critical 阈值规则触发通知；
- **Push 上报**：创建监控后拿一次性 Token，由外部脚本/CI 上报指标，超时未上报自动判异常。

完整的配置字段、JS 沙箱 API、规则状态机、Push 协议和示例配方见 **[自定义监控编程指南](docs/monitoring.md)**；
HTTP API 见 **[API 参考](docs/api.md)**。

## 通知

- **邮件（SMTP）**：设置 → SMTP，或创建邮件通知渠道；
- **Webhook**：自定义 URL/方法/Header/Body 模板，支持 HMAC-SHA256 签名，内置 Discord/Slack/Telegram/企业微信/钉钉/飞书/Bark/ntfy 等预设；
- **测试发送**：配置时不用先保存，填好内容直接点「测试发送」即可验证。

Webhook 请求格式、模板变量、签名校验与重试策略见 **[通知与 Webhook 集成](docs/notifications.md)**。

---

## 文档

| 文档 | 内容 |
|---|---|
| [开发文档索引](docs/README.md) | 5 分钟接入示例 + 文档导航 |
| [API 参考](docs/api.md) | 认证、限流、错误格式、全部端点与字段 |
| [自定义监控编程指南](docs/monitoring.md) | HTTP/JSON/JS 提取、阈值规则、Push 上报、配方 |
| [通知与 Webhook 集成](docs/notifications.md) | 渠道配置、事件类型、模板、HMAC、重试 |
| [数据与档案结构](docs/storage.md) | 数据目录、SQLite 表结构、迁移与备份 |

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

- 全部运行数据在 `DATA_DIR/`：`subwatch.db`（SQLite）、`.secret-key`、`backups/`。
- **备份必须包含 `.secret-key`**，否则加密的 SMTP 密码、Webhook 签名密钥、监控 Header 密钥等无法解密。
- 简单备份：

```bash
docker compose stop
tar czf subwatch-backup-$(date +%F).tar.gz data/
docker compose start
```

- 升级：拉取新代码后 `docker compose up -d --build`，或 `pnpm install && pnpm build` 后重启。
  启动时自动执行迁移，迁移前会在 `data/backups/` 保留快照（默认保留最近 5 份）。不支持降级。

更多表结构说明见 [数据与档案结构](docs/storage.md)。

---

## 可选：域名与 HTTPS（不配置也能正常使用）

SubWatch 默认「能访问端口即可使用」：直接 `http://IP:8080`，不依赖域名、证书、反向代理或 `TRUST_PROXY`。
只有你主动想用域名/HTTPS 时才需要下面配置；不做这些，直连 IP:端口仍然完全可用。

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
- 敏感配置（SMTP 密码、Webhook 签名密钥、监控 Header 密钥、Push Token）加密存储；API 返回掩码；日志脱敏。
- 监控目标 URL 由管理员配置（这是工具能力），请勿把管理权限开放给不可信用户。
- 自定义 JS 由管理员编写并受信任；沙箱用于防误操作，不是对抗恶意管理员的强安全边界。
- 不执行任意 Shell；外部脚本通过 Push API 上报。

---

## 常见问题

- **端口被占用**：改 `PORT` 或 compose 的端口映射。
- **502/无法登录**：确认服务健康检查通过；反代是否转发 `Host`/`X-Forwarded-Proto`。
- **收不到邮件**：先用设置页/频道页的「测试发送」；确认 SMTP 端口、SSL/STARTTLS、发件人权限（部分邮箱需要授权码）。
- **收不到 Webhook**：确认接收端返回 2xx；在通知记录页查看失败原因，或直接用「测试发送」排查。
- **忘记管理员密码**：停止服务，删除/编辑 SQLite 中 `settings` 表的 `admin_password_hash`（或恢复备份），重启后重新初始化。操作前请备份 `data/`。
- **迁移后启动失败**：从 `data/backups/pre-migration-*.db` 恢复，并附日志反馈。
- **时间不对**：检查设置中的时区；订阅日期按日期语义存储，提醒按设置时刻当地时区计算。
