import { describe, expect, it } from "vitest";
import {
  buildJavaEnvironments,
  classifyJavaImage,
  isJavaContainerEligible,
  JAVA_ENV_KEY_PATTERN
} from "../java_container_service";

function cls(ref: string) {
  const r = classifyJavaImage(ref);
  return r ? { vendor: r.vendor, major: r.major, name: r.name } : null;
}

describe("classifyJavaImage: Java Image Recognition", () => {
  it("recognizes catalogued repositories", () => {
    expect(cls("alibabadragonwell/dragonwell:21")).toEqual({
      vendor: "dragonwell",
      major: 21,
      name: "dragonwell-jdk21"
    });
    expect(cls("azul/zulu-openjdk:17")).toEqual({ vendor: "zulu", major: 17, name: "zulu-jdk17" });
  });

  it("tolerates registry host and library namespace", () => {
    expect(cls("docker.io/library/eclipse-temurin:17-jre")?.name).toBe("temurin-jdk17");
    expect(cls("mirror.example.com:5000/library/eclipse-temurin:17")?.name).toBe("temurin-jdk17");
    expect(cls("localhost/eclipse-temurin:21-mcsmtest")?.name).toBe("temurin-jdk21");
    expect(cls("localhost/azul/zulu-openjdk:17-mcsmtest")?.name).toBe("zulu-jdk17");
    expect(cls("library/openjdk:17")?.name).toBe("openjdk-jdk17");
  });

  it.each(["someone/eclipse-temurin:17", "my-openjdk:17", "eclipse-temurin-x:17", "azul/zulu:17"])(
    "rejects look-alike repository %s",
    (ref) => {
      expect(classifyJavaImage(ref)).toBeNull();
    }
  );

  it.each(["ubuntu:22.04", "node:22-alpine", "<none>:<none>", "", "   "])(
    "rejects non-JDK or empty image %s",
    (ref) => {
      expect(classifyJavaImage(ref)).toBeNull();
    }
  );

  it("rejects digest-only references", () => {
    expect(classifyJavaImage("eclipse-temurin@sha256:" + "a".repeat(64))).toBeNull();
  });

  it.each([
    ["eclipse-temurin:17", "temurin"],
    ["mcsm-eclipse-temurin:21", "temurin"],
    ["azul/zulu-openjdk:17", "zulu"],
    ["azul/zulu-openjdk-alpine:17", "zulu"],
    ["azul/zulu-openjdk-debian:17", "zulu"],
    ["azul/zulu-openjdk-centos:17", "zulu"],
    ["alibabadragonwell/dragonwell:17", "dragonwell"],
    ["amazoncorretto:17", "corretto"],
    ["openjdk:17", "openjdk"],
    ["ibm-semeru-runtimes:open-17-jre-jammy", "semeru"],
    ["sapmachine:17", "sapmachine"],
    ["bellsoft/liberica-openjdk-debian:17", "liberica"],
    ["bellsoft/liberica-openjdk-alpine:17", "liberica"],
    ["bellsoft/liberica-openjdk-alpine-musl:17", "liberica"],
    ["bellsoft/liberica-openjdk-centos:17", "liberica"],
    ["bellsoft/liberica-runtime-container:jdk-21-glibc", "liberica"],
    ["graalvm/jdk-community:21", "graalvm"],
    ["graalvm/graalvm-community:21", "graalvm"],
    ["graalvm/jdk:21", "graalvm"],
    ["mcr.microsoft.com/openjdk/jdk:21-ubuntu", "microsoft"]
  ])("maps %s to vendor %s", (ref, vendor) => {
    expect(classifyJavaImage(ref)?.vendor).toBe(vendor);
  });

  it("is case-insensitive", () => {
    expect(cls("Eclipse-Temurin:17-JRE")?.name).toBe("temurin-jdk17");
  });
});

describe("classifyJavaImage: Java Major Version From Tag", () => {
  it.each([
    ["17", 17],
    ["17-jre", 17],
    ["21-jdk-jammy", 21],
    ["17.0.9_9-jre", 17],
    ["8u392-b08-jdk", 8]
  ])("common tag %s -> %d", (tag, major) => {
    expect(classifyJavaImage(`eclipse-temurin:${tag}`)?.major).toBe(major);
  });

  it("vendor-marked tags", () => {
    expect(classifyJavaImage("ibm-semeru-runtimes:open-17-jre-jammy")?.major).toBe(17);
    expect(classifyJavaImage("bellsoft/liberica-runtime-container:jdk-21-glibc")?.major).toBe(21);
    expect(classifyJavaImage("ibm-semeru-runtimes:open-jdk-17")?.major).toBe(17);
    expect(classifyJavaImage("eclipse-temurin:java-11")?.major).toBe(11);
  });

  it("legacy 1.N numbering", () => {
    expect(classifyJavaImage("openjdk:1.8.0_392")?.major).toBe(8);
  });

  it.each(["eclipse-temurin", "eclipse-temurin:latest", "eclipse-temurin:lts", "eclipse-temurin:20231024"])(
    "unusable tag %s is not recognized",
    (ref) => {
      expect(classifyJavaImage(ref)).toBeNull();
    }
  );

  it("enforces the 6-99 range", () => {
    expect(classifyJavaImage("openjdk:5")).toBeNull();
    expect(classifyJavaImage("openjdk:100")).toBeNull();
    expect(classifyJavaImage("openjdk:1")).toBeNull();
    expect(classifyJavaImage("openjdk:6")?.major).toBe(6);
    expect(classifyJavaImage("openjdk:99")?.major).toBe(99);
  });

  it("sets ranking flags", () => {
    expect(classifyJavaImage("eclipse-temurin:17")).toMatchObject({
      jre: false,
      musl: false,
      bareMajor: true
    });
    expect(classifyJavaImage("eclipse-temurin:17-jre-alpine")).toMatchObject({
      jre: true,
      musl: true,
      bareMajor: false
    });
    expect(classifyJavaImage("azul/zulu-openjdk-alpine:17")).toMatchObject({ musl: true });
    expect(classifyJavaImage("bellsoft/liberica-openjdk-alpine-musl:17")).toMatchObject({
      musl: true
    });
  });
});

function img(tags: string[], created = 0) {
  return { RepoTags: tags, Created: created, Id: "sha256:deadbeef" };
}

describe("buildJavaEnvironments: Java Environment Naming", () => {
  it("formats names", () => {
    const set = buildJavaEnvironments(
      [img(["azul/zulu-openjdk:17"]), img(["alibabadragonwell/dragonwell:21"])],
      null
    );
    expect(set.options).toEqual([
      { name: "dragonwell-jdk21", version: 21 },
      { name: "zulu-jdk17", version: 17 }
    ]);
  });

  it("JRE-only image keeps the jdk name", () => {
    const set = buildJavaEnvironments([img(["eclipse-temurin:21-jre"])], null);
    expect(set.options).toEqual([{ name: "temurin-jdk21", version: 21 }]);
  });

  it("collapses duplicate names", () => {
    const set = buildJavaEnvironments(
      [
        img(["azul/zulu-openjdk:17"]),
        img(["azul/zulu-openjdk:17-jre"]),
        img(["azul/zulu-openjdk-alpine:17"])
      ],
      null
    );
    expect(set.options).toEqual([{ name: "zulu-jdk17", version: 17 }]);
  });

  it("sorts by major descending then vendor", () => {
    const set = buildJavaEnvironments(
      [
        img(["eclipse-temurin:17"]),
        img(["azul/zulu-openjdk:21"]),
        img(["amazoncorretto:21"]),
        img(["openjdk:8"])
      ],
      null
    );
    expect(set.options.map((o) => o.name)).toEqual([
      "corretto-jdk21",
      "zulu-jdk21",
      "temurin-jdk17",
      "openjdk-jdk8"
    ]);
  });

  it("ignores non-Java images, <none> tags and missing RepoTags", () => {
    const set = buildJavaEnvironments(
      [
        img(["ubuntu:22.04", "node:22-alpine"]),
        img(["<none>:<none>"]),
        { RepoTags: null, Created: 1 },
        img(["eclipse-temurin:21"])
      ],
      null
    );
    expect(set.options).toEqual([{ name: "temurin-jdk21", version: 21 }]);
  });

  it("never exposes references or IDs in current/options", () => {
    const set = buildJavaEnvironments([img(["eclipse-temurin:21"])], "eclipse-temurin:21");
    const json = JSON.stringify({ current: set.current, options: set.options });
    expect(json).not.toContain("eclipse-temurin");
    expect(json).not.toContain("sha256");
  });

  it("handles a null image list", () => {
    expect(buildJavaEnvironments(null, null).options).toEqual([]);
  });
});

describe("buildJavaEnvironments: current environment", () => {
  it("reports a recognized configured image", () => {
    const set = buildJavaEnvironments([img(["eclipse-temurin:21"])], "eclipse-temurin:17");
    expect(set.current).toEqual({ name: "temurin-jdk17", version: 17 });
  });

  it("reports null for a custom image", () => {
    const set = buildJavaEnvironments([img(["eclipse-temurin:21"])], "my/custom:1");
    expect(set.current).toBeNull();
  });
});

describe("buildJavaEnvironments: Representative Image Selection", () => {
  it("configured image wins", () => {
    const set = buildJavaEnvironments(
      [img(["azul/zulu-openjdk:17"]), img(["azul/zulu-openjdk:17-jre"])],
      "azul/zulu-openjdk:17-jre"
    );
    expect(set.representatives.get("zulu-jdk17")).toBe("azul/zulu-openjdk:17-jre");
  });

  it("configured image is compared after normalization", () => {
    const set = buildJavaEnvironments(
      [img(["azul/zulu-openjdk:17"]), img(["azul/zulu-openjdk:17-jre"])],
      "docker.io/azul/zulu-openjdk:17-JRE"
    );
    expect(set.representatives.get("zulu-jdk17")).toBe("azul/zulu-openjdk:17-jre");
  });

  it("bare major tag is preferred", () => {
    const set = buildJavaEnvironments(
      [img(["eclipse-temurin:21-jdk-jammy"], 200), img(["eclipse-temurin:21"], 100)],
      null
    );
    expect(set.representatives.get("temurin-jdk21")).toBe("eclipse-temurin:21");
  });

  it("JDK is preferred over JRE", () => {
    const set = buildJavaEnvironments(
      [img(["eclipse-temurin:17-jre"], 200), img(["eclipse-temurin:17-jdk"], 100)],
      null
    );
    expect(set.representatives.get("temurin-jdk17")).toBe("eclipse-temurin:17-jdk");
  });

  it("glibc is preferred over Alpine", () => {
    const set = buildJavaEnvironments(
      [img(["azul/zulu-openjdk-alpine:17-jre"], 200), img(["azul/zulu-openjdk-debian:17-jre"], 100)],
      null
    );
    expect(set.representatives.get("zulu-jdk17")).toBe("azul/zulu-openjdk-debian:17-jre");
  });

  it("most recently created wins next", () => {
    const set = buildJavaEnvironments(
      [img(["eclipse-temurin:17-jdk-focal"], 100), img(["eclipse-temurin:17-jdk-jammy"], 200)],
      null
    );
    expect(set.representatives.get("temurin-jdk17")).toBe("eclipse-temurin:17-jdk-jammy");
  });

  it("lexicographically smallest reference breaks ties", () => {
    const set = buildJavaEnvironments(
      [img(["eclipse-temurin:17-jdk-jammy"], 100), img(["eclipse-temurin:17-jdk-focal"], 100)],
      null
    );
    expect(set.representatives.get("temurin-jdk17")).toBe("eclipse-temurin:17-jdk-focal");
  });
});

describe("JAVA_ENV_KEY_PATTERN", () => {
  it.each(["zulu-jdk17", "dragonwell-jdk21", "openjdk-jdk8"])("accepts %s", (key) => {
    expect(JAVA_ENV_KEY_PATTERN.test(key)).toBe(true);
  });
  it.each(["", "zulu", "zulu-jdk", "zulu-jdk123", "Zulu-jdk17", "eclipse-temurin:17", "zulu-jdk17 "])(
    "rejects %s",
    (key) => {
      expect(JAVA_ENV_KEY_PATTERN.test(key)).toBe(false);
    }
  );
});

const JAVA_TYPES = [
  "minecraft/java",
  "minecraft/java/bukkit",
  "minecraft/java/spigot",
  "minecraft/java/paper",
  "minecraft/java/folia",
  "minecraft/java/leaves",
  "minecraft/java/pufferfish",
  "minecraft/java/forge",
  "minecraft/java/neoforge",
  "minecraft/java/fabric",
  "minecraft/java/bungeecord",
  "minecraft/java/velocity",
  "minecraft/java/geyser",
  "minecraft/java/sponge",
  "minecraft/java/mohist",
  "minecraft/java/purpur",
  "minecraft/bedrock/nukkit"
];
const NON_JAVA_TYPES = [
  "minecraft/bedrock",
  "minecraft/bedrock/bds",
  "universal/mcdr",
  "universal",
  "universal/web_shell",
  "steam/universal",
  "steam/terraria",
  "hytale",
  "minecraft/javax",
  ""
];

describe("isJavaContainerEligible", () => {
  it.each(JAVA_TYPES)("docker %s is eligible", (type) => {
    expect(isJavaContainerEligible({ type, processType: "docker" })).toBe(true);
  });
  it.each(JAVA_TYPES)("general %s is ineligible", (type) => {
    expect(isJavaContainerEligible({ type, processType: "general" })).toBe(false);
  });
  it.each(NON_JAVA_TYPES)("docker %s is ineligible", (type) => {
    expect(isJavaContainerEligible({ type, processType: "docker" })).toBe(false);
  });
  it.each(NON_JAVA_TYPES)("general %s is ineligible", (type) => {
    expect(isJavaContainerEligible({ type, processType: "general" })).toBe(false);
  });
  it("rejects missing config", () => {
    expect(isJavaContainerEligible(null)).toBe(false);
    expect(isJavaContainerEligible({})).toBe(false);
  });
});
