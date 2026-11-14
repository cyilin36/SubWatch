# 用户自定义模板

模板（Template）是用户自建的「创建蓝图」，用于复用订阅或监控的个性化配置。模板声明一组带类型的参数，以及一份含 `{{参数}}` 占位符的 payload；新建订阅或监控时选择模板、填写参数，服务端渲染并校验 payload，再把结果预填到新建表单。

- 模板分为 `subscription`（订阅模板）与 `monitor`（监控模板）两种 `kind`，创建后不可更改。
- 模板本身不创建实体，只生成草稿；实体的创建仍走原有的 `POST /api/subscriptions` 与 `POST /api/monitors`。
- 模板只在「新建」流程中使用，不会套用到已有记录；已有记录可在编辑页直接修改。
- 系统不内置任何模板，全部由用户创建，并支持 JSON 导入/导出以便分享与版本管理。

## 参数类型

每个参数（字段）由 `key`、`label`、`type` 及可选的校验属性构成。

| `type` | 说明 | 专属属性 | 默认值要求 |
|---|---|---|---|
| `text` | 单行文本 | `minLength`、`maxLength`、`pattern` | 字符串 |
| `textarea` | 多行文本 | `minLength`、`maxLength`、`pattern` | 字符串 |
| `url` | HTTP(S) 链接 | `minLength`、`maxLength`、`pattern` | 合法的 `http(s)://` 字符串 |
| `number` | 数字 | `min`、`max` | 数字 |
| `date` | 日期 | — | `YYYY-MM-DD` 字符串 |
| `time` | 时间 | — | `HH:mm` 字符串 |
| `select` | 单选 | `options`（至少一项，值唯一） | 必须是某个选项的 `value` |
| `switch` | 开关 | — | 布尔值 |
| `secret` | 敏感文本（密码、Token） | `minLength`、`maxLength`、`pattern` | **禁止设置默认值** |
| `json` | 任意 JSON | — | JSON 字符串（保存前需能解析） |

通用属性：

| 属性 | 说明 |
|---|---|
| `key` | 参数键，`^[a-zA-Z][a-zA-Z0-9_-]*$`，最长 50，模板内唯一 |
| `label` | 展示名，1..100 字符 |
| `required` | 是否必填，默认 `false` |
| `placeholder` / `help` | 表单占位提示与帮助文本 |
| `defaultValue` | 预填默认值；`secret` 禁止设置 |

模板层面的限制：`kind` 只能是 `subscription` 或 `monitor`；`name` 1..100；`description` ≤500；`icon` ≤16（单个 emoji）；`color` 为空或 `#RRGGBB`；`category` ≤50；`version` ≤32（可选，作者自定义版本号）；字段 ≤50 个；payload 为 JSON 对象且 ≤100 KB。

## 占位符语法

在 payload 的任意 JSON 字符串值中写入 `{{key}}`，其中 `key` 必须是模板已声明的参数键。

- **整体占位符**：字符串整体只有一个占位符（如 `"{{seats}}"`）时，渲染保留参数原始类型（number、boolean、数组、对象）。监控模板据此把数字阈值、布尔开关、对象配置写入需要原生类型的字段。
- **内联占位符**：占位符出现在字符串中间（如 `"{{service}} 额度监控"`）时按文本替换；非字符串类型会转为 JSON 文本。
- 占位符两侧允许空白，`{{ seats }}` 与 `{{seats}}` 等价。
- 引用未声明的参数、未闭合的 `{{` 或非法占位符名在保存模板时返回 `400`。
- payload 中未被引用的参数仍会参与参数校验，并随订阅一起持久化（订阅模板）。

## 订阅模板示例

```json
{
  "kind": "subscription",
  "name": "VPS 续费模板",
  "description": "按服务名生成续费提醒",
  "icon": "🖥️",
  "color": "#3366ff",
  "category": "基础设施",
  "fields": [
    { "key": "service", "label": "服务名", "type": "text", "required": true },
    { "key": "account", "label": "账号", "type": "text" },
    { "key": "apiToken", "label": "API Token", "type": "secret", "required": true },
    {
      "key": "plan",
      "label": "套餐",
      "type": "select",
      "options": [
        { "label": "月付", "value": "monthly" },
        { "label": "年付", "value": "yearly" }
      ],
      "defaultValue": "monthly"
    },
    { "key": "seats", "label": "席位", "type": "number", "defaultValue": 5 },
    { "key": "extra", "label": "附加配置", "type": "json" }
  ],
  "payload": {
    "name": "{{service}} 续费",
    "url": "https://billing.example.com/{{service}}",
    "notes": "account={{account}}, plan={{plan}}, seats={{seats}}",
    "reminderOffsets": [7, 3, 1, 0]
  }
}
```

订阅模板的 payload 是 `SubscriptionInput` 的子集，可省略任意字段；省略的字段由新建表单的默认值决定。渲染结果只覆盖 payload 中出现的字段。

## 监控模板示例

```json
{
  "kind": "monitor",
  "name": "API 额度监控模板",
  "description": "为任意 API 生成额度监控",
  "icon": "📈",
  "category": "额度",
  "fields": [
    { "key": "endpoint", "label": "接口地址", "type": "url", "required": true },
    { "key": "apiKey", "label": "API Key", "type": "secret", "required": true },
    { "key": "warning", "label": "预警阈值", "type": "number", "defaultValue": 80 },
    { "key": "critical", "label": "严重阈值", "type": "number", "defaultValue": 95 }
  ],
  "payload": {
    "name": "API 额度",
    "description": "由监控模板创建",
    "config": {
      "type": "http",
      "request": {
        "url": "{{endpoint}}",
        "method": "GET",
        "headers": [{ "key": "Authorization", "value": "{{apiKey}}", "secret": true }],
        "auth": { "type": "none" }
      },
      "extract": {
        "mode": "json",
        "metrics": [{ "key": "used", "label": "用量", "path": "used", "unit": "%" }]
      }
    },
    "intervalSeconds": 300,
    "enabled": true,
    "rules": [
      {
        "metricKey": "used",
        "label": "用量",
        "unit": "%",
        "operator": "gt",
        "warningValue": "{{warning}}",
        "criticalValue": "{{critical}}",
        "enabled": true
      }
    ]
  }
}
```

监控模板的 payload 在渲染时必须通过完整的 `MonitorInput` 校验；参数注入的 `secret` 值会随渲染结果返回，保存监控时由服务端加密存储并在 API 中掩码。

## WebUI 使用流程

1. 打开「模板」，新建模板并选择 `kind`；填写名称、描述、图标、颜色、分类。
2. 在参数编辑器中逐个添加字段，按类型填写校验属性。
3. 在 payload 编辑器（JSON）中编写草稿，使用 `{{key}}` 引用参数；可用「测试渲染」验证参数与结果。
4. 保存模板后回到「新建订阅」或「新建监控」页面，在顶部「从模板创建」中选择模板。
5. 填写参数并「应用模板」，服务端渲染成功后将结果预填到表单。
6. 按需继续修改表单并保存。订阅会保存参数值与字段定义快照；监控会记录模板来源。

## 导入与导出

`GET /api/templates/:id/export` 返回带版本号的信封；导入接口接受同一格式并创建新模板（生成新 `id`）。

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

- `format` 固定为 `subwatch-template`，`version` 固定为 `1`。
- `exportedAt` 仅作参考，导入时忽略。
- 导入时 `template` 与创建接口使用同一 schema，错误返回 `400 validation_error`。

## 从 Git 导入

除手动创建与 JSON 导入外，还可在「模板」页从 git 仓库导入模板：仓库提供 `subwatch-templates.json` 清单，
拉取预览后勾选所需模板导入。导入的模板与手动创建的模板完全一样，可编辑、可删除，并在卡片上显示来源，
支持按来源重新拉取更新。仓库结构、清单格式与 API 详见[从 Git 导入模板](template-import.md)。

## 安全说明

- `secret` 字段禁止设置默认值，避免凭据随模板落入模板库或导出文件。
- 订阅参数值整体加密存储；读取时解密，API 中 `secret` 值以哨兵 `__SUBWATCH_KEEP__` 返回。编辑时原样回传哨兵表示保持已存值。
- 监控配置整体加密存储，请求 Header、认证信息中的敏感值由既有逻辑掩码；模板渲染结果含明文参数，只通过需要登录的渲染接口返回。
- 模板 payload 不会执行任何代码。监控模板中的 JS 提取器仍按原有沙箱规则执行，不因模板获得额外权限。
- 模板删除不会级联删除订阅或监控数据。

## API

全部模板端点均需登录会话；非 GET 请求需要 CSRF 头。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/templates?kind=subscription\|monitor` | 模板摘要列表，含 `fieldCount` 与 `usageCount` |
| POST | `/api/templates` | 创建模板，请求体为 `TemplateInput`，返回 `201` |
| GET | `/api/templates/:id` | 模板详情（含 `fields` 与 `payload`） |
| PUT | `/api/templates/:id` | 更新模板；`kind` 不可修改 |
| DELETE | `/api/templates/:id` | 删除模板，返回 `204`；订阅/监控的模板快照保留 |
| POST | `/api/templates/:id/render` | 请求体 `{"values": {...}}`，返回渲染结果 |
| GET | `/api/templates/:id/export` | 导出信封 JSON |
| POST | `/api/templates/import` | 导入信封，创建新模板，返回 `201`（与创建共用 schema） |

渲染响应：

```json
{
  "kind": "subscription",
  "values": { "service": "vps", "seats": 7 },
  "payload": { "name": "vps 续费", "notes": "seats=7" }
}
```

错误格式沿用统一信封：

| HTTP | `code` | 场景 |
|---|---|---|
| 400 | `validation_error` | 模板定义不符合 schema（重复 key、未知占位符、超限等），`details` 为 `error.flatten()` |
| 400 | `bad_request` | 渲染参数错误（`details.fieldErrors`）、渲染后 payload 不合法（`details.issues`）、`kind` 被修改、模板与实体类型不符 |
| 404 | `not_found` | 模板不存在 |
| 429 | `too_many_requests` | 渲染接口限流（60 次/分钟） |

## 删除与快照语义

- 订阅创建时快照模板的 `template_name` 与字段定义 `field_defs`，并加密保存参数值 `fields`。
- 监控创建时快照 `template_name`；参数值不单独保存，渲染结果就是监控配置本身。
- 模板被修改后，已创建的订阅继续使用自己的字段定义快照，不受影响。
- 模板被删除后，`subscriptions.template_id` 与 `monitors.template_id` 置为 `NULL`，名称与字段快照保留，订阅详情、编辑与监控详情仍可正常显示。
