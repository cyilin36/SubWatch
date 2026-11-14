# 模板仓库

模板仓库（Template Repository）让订阅模板与监控模板脱离程序独立维护。模板作者把模板文件放进一个 git 仓库，
SubWatch 拉取并安装到本地模板库；用户只需登记仓库地址并执行「同步」。

该机制用于模板与程序分离开发：模板的增删改只发生在 git 仓库中，SubWatch 按仓库内容安装、更新与移除模板。

## 前提

- 运行环境需可执行 `git`（Docker 镜像已内置）。
- 仓库地址支持 `https://`、`http://` 与 `file://`；其他协议（`ssh://`、`git://` 等）不接受。
- 仓库拉取会占用网络与磁盘，同步操作限流为每分钟 10 次。

## 仓库结构

仓库根目录下需存在 `templates/` 目录，其中递归存放 `*.json` 模板文件。每个文件即一个模板：

```
my-subwatch-templates/
├── README.md
└── templates/
    ├── subscription/
    │   └── vps-renewal.json
    └── monitor/
        └── api-quota.json
```

- 文件内容可以是裸模板对象（即 `TemplateInput`），也可以是导出的信封
  （`{ "format": "subwatch-template", "version": 1, "template": { ... } }`）。
- 模板在仓库内的稳定标识是文件的相对路径（如 `templates/monitor/api-quota.json`），
  请避免随意重命名已发布的文件。
- 忽略以 `.` 开头的文件/目录、`node_modules/` 及非 `*.json` 文件，不跟随符号链接。
- 单文件不超过 256 KiB，单仓库最多 500 个模板文件。
- 解析或校验失败的文件会记录为「跳过」，不影响其余模板安装。

模板字段与占位符语法见[用户自定义模板](templates.md)。

## 安装与同步

1. 在 WebUI「模板仓库」中新增仓库，填写名称（可选）、git 地址与分支（可选，默认仓库默认分支）。
2. 保存后可立即「同步」，或稍后在列表中手动同步。
3. 同步执行以下步骤：浅克隆仓库 → 扫描 `templates/**/*.json` → 校验并安装/更新模板 → 移除仓库中已删除的模板。
4. 同步结果会显示新增、更新、移除、未变化与跳过的数量，以及当前 commit。

同步是镜像语义：仓库中删除某个模板文件后，再次同步会删除对应的本地模板。订阅与监控在创建时会对模板名称与字段
定义做快照，因此删除模板不影响已有记录。

服务端在同步时把仓库浅克隆到数据目录下的 `template-sources/<id>/`，该目录仅作为解析暂存副本，安装结果以
`templates` 表为准；每次同步会重建该目录，删除仓库时一并清理。

## WebUI 使用流程

1. 打开「模板仓库」，点「添加仓库」，填写 git 地址（名称、分支可选）。
2. 保存后自动同步；之后可在列表中随时点「同步」重新拉取。
3. 同步完成后，模板出现在「模板」页，新建订阅或监控时可直接选择。
4. 修改模板请在仓库中进行并提交，再回到「模板仓库」同步；删除仓库会移除其托管模板。

## 托管模板

由仓库安装的模板在模板库中标记为「仓库」并显示来源名。此类模板为只读：

- 不能在 SubWatch 内直接编辑或删除，改动请提交到仓库后重新同步。
- 卸载请删除对应模板仓库，其托管模板会被一并移除。

本地创建的模板不受影响，与托管模板共存。

## 安全说明

- 仅接受 `https://`、`http://` 与 `file://` 地址，且拒绝以 `-` 开头的参数注入式取值。
- 克隆以独立进程执行，不使用 shell，禁用在终端提示输入凭据（`GIT_TERMINAL_PROMPT=0`），超时 120 秒强制终止。
- 错误信息中的凭据（URL 内的 `user:pass@`）会被脱敏，不会写入日志或接口响应。
- 仓库内容仅作为模板 JSON 解析校验，不执行任何代码；监控模板中的 JS 提取器仍受既有沙箱限制。

## API

全部端点需登录会话，非 GET 请求需 `X-Requested-With: subwatch` 头（见 [API 参考](api.md#认证与请求约定)）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/template-sources` | 仓库列表，含 `templateCount`、`lastError` |
| POST | `/api/template-sources` | 新增仓库，请求体为 `TemplateSourceInput`，返回 `201` |
| GET | `/api/template-sources/:id` | 仓库详情，含其模板列表 |
| PUT | `/api/template-sources/:id` | 更新名称、地址、分支、启用状态 |
| DELETE | `/api/template-sources/:id` | 删除仓库及其托管模板，返回 `204` |
| POST | `/api/template-sources/:id/sync` | 拉取并安装/更新，返回同步结果（限流 10 次/分钟） |

`TemplateSourceInput`：

```json
{
  "name": "官方模板库",
  "url": "https://github.com/example/subwatch-templates.git",
  "branch": "main",
  "enabled": true
}
```

字段说明：

- `name`：显示名称，可空，缺省时列表回退显示 `url`。
- `url`：git 地址，仅接受 `https://`、`http://`、`file://`，最长 2000 字符。
- `branch`：分支名，留空时使用仓库默认分支。
- `enabled`：启用标记（仅作记录，同步始终由手动触发，不受其影响）。

同步结果：

```json
{
  "ok": true,
  "commit": "7fb6055e678f800320d8ab8cd8f201d9493d1ba0",
  "added": 2,
  "updated": 0,
  "removed": 0,
  "unchanged": 0,
  "skipped": [{ "path": "templates/monitor/broken.json", "error": "..." }],
  "error": null
}
```

错误沿用统一信封：

| HTTP | `code` | 场景 |
|---|---|---|
| 400 | `validation_error` | 请求体不符合 schema（含非法 git 地址） |
| 404 | `not_found` | 仓库不存在 |
| 409 | `conflict` | 同一地址+分支已存在，或该仓库正在同步 |
| 409 | `template_managed` | 对托管模板直接执行编辑/删除 |

## 示例仓库

在仓库根目录放置如下文件即可被安装：

`templates/monitor/api-quota.json`

```json
{
  "kind": "monitor",
  "name": "API 额度监控",
  "description": "为任意 API 生成额度监控",
  "icon": "📈",
  "category": "额度",
  "fields": [
    { "key": "endpoint", "label": "接口地址", "type": "url", "required": true },
    { "key": "apiKey", "label": "API Key", "type": "secret", "required": true }
  ],
  "payload": {
    "name": "API 额度",
    "config": {
      "type": "http",
      "request": {
        "url": "{{endpoint}}",
        "method": "GET",
        "headers": [{ "key": "Authorization", "value": "Bearer {{apiKey}}", "secret": true }],
        "auth": { "type": "none" }
      },
      "extract": {
        "mode": "json",
        "metrics": [{ "key": "used", "label": "用量", "path": "used", "unit": "%" }]
      }
    },
    "intervalSeconds": 300,
    "enabled": true,
    "rules": []
  }
}
```
