# Tasks

## Verification environment

- Every "Verify with …" command in this file, and every frontend and backend test, runs on the **remote Linux test server** (with Docker), not on the local development machine. Local editing is fine; local test runs do not count as verification.
- For each verification run, sync the current working tree to a fresh temporary directory on the server (excluding `node_modules`, `.git`, runtime `data/`, and `logs/`), use the server's dedicated Node 22 toolchain, and convert shell scripts to LF line endings there if needed. Remove the temporary directory after the run.
- Do not record the server's address, accounts, passwords, or keys in any file in this repository. They are reported only in the final delivery report (task 7.3).

## 1. Panel: Java image classification and resolution

- [x] 1.1 Create `panel/src/app/service/java_container_service.ts` with the vendor catalog and a pure `classifyJavaImage(ref)` that follows design §3: reference parsing, registry-host and `library/` normalization, exact repository lookup, tag-marker stripping, `1.N` handling, the 6–99 range, and the `jre`, `musl`, and `bareMajor` flags. Add `panel/src/app/service/__test__/java_container_service.test.ts` with table cases for every spec scenario under "Java Image Recognition" and "Java Major Version From Tag", including look-alike repositories, non-JDK images, `<none>:<none>`, and untagged or `latest`/`lts`/date tags. Verify with `cd panel && npm test`.
- [x] 1.2 Add `buildJavaEnvironments(images, configuredImage)` and the panel-side `isJavaContainerEligible(config)` to the same service: name format, duplicate collapse, the representative order from the spec, and options sorted by major descending and then by vendor. Extend the unit tests with each "Representative Image Selection" and "Java Environment Naming" scenario and the full eligibility matrix (Java subtypes, Nukkit, BDS, generic Bedrock, MCDR, non-Minecraft types, general and Docker backends). Verify with `cd panel && npm test`.

## 2. Panel: endpoints, default layout, and permission documentation

- [x] 2.1 Add the panel error keys `TXT_CODE_JAVA_CONTAINER_NOT_SUPPORTED`, `TXT_CODE_JAVA_CONTAINER_INVALID_KEY`, and `TXT_CODE_JAVA_CONTAINER_NOT_FOUND` to all 12 `languages/*.json` files with translations: English source in `en_US.json`, Chinese in `zh_CN.json`, and translations in the other ten. Verify every catalog still parses (`node -e "const fs=require('fs');for(const f of fs.readdirSync('languages'))JSON.parse(fs.readFileSync('languages/'+f,'utf8'))"`), then run `cd panel && npm test`.
- [x] 2.2 Implement `GET` and `PUT /java_container` in `panel/src/app/routers/instance_operate_router.ts` per design §4: `ROLE.USER`, the existing ownership gate, `speedLimit(3)` on `PUT`, and fail-closed validation in the order key format → stored config via `instance/detail` → eligibility → `environment/images` → resolve. Wrap the `{ docker: { image } }` update in `updateInstanceWithAudit`. Responses carry only names and majors. Verify with `cd panel && npm run build` (type check) and `cd panel && npm test`.
- [x] 2.3 Remove the `/instances/terminal/javaContainer` page that the previous (sub-page) revision added to `panel/src/app/service/frontend_layout.ts`. The default layout ends up exactly as before this change. Verify with `cd panel && npm run build` and `cd panel && npm test`.
- [x] 2.4 Update the AGENTS.md permission-table note to name the feature "Java environment management" (Java 环境管理) instead of "Java 容器": regular users may switch between Java images already on the node, submitting only an environment name that the backend resolves. Verify the rendered table and run `cd panel && npm test`.

## 3. Real-process integration suite

- [x] 3.1 Create `common/test/integration/suites/java_container.test.ts` and register it in the `SUITES` list in `common/test/integration/run.mjs`. Set up the world with `setupSecurityWorld()`; u1 is the owner and u2 is not assigned. Cover the cases that need no Docker:
  - u2 `GET` and `PUT` are refused with 403.
  - A host-process `minecraft/java` instance is rejected as not supported, also when the body adds `processType: "docker"` and an `image`.
  - A Docker `minecraft/bedrock/bds` instance is rejected.
  - A malformed key is rejected with the configuration unchanged, checked through the admin detail view.
  - A low-privilege `instance_update` carrying `docker.image` leaves the image unchanged.

  If creating a Docker-backed instance itself needs Docker, gate the affected cases with `dockerIt` and note it in the file. Verify by building the prerequisites (`cd panel && npm run build`, `cd daemon && npm run build`), then running the suite with `cd common && node node_modules/vitest/vitest.mjs run --config test/integration/vitest.config.ts test/integration/suites/java_container.test.ts --reporter=verbose` and `cd common && npm test`.
- [x] 3.2 Add `dockerIt`-gated cases to the same suite.
  - **Setup**: tag the already-required `node:22-alpine` as `localhost/eclipse-temurin:98-mcsmtest` and `localhost/azul/zulu-openjdk:97-mcsmtest`, and remove both tags in `afterAll`. The unusual majors keep the test images from competing with real Java images on the node (for example an existing `azul/zulu-openjdk:17`, which would win representative selection through its bare-major tag). Before tagging, fail the case if the node already holds any image that resolves to `temurin-jdk98` or `zulu-jdk97`.
  - **Listing**: the owner's `GET` returns `temurin-jdk98` and `zulu-jdk97` with no image reference or ID anywhere in the payload.
  - **Stopped switch**: the owner's `PUT` of `zulu-jdk97` sets `docker.image` to the resolved tag, leaves every other `docker` field unchanged, and writes an `instance_config_change` operation-log entry.
  - **Running switch**: for a running instance (`node test.mjs` fixture), the container keeps its image until restart, and the next start uses the new image.
  - **Unavailable name**: a well-formed name that is absent from the node is rejected.

  Verify with `cd common && npm run test:integration` on Linux with Docker. Elsewhere the cases show as skipped.

## 4. Frontend: eligibility helpers, API wrappers, and feature entry

- [x] 4.1 Add `isMinecraftInstanceType`, `isJavaFamilyMinecraftType`, and `isJavaContainerEligible` to `frontend/src/hooks/useInstance.ts`. Add `frontend/src/hooks/__test__/javaContainerEligibility.test.ts` with the same type × backend matrix as task 1.2, covering every Java subtype constant, Nukkit, BDS, generic Bedrock, MCDR, and the non-Minecraft types. Verify with `cd frontend && npm run type-check && npm test`.
- [x] 4.2 Add `frontend/src/services/apis/javaContainer.ts` with typed `getJavaContainerOptions` (`GET /api/protected_instance/java_container`) and `switchJavaContainer` (`PUT`, body `{ key }`) wrappers, built on `useDefineApi`. Verify with `cd frontend && npm run type-check && npm test`.
- [x] 4.3 Update `frontend/src/widgets/instance/ManagerBtns.vue` per design §6–§7 and §9:
  - The Docker entry uses the title `t("TXT_CODE_3fee13ed")` and the `CoffeeOutlined` icon, stays directly after Plugins/Mods with the condition `isJavaContainerEligible`, and opens the Java environment dialog via `openDialog()` instead of navigating. Mount the dialog next to `JavaManager`, wiring `@update` to `refreshInstanceInfo`.
  - Keep the Java Manager condition `isJavaFamilyMinecraftType(type) && processType === "general"` (Nukkit included) and the Plugins/Mods condition through `isMinecraftInstanceType`, with no behavior change to Plugins/Mods.

  Update `frontend/src/widgets/instance/__test__/ManagerBtns.test.ts` for every "Java Selection Entries in Instance Features" scenario: entry order, the shared label, that activating the entry opens the dialog and does not navigate, and the unchanged Plugins/Mods rule. Verify with `cd frontend && npm run type-check && npm run lint && npm test`.
- [x] 4.4 Remove the child route `/instances/terminal/javaContainer` from `frontend/src/config/router.ts`. Verify with `cd frontend && npm run type-check && npm test`.

## 5. Frontend: remove the previous revision's page machinery

- [x] 5.1 Remove the layout-column collapse added by the previous revision: `hiddenCardIds`, `setCardHidden`, and `isCardColumnVisible` from `frontend/src/stores/useLayoutContainerStore.ts`, the `v-show` bindings from `frontend/src/views/LayoutContainer.vue`, and `frontend/src/views/__test__/LayoutContainer.test.ts`. Both source files end up exactly as before this change. Verify with `cd frontend && npm run type-check && npm run lint && npm test`.
- [x] 5.2 Remove the `InstanceJavaContainer` layout card: its import, its `LAYOUT_CARD_TYPES` entry, and its card-pool entry in `frontend/src/config/index.ts`, plus `frontend/src/widgets/instance/JavaContainer.vue` and `frontend/src/widgets/instance/__test__/JavaContainer.test.ts`. Verify with `cd frontend && npm run type-check && npm run lint && npm test`.

## 6. Frontend: Java environment dialog

- [x] 6.1 Create `frontend/src/widgets/instance/dialogs/JavaEnvironment.vue` per design §8, following the `InstanceDetail.vue` / `JavaManager.vue` dialog conventions (`a-modal`, `instanceInfo` / `instanceId` / `daemonId` props, exposed `openDialog()`, `emit("update")`):
  - **Display**: title `t("TXT_CODE_3fee13ed")`, version badge, current name or "Custom image", status tag, tile grid with the "Current" tag and `.selected` styling, skeleton while loading, and no raw references.
  - **Running notice**: an inline warning `a-alert` with `TXT_CODE_JAVA_CONTAINER_RUNNING_TIP`, shown only for RUNNING and STARTING.
  - **Switch control**: `ok-text` "Switch", disabled while nothing is selected or the selection is the current environment.
  - **i18n**: add `TXT_CODE_JAVA_CONTAINER_RUNNING_TIP` to all 12 catalogs, and remove `TXT_CODE_JAVA_CONTAINER`, `TXT_CODE_JAVA_CONTAINER_DESC`, `TXT_CODE_JAVA_CONTAINER_DESIGN_TIP`, `TXT_CODE_JAVA_CONTAINER_CONFIRM_TITLE`, and `TXT_CODE_JAVA_CONTAINER_CONFIRM_RUNNING` from all 12. Verify every catalog parses and every remaining new key has matching placeholders in all 12.
  - **Tests**: add `frontend/src/widgets/instance/dialogs/__test__/JavaEnvironment.test.ts` covering the "Java Environment Dialog" and "Running Instance Notice" scenarios, the custom-image and missing-local-image edge cases, options reloading on each open, and the absence of image references in the DOM.

  Verify with `cd frontend && npm run type-check && npm run lint && npm test`.
- [x] 6.2 Implement the submit flow per design §8:
  - **Direct submit**: Switch submits in every status with no confirmation dialog; `confirm-loading` shows the pending state and tiles ignore clicks while pending.
  - **Success**: close the dialog, `emit("update")`, then `message.success(t("TXT_CODE_d3de39b4"))`; no navigation.
  - **Failure**: `reportErrorMsg`, reload the options, and keep the dialog open.
  - **Cancel / close**: sends nothing.
  - **Tests**: extend the dialog test with every "Switch Completion Feedback" scenario, "Running instance submits without a second dialog", and "Cancel sends nothing".

  Verify with `cd frontend && npm run type-check && npm run lint && npm test`.

## 7. Cross-module verification

- [x] 7.1 Because `languages/` changed, run every suite in one pass **on the remote Linux test server** and report the results:
  - `npm test` in `common`, `daemon`, `panel`, and `frontend`
  - `cd frontend && npm run type-check && npm run lint`
  - `npm run build` in `panel` and `daemon`
  - `cd common && npm run test:integration`, including the Docker-gated `java_container` and `docker` suites, which must run (not skip) there
  - A search confirming no leftovers of the previous revision: no `InstanceJavaContainer`, `javaContainer` route, `hiddenCardIds`, or removed i18n keys anywhere under `frontend/src`, `panel/src`, or `languages/`.

  Verify that every suite passes on the server with zero skipped Docker cases, and remove the temporary test directory afterwards.
- [x] 7.2 Check the change in the running app **on the remote Linux test server** (panel, frontend, and daemon all deployed there, using a Docker node on that server):
  - A Docker `minecraft/java/paper` instance shows the Java Manager / Java 环境管理 entry right after Plugins/Mods (when that entry is shown), and activating it opens the dialog on the instance page with `xx-jdky` tiles.
  - Switching a stopped instance closes the dialog with "Update Successful" and refreshes the instance info.
  - With a running instance the dialog shows the yellow running notice, and Switch submits directly without a second dialog.
  - A host-process instance shows only Java Manager, which opens the existing Java Manager dialog.
  - A `steam/terraria` instance shows neither entry.

  Verify by observing each behavior through the server-hosted panel and reporting what was seen. Test instances created for this check are removed afterwards.
- [x] 7.3 Redeploy and deliver for acceptance:
  - Rebuild the production bundle (`build.sh`, `BUNDLE=1`) from the verified tree on the remote server and redeploy it to the existing panel and daemon services, keeping their runtime `data/` (accounts, node pairing) unchanged. The daemon stays bound to `127.0.0.1`.
  - Confirm both services are active, the panel reports the daemon connected with key validation successful, and the panel answers HTTP 200 on the server's LAN address.
  - In the final report (not in any repository file), give the panel's **LAN address**, the **account**, and the **password** for acceptance.
  - Include an **acceptance rationale**: a checklist mapping every requirement in `specs/instance-java-environment/spec.md` and `specs/instance-management/spec.md` to its evidence (the passing unit or integration test names from 7.1, and the observations from 7.2), plus the exact steps the reviewer can repeat in the deployed panel to confirm each user-visible behavior.

## Workflow follow-up

- Archive the change with `openspec-archive-change` after review, which syncs the new `instance-java-environment` spec and the `instance-management` delta into `openspec/specs/`.
