import { describe, expect, it, vi } from "vitest";

vi.mock("@/lang/i18n", () => ({
  t: (key: string) => key
}));
vi.mock("@/services/apis/instance", () => ({}));
vi.mock("ant-design-vue", () => ({ message: {}, Modal: {} }));

import {
  isJavaContainerEligible,
  isJavaFamilyMinecraftType,
  isMinecraftInstanceType,
  TYPE_HYTALE,
  TYPE_MINECRAFT_BDS,
  TYPE_MINECRAFT_BEDROCK,
  TYPE_MINECRAFT_BUKKIT,
  TYPE_MINECRAFT_BUNGEECORD,
  TYPE_MINECRAFT_FABRIC,
  TYPE_MINECRAFT_FOLIA,
  TYPE_MINECRAFT_FORGE,
  TYPE_MINECRAFT_GEYSER,
  TYPE_MINECRAFT_JAVA,
  TYPE_MINECRAFT_LEAVES,
  TYPE_MINECRAFT_MCDR,
  TYPE_MINECRAFT_MOHIST,
  TYPE_MINECRAFT_NEOFORGE,
  TYPE_MINECRAFT_NUKKIT,
  TYPE_MINECRAFT_PAPER,
  TYPE_MINECRAFT_PUFFERFISH,
  TYPE_MINECRAFT_PURPUR,
  TYPE_MINECRAFT_SPIGOT,
  TYPE_MINECRAFT_SPONGE,
  TYPE_MINECRAFT_VELOCITY,
  TYPE_STEAM_SERVER_UNIVERSAL,
  TYPE_TERRARIA,
  TYPE_UNIVERSAL,
  TYPE_WEB_SHELL
} from "../useInstance";

// Same type x backend matrix as panel/src/app/service/__test__/java_container_service.test.ts
const JAVA_TYPES = [
  TYPE_MINECRAFT_JAVA,
  TYPE_MINECRAFT_BUKKIT,
  TYPE_MINECRAFT_SPIGOT,
  TYPE_MINECRAFT_PAPER,
  TYPE_MINECRAFT_FOLIA,
  TYPE_MINECRAFT_LEAVES,
  TYPE_MINECRAFT_PUFFERFISH,
  TYPE_MINECRAFT_FORGE,
  TYPE_MINECRAFT_NEOFORGE,
  TYPE_MINECRAFT_FABRIC,
  TYPE_MINECRAFT_BUNGEECORD,
  TYPE_MINECRAFT_VELOCITY,
  TYPE_MINECRAFT_GEYSER,
  TYPE_MINECRAFT_SPONGE,
  TYPE_MINECRAFT_MOHIST,
  TYPE_MINECRAFT_PURPUR,
  TYPE_MINECRAFT_NUKKIT
];
const NON_JAVA_MC_TYPES = [TYPE_MINECRAFT_BEDROCK, TYPE_MINECRAFT_BDS, TYPE_MINECRAFT_MCDR];
const NON_MC_TYPES = [
  TYPE_UNIVERSAL,
  TYPE_WEB_SHELL,
  TYPE_STEAM_SERVER_UNIVERSAL,
  TYPE_TERRARIA,
  TYPE_HYTALE
];

describe("isJavaFamilyMinecraftType", () => {
  it.each(JAVA_TYPES)("%s is Java-family", (type) => {
    expect(isJavaFamilyMinecraftType(type)).toBe(true);
  });
  it.each([...NON_JAVA_MC_TYPES, ...NON_MC_TYPES, "minecraft/javax", "", undefined])(
    "%s is not Java-family",
    (type) => {
      expect(isJavaFamilyMinecraftType(type)).toBe(false);
    }
  );
});

describe("isMinecraftInstanceType", () => {
  it.each([...JAVA_TYPES, ...NON_JAVA_MC_TYPES])("%s is Minecraft", (type) => {
    expect(isMinecraftInstanceType(type)).toBe(true);
  });
  it.each([...NON_MC_TYPES, "", null])("%s is not Minecraft", (type) => {
    expect(isMinecraftInstanceType(type)).toBe(false);
  });
});

describe("isJavaContainerEligible", () => {
  it.each(JAVA_TYPES)("docker %s is eligible", (type) => {
    expect(isJavaContainerEligible({ type, processType: "docker" })).toBe(true);
  });
  it.each(JAVA_TYPES)("general %s is ineligible", (type) => {
    expect(isJavaContainerEligible({ type, processType: "general" })).toBe(false);
  });
  it.each([...NON_JAVA_MC_TYPES, ...NON_MC_TYPES])("docker %s is ineligible", (type) => {
    expect(isJavaContainerEligible({ type, processType: "docker" })).toBe(false);
  });
  it.each([...NON_JAVA_MC_TYPES, ...NON_MC_TYPES])("general %s is ineligible", (type) => {
    expect(isJavaContainerEligible({ type, processType: "general" })).toBe(false);
  });
  it("rejects missing config", () => {
    expect(isJavaContainerEligible(undefined)).toBe(false);
    expect(isJavaContainerEligible({})).toBe(false);
  });
});
