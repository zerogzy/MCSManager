# MCSManager 后端集成测试覆盖情况（2026-09-30）

> 取代 [`docs/backend-test-coverage-2026-09-29.md`](backend-test-coverage-2026-09-29.md)（来自 `feat/backend-route-tests` 分支的 mock 路由测试覆盖情况）。mock 路由测试套件（`panel/src/app/routers/__test__/*` + `daemon/src/routers/__test__/*_router.test.ts` 中的 mock）以及第一代 `panel/test/integration/` 黑盒端到端运行器已在清理中被删除；现在权威的后端集成测试层位于 `common/test/integration/`。

## 1. 结论

2026-09-30 迁移之后，后端有**两**层测试：

1. 各模块的**纯单元测试**：只测逻辑，对边界 I/O 做 mock。
2. **真实进程集成测试**：启动真实的 daemon + panel，通过 HTTP + socket.io 驱动整个后端（不使用 mock）。

| 层 | 模块 | 命令 | 测试文件 | 预期 |
| --- | --- | --- | --- | --- |
| 纯单元 | `common` | `cd common && npm test` | `common/src/__test__/{system_storage,upgrade}.test.ts` | 9 个通过 |
| 纯单元 | `panel` | `cd panel && npm test` | `panel/src/app/utils/__test__/integration_test_mode.test.ts`（8）+ `panel/src/app/service/__test__/login_ban.test.ts`（23） | 约 31 个通过 |
| 真实磁盘/进程 | `daemon` | `cd daemon && npm test` | `daemon/src/routers/__test__/Instance_router.integration.test.ts`（12）+ `daemon/src/routers/__test__/file_router.security.test.ts`（24） | 约 36（非 Linux 上 docker 用例提前跳过） |
| 纯单元（jsdom） | `frontend` | `cd frontend && npm test` | 7 个文件 | 41 个通过 |
| 真实进程集成 | `common` | `cd common && npm run test:integration` | `common/test/integration/suites/{_smoke,auth,user,instance,files,streams,docker}.test.ts` | macOS 上约 65 通过 / 6 跳过；Linux+Docker 上约 70 通过 / 1 跳过 |

旧的 mock 路由测试套件和 `panel/test/integration/` 黑盒运行器已被删除。新的 `common/test/integration/` 是权威的后端集成测试层，保留的两个 daemon 测试套件是它在 daemon 侧的底层补充。

## 2. 架构：`common/test/integration/`

```
common/test/integration/
  lib/
    bootstrap.ts    # bootRuntime/stopRuntime：启动 daemon，等待 5 秒，以 --unsafe=<key> 启动 panel，等待 /auth/status
    world.ts         # 共享单例 + RUNTIME_FILE（跨文件持久化）；addFinding/saveState
    http.ts          # requestPanel、login、ensureUser/Owner、createUser、loginSessionRetry
    socket.ts        # createStream、waitForOutput、collectText（socket.io）
    files.ts         # 上传（单次/分块）、下载、zip、列表、编辑、移动、复制、删除、路径穿越
    util.ts          # waitFor、sleep、buildZip/System
    process.ts       # spawnApp、groupKill
    index.ts         # 重新导出
  suites/
    _smoke.test.ts   # 框架验证：key 能访问 /auth/status + 管理员登录
    auth.test.ts     # 安装状态机 + 登录 + token + 伪造 + api-key 闸门 + key 边界
    user.test.ts     # 管理员用户增删改查 + 越权 + 脱敏 + 实例级闸门 + 普通用户 quick_install
    instance.test.ts # 生命周期：创建/打开/命令/停止/强杀/重启/删除 + startCommand 变更
    files.test.ts    # 增删改查 + zip + 上传并解压 + 下载 + zip-slip + 路径穿越 + 实例级闸门
    streams.test.ts  # 实例 I/O 多 socket：广播、多行、写入、断开、鉴权、停止
    docker.test.ts   # Linux + 可达的 dockerd：docker 实例 + 镜像生命周期（非 Linux 上可见地跳过）
  fixtures/
    test.mjs         # 交互式进程夹具（行协议 + 心跳；从 daemon/test/fixtures/test.mjs 复制）
  globalSetup.ts     # vitest globalSetup：先 loadState() 再 bootRuntime()；teardown 调用 stopRuntime()
  vitest.config.ts   # 根目录：common/，180 秒超时，environment 为 node，使用上述 globalSetup
  run.mjs            # 顺序运行器：每个套件文件单独调用一次 vitest
  FINDINGS.html      # 静态发现文档（运行器的 `addFinding` 累积是另一回事）
  .runtime.json      # 被 git 忽略的跨文件运行时状态（每次调用的 key/pid/url）
  .last-run/         # 被 git 忽略的事后分析日志（daemon.log、panel.log、info.json）
```

### 每个套件的启动模型

每个套件都是独立的一次 `vitest run`。`globalSetup` 会在每个套件专属的 `mkdtemp` 工作区（`workDir/{daemon,panel}` 同级目录）中，使用默认端口（panel `23333`，daemon `24444`）启动全新的 daemon + panel，传入每次调用随机生成的 `--unsafe-integration-test-mode=<key>`，等待 `/auth/status` 返回 200，发现本地 daemon 的 id，开启 `allowUsePreset`，然后交给测试文件。**套件之间不继承任何状态**：每个套件的 admin/u1/u2/实例都通过 `--unsafe` key + 真实登录重新创建。`teardown` 会尽力删除测试实例和用户，按进程组终止进程（先 SIGTERM 宽限 1.5 秒，再 SIGKILL），把日志复制到 `.last-run/`，并删除临时工作目录。

### 采用顺序运行器的原因（vitest 0.33 并行问题）

vitest 0.33 会**忽略** `singleFork` / `fileParallelism:false`；一次调用中运行多个文件会并行执行，从而争用共享的 panel/状态（相同的默认端口、相同的 `world`）。因此 `run.mjs` 把每个套件文件作为**独立的** `vitest` 进程调用，每个文件使用一个共享的 `globalSetup`，以此绕开并行问题。**不要把这些套件合并到一次 vitest 调用中。**

### `--unsafe-integration-test-mode=<key>` 的边界（关键）

每次调用随机生成的 key 会作为 `x-request-api-key` 请求头传给所有 panel 路由。它**只**绕过 `panel/src/app/middleware/permission.ts`（权限等级/token/会话/限速）。它**不会**绕过：

- `preCheckMiddleware`：multipart 上传仍然通过 `stream_channel`/任务通行证系统直连 daemon。
- `instance_operate_router` / `filemananger_router` / `instance_admin_router` / `java_manager_router` / `schedule_router` / `mod_manager_router` 上的实例级 `router.use` 闸门：它们读取 `ctx.session.uuid`，在使用 key 时该值为空，所以返回 **403**。

因此实例级操作要使用真实登录（所有者/管理员 cookie + `?token=`）；单独使用 key 只适用于**没有实例级闸门**的管理员路由（用户/节点/设置的增删改查、市场列表、`/service/remote_services_list`）。

## 3. 六个套件 + 冒烟验证：`it` 数量与覆盖内容

数量是精确的（对每个文件执行 `grep -cE "^\s*it\("`）；`it.skip` 和 `dockerIt = dockerOk ? it : it.skip` 的用例会被单独标明。

| 套件 | `it` 数量 | 覆盖内容 | 延后 / 跳过 |
| --- | --- | --- | --- |
| `_smoke.test.ts` | 2 | 框架验证：key 访问 `/auth/status` 返回 200；管理员登录成功并读取 `/auth/overview`。 | — |
| `auth.test.ts` | 16 | 安装状态机（创建管理员后 `isInstall` 翻转）；安装后 `POST /auth/install` 被拒绝；通过 key 创建 admin + u1 + u2；登录 → cookie + token；u1 不能创建用户；token 错误/伪造/缺失；api-key 闸门（`enableApiKey=false`）；`--unsafe` key 只绕过 `permission`（实例级闸门仍然生效，临时实例测试断言 key 访问 `/api/instance?uuid=<real>` 得到 500）；validator/输入格式闸门（弱密码、缺少密码）。 | — |
| `user.test.ts` | 17 | 管理员创建用户（重复/弱密码被拒绝）；通过 key 创建最小实例；`ensureOwner(u1)`；u1 不能 POST/DELETE/GET 搜索/PUT 他人（仅管理员 → 403）；`/auth/search` 分页 + 脱敏（无 `passWord`/`salt`/`apiKey`）；越权：u2 → 403（实例级 `router.use` 闸门）或 500（`instance_admin GET /` 处理函数抛错）；u2 不能使用 `stream_channel`；普通用户不能自己执行 `quick_install`（`uuid='-'` 上的实例级闸门）。 | — |
| `instance.test.ts` | 9 | `POST /api/instance` 创建；u1 通过低权限 `instance_update` 修改（oe/ie/stopCommand/terminalOption）；普通用户**不能**修改非 docker 实例的 `startCommand`，管理员可以；打开 → 轮询到 RUNNING；通过 `/protected_instance/command` + `outputlog` 完成命令往返；停止（优雅的 `stopCommand: 'exit'`）；强杀；重启（`pid` 变化 + `startCount++`）；删除运行中的实例被拒绝 → 删除已停止的实例。 | 市场 `quick_install` + `reinstall` **延后**：依赖网络，需要从 `fill-data.papermc.io` 下载约 52MB 的 jar；通过 `addFinding` 记录为 `F-quick-install-deferred`，没有被跳过的 `it`。 |
| `files.test.ts` | 11 | 准备 + mkdir → 单次上传 → 列表；mkdir → 编辑（中文）→ 读取 → 移动 → 复制 → 删除；压缩（zip）→ 解压 → 字节一致；单次 multipart 上传；带 `unzip=1` 的上传 → 已解压；分块上传（`/upload-new` + `/upload-piece`）→ 接收进度跟踪 → 自动完成；下载（通行证）→ `/download/{password}/{name}` → 字节一致；zip-slip 的 `../` 条目被拒绝；列表/移动/编辑/删除/上传的 `../` 路径穿越被拒绝；实例级闸门 u2 → 403。 | `download_from_url` **延后**：依赖网络；`addFinding` 记录为 `F-download-from-url-deferred` + 1 个 `it.skip`。 |
| `streams.test.ts` | 9 | 打开 + 准备（实例在 `node test.mjs` 上处于 RUNNING）；双 socket 广播（两个 socket 都看到相同的 ASCII + 中文行）；两个 socket 上连续多行的顺序；两个 socket 都可以写入；断开 → `s1.connected` 为 false，s2 仍能收到；**命令注入无效**（`echo x; rm -rf /` → `ECHO:x; rm -rf /`，是字面量，不经过 shell）；stream/auth 密码错误 → ready 为 false；非所有者 u2 POST `/protected_instance/stream_channel` → 403；停止时向已连接的 socket 发送 `instance/stopped`。 | — |
| `docker.test.ts` | 1 + 5 个 `dockerIt` | 始终运行的可用性探测 `it`（记录 `F-docker-availability`）。5 个 `dockerIt`（仅 Linux + 可达的 dockerd）：创建 docker 实例；打开 + RUNNING；通过 `/protected_instance/command` 完成命令往返；停止 / 强杀 / 重启；镜像生命周期（`POST/GET/DELETE /api/environment/image`）；清理，没有泄漏带标签的容器。 | 非 Linux / dockerd 不可达：5 个 `dockerIt` 会变成 `it.skip`（可见的 SKIPPED，而不是悄悄通过）。 |

**合计：** 2 + 16 + 17 + 9 + 11 + 9 + 1 = 65 个 `it`，另外 `files` 中有 1 个始终跳过的 `it.skip` 和 5 个 `dockerIt`（受条件控制）。注册的条目共 71 个。

在 macOS 开发机上：约 65 通过 / 6 跳过 / 0 失败。在 Linux + root + 可达 docker 的环境：约 70 通过 / 1 跳过 / 0 失败（跳过的 1 个是 `download_from_url`）。

## 4. 发现（设计层面的模糊点，**不是**产品代码修复项）

套件会在运行时通过 `addFinding` 记录模糊点，运行器把它们累积到 `common/test/integration/FINDINGS.html`。它们**不是**需要在产品代码中修复的 bug，而是测试所断言的、已记录的行为，留待将来的设计评审。

| ID | 套件 | 一句话说明 |
| --- | --- | --- |
| `F-install-rejected-status` | auth | 已安装时 `POST /auth/install` 返回非 200（经由 `validator` 的 try/catch 返回 400）：处理函数抛错 → validator 错误信封。 |
| `F-key-not-instance-admin` | auth | `--unsafe` 测试 key 只绕过 `panel/src/app/middleware/permission.ts`，不绕过实例级 `router.use` 闸门，该闸门读取 `ctx.session.uuid`，使用 key 时为空 → 403。 |
| `F-instance-admin-throw-500` | auth | `instance_admin GET /` 把所有权检查放在处理函数**内部**（在 `router.use` 闸门之外），所以非所有者得到的是 500 错误信封，而不是同级路由那样的 403。交叉引用 [`docs/test-doubts/panel-instance_admin-perm-throw-vs-gate-403.md`](test-doubts/panel-instance_admin-perm-throw-vs-gate-403.md)。**不要修改产品代码。** |
| `F-normal-quickinstall` | user | 普通用户被 `uuid='-'` 上的实例级闸门（仅管理员）拦截，无法执行 `quick_install`。 |
| `F-quick-install-deferred` | instance | 市场 `quick_install` + `reinstall` 被延后：依赖网络，要下载约 52MB 的 jar。记录下来供手动或带网络的 CI 运行使用。 |
| `F-normal-cannot-change-startcmd` | instance | 普通用户不能修改非 docker 实例的 `startCommand`（安全性良好，管理员可以）。 |
| `F-download-from-url-deferred` | files | `download_from_url` 的启动/轮询/停止被延后：依赖网络。显式的 `it.skip` + `addFinding`。 |
| `F-unzip-keeps-source-archive` | files | 旧版 `/upload/:k` 路由在 `unzip=1` 之后**不会**删除源压缩包（该路由下的有意行为）。 |
| `F-compress-source-targets-swap` | files | `POST /files/compress` 的 source/targets 语义在 `type=1` 与 `type=0` 之间被重载使用。 |
| `F-cmd-injection-inert` | streams | 通过 stream/input 的命令注入无效：`echo x; rm -rf /` 以字面字符串 `ECHO:x; rm -rf /` 到达，不经过 shell。（安全性良好。） |
| `F-docker-availability` | docker | 信息性探测：记录 docker 用例在本机上是真实运行还是被跳过。 |
| `F-docker-startcmd-change-allowed` | docker | docker 实例允许修改 `startCommand`（与非 docker 对比，见 `F-normal-cannot-change-startcmd`）。 |

`F-instance-admin-throw-500` 这个 500 对 403 的越权不一致，是唯一已有 test-doubts 文档的条目；其他条目记录在 `common/test/integration/FINDINGS.html` 中。

## 5. 如何运行

```bash
# 1) 各模块的纯单元测试 + 保留的套件（快）
cd common  && npm test           # 9 个通过
cd panel   && npm test           # 约 31 个通过（login_ban + integration_test_mode）
cd daemon  && npm test           # 约 36：Instance_router.integration（12）+ file_router.security（24）；非 Linux 上 docker 提前跳过
cd frontend && npm test         # 41 个通过

# 2) common 真实进程集成测试（有构建前置条件，见下文）
cd common && npm run test:integration       # 在构建好 panel+daemon 之后运行
# 便捷方式：重新构建 common → panel → daemon，然后运行集成测试
cd common && npm run test:integration:build
```

### 构建前置条件（关键）

`run.mjs` 要求预先构建好：

- `panel/production/app.js`（开发构建，不带 `BUNDLE=1`）
- `daemon/production/app.js`（开发构建，不带 `BUNDLE=1`）
- `daemon/lib/<pty|file_zip>_<os>_<arch>` 平台二进制文件（通过 `./install-dependents.sh` 安装）
- `panel/data/market_cache.json`（这样 `quick_install_list` 可以离线工作）

任何一项缺失时，`run.mjs` 都会报错并给出构建命令。修改 panel 或 daemon 的**源码**之后，需要先重新构建再运行集成测试。`npm run test:integration:build` 可以自动完成（common → panel → daemon → 运行）。

## 6. 已知限制

- **构建前置条件。** 集成运行器不会构建 panel/daemon；构建缺失会导致硬错误，并给出构建命令。
- **依赖网络的延后用例。** 市场 `quick_install`（`instance`）、`reinstall`（`instance`）和 `download_from_url`（`files`）需要网络访问（要从 `fill-data.papermc.io` 下载约 52MB 的 jar）。它们是 `it.skip` + `addFinding`，这样默认的开发机运行可以保持离线且快速；它们用于手动或带网络的 CI 运行。
- **Docker 仅限 Linux + 可达的 dockerd。** `docker.test.ts` 在非 Linux 上按用例自行跳过（`dockerIt = dockerOk ? it : it.skip`）。common 套件在 macOS / Windows 上**绝不会**因为 docker 而失败，docker 用例显示为 SKIPPED（而不是悄悄通过）。
- **顺序运行 + 每个套件单独启动，所以很慢。** 每个套件都要启动全新的 daemon（等待 5 秒 + 就绪等待）和 panel（就绪等待最长 40 秒），所以即使在快速的机器上，完整运行也要几分钟。每个测试 180 秒的超时比较宽松（实例引擎有 2 秒启动保护和 6 秒强杀保护）。
- **run.mjs 遇到第一个失败就停止。** 它会短路，以便单独调试第一个出问题的套件。修好之后重新运行。
- **macOS / 开发机的预期结果：** `cd common && npm run test:integration` → 约 65 通过 / 6 跳过（5 个 docker + 1 个 `download_from_url`）/ 0 失败；docker 测试套件会通过 verbose reporter 清楚地显示被 SKIPPED 的用例名称。

## 7. 关系：三层后端测试

| 层 | 测试什么 | 位置 |
| --- | --- | --- |
| **纯单元** | 孤立的逻辑（对边界 I/O 做 mock）。反馈快，分支覆盖全面。 | `common/src/__test__/*`、`panel/src/app/{utils,service}/__test__/*`、`frontend/src/**/__test__/*` |
| **真实进程集成（由 panel 驱动，端到端）** | 用户所看到的整个后端：真实启动的 daemon + panel，真实的 HTTP + socket.io，真实的磁盘 + 子进程 + Docker。**权威的**后端集成测试层。 | `common/test/integration/` |
| **真实磁盘/进程（daemon 侧，进程内底层）** | 脱离 panel、单独测试 daemon 路由：真实的子进程/容器生命周期、真实磁盘，但 daemon 是在测试进程里直接导入的（没有 panel socket）。是 common 套件在 daemon 侧的**补充**。 | `daemon/src/routers/__test__/Instance_router.integration.test.ts` + `file_router.security.test.ts` |

对 `daemon/src/routers/Instance_router.ts` / `instance.ts` / `general/*` 命令 / docker 服务的修改，会同时被两个真实进程集成套件覆盖：common 的（由 panel 驱动）和保留的进程内套件（daemon 侧底层）。两者都要运行（见 `mcsmanager-test` skill 的 §5）。

## 8. 交叉引用

- AGENTS.md §8"Testing Quirks"：迁移后的测试范围，以及一次性运行全部的循环。
- AGENTS.md §9"Backend integration tests" + "Docker + instance integration tests"：权威的深入说明条目。
- `.agents/skills/mcsmanager-test/SKILL.md`：各模块的命令和循环，以及 docker + 实例生命周期套件（两个套件）。
- `common/test/integration/FINDINGS.html`：静态发现文档 + 运行时累积的指引。
- `docs/test-doubts/panel-instance_admin-perm-throw-vs-gate-403.md`：`F-instance-admin-throw-500` 的 test-doubts 交叉引用。
- `docs/backend-test-coverage-2026-09-29.md`：本文取代的、上一份（基于 mock 的）覆盖情况说明。

## 9. 最终验证（收尾运行）

分支：`yumao/full-test-v2`。迁移在功能上已完成（框架已搭建，mock 测试已删除，文档已更新）。

**已验证通过，并注明来源：**

| 范围 | 命令 | 结果 | 来源 |
| --- | --- | --- | --- |
| common 纯单元 | `cd common && npm test` | 9 个通过（2 个文件：`system_storage` 6 + `upgrade` 3） | 本次收尾时重新运行（197ms） |
| panel 纯单元 | `cd panel && npm test` | 31 个通过（2 个文件：`login_ban` 23 + `integration_test_mode` 8） | 本次收尾时重新运行（219ms） |
| daemon 保留的真实套件 | `cd daemon && npm test` | 36 个通过，覆盖 `Instance_router.integration`（真实的子进程/容器生命周期，非 Linux 上 docker 提前跳过）+ `file_router.security`（真实磁盘沙箱，24 个） | T11 验证（此后没有修改源码，T12 仅涉及文档）；因为有真实子进程，耗时约 2 分钟 |
| common 集成（权威） | `cd common && npm run test:integration` | 6 个套件通过：`_smoke` 2 / `auth` 16 / `user` 17 / `instance` 9 / `files` 11（+1 跳过）/ `streams` 9 / `docker` 1（+5 跳过），约 **65 通过，6 跳过** | T11 完整运行验证；`_smoke` 在本次收尾时重新运行（2 个通过，12.81 秒，确认 T12 之后真实的 daemon+panel 启动正常） |
| webpack 类型检查构建 | 在 `common`/`panel`/`daemon` 中执行 `npm run build` | 全部编译通过 | T12 验证 |

**docker 自动跳过（macOS 开发机）：** 本机没有安装 Docker，所以 `dockerOk=false`；`common/test/integration/suites/docker.test.ts` 使用 `dockerIt = dockerOk ? it : it.skip` → 1 个始终运行的探测 `it` 通过 + 5 个 `dockerIt` 可见地跳过；保留的 `daemon/.../Instance_router.integration.test.ts` 会让它的 Docker 用例提前返回（`if (!dockerOk) return;`）。**在 Linux + Docker 的 CI 运行器上，docker 套件会运行真实的容器生命周期**（访问 socket 需要 root/sudo；见 `mcsmanager-test` skill）。

**跳过/延后的用例（已记录，不阻塞）：**
- `instance` 的市场 `quick_install` + reinstall：依赖网络（从 `fill-data.papermc.io` 下载约 52MB 的 jar）；发现项 `F-quick-install-deferred`；基础生命周期通过 `instance/new` + `node test.mjs` 覆盖。
- `files` 的 `download_from_url`：依赖网络；`.skip` + `F-download-from-url-deferred`。

**延后的收尾优化（不阻塞，记录在 SDD 台账中）：** `run.mjs` 中 `isLinux` 变量未使用 / 在所有平台都调用 docker（加一句 `if (name === "docker" && !dockerOk) continue` 就能在非 Linux 上省下约 12 秒浪费的启动）；`files` 的实例级闸门 `it` 缺少 admin→200 的断言（u2→403 已很稳固）；docker 的 `it #4` 标题与内容不符（走的是 startCommand 变更的 admin-key 路径，而不是用户路径，通过 `F-docker-startcmd-change-allowed` 记录）；`common/package.json` 把 `fs-extra` 同时列在 `dependencies` 和 `devDependencies` 中（npm 会去重）。

**本机的运行耗时：** 四个模块的 `npm test` 从不到一秒到约 2 分钟（daemon）不等；`cd common && npm run test:integration` 顺序执行约 3–5 分钟（6 个套件，每个约 30–90 秒，每个套件启动一次 panel+daemon）。修改 panel/daemon 的 `src` 之后，请先重新构建再重新运行集成测试（运行器要求预先构建好 `production/app.js`）。
