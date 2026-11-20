# 自动更新：面板与守护进程自更新

本文档是 MCSManager 自动更新功能的参考文档。在修改 `**/upgrade_*`、`common/src/upgrade.ts`、`scripts/*update*`，或 `Settings.vue` / `NodeItem.vue` 中的更新界面之前，请先阅读本文。

> 历史说明：该功能最初是在过去某个 AI 工作流时代设计和测试的，当时的设计文档从未迁移到本仓库。
> 那些笔记本身也已部分过时（例如 `allowAutoUpdate` 开关和设置页顶部横幅已被移除；
> 现在的界面位于左侧标签栏）。本文反映当前的实际实现，是权威参考。

## 1. 概览

运维人员可以直接在 Web 界面中更新**面板（web）**以及任何**远程守护进程（节点）**，无需手动替换文件，也无需 SSH。更新是**手动且显式**的；不会在后台下载或应用任何内容。

| 目标 | 触发入口 | 更新内容 |
| --- | --- | --- |
| 面板 | 设置 → "自动更新"标签页 → "更新面板"按钮 | `app.js`、`package.json`、`public/`（前端产物），以及更新包中包含的其他内容 |
| 守护进程 | 节点卡片 → 操作按钮组 → "更新守护进程" | 守护进程的 `app.js`、`package.json` 等；各平台专用的 `lib/` 二进制文件（PTY/Zip-Tools）不会被替换 |

两种流程都会从运维人员配置的**更新源**（`updateSourceUrl`，一个清单 URL，默认为官方 GitHub Release 上发布的清单）下载更新包，并将整个包覆盖到安装目录。新版本只有在**手动重启**后才会生效：界面会弹出"重启以应用更新"的对话框，进程日志中也会记录提醒，不会自动重启。

> **更新源（自 GitHub Release 流水线起）：** 默认的 `updateSourceUrl` 是官方 Release 的更新清单资源，
> `https://github.com/MCSManager/MCSManager/releases/latest/download/mcsmanager_update_manifest.json`。
> 每个 Release 会发布 `mcsmanager_update_manifest.json`，以及仅含代码的更新包
> `mcsmanager_web_update.tar.gz` 和 `mcsmanager_daemon_update.tar.gz`
>（只包含构建出的 `app.js`/`package.json`/`public/`，不含依赖目录、
> PTY/Zip-Tools 二进制文件和运行时）。清单中的 `url` 字段固定指向生成它们的 Release 标签。
> 仍把旧版 mcsmanager.com 源作为*主源*的安装，会在启动时迁移到新的默认值
>（`migrateLegacyUpdateSourceUrl`）；运维人员自定义的源 URL 永远不会被改动。
> 自定义源仍然支持 zip 包。

> **备用更新源（`updateSourceUrlFallback`）：** 每一端都通过一个有序的两候选列表解析清单：
> 先 `updateSourceUrl`，再 `updateSourceUrlFallback`（默认：
> `https://mcsmanager.com/upgrade/manifest.json`，即旧版 mcsmanager.com 托管）。
> 主源出现获取层面的失败（超时、连接错误、HTTP 非 2xx、重定向次数超限、JSON 无效）时会转向备用源；
> 能够解析的清单会被直接使用（语义问题不会跨源重试）。
> **只有当两个字段都为空时**该功能才会被禁用，只清空主源并不会禁用更新检查。
> 两个字段都可以在设置 → 自动更新页面中编辑，并持久化到配置文件中。
>
> 运维提示：备用清单和 zip 包托管在 GitHub Release 流水线之外，发布新版本时必须同步刷新，
> 否则通过备用源检查时，会对照旧的镜像版本报告"已是最新"。

## 2. 架构 / 数据流

```
frontend
  Settings.vue (autoUpdate tab)              node/NodeItem.vue (update icon + button)
      |  GET/POST /api/upgrade/panel*            |  GET/POST /api/upgrade/daemon*
      v                                          v
panel/src/app/routers/upgrade_router.ts --(socket.io "upgrade/*", forwards both source URLs)--> daemon/src/routers/upgrade_router.ts
      v                                          v
panel/src/app/service/upgrade_service.ts   daemon/src/service/upgrade_service.ts
      \_______________ both build on ______________/
                       common/src/upgrade.ts
        fetchJson -> downloadToFile -> extractArchive -> applyUpgradePackage  (then: manual restart)
                                |
                                v
     updateSourceUrl -> updateSourceUrlFallback -> manifest.json -> { web | daemon: { version, url, notes } } -> *.tar.gz | *.zip
```

`common/` 通过源码别名（tsconfig `paths` + webpack `resolve.alias`）编译进 panel 和 daemon，因此修改该目录后需要重新构建这两个应用。

## 3. 清单格式

`updateSourceUrl` 指向一个小型 JSON 文档。官方源是每个 GitHub Release 上发布的 `mcsmanager_update_manifest.json` 资源（由 `scripts/build-release-update-packages.mjs` 生成，该脚本同时会从同一个 `production-code/` 构建中打出两个更新 tarball）；自定义源可以在任意位置提供相同格式：

```json
{
  "daemon": {
    "version": "4.18.4",
    "url": "https://github.com/MCSManager/MCSManager/releases/download/v10.18.4/mcsmanager_daemon_update.tar.gz",
    "notes": {
      "en_us": "MCSManager Daemon v4.18.4\n- Bug fixes and performance improvements",
      "zh_cn": "MCSManager 守护进程 v4.18.4\n- 问题修复与性能改进"
    }
  },
  "web": {
    "version": "10.18.4",
    "url": "https://github.com/MCSManager/MCSManager/releases/download/v10.18.4/mcsmanager_web_update.tar.gz",
    "notes": { "en_us": "...", "zh_cn": "..." }
  }
}
```

- **`version`**：以点分隔的数字字符串。用 `compareVersions()`（`common/src/upgrade.ts`）比较：按 `.` 拆分，逐段按数值比较，缺失的段按 `0` 处理。这里有意**不使用**严格的 semver。可选的前导 `v` 会被忽略（`normalizeVersion`）。去掉 `v` 后仍不是点分数字的版本视为**格式错误**，按"失败即关闭"处理：永远不会作为更新被提供（`isComparableVersion`）。
- **`url`**：更新包的完整 http/https URL（会跟随重定向）。`.tar.gz`/`.tgz`（官方包）和 `.zip`（自定义源）都被接受。
- **`notes`** *（可选）*：新版本的发布说明，在版本扫描后显示在界面中：
  - 推荐形式：**语言区域 → 文本的映射**。键为运行时语言代码（小写区域，如 `en_us`、`zh_cn`，与 `toStandardLang()` 输出的形式相同）。匹配时不区分大小写和连字符，所以 `en-US` 也可以。
  - 普通**字符串**会被当作与语言无关的兜底文本。
  - 解析顺序（`frontend/src/tools/localizedNotes.ts::pickLocalizedNotes`）：精确匹配语言区域 → 基础语言（`zh_cn` → `zh`） → `en_us` → `en`；都不匹配则隐藏该区块。缺少英文条目视为清单格式错误。
- 顶层的 `daemon` / `web` 条目都是**可选**的；被更新的一端缺少对应条目时，会返回 `TXT_CODE_AUTOUPDATE_B_MANIFEST_MISSING`。

语言选择发生在**前端**（依据当前面板界面语言 `getCurrentLang()`），而不在后端：清单由 panel/daemon 服务获取，但只有浏览器知道用户实际看到的语言。因此后端会原样透传 `onlineNotes`（`string | Record<string, string>`）。

## 4. 关键组件

| 层 | 文件 | 作用 |
| --- | --- | --- |
| 共享 | `common/src/upgrade.ts` | `compareVersions`/`normalizeVersion`/`isComparableVersion`、`fetchJson`、`fetchJsonFromSources`（主源→备用源候选列表）、`downloadToFile`、`extractArchive`（`extractTarGz` + `extractZip`，均带路径穿越防护）、`applyUpgradePackage`（事务性覆盖）、`migrateLegacyUpdateSourceUrl` |
| panel | `panel/src/app/service/upgrade_service.ts` | 获取清单（使用 `web` 条目）、失败即关闭的版本比较、下载/覆盖（不自动重启） |
| panel | `panel/src/app/routers/upgrade_router.ts` | `/api/upgrade/panel_info`、`/api/upgrade/panel`、`/api/upgrade/daemon_info`、`/api/upgrade/daemon`（仅管理员）；将面板的更新源 URL（主源 + 备用源）转发给守护进程 |
| daemon | `daemon/src/service/upgrade_service.ts` | 与面板端相同，处理 `daemon` 条目；转发来的每个源字段都优先于守护进程本地对应的字段 |
| daemon | `daemon/src/routers/upgrade_router.ts` | socket.io `upgrade/info`、`upgrade/daemon` |
| 配置 | `panel/src/app/entity/setting.ts`、`daemon/src/entity/config.ts` | `updateSourceUrl` + `updateSourceUrlFallback`（默认值：GitHub Release 清单 URL / 旧版 mcsmanager.com 清单 URL；两者都为空 ⇒ 功能禁用）；旧版*主源*在两个 `version_adapter` 中迁移 |
| 发布 | `scripts/build-release-update-packages.mjs`、`.github/workflows/release.yml` | 打包 `mcsmanager_{daemon,web}_update.tar.gz`，并将 `mcsmanager_update_manifest.json` 作为 Release 资源写出 |
| 前端 API | `frontend/src/services/apis/index.ts` | `IUpgradeInfo` / `IUpgradeResult`、`getPanelUpgradeInfo`、`upgradePanel`、`getDaemonUpgradeInfo`、`upgradeDaemon` |
| 前端 UI | `frontend/src/widgets/Settings.vue` | 自动更新标签页：状态标签、源 URL 输入框（主源 + 备用源）、更新按钮、本地化的发布说明框 |
| 前端 UI | `frontend/src/widgets/node/NodeItem.vue` | 守护进程版本旁的更新图标 + 提示，操作按钮组中的"更新守护进程" |
| 前端工具 | `frontend/src/tools/localizedNotes.ts` | 发布说明的语言解析（有单元测试） |
| 测试工具 | `scripts/build-update-packages.mjs`、`scripts/update-test-server.mjs`、`scripts/verify-auto-update.mjs`、`scripts/verify-auto-update-strict.mjs`、`scripts/auto-update-test-utils.mjs` | 本地更新包 + 静态服务器 + 端到端验证（见 §6） |

## 5. 设计决策与理由

- **手动、显式更新。** 不在后台轮询更新，不做静默安装。运维人员通过刷新按钮或打开页面进行扫描，查看发布说明，再点击更新。
- **失败即关闭的版本检查。** 只有当清单获取/解析成功，且公布的版本是可比较的点分数字版本（`isComparableVersion`）并新于当前运行的版本时，才会提示"有可用更新"。获取失败（所有已配置的源都尝试过之后）、清单格式错误、版本格式错误，都意味着*不弹更新提示*，绝不会给出错误的提示。
- **带获取层回退的两候选源列表。** 清单解析通过 `common/src/upgrade.ts` 中的 `fetchJsonFromSources`，先尝试 `updateSourceUrl`，再尝试 `updateSourceUrlFallback`（跳过空值，合并重复项）。只有获取/解析失败（超时、连接错误、HTTP 非 2xx、重定向次数超限、JSON 无效）才会转向下一个候选；能解析的清单会被直接使用，所以缺少某一端条目或版本格式错误，都不会引发跨源重试。上报的 `updateSourceUrl` 是实际提供清单的那个 URL（所有获取都失败时为第一个已配置的候选，禁用时为空）。
- **双空才禁用。** 只有当两个源字段**都**为空时，更新检查才会关闭；只清空主源，备用源仍然生效（设置页的文案对此有明确说明）。默认的备用源是旧版 mcsmanager.com 清单，是一个真实的外部主机，因此端到端测试脚本总是显式管理这两个字段，以保持隔离。
- **整包覆盖**，而不是固定文件白名单（`app.js`/`package.json`/`public`）。更新包中包含的内容都会被复制覆盖，所以更新可以新增文件（例如新的前端资源）。运行时状态目录会被跳过：`data/`、`logs/`、`__upgrade_staging/`、`node_modules/`（`common/src/upgrade.ts` 中的 `OVERLAY_SKIP_TOP_DIRS`）。
- **事务性应用。** `applyUpgradePackage` 会把所有将被覆盖的文件备份到 `__upgrade_staging/backup`，然后应用覆盖，如果任何一次复制失败就回滚（恢复备份，删除新增的文件）。成功后会删除暂存区。
- **修改前先做有效性检查。** 更新包必须包含 `app.js`（`requiredFiles`）；缺少它的包会在写入任何内容之前就被拒绝。
- **路径穿越防护（zip 和 tar.gz）。** `extractZip` 和 `extractTarGz` 都会解析每个条目，并拒绝逃出目标目录的条目（Zip-Slip / Tar-Slip）。`extractTarGz` 还会直接拒绝符号链接、硬链接和设备文件条目，因为链接之后可能把写入重定向到目标目录之外。出现违规条目会在触碰安装目录之前中止整个解压。node-stream-zip 自带的防护是第二层。
- **下载使用总超时，而不是空闲超时。** `downloadToFile(url, dest, timeoutMs)` 强制执行*总*期限（更新 zip 为 5 分钟），这样慢速滴灌（TARPIT）的源就无法永久占用更新锁。
- **更新锁。** 每个进程只有一个 `upgradeInProgress` 标志，防止并发更新。
- **不自动重启。** 更新只在磁盘上覆盖文件；运行中的进程仍在内存里使用旧版本。界面会弹出 `Modal.success` 提示，进程日志也会记录提醒，两者都告知运维人员需要手动重启面板/守护进程（systemd/pm2 重启、Ctrl+C 后再启动等），新版本才会生效。`getVersion()` 在启动时读取，所以在重启之前，API 仍会报告旧版本，并继续提示可更新。
- **面板把自己的源 URL 转发给守护进程。** 只需在面板中配置一次源，即使节点自己的配置为空，每个节点也会从这些源更新。转发来的每个字段都优先于守护进程本地对应的字段（`daemon/src/service/upgrade_service.ts` 中的 `effectiveSourceUrls`）。
- **旧版源迁移。** 启动时，panel 和 daemon 的 `version_adapter` 会把持久化的、仍等于旧版 mcsmanager.com 默认值的*主源* `updateSourceUrl` 改写为 GitHub Release 清单 URL（`common/src/upgrade.ts` 中的 `migrateLegacyUpdateSourceUrl`），而同一个 URL 作为默认*备用源*的值仍然有效。任何其他值都被视为运维人员的选择，不会被改动。
- **版本上报**在运行时来自 `package.json`（`getVersion()`）；只替换了 `package.json` 的更新，在重启后同样会上报新版本。
- **Windows 注意事项。** 运行时的 `.js` 文件在运行中可以被覆盖，但已加载的原生二进制文件（`daemon/lib/*.node`、`*.exe`）会被锁定；此时覆盖会在中途失败，事务回滚，更新被干净地中止，而不会留下升级到一半的安装。
- **节点卡片上的界面优先级。** 当清单公布了更新的版本时，版本行会显示更新图标 + 本地化的发布说明，而不是"与面板版本不一致"的警告（`TXT_CODE_e520908a`）；没有可用更新时，仍保留版本不一致警告作为兜底。

## 6. 测试

### 前端单元测试（vitest）

- `frontend/src/tools/__test__/localizedNotes.test.ts`：发布说明的语言匹配 / 英文兜底规则。
- `frontend/src/widgets/__test__/Settings.test.ts`：自动更新标签页渲染、本地化说明框、主源 + 备用源输入框、保存/刷新/更新流程。
- `frontend/src/widgets/node/__test__/NodeItem.test.ts`：节点卡片上的更新图标 + 提示、离线行为、通过操作按钮组更新。

运行：`cd frontend && npm run type-check && npm run lint && npm test`。

### 共享库单元测试（vitest）

- `common/src/__test__/upgrade.test.ts`：`compareVersions` 语义和 `fetchJsonFromSources` 的回退行为（主源成功、连接错误 / HTTP 错误 / JSON 无效 / 超时时转向备用源、主源为空、重复项合并、全部失败时的聚合错误）。

运行：`cd common && npm test`。

### 后端配置单元测试（vitest）

- `panel/src/__test__/system_config_default.test.ts`、
  `daemon/src/entity/__test__/config.test.ts`：`updateSourceUrl` /
  `updateSourceUrlFallback` 的类默认值、旧版本中缺少这些字段的配置的升级、自定义值，以及显式双空的保留。

运行：`cd panel && npm test` / `cd daemon && npm test`。

### 端到端测试脚本（"后端测试"）

webpack 构建本身就是后端的类型检查；端到端行为由两个编排好的脚本来验证：

```bash
# 1. 先构建发布包（BUNDLE=1），生成 production-code/
./build.sh          # Windows 上使用 build.bat

# 2. 基础：面板和守护进程的版本升级 + 整包覆盖
node scripts/verify-auto-update.mjs

# 3. 严格：真实的内容替换 + 反向场景
node scripts/verify-auto-update-strict.mjs
```

- `scripts/build-update-packages.mjs`：从 `production-code/` 打出 `daemon.tar.gz` / `web.tar.gz`（升级后的 `package.json`、`OVERLAY_MARKER.txt`），并写出 `manifest.json`（包含多语言 `notes`）。
- `scripts/update-test-server.mjs`：在 `:9999` 端口提供清单和 zip 包的静态 HTTP 服务器。
- `scripts/verify-auto-update.mjs`：安装/登录、配置更新源、断言 `panel_info`/`daemon_info`（包括 `onlineNotes` 透传）、执行面板更新和转发的守护进程更新、验证磁盘上的版本和覆盖标记，然后模拟运维人员的**手动重启**（杀掉并重新拉起），验证新构建上报新版本。预期进程在更新期间保持运行，因为没有自动重启。同时覆盖备用源解析：主源失效 + 本地备用源（提供更新，且上报的 `updateSourceUrl` 是备用源 URL）、两个源都失效（失败即关闭，无更新）、通过面板→守护进程转发的同样回退，以及面板配置文件中的 `updateSourceUrlFallback` 键。
- `scripts/verify-auto-update-strict.mjs`：场景包括
  `0` 未配置（任何地方都没有源）、`A` 已是最新时拒绝、
  `B` 拒绝 Zip-Slip、`B2` 缺少 `app.js` 的有效性检查、
  `C` 面板内容替换（`app.js` 标记、`public` 新增并被覆盖、版本升级）、`D` 通过转发的源进行守护进程内容替换、
  `F` 主源失效 + 备用源正常时提供更新（且上报的源 URL 是备用源）、`G` 语义性的清单问题不会跨源
  （主源版本格式错误 + 备用源正常时，仍然保持失败即关闭）。

两个脚本都假定运行时状态是干净的：它们会重置 `production-code/*/data` 并恢复基线 `package.json`。注意，**两个**源字段的默认值都是真实的外部 URL（GitHub Release 清单 / 旧版 mcsmanager.com 清单）；因此"未配置"场景必须显式清空两者（面板设置 + 守护进程配置，后者在启动时读取），其他所有场景都设置两个字段，这样失效的主源就不会把请求泄漏到真实互联网。严格脚本还覆盖了恶意的 Tar-Slip 包（在写入任何安装目录之前就被拒绝）和格式错误的在线版本（不弹"有可用更新"提示，即失败即关闭规则）。

## 7. i18n 键

界面文本位于 `languages/*.json`（`TXT_CODE_AUTOUPDATE_*`）；前端使用 `t()`，参数用单花括号 `{v}`，后端/守护进程使用 `$t()`，参数用双花括号 `{{v}}`。主要的键：

| 键 | 位置 | 含义 |
| --- | --- | --- |
| `TXT_CODE_AUTOUPDATE_TAB_TITLE` | 设置标签页 | "自动更新" |
| `TXT_CODE_AUTOUPDATE_WEB_*` | 设置标签页 | 面板更新区块（标题、源、保存、确认、需要重启的对话框等） |
| `TXT_CODE_AUTOUPDATE_WEB_SOURCE_BACKUP*` | 设置标签页 | 备用源输入框（标签、占位符、说明，包括双空禁用规则） |
| `TXT_CODE_AUTOUPDATE_WEB_NOTES` | 设置标签页 | 发布说明框的标题 |
| `TXT_CODE_AUTOUPDATE_WEB_LATEST` | 设置标签页 | "有新版本可用：{v}"标签 |
| `TXT_CODE_AUTOUPDATE_DAEMON_BTN` | 节点卡片按钮组 | "更新守护进程" |
| `TXT_CODE_AUTOUPDATE_DAEMON_UPDATE_TIP` | 节点卡片提示 | "有新版本可用：v{v}。点击更新守护进程按钮……" |
| `TXT_CODE_AUTOUPDATE_B_*` | 后端错误 | 已在更新中 / 已是最新 / 清单缺失 / 没有 url / 应用失败 |

清单中的发布说明文本**不是** i18n 键，它们是运维人员撰写的内容，通过 `notes` 语言映射实现本地化（§3）。
