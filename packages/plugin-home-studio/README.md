# @zzerx/dsh-plugin-home-studio

Forge Studio 主面板的 dsh 插件形态 —— **骨架占位**，UI 待填充。

## 现状

- host：空占位（`src/index.ts`），不注册任何能力
- client：空占位（`src/client/index.ts`），不注册任何 slot
- 图标：统一 lucide-react（`src/client/icons.ts` 为占位图标入口，见注释用法）

## 启用进 web profile（骨架阶段勿启用）

把 `@zzerx/dsh-plugin-home-studio` 加进 `.dsh-home/profiles/web/package.json`
的 `dsh.profile.bundles` 列表后执行：

```bash
pnpm --filter @zzerx/dsh-plugin-home-studio build
pnpm install   # 更新 profile 锁文件
pnpm dev
```

## 开发

```bash
pnpm --filter @zzerx/dsh-plugin-home-studio typecheck   # tsc --noEmit
pnpm --filter @zzerx/dsh-plugin-home-studio test        # vitest
pnpm --filter @zzerx/dsh-plugin-home-studio build       # lib/index.js + lib/client.js + lib/types
```

范式参照 `@zzerx/dsh-plugin-notes`：host 侧 storage-domain 数据后端 +
Typert remote 直连 client UI；依赖只指向 Service Definition 包。
