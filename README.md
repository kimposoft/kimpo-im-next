# kimpo-im-next（KimpoChat）

Kimpo 官方即时通讯插件「KimpoChat」的前端源码。插件 ID：`com.kimposoft.im.next`。

它是一个纯前端插件，挂在宿主 IM 面板（`im-panel` surface）上，负责即时通讯界面与交互编排；不包含后端 sidecar，不自行连接 IM 服务，也不直接请求宿主 API——会话、消息、组织与附件能力全部由宿主经 SDK 注入。

## 能力

- 会话列表、联系人 / 组织树、部门群与普通群入口、消息区、设置、搜索和系统通知会话；
- 文本、图片、文件、视频、业务卡片、系统消息与撤回消息的独立渲染与安全兜底；
- 虚拟消息列表、历史锚点、异步媒体高度重测、已读回执与引用消息定位；
- 中文输入法、按会话隔离的草稿、`@`、粘贴图片、拖拽附件与上传失败重试；
- 回复、复制、本人撤回、转发、表情回应，以及群成员 / 角色相关交互；
- 聊天记录浮层（分类、关键字、日期筛选）、图片序列预览与缩放；
- 每日免打扰、紧急通知绕过，以及聊天 / 待办 / @ / 公告 / 系统五类通知的站内信、邮件、短信偏好。

## 宿主与 SDK 约定

插件通过 `im-panel` surface 的 props 接收 `hostBridge`。manifest 声明的主要 `host_caps`：

- `im`：SDK `NahidaImClient`，提供会话、消息、群组、偏好、附件等能力；
- `org`：SDK `OrgDirectoryClient`，提供组织树懒加载、成员搜索和多部门关系；
- `ws`：宿主共享的 IM WebSocket 客户端，插件不会建立第二条连接；
- `i18n`、`log`、`message`、`navigation`、`ui.confirm`、`ui.prompt` 等：宿主界面与诊断能力。

附件上传、下载和在线预览统一走 `hostBridge.im.assets`。缺少必需能力时，插件展示错误态并写入宿主日志，不会降级为裸 `fetch` 或私建 WebSocket。

manifest 的 `permissions.storage` 为 `true`：插件只用浏览器本地存储保存按用户、按会话隔离的输入草稿，以及按用户隔离的浮窗位置和尺寸；服务端消息、组织关系、附件和通知偏好不以本地存储为准，存储被拒或超额不会阻断输入和发送。

`frontend/src/fixtures/demo.ts` 只用于单测夹具，不进入 bundle（`production-bundle.static.test.ts` 会检查）。

## 依赖

- Node.js 18+ 与 npm
- Kimpo 插件 SDK 前端包 [`@kimposoft/plugin-sdk`](https://www.npmjs.com/package/@kimposoft/plugin-sdk) `1.1.0-tp.20`（预览版，见 `frontend/package.json`）
- 打包与预检：`zip`，以及 SDK 的签名 / 预检工具 `kimpo-plugin-sign`（Go 工具；没有 Go 时可跳过预检）

## 从源码构建 .kpp

```sh
# 可选：先装好预检工具（不装时 build.sh 会用 go run 临时编译，需要 Go ≥ 1.23）
GOWORK=off go install github.com/kimposoft/kimpo-plugin-sdk/cmd/kimpo-plugin-sign@v1.1.0-tp.20

bash build.sh
```

`build.sh` 依次执行 `npm ci` → `npm test`（vitest）→ `vite build`（单个 UMD 文件 `frontend/dist/plugin.umd.js`，样式内联，Vue 由宿主提供）→ 组装 `.kpp` → `kimpo-plugin-sign lint`，产物在 `release/<插件ID>-<版本>.kpp`。前端开发时也可以在 `frontend/` 下直接用 `npm test`、`npm run typecheck`、`npm run build`。

包内结构：`manifest.json`、`frontend/plugin.umd.js`、`frontend/locales/`。

## 关于签名与插件 ID

- `com.kimposoft.*` / `com.kimpo.*` 是 Kimposoft 保留命名空间。**官方签名的安装包只由 Kimposoft 发布**，本仓库不含任何签名私钥。
- 用本仓库源码自行构建的包没有官方签名，宿主会按官方命名空间拦截安装；`kimpo-plugin-sign lint` 也会报 `reserved_plugin_namespace` 错误。
- 如需安装自己构建的版本，请把 `manifest.json` 的 `plugin_id`、`i18n.namespace` 改成你自己的插件 ID（如 `com.example.im`），并按需修改 `capabilities.frontend.global_name` 与 `frontend/vite.config.ts` 里的 UMD 全局名（两者必须一致），以第三方插件身份安装；签名用你自己的密钥（`KIMPO_PLUGIN_SIGNING_KEY_FILE=<私钥文件> bash build.sh`），流程见 SDK 文档 `docs/third-party/`。

## 许可证

[Apache License 2.0](LICENSE)，Copyright 2026 金宝量行（无锡）软件有限公司，附加声明见 [NOTICE](NOTICE)。Kimpo / KimpoChat 名称与 logo 图形是金宝量行（无锡）软件有限公司的商标标识，Apache-2.0 不授予商标使用权。
