---
description: 所有 AI 助手（Claude、Cursor 等）共用的核心项目规则
---

**在对本项目的代码做出任何修改之前，你必须先阅读本文！！！**

## 1. 核心功能说明

本项目"MCSManager"是一个面向 Minecraft 和 Steam 游戏服务器程序的 Web 管理面板，发布在 GitHub 上。它由三个子项目组成：Web 前端、Web 后端和 Daemon（守护进程）。它支持分布式部署架构，提供多用户、文件管理、环境管理和 Docker 管理等功能。

项目的所有功能都围绕**实例**（`daemon\src\entity\instance\instance.ts`）和**用户**展开。项目只有两种角色，各自拥有不同的权限集合（`panel\src\app\entity\user.ts`）：

### 角色概述

- **管理员**：拥有完全控制权：创建实例、配置实例、创建用户、分配实例，是整个面板的最高权限。
- **普通用户**：权限受限：**只能操作管理员分配给自己的实例**，不得超出管理员允许的范围；必须禁止普通用户以任何方式在宿主机上执行任意命令；文件管理模块也必须禁止在未授权的情况下访问实例工作目录之外的文件。

### 核心功能与权限对照

| 管理员 | 普通用户 | 能力                                                         |
| ------ | -------- | ------------------------------------------------------------ |
| 是     | 否       | 完整地管理、删除和创建实例（基于模板 / Docker 镜像）         |
| 是     | 否       | 配置实例（启动命令、更新命令、高级容器化参数）               |
| 是     | 否       | 普通用户管理，将实例分配给用户                               |
| 是     | 是       | 实例操作：启动、停止、重启、更新、实例终端、发送命令         |
| 是     | 是       | 文件管理：上传、下载、删除、解压、移动、编辑                 |
| 是     | 是       | 配置文件更新：Minecraft、Steam 及其他游戏服务器的配置，安装 Mod/插件 |

> 注意：服务器既可以运行在 Docker 容器内，也可以直接以进程方式运行，其终端可以通过网页访问；上述普通用户的实例操作仅限于分配给他们的实例，且不得超出管理员允许的范围（通过 Docker 容器和文件权限检查等手段来保证）。

因此，当你修改功能或实现需求时，**必须从安全角度仔细思考，确保新的改动不会引入安全或性能问题**。

## 2. 项目结构

- **`panel/`**：Web 后端（Koa）：用户、节点、认证、API。入口 `panel/src/app.ts`，webpack 打包 → `production/app.js`。
- **`daemon/`**：Node 工作进程：实例进程、容器、文件、终端。入口 `daemon/src/app.ts`。
- **`frontend/`**：Vue 3 + Vite 界面。与 panel 通信；部分功能直接与 daemon 通信以减轻负载。
- **`common/`**：作为 `mcsmanager-common` 发布的共享库。panel/daemon 通过 tsconfig `paths` + webpack `resolve.alias` 把它别名到**源码**（`common/src/index.ts`），所以改动会被直接编译进两个应用，无需发布步骤，但每个应用都必须重新构建才能生效。
- **`languages/`**：位于根目录的 i18n JSON，由三个子项目共用（`@languages` 别名）。文件名使用大写区域（`en_US.json`）；运行时的语言代码是小写的（`en_us`），不要混淆。

## 3. OpenSpec 开发流程（强制）

本仓库中所有非琐碎的开发都要走 **OpenSpec**（规格驱动开发）。流程相关的 skill 位于 `.agents/skills/openspec-*`（与工具无关，所有 AI 工具共用）；产物位于 `openspec/`（`config.yaml`、`specs/`、`changes/`）。**如果任何通用的流程类 skill（头脑风暴、规划、TDD 启动等）与本节冲突，以本节为准。**

**必须遵循 OpenSpec**（propose → implement → archive）：

- 新功能或行为变更（任何模块）
- 跨模块或对外接口的变更（API、实例配置、数据格式、节点/面板协议）
- 改变各组件组合方式的重构性变更

**可豁免**（直接实现即可）：

- 不改变行为约定的 bug 修复
- 不改变行为的纯重构
- 仅涉及测试或文档的改动、依赖升级、单文件的小补丁

**流程：**

1. 还不确定要做什么？先用 [`openspec-explore`](.agents/skills/openspec-explore/SKILL.md) skill 权衡各种方案，再做决定。
2. [`openspec-propose`](.agents/skills/openspec-propose/SKILL.md) `<change-id>`：创建 `openspec/changes/<change-id>/`（proposal.md、specs/、design.md、tasks.md）。
3. **在写任何代码之前**由人审阅这些产物；需要时通过 [`openspec-update-change`](.agents/skills/openspec-update-change/SKILL.md) 修订。
4. [`openspec-apply-change`](.agents/skills/openspec-apply-change/SKILL.md)：实现各项任务。每个任务都以其对应的测试套件收尾（§4、§10）；§10 的测试闸门依然适用，必须通过后才能把任务标记为完成。
5. [`openspec-archive-change`](.agents/skills/openspec-archive-change/SKILL.md)：把变更移动到 `openspec/changes/archive/`，并将规格增量同步到 `openspec/specs/`（[`openspec-sync-specs`](.agents/skills/openspec-sync-specs/SKILL.md)）。

长期有效的项目知识保存在本文件和 `docs/` 中；`openspec/config.yaml` 只承载用于生成产物的简明约束。升级 CLI 之后，请在仓库根目录运行 `openspec update` 以刷新生成的 skill。

## 4. 命令

- 安装：`./install-dependents.sh`（或 `.bat`）：安装所有依赖包并构建 `common`（根目录的 `npm run preview-build` 实际上是构建 common，尽管名字不像）。Node.js 22.23.4+（CI 运行 22.x）。
- 开发：`npm run dev`（同时运行三个）或 `npm run panel` / `npm run daemon` / `npm run frontend`（每个都是 nodemon → `npm run build` → 运行 `production/app.js`）。
- 按包构建：`cd panel|daemon && npm run build`（webpack + ts-loader）；`cd frontend && npm run build`（`type-check` + vite）；`cd common && npm run build`（tsc → `dist/`）。
- **完成前的验证**：**强制要求：在修改了*任何*模块的代码之后，你必须运行相关的测试套件并在完成前汇报结果。没有运行测试，绝不能声称改动已完成。** `common`、`daemon`、`panel`、`frontend` 都有 vitest 套件（`cd <module> && npm test`）；修改 `common/` 需要运行 common + daemon + panel，因为两个应用都直接别名到 `common/src`（见 `mcsmanager-test` skill）。使用 [`mcsmanager-test`](.agents/skills/mcsmanager-test/SKILL.md) skill 中的一次性循环来运行**所有**套件。前端另外需要：`npm run type-check`、`npm run lint`（eslint `--fix`）；涉及 TS 类型时，先运行 type-check 再运行 lint/test；panel/daemon 的 webpack `npm run build` 就是它们的类型检查。
- 发布包：`./build.sh` / `build.bat` → `production-code/`（`BUNDLE=1` 会把所有依赖和语言包内联成一个独立的 `app.js`）。平台二进制文件（`daemon/lib` 中的 PTY / Zip-Tools，见 `lib-urls.txt`）**不会**被打包，终端和压缩功能在运行时需要它们，见 DEVELOPMENT.md。完整的构建与部署指南：项目 Agent Skill [`mcsmanager-build`](.agents/skills/mcsmanager-build/SKILL.md)（位于仓库内、与工具无关的 `.agents/skills/` 中，所有 AI 工具共用；简要摘要见 [`docs/build-production.md`](docs/build-production.md)）。
- i18n 工具：`npm run i18n`、`npm run sort-lang-keys`、`npm run scan-useless-key`（见 §6）。
- Prettier：`printWidth: 100`，`trailingComma: "none"`。

## 5. 持久化

- 所有 JSON 数据模型都通过 `StorageSubsystem`（`common/src/system_storage.ts`）持久化：先写临时文件再重命名，保存为 `data/<Category>/<uuid>.json`，实现原子写入。配置/数据存储不要自己手写 `fs.writeFile`。
- Panel 端：使用 `Storage.getStorage().store(...)`（`panel/src/app/common/storage/sys_storage.ts`），配置了 `redisUrl` 时它会透明地切换到 Redis。Daemon 直接使用 `StorageSubsystem` 单例。
- 敏感文件（绝不能记录其内容）：`daemon/data/Config/global.json`（panel↔daemon 的密钥）、`panel/data/User/*.json`（apiKey、密码哈希、2FA 密钥）、`panel/data/RemoteServiceConfig/*.json`（节点 apiKey）。

## 6. 通用编码规则

- **最小改动**：优先做小而聚焦的修改。添加新逻辑之前，先检查相关子项目中已有的 `hooks`、`services`、`stores`、`utils`，能复用就复用。
- **代码和注释使用英文**；面向用户的文本走 i18n（后端日志除外）。
- 追求高内聚、低耦合、可复用的代码。

## 7. i18n 约定

- **前端（Vue）**：使用来自 `@/lang/i18n` 的 `t()`（vue-i18n）。**后端/daemon**：使用来自 `panel/src/app/i18n` / `daemon/src/i18n` 的 `$t()`（i18next）。
- 键使用 `TXT_CODE_` 前缀。两种风格并存：手工编写的描述性键（`TXT_CODE_system_instance.autoStart`）和自动生成的 `TXT_CODE_<crc32hex>` 键。
- 源文本：`languages/en_US.json` 中简短、正确的英文；其他语言是它的翻译。

### 7.1 带参数的字符串：占位符语法不同

- **前端**：一对花括号 `{name}`（vue-i18n）。
- **后端/daemon**：双花括号 `{{uuid}}`（i18next）。

```json
{
  "TXT_CODE_FILE_ERROR": "File {name} error!",
  "TXT_CODE_INSTANCE_ERROR": "Exception instance {{uuid}}: {{err}}"
}
```

```vue
<template>{{ t("TXT_CODE_FILE_ERROR", { name: props.fileName }) }}</template>
```

```ts
const errorMsgWithParams = $t("TXT_CODE_INSTANCE_ERROR", {
  uuid: instance.instanceUuid,
  err: err
});
```

### 7.2 `npm run i18n` 会改写源文件

`i18next-scanner`（`i18-scanner.config.js`）会找出 `t()`/`$t()` 调用中的字面量字符串，并**直接原地改写源文件**，把字面量替换为生成的 `TXT_CODE_<crc32>` 键，然后只写出 `languages/zh_CN.json` + `en_US.json`（其他语言单独维护，例如 `scripts/auto-translate.mjs`）。请谨慎运行，并检查它在 `src/` 中产生的 diff。

## 8. 后端约定（`daemon/src/**`、`panel/src/app/**`）

- 文件夹名称表达分层（routes、middleware、services、instances 等），新代码要放在正确的层里。
- 使用项目的 **logger**，不要使用裸的 `console.*`；根据上下文选择日志级别。
- 外部资源（文件、网络、容器、shell）：先校验输入/边界；失败时记录日志后重新抛出，或返回带类型的结果，绝不能悄悄吞掉。
- 安全：严格解析/校验容器和命令配置（长度、格式、允许的取值）；绝不要把未经校验的前端输入直接传给 shell 参数或路径操作。
- 长期存在的结构（Map、队列、缓冲区、流）需要有相应的清理，避免无限增长。

## 9. 前端约定（`frontend/src/**/*.vue`）

- Vue 3 `<script setup lang="ts">`；优先使用带明确类型的 `const`。
- 把复杂逻辑按职责抽取到 `hooks/`（组合式函数）中；把复杂的模板块抽取成组件。
- 单向数据流：props 向下，events 向上，绝不直接修改父级状态。

## 10. 测试与构建约定

- **测试驱动开发的思维方式**：每个模块都有 vitest 套件；后端有**两**层：纯单元测试 + 真实进程集成运行器。
- **测试闸门**：完成任何新需求或功能变更之后，你**必须使用** [`mcsmanager-test`](.agents/skills/mcsmanager-test/SKILL.md) skill，或手动运行 `npm run test` 和 `npm run test:integration`，进行完整的测试检查。这条测试约定是强制的。
- **生产构建与部署**：在修改 `build.bat` / `build.sh`、`prod-scripts/`，或部署 `production-code/` 之前，先阅读项目 Agent Skill [`.agents/skills/mcsmanager-build/SKILL.md`](.agents/skills/mcsmanager-build/SKILL.md)。它记录了 `BUNDLE=1` 的打包模型、`daemon/lib` 外部二进制文件、运行时 `data/` 的目录结构（包括敏感文件和成对密钥迁移）、运行/停止命令以及部署后验证清单。它位于仓库内、与工具无关的 `.agents/skills/` 目录（opencode 及其他兼容 agent 的工具会自动发现），所以在支持的工具中，构建/编译等关键词会自动触发它；简要摘要见 [`docs/build-production.md`](docs/build-production.md)。
- **后端集成测试（真实 daemon + panel，`common/test/integration/`）**：权威的后端集成测试层；**API 和用法参考见 [`docs/integration-test-framework.md`](docs/integration-test-framework.md)**，修改该套件之前请先阅读。它会启动真实的 daemon + panel（panel 以 `--unsafe-integration-test-mode=<key>` 启动），然后在隔离的 `mkdtemp` 工作区中通过真实的 HTTP + socket.io 驱动整个后端，不使用 mock。
