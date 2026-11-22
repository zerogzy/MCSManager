# Proposal

## Why

Players who host Java-edition Minecraft servers (or Nukkit) in Docker regularly need a different Java version when they change server versions (Java 8 for old modpacks, 17 or 21 for current releases). Today only administrators can change an instance's Docker image, through the full instance settings form, by typing or picking a raw image reference. Regular users who own the instance have no way to do this themselves, and the host-process "Java Manager" entry does not apply to Docker instances.

## What Changes

- Add a **Java environment management** entry to the instance "Instance Features" group, placed directly after "Plugins/Mods". It reuses the existing host-process entry's label (`TXT_CODE_3fee13ed`: "Java Manager" / "Java 环境管理"), so both backends present the same concept under one name. It is shown only for Docker-backed Java-family Minecraft instances (`minecraft/java` and its subtypes, plus `minecraft/bedrock/nukkit`). Host-process instances keep the existing Java Manager entry, and every other instance type shows neither. The two entries never appear together.
- The Docker entry opens a **dialog** (like "Instance Settings"), not a separate page. The dialog shows the current Java environment and its run status, one tile per available environment, and a "Switch" button. While the instance is running or starting, the dialog shows an inline yellow notice that the change takes effect after a restart, and Switch submits directly without a second confirmation dialog. On success the dialog closes, the standard "Update Successful" message appears, and the instance information is refreshed in place.
- Add panel-side discovery of Java images on the instance's node. Local images are matched against a built-in catalog of known JDK repositories (Eclipse Temurin, including the panel's own `mcsm-eclipse-temurin` preset, Azul Zulu, Alibaba Dragonwell, Amazon Corretto, OpenJDK, IBM Semeru, SapMachine, BellSoft Liberica, GraalVM, and Microsoft Build of OpenJDK). Each match is classified by vendor and major version and exposed only as an environment key such as `zulu-jdk17` or `dragonwell-jdk21`. Raw image references are never sent to the browser.
- Add two owner-gated, regular-user endpoints, `GET` and `PUT /api/protected_instance/java_container`. The client submits only an environment key. The panel verifies the instance's stored backend and type, re-resolves the key against the node's current local images, and updates only `docker.image`, through the existing audited update path.
- **Permission model change**: a regular user can now change the Docker image of an instance they own, but only to a discovered Java image already present on the node, and only through the Java environment switch. All other container parameters stay administrator-only. AGENTS.md's permission table gains a matching note.
- Extend the existing host-process Java Manager entry condition to include Nukkit, which also runs on the JVM.
- Add i18n keys for all new user-facing text (frontend and panel), in all language catalogs. The entry and dialog title reuse `TXT_CODE_3fee13ed`.
- No layout card, sub-page, route, or layout-column changes. The Plugins/Mods entry keeps its current behavior (it still appears only when the instance has a `plugins` or `mods` folder).
- Add tests:
  - unit tests for the panel classifier and resolver
  - frontend tests for type and visibility rules, the feature-group entry, and the dialog's switch flow and running notice
  - a new real-process integration suite for the endpoints' authorization and validation

## Capabilities

### New Capabilities

- `instance-java-environment`: How a Minecraft instance's Java environment is selected. This covers which instances qualify, the instance-feature entries (Docker Java environment dialog and host-process Java Manager), Java image discovery and classification, the environment-key switching endpoints and their validation, and the switch dialog's user-visible flow.

### Modified Capabilities

- `instance-management`: gains a new requirement, "Non-Administrator Docker Image Changes", next to "Privilege Separation for Instance Configuration". It bounds the new exception: a non-administrator may change an owned instance's Docker image only through the Java environment switch, which never accepts a raw image reference. The low-privilege configuration update keeps ignoring Docker image changes. The existing privilege-separation text is unchanged.

## Impact

- **Frontend**:
  - `frontend/src/widgets/instance/ManagerBtns.vue`: new entry that opens the dialog, plus Nukkit in the Java Manager condition
  - New `frontend/src/widgets/instance/dialogs/JavaEnvironment.vue`
  - `frontend/src/hooks/useInstance.ts`: type helpers
  - New `frontend/src/services/apis/javaContainer.ts`
- **Panel**:
  - New `panel/src/app/service/java_container_service.ts`
  - `panel/src/app/routers/instance_operate_router.ts`: two routes
- **Daemon**: no code change. It reuses `environment/images`, `instance/detail` and `instance/update`.
- **Languages**: new keys in all 12 files under `languages/`.
- **Docs**: AGENTS.md permission table note.
- **Tests**:
  - panel unit tests
  - frontend vitest suites
  - new integration suite `common/test/integration/suites/java_container.test.ts`, registered in `run.mjs`
- **API**: two new endpoints. No breaking changes to existing endpoints, persisted data formats, layouts, or dependencies.
