# Spec Delta

## ADDED Requirements

### Requirement: Non-Administrator Docker Image Changes
A non-administrator SHALL be able to change the Docker image of an instance assigned to them only through the Java environment switch, which accepts an environment name rather than an image reference and resolves it to a Java image already present on the instance's node. The low-privilege configuration update SHALL keep ignoring Docker image changes, and every other container parameter SHALL stay administrator-only.

#### Scenario: Low-privilege update ignores the image
- **WHEN** a non-administrator sends a Docker image through the low-privilege configuration update, with or without the allow-command-change switch enabled
- **THEN** the stored Docker image is unchanged

#### Scenario: Java environment switch changes only the image
- **WHEN** a non-administrator owner switches an eligible instance to an available Java environment
- **THEN** only the Docker image changes; ports, volumes, privileges, devices, network, limits, and environment variables are unchanged

#### Scenario: Image references cannot be submitted
- **WHEN** a non-administrator includes an image reference in a Java environment switch request
- **THEN** the reference is ignored and only a valid environment name can change the image
