# @forge-studio/dsh-plugin-notes

Forge Studio 便签（F1）的 dsh 插件形态：agent 工具 + `/note` 命令 + 对话流便签板。

## 能力

- **host**
  - `ctx.notes` 服务（storage-domain 持久化，`notes` 域，per-record 布局）
  - 工具：`notes_create` / `notes_list` / `notes_update` / `notes_delete`
  - 命令：`/note add <标题>[: 正文]`、`/note list`、`/note rm <id>`、`/note pin|unpin <id>`
  - 设置命名空间 `forge-studio.notes`（`maxVisibleNotes` / `defaultTitle`）
- **client**
  - `note-list` 会话节点：折叠 `note/listed` 快照事件为便签板卡片（last-write-wins）
  - 板内新建/编辑走 tiptap 编辑器，保存即向会话发 `/note` 命令
  - 设置卡片（settings.plugin.item，key=`forge-studio.notes`）

## 事件

`note/listed`（SessionEventMap 合并）：每次变更后写入完整列表快照 + 会话内
`revision`（从日志已有事件数推导，恢复后继续递增）。client 节点以
`revision === 1` 判定 start、其余为 update；窗口中部开始的会话回退渲染最近快照。

## 开发

```bash
pnpm --filter @forge-studio/dsh-plugin-notes typecheck   # tsc --noEmit
pnpm --filter @forge-studio/dsh-plugin-notes test        # vitest
pnpm --filter @forge-studio/dsh-plugin-notes build       # lib/index.js + lib/client.js + lib/types
```

## 安装进 web profile

```bash
pnpm --filter @forge-studio/dsh-plugin-notes build
pnpm dsh -- plugin --profile web add "D:/codes/dsh-desk-studio/packages/plugin-notes"
pnpm dev
```

依赖只指向 Service Definition 包；client 对跨插件值一律 type-only import
（`scripts/build.mjs` 把 `dsh.client.inject` 声明的平台包外部化，避免注册表重复实例化）。
