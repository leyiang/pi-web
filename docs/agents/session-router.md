# 会话路由（Downstream MVP）

## 用户行为与普通聊天隔离

- 裸首页显示 `SessionRouter`；`?session=` 和 `?cwd=` 保持原来的指定会话/新对话入口。首页忽略标签页记忆，不自动跳入旧对话。
- 输入任务后调用 `POST /api/session-router`。明确目标时跳转，并通过 ChatWindow 的独立 `initialPromptFollowUp` 路径发送用户原文；使用现有 `prompt` + `streamingBehavior: "followUp"`，由 Pi 原子决定立即开始还是排队，不中断正在运行的会话。
- 不明确时展示已读取的候选，由用户选择后才发送。请求失败、取消、目标不存在时保留输入，且不发送。目标选择前再读一次普通会话接口，防止失效目标。
- 普通手动发送和引用分支的 initialPrompt 仍走原来的 `handleSend`；路由入口不修改它们的模型、工具或配置。
- 路由请求 ID 在 AppShell 去重；initialPrompt 在挂载内只消费一次，不持久化待发送任务。刷新不自动重发。用户切换会话或新建对话时清掉尚未投递的路由任务。

## 只读 AI 与 Skill

- 模型固定为 `openai-codex / gpt-6-luna`，路由思考强度为 `high`。真实污染样例中 low 曾忽略已经搜到的正确候选；high 配合正文搜索/证据约束实测能选对。来自当前实例现有 ModelRuntime 和登录凭据；找不到时明确报错，不静默换模型。
- Skill 位于 `bin/skills/route-session/SKILL.md`，随 release 的 bin 打包。调整检索规则优先修改该 Skill，不另造自主执行框架。
- 使用 Pi SDK 临时会话（`SessionManager.inMemory`、内存设置），只注册/启用 `list_sessions`、`search_sessions`、`read_session`、`open_session`。启动后核对实际工具集合。没有文件写入、shell、MCP、项目指令或发现式扩展；不会生成路由 JSONL 或修改目标会话。
- 模型定义复用既有的全局扩展加载 ModelRuntime；路由会话自己的 ResourceLoader 不发现/运行项目或个人扩展与上下文文件。
- `open_session` 只返回选择意图；必须先进行正文搜索并读取目标。当前版本要求目标在最后一次 search_sessions 返回的候选页中，且 evidence 必须是实际读过的助手/摘要的原文片段（不是用户问题），否则拒绝。不发送消息。禁止通过解析模型普通回复中的 JSON 来驱动导航。
- 每次请求最多 12 个模型回合、24 次工具调用、90 秒；服务最多同时运行两个路由请求。取消信号触发 SDK abort，最终 unsubscribe/dispose。

## 上下文可见范围

- 只读取当前实例会话目录的 catalog；开发服与正式服仍各用各的数据，没有跨实例读取。
- 不接受模型给出的文件路径，只接受 catalog 内 ID。过滤 subagent 和未落盘的临时会话。
- 最近优先：工具复制 catalog 后按 modified 倒序、created 倒序稳定排序，不依赖上游顺序、不修改原列表。第一次 list_sessions 固定返回最近 30 个会话，不应用 query/offset/includeOlder；默认后续搜索仍限定这 30 个。只有显式 includeOlder=true 才扩大到全部会话并支持每页 30 条分页。Skill 要求近期无匹配时才扩大范围，同一事项优先最近的相关进度，而非最新但无关的会话。
- 不提前生成搜索词或预选答案。search_sessions 仅在 Agent 调用后，以它给出的 query/match 扫描正文；默认最近 30 个，includeOlder 显式扩大范围。空白分隔词支持 all/any 匹配，返回每个会话的命中消息数、最多 5 条带角色/时间/offset 的片段，每页 8 个会话。失败文件明确列在 unavailable 中。
- read_session 只接受 list_sessions 或 search_sessions 已展示的 ID，可用命中 offset 读更早的消息；query 可让长消息预览定位到命中词附近。模糊候选列表按时间排序，而非模型读取顺序。读取和搜索都沿 JSONL 最新叶子的父链，只包含用户/助手文本和 compaction 摘要，不包含废弃分支、toolResult、thinking、签名或图片。
- 文本分页：每页 12 条、每条最多 2000 字符；文件最多 32 MiB，超限明确拒绝。直接只读解析，不通过可能迁移旧文件的 SessionManager.open。
- 历史内容是不可信检索资料，不是新的指令。Skill 明确禁止执行历史正文中要求的动作。

## “回到上一个聊天”是手动导航

- `lib/last-chat.ts` 在 localStorage 的 `pi-web:last-chat` 只记录最近选中的会话 ID。只在选择 ID 变化时更新，避免元数据刷新覆盖其他标签页的新选择。
- 路由页初始化只读该 ID（兼容本标签页旧 sessionStorage 会话 ID），不自动打开。跨标签页 storage 事件只更新按钮的目标，不导航。
- 按钮点击后验证目标并复用正常选中会话行为；不调用路由模型、不填充 initialPrompt、不发送任务。没有历史时禁用；404 时清理对应记录并提示，不跳入其他会话。
- 原 `pi-web:last-open-by-workspace` 的自动恢复路径保持删除。

## 验证入口

- `lib/session-router-tools.test.mjs`：四工具隔离、最近 30 个倒序、Agent 显式调用才搜索、完整正文命中/offset、搜索与读证据校验、选择一次、取消/预算、分支与敏感块过滤、分页。
- `app/api/session-router/route.test.mjs`：参数/Content-Type、原文、错误脱敏、缺失模型、取消与并发配额。
- `components/ChatWindow.routed-prompt.test.mjs`：普通 initialPrompt 与路由 follow-up 分流、加载错误、重复消费/请求。
- `lib/last-chat.test.mjs`：手动目的地记忆、删除与 storage 不可用。
- `scripts/diagnose-session-router.mjs --message '<用户原文>'`：直接运行真实 Luna，记录其自主搜索词和实际读取的会话，不提前搜好/提供答案，也不转发任务。可用当前实例真实数据排查准确率；不要只依赖标题清晰的合成样例。
- `scripts/test-session-router-live.mjs`：显式运行，真实 Luna + 内存候选资料，验证选中目标而不执行/发送任务。使用当前环境指定的 `PI_CODING_AGENT_DIR`，会产生模型调用费用。
- `scripts/test-session-router-ui.mjs`：真实开发界面 + 拦截的合成会话/发送请求，覆盖桌面、手机、运行中会话、原文转发一次、刷新不重发、模糊匹配、失败、普通聊天和手动返回。不会向真实聊天发送测试任务。
- 修改后仍必须执行 AGENTS.md 的真实开发域名健康检查；手机尺寸模拟不等同于真实设备验证。
- 全量回归中，终端继承的 `ANTHROPIC_API_KEY` / `ANTHROPIC_OAUTH_TOKEN` 会污染 models-route 和 Chat-only 的隔离模型断言。遇到这两个失败时，仅对测试子进程临时 unset 后重跑，不能修改开发/正式实例的真实凭据。
