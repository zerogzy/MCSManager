# instance-java-environment Specification

## Purpose

Defines how a Minecraft instance's Java environment is selected: which instances qualify, the instance-feature entries, how Java images on a node are discovered and named, the owner-facing switch endpoints, and the Java environment dialog's switching flow.

## Requirements

### Requirement: Java Container Eligibility
An instance SHALL be eligible for Java container switching only when its stored process backend is Docker and its game type is a Java-family Minecraft type: `minecraft/java`, any `minecraft/java/<subtype>`, or `minecraft/bedrock/nukkit`. Every other game type and every host-process instance SHALL be ineligible.

#### Scenario: Docker Java-edition subtype is eligible
- **WHEN** an instance has game type `minecraft/java/paper` and the Docker process backend
- **THEN** it is eligible for Java container switching

#### Scenario: Docker Nukkit is eligible
- **WHEN** an instance has game type `minecraft/bedrock/nukkit` and the Docker process backend
- **THEN** it is eligible for Java container switching

#### Scenario: Non-Java Minecraft types are ineligible
- **WHEN** a Docker instance has game type `minecraft/bedrock`, `minecraft/bedrock/bds`, or `universal/mcdr`
- **THEN** it is not eligible

#### Scenario: Non-Minecraft types are ineligible
- **WHEN** a Docker instance has game type `universal`, `universal/web_shell`, `steam/universal`, `steam/terraria`, or `hytale`
- **THEN** it is not eligible

#### Scenario: Host-process instances are ineligible
- **WHEN** an instance has game type `minecraft/java` and the general (host process) backend
- **THEN** it is not eligible

### Requirement: Java Selection Entries in Instance Features
The instance feature group SHALL show a Java environment entry directly after the Plugins/Mods entry only for eligible instances, opening the Java environment dialog. It SHALL show the host-process Java Manager entry for host-process Java-family instances, including Nukkit. Both entries SHALL share the Java Manager label and SHALL never appear together.

#### Scenario: Docker Java instance shows the Java environment entry
- **WHEN** the feature group renders for an eligible instance
- **THEN** a Java environment entry with the Java Manager label appears directly after the Plugins/Mods position, and the host-process Java Manager entry is absent

#### Scenario: Entry opens the dialog
- **WHEN** the user activates the Java environment entry
- **THEN** the Java environment dialog opens for the same instance and node, and the user stays on the instance page

#### Scenario: Host-process Java instance keeps Java Manager
- **WHEN** the feature group renders for a host-process `minecraft/java/fabric` instance
- **THEN** the Java Manager entry appears and the Java environment entry is absent

#### Scenario: Host-process Nukkit shows Java Manager
- **WHEN** the feature group renders for a host-process `minecraft/bedrock/nukkit` instance
- **THEN** the Java Manager entry appears

#### Scenario: Other instances show neither entry
- **WHEN** the feature group renders for a `steam/terraria` instance or a `minecraft/bedrock/bds` instance
- **THEN** neither the Java environment entry nor the Java Manager entry appears

#### Scenario: Plugins/Mods visibility is unchanged
- **WHEN** an eligible instance has no `plugins` or `mods` folder
- **THEN** the Plugins/Mods entry stays hidden as before, and the Java environment entry still appears in its position after it

### Requirement: Java Image Recognition
The panel SHALL recognize a local Docker image as a Java environment only when its repository, after dropping an optional registry host and the `library/` namespace, exactly equals a catalogued JDK repository. Repositories that merely resemble a catalogued one, and images that are not JDK images, SHALL NOT be recognized.

#### Scenario: Catalogued repositories are recognized
- **WHEN** the node holds `alibabadragonwell/dragonwell:21` and `azul/zulu-openjdk:17`
- **THEN** they are recognized as the `dragonwell` Java 21 and `zulu` Java 17 images

#### Scenario: Registry host and library namespace are tolerated
- **WHEN** the node holds `docker.io/library/eclipse-temurin:17-jre` or `mirror.example.com:5000/library/eclipse-temurin:17`
- **THEN** each is recognized as a `temurin` Java 17 image

#### Scenario: Look-alike repositories are rejected
- **WHEN** the node holds `someone/eclipse-temurin:17` or `my-openjdk:17`
- **THEN** neither is recognized

#### Scenario: Non-JDK images are rejected
- **WHEN** the node holds `ubuntu:22.04` or `node:22-alpine`
- **THEN** neither is recognized

#### Scenario: Catalogued repositories and their name prefixes
- **WHEN** images come from the catalogued repositories
- **THEN** they use these name prefixes: `eclipse-temurin` and `mcsm-eclipse-temurin` → `temurin`; `azul/zulu-openjdk`, `azul/zulu-openjdk-alpine`, `azul/zulu-openjdk-debian`, `azul/zulu-openjdk-centos` → `zulu`; `alibabadragonwell/dragonwell` → `dragonwell`; `amazoncorretto` → `corretto`; `openjdk` → `openjdk`; `ibm-semeru-runtimes` → `semeru`; `sapmachine` → `sapmachine`; `bellsoft/liberica-openjdk-debian`, `bellsoft/liberica-openjdk-alpine`, `bellsoft/liberica-openjdk-alpine-musl`, `bellsoft/liberica-openjdk-centos`, `bellsoft/liberica-runtime-container` → `liberica`; `graalvm/jdk-community`, `graalvm/graalvm-community`, `graalvm/jdk` → `graalvm`; `openjdk/jdk` → `microsoft`

### Requirement: Java Major Version From Tag
The panel SHALL take an image's Java major version from its tag, ignoring a leading `open-`, `jdk-`, `jre-`, or `java-` marker and reading a legacy `1.N` version as N. Only majors from 6 through 99 SHALL be accepted; an image without a tag, with a non-numeric tag, or with an out-of-range number SHALL NOT be recognized.

#### Scenario: Common tag shapes
- **WHEN** catalogued images are tagged `17`, `17-jre`, `21-jdk-jammy`, `17.0.9_9-jre`, or `8u392-b08-jdk`
- **THEN** their majors are 17, 17, 21, 17, and 8

#### Scenario: Vendor-marked tags
- **WHEN** a Semeru image is tagged `open-17-jre-jammy` or a Liberica image is tagged `jdk-21-glibc`
- **THEN** their majors are 17 and 21

#### Scenario: Legacy version numbering
- **WHEN** a catalogued image is tagged `1.8.0_392`
- **THEN** its major is 8

#### Scenario: Unusable tags
- **WHEN** a catalogued image is untagged or tagged `latest`, `lts`, or `20231024`
- **THEN** it is not recognized

### Requirement: Java Environment Naming
Each recognized image SHALL be presented as the environment `<vendor>-jdk<major>`, for example `zulu-jdk17` or `dragonwell-jdk21`, whether the image ships a full JDK or only a JRE. A node SHALL list each environment name at most once.

#### Scenario: Name format
- **WHEN** the node holds `azul/zulu-openjdk:17` and `alibabadragonwell/dragonwell:21`
- **THEN** the environments are named `zulu-jdk17` and `dragonwell-jdk21`

#### Scenario: JRE-only image keeps the jdk name
- **WHEN** the only Temurin 21 image on the node is `eclipse-temurin:21-jre`
- **THEN** the environment is named `temurin-jdk21`

#### Scenario: Duplicate names collapse
- **WHEN** the node holds `azul/zulu-openjdk:17`, `azul/zulu-openjdk:17-jre`, and `azul/zulu-openjdk-alpine:17`
- **THEN** a single `zulu-jdk17` environment is listed

### Requirement: Representative Image Selection
When several local images share an environment name, the panel SHALL resolve the name to one image in this fixed order: the instance's configured image, then a tag equal to the bare major version, then a JDK over a JRE, then a non-Alpine, non-musl image, then the most recently created image, then the lexicographically smallest reference. Listing and switching SHALL use the same resolution.

#### Scenario: Configured image wins
- **WHEN** the instance is configured with `azul/zulu-openjdk:17-jre` and the node also holds `azul/zulu-openjdk:17`
- **THEN** `zulu-jdk17` resolves to `azul/zulu-openjdk:17-jre` for that instance

#### Scenario: Bare major tag is preferred
- **WHEN** the node holds `eclipse-temurin:21` and `eclipse-temurin:21-jdk-jammy` and neither is configured on the instance
- **THEN** `temurin-jdk21` resolves to `eclipse-temurin:21`

#### Scenario: JDK is preferred over JRE
- **WHEN** the node holds `eclipse-temurin:17-jre` and `eclipse-temurin:17-jdk` and neither is configured on the instance
- **THEN** `temurin-jdk17` resolves to `eclipse-temurin:17-jdk`

#### Scenario: glibc is preferred over Alpine
- **WHEN** the node holds `azul/zulu-openjdk-alpine:17-jre` and `azul/zulu-openjdk-debian:17-jre` and neither is configured on the instance
- **THEN** `zulu-jdk17` resolves to `azul/zulu-openjdk-debian:17-jre`

### Requirement: Image References Stay on the Server
Java environment endpoints SHALL describe environments only by name and major version. Their responses SHALL NOT include raw image references, image IDs, or information about non-Java images on the node, for any caller role.

#### Scenario: Listing hides references
- **WHEN** an owner or an administrator lists Java environments
- **THEN** the response contains environment names and majors only, with no image reference or image ID

### Requirement: Java Environment Listing
The panel SHALL provide an instance-scoped listing, behind the standard instance ownership gate, that returns the current Java environment and the environments available on the instance's node. The current environment SHALL be reported by name and major, or as a custom image when the configured image is not recognized. Requests for ineligible instances SHALL be rejected.

#### Scenario: Owner lists environments
- **WHEN** a regular user lists environments for an eligible instance assigned to them
- **THEN** the current environment and the available environments are returned

#### Scenario: Unassigned user is refused
- **WHEN** a regular user lists environments for an instance not assigned to them
- **THEN** the request is refused with the instance-forbidden response

#### Scenario: Ineligible instance is rejected
- **WHEN** the listing targets a host-process instance or a `minecraft/bedrock/bds` Docker instance
- **THEN** the request is rejected with a not-supported error

#### Scenario: Unrecognized configured image
- **WHEN** an eligible instance is configured with an image that is not a recognized Java image
- **THEN** the current environment is reported as a custom image and no available environment is marked current

### Requirement: Java Environment Switch
The panel SHALL let the instance owner or an administrator switch an eligible instance by submitting only an environment name. It SHALL check the name's format, judge eligibility from the stored instance configuration rather than the request, resolve the name against the node's current local images, change only the Docker image, and record the change in the operation log.

#### Scenario: Switch changes only the image
- **WHEN** the owner switches an eligible instance to an available environment
- **THEN** the instance's Docker image becomes the resolved image and every other container parameter is unchanged

#### Scenario: Change is recorded in the operation log
- **WHEN** a switch changes the image
- **THEN** an instance configuration change entry naming the operator is written to the operation log

#### Scenario: Request claims are ignored
- **WHEN** a switch request for a host-process instance also carries `processType: "docker"` or an image reference
- **THEN** the request is rejected as not supported and the extra fields have no effect

#### Scenario: Malformed name is rejected
- **WHEN** the submitted name is not of the form `<vendor>-jdk<major>`
- **THEN** the request is rejected and the configuration is unchanged

#### Scenario: Unavailable environment is rejected
- **WHEN** the submitted name is well-formed but no local image on the node resolves to it
- **THEN** the request is rejected and the configuration is unchanged

#### Scenario: Unassigned user is refused
- **WHEN** a regular user submits a switch for an instance not assigned to them
- **THEN** the request is refused with the instance-forbidden response and nothing changes

#### Scenario: Running container is not replaced
- **WHEN** a running instance is switched
- **THEN** the running container keeps its current image and the new image is used from the next start

### Requirement: Java Environment Dialog
The Java environment dialog SHALL show the instance's current Java environment with its major version and run status, and one selectable tile per available environment, with the current one marked. It SHALL offer a single Switch control that acts only while an environment other than the current one is selected. The dialog SHALL NOT display raw image references. Closing or cancelling the dialog SHALL NOT send a switch request.

#### Scenario: Selecting another environment enables Switch
- **WHEN** the user selects a tile other than the current environment
- **THEN** the Switch control becomes active

#### Scenario: Current environment selected
- **WHEN** the selected tile is the current environment
- **THEN** the Switch control is inactive and activating it does nothing

#### Scenario: Only one environment available
- **WHEN** the node offers only the current environment
- **THEN** the dialog shows that single tile marked as current and Switch stays inactive

#### Scenario: Cancel sends nothing
- **WHEN** the user cancels or closes the dialog after selecting another environment
- **THEN** no switch request is sent

### Requirement: Running Instance Notice
While the instance is running or starting, the Java environment dialog SHALL show an inline warning stating that the instance is running and the change takes effect after a restart. Switch SHALL submit directly in every instance state, without an additional confirmation dialog. When the instance is stopped, stopping, or busy, the warning SHALL NOT be shown.

#### Scenario: Running instance shows the notice
- **WHEN** the dialog is open while the instance is running
- **THEN** the inline running warning is visible

#### Scenario: Starting instance shows the notice
- **WHEN** the dialog is open while the instance is starting
- **THEN** the inline running warning is visible

#### Scenario: Stopped instance shows no notice
- **WHEN** the dialog is open while the instance is stopped
- **THEN** no running warning is shown

#### Scenario: Running instance submits without a second dialog
- **WHEN** the user activates Switch while the instance is running
- **THEN** the switch is submitted directly and no confirmation dialog appears

### Requirement: Switch Completion Feedback
After a successful switch, the UI SHALL close the Java environment dialog, show the standard "Update Successful" message, and refresh the instance information while staying on the instance page. After a failed switch, the UI SHALL show the error, keep the dialog open, and reload the available environments.

#### Scenario: Success closes the dialog
- **WHEN** a switch succeeds
- **THEN** the dialog closes, the update-success message is shown, and the instance information is refreshed on the same instance page

#### Scenario: Failure keeps the dialog open
- **WHEN** a switch fails
- **THEN** the error is shown, the dialog stays open, and the environment list is reloaded

### Requirement: Localized Java Environment Text
All user-facing text of the Java selection UI and of the switch endpoints' errors SHALL be resolved through language catalog keys, and every new key SHALL exist in every language catalog with matching placeholders. Environment names such as `zulu-jdk17` SHALL be shown verbatim in every language.

#### Scenario: Locale change
- **WHEN** the user changes the UI language
- **THEN** the Java environment entry, dialog, running notice, and endpoint errors appear in that language while environment names stay unchanged
