---
description: "一个组合包装齐 dsh-forge-studio 全部插件：便签、记忆、计费、日报、智能体工坊。"
kind: "package-bundle"
---

# @zzerx/dsh-forge-studio-profile

[English](README.md) | 简体中文直接阅读

## 概述

dsh-forge-studio 全家桶组合包。安装本包会通过 npm 依赖一并装齐五个子插件，并把它们作为五个插件行插入 profile，一个开关整体启停：

| 子插件 | 说明 |
|---|---|
| [`@zzerx/dsh-plugin-notes`](../plugin-notes) | 便签板：纸卡墙 + 任务泳道 + 定时任务 |
| [`@zzerx/dsh-plugin-memory`](../plugin-memory) | 记忆与进化：全局/项目双作用域记忆 |
| [`@zzerx/dsh-plugin-usage-billing`](../plugin-usage-billing) | 用量与计费显示 |
| [`@zzerx/dsh-plugin-daily-log`](../plugin-daily-log) | 每日工作日志：日报/周报/月报 |
| [`@zzerx/dsh-plugin-agent-studio`](../plugin-agent-studio) | 智能体工坊：自定义单/团队 Agent |

## 安装

```sh
# 桌面版：插件页直接输入包名安装
@zzerx/dsh-forge-studio-profile

# CLI：
dsh plugin --profile web add @zzerx/dsh-forge-studio-profile
```

安装后默认启用；插件页可整体开关，也可对单个子插件行单独 disable。

> 注意：如果你已经单独安装过其中某个子插件，请先移除再安装本组合包，避免同一插件出现两行。

## 双轨分发

五个子插件仍各自独立发布 npm，可按需单装；本组合包只是叠加的分发层，版本范围跟随子插件主版本演进。

## 实现

运行时内容只有 [`cordis.patch.yml`](cordis.patch.yml)：五行 `insert` 与各子插件自身 patch 完全一致（同 id、无 config）。子插件作为传递依赖时其自带 patch 不生效，因此由本包代插。
