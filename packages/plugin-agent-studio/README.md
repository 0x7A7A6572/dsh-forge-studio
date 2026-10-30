# @zzerx/dsh-plugin-agent-studio

给 DeepSeek Harness 的「智能体工坊」插件：自定义单 Agent / 团队 Agent，在会话内选择并启动；每个 Agent 可以有自己的 **preset、模型、推理档位、角色提示词**，并且任何 Agent 都能调用 `delegate_agent` 找合适的 subagent 帮忙。

一期不含像素面板。

## 功能

- **Agent 库**：名字、显示名、职责、角色提示词、默认任务、preset、provider/model、reasoning effort、fresh/fork、委派深度。
- **团队模板**：从 Agent 库挑成员组成团队；每个成员保留自己的 preset/model。
- **会话内选择**：会话头部 `Studio` 面板选择「不启用 / 单人 / 团队」，保存到该会话；点「启动」才真正派活。
- **团队走官方 Agent Teams**：roster、任务板、消息、interrupt、冷恢复都复用官方能力；插件只通过运行时 seam 把每个成员的 `agentPreset` / `agentOptions` 注入 `spawnTeammate`，不改官方文件。
- **Agent 互相调用**：`delegate_agent({ agent, task, context })` 让 Lead / teammate / solo 按 profile 启动 subagent；`list_agent_profiles` 列出可用名字。
- **动态提示**：当前会话选了团队/单人时，注入一小段提示，告诉模型当前阵容和可用工具；不选时零注入。

## 安装

```sh
dsh plugin --profile web add @zzerx/dsh-plugin-agent-studio
```

重启宿主，在 **设置 → 智能体工坊** 建 Agent / 团队。

### 前置条件

- DSH `>= 0.2.1-alpha.2`（seam 依赖 `subagents.startActivation`）。
- 团队模式需要官方 `@deepseek-ai/dsh-experimental-agent-team-profile` 已启用；没有官方 Team 时单人/`delegate_agent` 仍可用。
- 团队成员的独立 preset 只能是**已存在**的 preset；本插件不创建/编辑 preset（官方没有运行时 API）。

## 使用

1. 设置 → 智能体工坊 → 新建 Agent：填名字、角色提示词、模型/preset。
2. （可选）新建团队：把 Agent 加进成员列表。
3. 会话头部点 `Studio` → 选单人/团队 → 保存选择。
4. 填本次任务 → 启动。
5. 需要临时帮手时，直接让 Agent 调 `delegate_agent`，或自己用 `list_agent_profiles` 看可用名字。

## 实现

- `src/seam.ts`：包装 `agentTeams.spawnTeammate`（AsyncLocalStorage 捕获 Lead + 成员名 + context）与 `subagents.startActivation`（注入 `agentPreset` / `agentOptions`）。实例 + 原型双装，可还原；找不到 seam 时团队启动 fail-closed。
- `src/service.ts`：`ctx.agentStudio`，负责 profiles/teams/bindings/assignments 存储、solo/team launch、roster。
- `src/agent/tools.ts`：`delegate_agent` / `list_agent_profiles`。
- `src/agent/prompt.ts`：动态 systemPrompt.context。
- `src/client/`：设置分区与会话头部面板。

## 限制

- seam 依赖官方内部方法；DSH 升级后可能失效。失效时团队启动会明确报错，不会静默让成员继承 Lead。
- 官方 roster 是 append-only：不支持 rename/delete teammate；同一个会话里名字不能复用。
- 团队模式最多受官方 `maxMembers` 限制（本机 profile 默认 8）。
- 团队成员的 preset 必须已存在；不能在 UI 里新建 preset。
- 一期没有像素面板。
- 与其它同样包装 `spawnTeammate` / `startActivation` 的插件可能冲突，建议只启用一个。

## 开发

```sh
pnpm --filter @zzerx/dsh-plugin-agent-studio typecheck
pnpm --filter @zzerx/dsh-plugin-agent-studio build
pnpm exec vitest run scripts/agent-studio-*.spec.ts --pool=threads
```

## License

MIT
