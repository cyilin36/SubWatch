# SubWatch

> ⚠️ **早期开发版本（early development）**：功能与数据表结构仍在快速变动，接口可能随时调整，
> 不建议用于生产环境。升级前请备份整个 `data/` 目录。

自托管的**订阅提醒 + 自定义监控**工具：一个 WebUI 管理订阅到期、服务额度/余额监控，以及 Webhook/邮件通知。

订阅和监控在同一个列表里，打开即是「订阅与监控」。自定义监控支持 HTTP 拉取（JSON/JS 提取 + 阈值规则）和 Push 上报；通知支持 SMTP 邮件与 Webhook。支持用户自定义模板：为订阅或监控定义参数化蓝图，新建时选择模板并填写参数即可复用配置；也可在「模板」页从 git 仓库导入模板（仓库需提供 `subwatch-templates.json` 清单，导入后即为普通模板，可编辑并按来源更新）。界面提供亮色与深色两套玻璃质感外观，默认亮色，在右上角切换，或跟随系统。

## 部署

**Docker Compose（推荐）**

```bash
mkdir -p data
docker compose up -d --build
```

打开 `http://<服务器IP>:8080`，首次访问设置管理员密码即可。不需要域名、证书或反向代理。

如果宿主机用户不是 UID/GID 1000，启动时指定：

```bash
PUID=$(id -u) PGID=$(id -g) docker compose up -d --build
mkdir -p data && sudo chown -R "$(id -u):$(id -g)" data
```

**Docker Run**

```bash
docker build -t subwatch:latest .
docker run -d --name subwatch --restart unless-stopped \
  -p 8080:8080 -e TZ=Asia/Shanghai \
  -v "$PWD/data:/app/data" subwatch:latest
```

**源码运行**（需要 Node.js 24+）

```bash
pnpm install --frozen-lockfile && pnpm build
DATA_DIR=./data PORT=8080 TZ=Asia/Shanghai node apps/server/dist/index.js
```

常用环境变量见 `.env.example`（`PORT`、`DATA_DIR`、`TZ`、`SUBWATCH_ADMIN_PASSWORD` 等），其余可在 WebUI 设置里改。

## 首次使用

1. 设置管理员密码。
2. 首页「新建提醒」填名称 + 日期（可选续费链接）；需要额度监控时「新建监控」。
3. 通知渠道里配 SMTP 或 Webhook，点「测试发送」验证。

## 注意

- **备份必须包含整个 `data/`，尤其是 `.secret-key`**，否则加密的密码/密钥无法恢复。
- 升级时自动执行数据库迁移，迁移前会备份到 `data/backups/`；**不支持降级**，回退请恢复备份。
- 直接用 `http://IP:8080` 即可使用；只有主动用域名/HTTPS 时才需要反向代理（见 `.env.example` 的 `TRUST_PROXY`）。
- 「从 Git 导入模板」功能需要运行环境可执行 `git`（Docker 镜像已内置）；导入后的模板保存在本地 `data/` 内，可离线使用。
- 自定义 JS 由管理员编写、在沙箱中执行；管理权限不要开放给不可信用户。

## 文档

API、自定义监控编程、通知对接、数据库结构都在 **[docs/](docs/README.md)**：

- [API 参考](docs/api.md)
- [自定义监控编程指南](docs/monitoring.md)
- [通知与 Webhook 集成](docs/notifications.md)
- [用户自定义模板](docs/templates.md)
- [从 Git 导入模板](docs/template-import.md)
- [数据与档案结构](docs/storage.md)

## 许可证

[GPL-3.0](LICENSE)：可自由使用、修改、部署；但分发修改后的作品时必须同样以 GPL-3.0 开源。
