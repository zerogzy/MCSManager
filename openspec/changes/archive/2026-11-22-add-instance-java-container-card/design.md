# Design

## Context

See proposal.md (Why) for the motivation and specs/ for the behavior contract. This change builds on the following facts about the current code:

- **Docker image storage and updates**
  - The Docker image lives in `config.docker.image`.
  - The daemon's `instance/update` calls `parameters()`, which merges only the keys present in the request (`configureEntityParams` keeps existing values for absent keys). A `{ docker: { image } }` payload therefore changes nothing else.
  - Containers are created on every start with `AutoRemove` (`daemon/src/service/docker_process_service.ts`), so a new image applies from the next start. `parameters()` does not block image changes while the instance runs.
- **Panel access paths**
  - Administrators change images through `PUT /api/instance`.
  - The low-privilege `PUT /api/protected_instance/instance_update` strips the image: `checkInstanceAdvancedParams` returns only `startCommand`, `updateCommand`, and `docker.env`.
  - `GET /api/environment/image` (daemon `environment/images` → `docker.listImages()`) is administrator-only.
  - Every `/protected_instance` route passes the ownership gate (`router.use` + `isHaveInstanceByUuid`).
  - `updateInstanceWithAudit` reads the config before and after an update and logs the diff.
- **Frontend patterns**
  - The feature group (`ManagerBtns.vue`) builds its entries with `arrayFilter` conditions, so a hidden entry leaves no gap. Dialog entries call a ref'd dialog's `openDialog()` (Java Manager, Instance Settings, Terminal Settings).
  - Instance dialogs (`dialogs/InstanceDetail.vue`, `dialogs/JavaManager.vue`) are `a-modal` components that receive `instanceInfo`, `instanceId` and `daemonId` props, expose `openDialog()`, bind `:confirm-loading` / `:ok-text` / `@ok`, and `emit("update")` after saving so `ManagerBtns` refreshes the instance info.
  - Settings saves follow: execute → close → `message.success(t("TXT_CODE_d3de39b4"))`, with errors shown through `reportErrorMsg`.
  - The host-process Java Manager entry and dialog title use `TXT_CODE_3fee13ed` ("Java Manager" / "Java 环境管理", translated in all 12 catalogs).
  - The Plugins/Mods entry is shown only when the daemon's mod scan finds a `plugins` or `mods` folder in the instance directory. This change does not touch that rule.

## Goals / Non-Goals

**Goals:**

- Owners switch the Java image of their Docker Java-family instances themselves, and no raw image reference ever leaves the server.
- No daemon change. Existing panel plumbing (ownership gate, audited update, daemon requests) is reused.
- The UI follows the existing feature-entry → dialog pattern and the existing save and feedback patterns, under the same name as the host-process Java Manager.

**Non-Goals:**

- Pulling images. Only images already present on the node are offered.
- An administrator UI to edit the catalog, or per-node or per-instance allowlists.
- Changing any container parameter other than `docker.image`.
- Supporting BDS, generic Bedrock, or MCDR, which are not eligible.
- A sub-page, a route, a layout card, or any layout-container change.
- Changing the Plugins/Mods entry's visibility rule.
- Changing Java Manager behavior, apart from adding Nukkit to its entry condition.

## Decisions

### 1. Server-side discovery and resolution by environment name

The browser receives and submits only `<vendor>-jdk<major>` names. The panel lists the node's local images, classifies them, and resolves a submitted name back to an image at switch time.

- **Alternatives considered**:
  - *Client-side parsing with image references sent back*: rejected, because users could submit arbitrary references.
  - *Administrator allowlist*: rejected, because the requirement is automatic discovery.
  - *Substring heuristics such as "contains `jdk`"*: rejected, because look-alike repositories would match.
- **Trust boundary**: images must already exist on the node, and the host's Docker is controlled by administrators. Matching is exact on the repository path after normalization.

### 2. Logic lives in the panel, not `common/`

A new `panel/src/app/service/java_container_service.ts` holds the catalog, the classifier, and the resolver as pure functions, plus a thin async layer that calls the daemon. Only the panel uses them. Putting them in `common/` would force rebuilds and test runs of daemon and panel for no consumer gain, and the frontend cannot import `common/src` anyway.

### 3. Classification algorithm

Input is one `RepoTags` entry (or the configured `docker.image`).

1. Reject empty values, `<none>:<none>`, and digest-only references.
2. Separate the tag. It follows the last `:` only when that `:` comes after the last `/`. No tag means the image is unrecognized.
3. Normalize the repository: lowercase it. Drop the first path segment when it is a registry host (it contains `.` or `:`, or equals `localhost`). Then drop a leading `library/`.
4. Look up the vendor by **exact** repository match in the catalog listed in the spec (Java Image Recognition).
5. Parse the major from the lowercased tag:
   - Strip one leading marker among `open-`, `jdk-`, `jre-`, and `java-`, applied repeatedly so that `open-jdk-17…` works.
   - Match `^(\d+)`. If the number is `1` and is followed by `.N`, use `N`.
   - Accept only 6–99.
6. Flags used for ranking:
   - `jre`: the tag has a `jre` token.
   - `musl`: the repository or the tag has an `alpine` or `musl` token.
   - `bareMajor`: the tag equals the major exactly.
7. The result is `{ vendor, major, name: vendor + "-jdk" + major }`, or `null` when the image is not recognized.

`buildJavaEnvironments(images, configuredImage)` groups recognized images by name and picks the representative in the order defined by the spec (Representative Image Selection). It compares the configured image after the same normalization, and uses `Created` from `listImages` for recency. It returns options sorted by major descending, then by vendor. Both endpoints call the same function.

### 4. Endpoints

These live in `panel/src/app/routers/instance_operate_router.ts` under the existing `/protected_instance` gate, with `permission({ level: ROLE.USER })`.

- **`GET /java_container?uuid&daemonId`** returns `{ current: { name, version } | null, options: [{ name, version }] }`. `current` is `null` for a custom (unrecognized) image.
- **`PUT /java_container?uuid&daemonId`**, with `speedLimit(3)`, takes the body `{ key }` and returns `true`.

Validation is fail-closed and ordered so that every check that does not need Docker runs before any Docker call:

1. `key` matches `^[a-z]+-jdk\d{1,2}$` (PUT only). Other body fields are never read.
2. The daemon's `instance/detail` provides the stored config. Eligibility is decided from the stored `processType` and `type`, never from the request.
3. The daemon's `environment/images` provides the local images, which are classified and resolved. An unknown name is rejected.
4. `updateInstanceWithAudit(ctx, daemonId, uuid, () => instance/update { docker: { image } })`.

Errors use `$t` keys and follow the router's existing error-return convention. Daemon errors propagate and are never swallowed. Responses never contain references or IDs.

### 5. Eligibility rule in two places

The panel is the authority. The frontend needs the same rule for entry visibility, and it cannot import panel code, so it gets small helpers in `frontend/src/hooks/useInstance.ts`:

- `isMinecraftInstanceType(type)`: Java, Bedrock, and MCDR.
- `isJavaFamilyMinecraftType(type)`: `minecraft/java`, `minecraft/java/*`, and `minecraft/bedrock/nukkit`.
- `isJavaContainerEligible(config)`: the Java-family check plus `processType === "docker"`.

The Plugins/Mods entry condition reuses `isMinecraftInstanceType`, which keeps its behavior unchanged. Both sides are covered by the same type × backend test matrix to prevent drift.

### 6. Placement: feature entry → dialog

- **Entry**: `ManagerBtns.vue` gets a new entry titled `t("TXT_CODE_3fee13ed")` with the `CoffeeOutlined` icon, inserted right after the Plugins/Mods entry, with the condition `isJavaContainerEligible(config)`. Clicking it calls `javaEnvironmentDialog.value?.openDialog()`, and the dialog's `update` event triggers the component's existing `refreshInstanceInfo`.
- **Dialog**: a new `frontend/src/widgets/instance/dialogs/JavaEnvironment.vue`, mounted in `ManagerBtns.vue` next to `JavaManager`, with the same `instanceInfo`, `instanceId`, and `daemonId` props.
- **Alternatives considered**:
  - *A sub-page plus a registered layout card* (the previous revision of this change): rejected. It needs a route, a default-layout page, card registration, and a layout-column collapse mechanism for ineligible instances, and it navigates away from the instance page for a one-field change. Instance Settings, Terminal Settings, and Java Manager are all dialogs.
  - *A second confirmation dialog on top of the Java dialog for running instances*: rejected in favor of an inline notice (Decision 8), to avoid stacking modals.

### 7. One name for both backends

The Docker entry and the host-process Java Manager entry both use `TXT_CODE_3fee13ed` as their title, and the Docker dialog uses it as its modal title. The two entries are mutually exclusive (Docker vs. general backend), so the shared label never shows twice, and users see one "Java environment management" concept regardless of backend. Reusing the key also keeps all 12 catalogs consistent without new translations for the title.

### 8. Dialog states and flow (`frontend/src/widgets/instance/dialogs/JavaEnvironment.vue`)

- **Data**: `openDialog()` opens the modal and loads environments through `getJavaContainerOptions` (`frontend/src/services/apis/javaContainer.ts`). Status comes from the `instanceInfo` prop, which `ManagerBtns` already auto-refreshes. Each open reloads the options, and the selection resets to the current environment.
- **Layout** (`a-modal`, title `t("TXT_CODE_3fee13ed")`, `ok-text` "Switch", default cancel button):
  - A version badge, the label "Current Java environment", and the current name, or "Custom image" when `current` is `null`.
  - A status tag, styled like `InstanceBaseInfo`.
  - While status is RUNNING (3) or STARTING (2): an inline warning `a-alert` (type `warning`, shown with icon) reading "The instance is running. The change takes effect after a restart." It is not shown for STOP, STOPPING, or BUSY.
  - A responsive grid of tiles showing `name` and "Java {version}", with a "Current" tag on the current tile and the global `.selected` style on the selected one.
  - A skeleton while the options load.
  - No raw image references, Docker tag, image-management link, or refresh button.
- **Switch button** (`ok-button-props.disabled`): disabled while nothing is selected or the selection is the current environment; otherwise enabled. This also covers "only the current environment available" and "no environment available".
- **Edge cases**:
  - Custom image: no tile is marked current and nothing is pre-selected.
  - The configured image is recognized but no longer present locally: the label still shows the recognized name, and no tile is marked current.
- **Submit** (`@ok`):
  - Submits directly for every status; there is no extra confirmation. `:confirm-loading` shows the pending state, and tiles ignore clicks while pending.
  - On success: close the dialog, `emit("update")`, and `message.success(t("TXT_CODE_d3de39b4"))`. The user stays on the instance page.
  - On failure: keep the dialog open, call `reportErrorMsg(err.message)`, and reload the options.
  - On cancel or close: nothing is sent.

### 9. Java Manager entry now includes Nukkit

The condition changes from `type.includes("minecraft/java") && processType === "general"` to `isJavaFamilyMinecraftType(type) && processType === "general"`. The existing `{mcsm_java}` rewrite works for Nukkit, whose start command begins with `java`.

### 10. i18n

Hand-written descriptive keys are added to all 12 catalogs, without running `npm run i18n`. Frontend keys use `{name}`-style placeholders. The entry and dialog title reuse `TXT_CODE_3fee13ed`; the update-success message reuses `TXT_CODE_d3de39b4`.

| Key | en_US | zh_CN |
| --- | --- | --- |
| `TXT_CODE_JAVA_CONTAINER_CURRENT` | Current Java environment | 当前 Java 环境 |
| `TXT_CODE_JAVA_CONTAINER_CURRENT_TAG` | Current | 当前 |
| `TXT_CODE_JAVA_CONTAINER_CUSTOM_IMAGE` | Custom image | 自定义镜像 |
| `TXT_CODE_JAVA_CONTAINER_VERSION` | Java {version} | Java {version} |
| `TXT_CODE_JAVA_CONTAINER_SWITCH` | Switch | 切换 |
| `TXT_CODE_JAVA_CONTAINER_RUNNING_TIP` | The instance is running. The change takes effect after a restart. | 实例正在运行，重启后生效 |
| `TXT_CODE_JAVA_CONTAINER_NOT_SUPPORTED` (panel) | This instance does not support Java container switching | 该实例不支持切换 Java 容器 |
| `TXT_CODE_JAVA_CONTAINER_INVALID_KEY` (panel) | Invalid Java environment | 无效的 Java 环境 |
| `TXT_CODE_JAVA_CONTAINER_NOT_FOUND` (panel) | This Java environment is not available on the node | 节点上没有这个 Java 环境 |

Keys from the previous revision that are no longer used are removed from all 12 catalogs: `TXT_CODE_JAVA_CONTAINER`, `TXT_CODE_JAVA_CONTAINER_DESC`, `TXT_CODE_JAVA_CONTAINER_DESIGN_TIP`, `TXT_CODE_JAVA_CONTAINER_CONFIRM_TITLE`, and `TXT_CODE_JAVA_CONTAINER_CONFIRM_RUNNING` (its text moves to `TXT_CODE_JAVA_CONTAINER_RUNNING_TIP`).

### 11. Documentation

The AGENTS.md permission table gets a note next to the administrator-only "advanced container parameters" row. Regular users may switch between Java images already on the node through Java environment management (Java 环境管理). They submit only an environment name, and the backend resolves it.

## Risks / Trade-offs

- [Any catalogued-repository image on the node becomes selectable by owners, including one an administrator pulled for another purpose, or a local image re-tagged under a catalogued name] → Only exact catalogued JDK repositories are accepted. Only local images, which require host Docker access to create, can be chosen. Container privileges, volumes, and devices stay unchanged. Every switch is audited, and the exception is documented in AGENTS.md.
- [Unusual tags may be misread] → Ambiguous tags are excluded rather than guessed (numeric start, range 6–99). A table-driven unit test covers each vendor's tag shapes. A misread affects only the label, never the resolved image.
- [Node images change between listing and switching] → The switch re-resolves the name. It may pick a different tag with the same vendor and major, which is acceptable.
- [Docker unreachable on the node] → `environment/images` fails, the endpoints return that error, and the dialog shows it. Nothing changes.
- [Running instances keep the old image until restart; without a confirmation step a user may miss this] → The running notice is always visible in the dialog body next to the Switch button while the instance runs or starts. The daemon recreates the container at the next start.
- [Two entries share one label] → They are mutually exclusive by backend, so only one ever shows for an instance.
- [The frontend and panel eligibility rules could drift] → Both are covered by the same type × backend test matrix.
- [Normal users can now trigger `docker.listImages()`] → The call is cheap and owner-gated, the switch is rate-limited, and responses expose only Java environment names and majors.

## Migration Plan

- No data migration and no layout change. Ship panel and frontend together; the daemon is unchanged.
- Rollback: revert the panel and frontend. Images set through the switch remain ordinary, valid `docker.image` values.
- Code already implemented for the previous (sub-page) revision is reworked as listed in tasks.md: the route, default-layout page, card registration, and layout-column collapse are removed; the card becomes the dialog.
