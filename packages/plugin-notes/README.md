# @forge-studio/dsh-plugin-notes

Forge Studio 便签 的 dsh 插件形态：**独立便签板 UI**（侧栏入口 + 全屏浮层），
host 侧只作为数据后端（storage-domain）与设置源。

## 能力

- **host**
  - `ctx.notes` 服务（storage-domain 持久化，`notes` 域，per-record 布局）
  - 经 Typert Gateway 以 SRC 模式暴露 `notes/*` 端点，client 直连读写
  - 设置命名空间 `forge-studio.notes`（`defaultTitle`）
- **client**
  - 侧栏入口按钮（sidebar.footer.action）：开/关便签板
  - 便签板浮层（shell.overlay）：**行式列表 / grid 纸卡墙**双视图（Win11 便签式
    六色纸卡，置顶优先）切换 + **文字搜索**（标题+正文纯文本，实时过滤）+
    **按颜色多选筛选**（只作用于活动区）+ 底部**归档折叠区**（默认收起，
    展开才渲染）；列表**懒加载**：首批 8 条，滚动触底分批展开（活动区优先，
    归档区展开后同样分批），全部便签最终可见
  - 便签可**归档**：归档后移出活动区、折叠在列表底部，可恢复/编辑/删除
  - 正文以 Markdown 存储：格式操作栏（加粗/标题/列表/引用/代码/撤销重做），
    `Ctrl+Enter` 保存；卡片展示 Markdown 摘要
  - 编辑器内直接 **Ctrl+V 粘贴图片**（剪贴板图片 → data URL 内联进正文 Markdown）
  - **便签板设置弹窗**（header 齿轮）：编辑默认标题，直接读写命名空间 scope，
    不再占用插件设置页
  - client 结构：`views/`（页面：入口/浮层主体/编辑页，浮层仅做数据控制与
    路由出口）、`components/`（复用组件：纸卡/行/色筛/搜索与归档折叠/设置弹窗/
    编辑器等）、`core/`（状态/路由/远程通道/纯函数/工具）；页面切换走
    `notes-nav` 状态路由（列表 ⇄ 编辑），设置弹窗为独立浮层层

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
