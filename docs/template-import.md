# 从 Git 导入模板

在「模板」页面可以把一个 git 仓库中的模板导入到本地模板库。仓库只是导入来源：拉取、解析、导入后即可丢弃，
程序最终只保存模板本身，并记录其来源信息用于展示与后续更新。

## 前提

- 运行环境需可执行 `git`（Docker 镜像已内置）。
- 仓库地址支持 `https://`、`http://` 与 `file://`；其他协议不接受。
- 仓库根目录必须提供清单文件 `subwatch-templates.json`，用于声明可供导入的模板。

## 仓库结构

```
my-subwatch-templates/
├── subwatch-templates.json      # 必需：模板清单
└── templates/
    ├── subscription/
    │   └── vps-renewal.json
    └── monitor/
        └── api-quota.json
```

清单格式：

```json
{
  "format": "subwatch-template-repository",
  "version": 1,
  "name": "我的模板库",
  "description": "可选",
  "templates": [
    { "path": "templates/subscription/vps-renewal.json", "id": "vps", "name": "VPS 续费", "kind": "subscription", "version": "1.0.0" },
    { "path": "templates/monitor/api-quota.json", "version": "2.3.0" }
  ]
}
```

- `path` 必填，必须位于仓库的 `templates/` 目录内。
- `id`、`name`、`kind`、`version`、`description`、`category`、`icon`、`color` 可选；
  缺省时回退到模板文件自身的字段。
- 模板文件可为裸 `TemplateInput` 对象，也可为导出信封。每个文件不超过 256 KiB，单仓库最多 500 个模板。

## 使用流程

1. 打开「模板」页面，点击「从 Git 导入」。
2. 填写仓库地址（可选分支），点「拉取预览」。服务端克隆仓库并读取清单，列出可选模板及其类型、版本、描述与路径。
3. 勾选需要的模板，点「导入所选」。仅所选项被导入。
4. 导入后模板出现在模板列表中，与手动创建的模板完全一样，可编辑、可删除。

导入的模板会记录来源（仓库地址、分支、文件路径、提交），在卡片标题下显示「来自 owner/repo」：

- 若仓库为 HTTP(S) 地址，来源可点击跳转到仓库；
- 卡片提供「更新」操作，按来源重新拉取并更新该模板的内容与版本。

## 模板版本

模板支持可选 `version` 字段（≤32 字符）。导入时优先使用清单中声明的版本，否则使用模板文件自身的 `version`。
未声明时为空。

## 安全说明

- 仅接受 `https://`、`http://`、`file://` 地址，拒绝以 `-` 开头的参数注入式取值。
- 克隆以独立进程执行，不使用 shell，禁用终端凭据提示（`GIT_TERMINAL_PROMPT=0`），超时 120 秒强制终止。
- 错误信息中的凭据（URL 内的 `user:pass@`）会被脱敏，不会写入日志或接口响应。
- 仓库内容仅作为模板 JSON 解析校验，不执行任何代码；监控模板中的 JS 提取器仍受既有沙箱限制。
- 克隆在数据目录下的临时目录中进行，导入完成或失败后即清理。

## API

全部端点需登录会话，非 GET 请求需 `X-Requested-With: subwatch` 头（见 [API 参考](api.md#认证与请求约定)）。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/templates/git/preview` | 克隆并读取清单，返回可选模板（不写库）；请求体 `{ url, branch? }` |
| POST | `/api/templates/git/import` | 导入所选模板；请求体 `{ url, branch?, paths: [...] }`，返回 `201` |
| POST | `/api/templates/:id/update-from-source` | 按模板记录的来源重新拉取并更新；无来源返回 `400` |

错误码：`400 validation_error`（请求体非法、非法地址、`paths` 不在清单内、仓库缺少清单或模板非法）、`404 not_found`（模板不存在）。
