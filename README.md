# dsh-rewind-resend

> 像 Codex 一样回头改：消息已经发出、回合已经在跑，也能撤回重写。

一个 DSH（DeepSeek Harness）桌面端插件。会话输入框底下会多出一个小胶囊「↩ 改上一条并重发」，点一下就把刚发的那条消息取回输入框，改完再发 —— 前面的历史一条不丢。

![demo](docs/demo.gif)

## 它做什么

点一下胶囊：

1. 当前回合还在跑？先把它停掉（等价于点 Stop，`session.cancel()`）；
2. 在**上一条消息之前**的最后一个完整回合边界上 fork 一个子会话 —— 子会话保留所有更早的回合，但不包含你要改的这条；
3. 在这个子会话上先 retain 拿到 binding，把原消息的文本预填进输入框（`clearPreviousDraft: true`），再 `openSession` 打开它 —— 和官方 `startSession` 的 `beforeOpen` 同序，草稿不会被后续挂载覆盖；
4. 你改完、按下发送即可。

原会话不会被删除，历史也还在：等价于「从这条消息处开一版新的」，和 Codex 的终止 → 改写 → 重发是同一个语义。

## 为什么是 fork 而不是原地编辑

宿主的会话日志是 append-only 的（`session/session-fork` 只接受「在某个 seq 处切一个前缀」），没有原地改写某条已提交消息的 RPC。所以唯一正确的做法是分叉出一个新会话，把旧上下文带过去 —— 这也是官方 UI 里「分支」按钮用的机制。

## 安装

### 一行命令

```powershell
git clone https://github.com/yangmingzhou-restart/dsh-rewind-resend.git
cd dsh-rewind-resend
pwsh -File install.ps1
```

重启 DSH 桌面端即可（bundle 只在启动时进 boot graph）。脚本是幂等的，`-Uninstall` 可以卸掉。

### 手动

profile（默认 `%USERPROFILE%\.dsh\profiles\desktop`）里：

1. `node_modules\dsh-rewind-resend` 指向本目录（junction 即可）；
2. `package.json` 的 `dependencies` 加 `"dsh-rewind-resend": "file:<本目录>"`；
3. `dsh.profile.bundles` 末尾加 `"dsh-rewind-resend"`；
4. 重启桌面端。

## 边界情况

- **这条消息就是第一轮**：前面没有可 fork 的完整回合，退化成开一个全新的空会话并把文本预填进去。
- **消息里带图片/附件**：只恢复文字（`type: "text"` 的块），附件需要重新添加。
- **没有人类消息**（比如只看不说的会话）：胶囊不显示。
- **分叉失败**（`session/fork-unavailable` 等）：胶囊变红显示失败原因，5 秒后恢复，原会话不受影响。

## 依赖

无。只用到客户端公开服务 `sessions`（`binding` / `fork` / `retain`）、`uiWorkspace`（`openSession` / `startSession`）、`conversation`（`input.requestDraftInitialization`），不碰宿主、不写文件。

## 已知限制

- 胶囊挂在 `conversation.composer.dock`，和官方的 Activity / Usage 胶囊同一行；如果你装了会隐藏整行 composer dock 的皮肤插件，胶囊也会一起消失。
- 只支持「最近一条」人类消息；要改更早的消息，请先用官方的「分支」按钮分叉。

## 目录

```
lib/index.js       宿主半边：只提供一个空的 apply，让包能被宿主与浏览器两侧的 roster 加载
lib/client.js      客户端半边：胶囊组件 + 停/分叉/预填/打开 的完整流程
cordis.patch.yml   浏览器侧插件 roster
install.ps1        装进 desktop profile（junction + dependencies + bundles）
```

## License

MIT
