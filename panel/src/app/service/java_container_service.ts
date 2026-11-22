import { $t } from "../i18n";
import RemoteRequest from "./remote_command";
import RemoteServiceSubsystem from "./remote_service";

// Exact (normalized) repository path -> vendor name prefix.
// Only these repositories are recognized as Java environments; matching is exact
// so look-alike repositories (e.g. "someone/eclipse-temurin") are never accepted.
export const JAVA_IMAGE_CATALOG: Readonly<Record<string, string>> = Object.freeze({
  "eclipse-temurin": "temurin",
  "mcsm-eclipse-temurin": "temurin",
  "azul/zulu-openjdk": "zulu",
  "azul/zulu-openjdk-alpine": "zulu",
  "azul/zulu-openjdk-debian": "zulu",
  "azul/zulu-openjdk-centos": "zulu",
  "alibabadragonwell/dragonwell": "dragonwell",
  amazoncorretto: "corretto",
  openjdk: "openjdk",
  "ibm-semeru-runtimes": "semeru",
  sapmachine: "sapmachine",
  "bellsoft/liberica-openjdk-debian": "liberica",
  "bellsoft/liberica-openjdk-alpine": "liberica",
  "bellsoft/liberica-openjdk-alpine-musl": "liberica",
  "bellsoft/liberica-openjdk-centos": "liberica",
  "bellsoft/liberica-runtime-container": "liberica",
  "graalvm/jdk-community": "graalvm",
  "graalvm/graalvm-community": "graalvm",
  "graalvm/jdk": "graalvm",
  "openjdk/jdk": "microsoft"
});

export const JAVA_ENV_KEY_PATTERN = /^[a-z]+-jdk\d{1,2}$/;

const TAG_MARKERS = ["open-", "jdk-", "jre-", "java-"];
const MIN_MAJOR = 6;
const MAX_MAJOR = 99;

export interface JavaImageInfo {
  vendor: string;
  major: number;
  name: string;
  // Normalized "<repository>:<tag>" used for configured-image comparison
  normalized: string;
  jre: boolean;
  musl: boolean;
  bareMajor: boolean;
}

export interface JavaEnvironment {
  name: string;
  version: number;
}

// Minimal subset of a Docker `listImages` entry used here
export interface DockerImageSummary {
  RepoTags?: string[] | null;
  Created?: number;
}

export interface JavaEnvironmentSet {
  current: JavaEnvironment | null;
  options: JavaEnvironment[];
  // environment name -> representative image reference (server-side only)
  representatives: Map<string, string>;
}

function tokens(text: string) {
  return text.split(/[^a-z0-9]+/).filter(Boolean);
}

function isRegistryHost(segment: string) {
  return segment.includes(".") || segment.includes(":") || segment === "localhost";
}

/**
 * Split an image reference into a normalized repository path and a lowercased tag.
 * Returns null when the reference has no usable tag.
 */
function parseReference(ref: string): { repo: string; tag: string } | null {
  let value = String(ref ?? "").trim();
  if (!value || value === "<none>:<none>") return null;
  // Drop any digest; a digest-only reference has no tag left and is rejected below
  const at = value.indexOf("@");
  if (at >= 0) value = value.slice(0, at);
  const lastSlash = value.lastIndexOf("/");
  const lastColon = value.lastIndexOf(":");
  if (lastColon <= lastSlash) return null;
  const tag = value.slice(lastColon + 1).toLowerCase();
  if (!tag || tag === "<none>") return null;

  const segments = value.slice(0, lastColon).toLowerCase().split("/");
  if (segments.length > 1 && isRegistryHost(segments[0])) segments.shift();
  if (segments.length > 1 && segments[0] === "library") segments.shift();
  if (segments.some((s) => !s)) return null;
  return { repo: segments.join("/"), tag };
}

function parseMajor(tag: string): number | null {
  let rest = tag;
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const marker of TAG_MARKERS) {
      if (rest.startsWith(marker)) {
        rest = rest.slice(marker.length);
        stripped = true;
      }
    }
  }
  const match = /^(\d+)(?:\.(\d+))?/.exec(rest);
  if (!match) return null;
  let major = Number(match[1]);
  if (major === 1 && match[2] !== undefined) major = Number(match[2]);
  if (!Number.isInteger(major) || major < MIN_MAJOR || major > MAX_MAJOR) return null;
  return major;
}

/**
 * Classify one image reference as a Java environment, or return null when unrecognized.
 */
export function classifyJavaImage(ref: string): JavaImageInfo | null {
  const parsed = parseReference(ref);
  if (!parsed) return null;
  const vendor = JAVA_IMAGE_CATALOG[parsed.repo];
  if (!vendor) return null;
  const major = parseMajor(parsed.tag);
  if (major === null) return null;
  const tagTokens = tokens(parsed.tag);
  const repoTokens = tokens(parsed.repo);
  const isMusl = (t: string) => t === "alpine" || t === "musl";
  return {
    vendor,
    major,
    name: `${vendor}-jdk${major}`,
    normalized: `${parsed.repo}:${parsed.tag}`,
    jre: tagTokens.includes("jre"),
    musl: tagTokens.some(isMusl) || repoTokens.some(isMusl),
    bareMajor: parsed.tag === String(major)
  };
}

interface Candidate {
  ref: string;
  info: JavaImageInfo;
  created: number;
}

/**
 * Group the node's local images into Java environments and pick one representative
 * image per environment name. Listing and switching both use this function.
 */
export function buildJavaEnvironments(
  images: DockerImageSummary[] | null | undefined,
  configuredImage?: string | null
): JavaEnvironmentSet {
  const configured = configuredImage ? classifyJavaImage(configuredImage) : null;
  const groups = new Map<string, Candidate[]>();

  for (const image of Array.isArray(images) ? images : []) {
    const created = Number(image?.Created) || 0;
    const tags = Array.isArray(image?.RepoTags) ? image.RepoTags : [];
    for (const ref of tags) {
      if (typeof ref !== "string") continue;
      const info = classifyJavaImage(ref);
      if (!info) continue;
      const list = groups.get(info.name) ?? [];
      list.push({ ref, info, created });
      groups.set(info.name, list);
    }
  }

  const rank = (c: Candidate) => [
    configured && c.info.normalized === configured.normalized ? 0 : 1,
    c.info.bareMajor ? 0 : 1,
    c.info.jre ? 1 : 0,
    c.info.musl ? 1 : 0
  ];

  const representatives = new Map<string, string>();
  const options: (JavaEnvironment & { vendor: string })[] = [];
  for (const [name, list] of groups) {
    list.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < ra.length; i++) {
        if (ra[i] !== rb[i]) return ra[i] - rb[i];
      }
      if (a.created !== b.created) return b.created - a.created;
      return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;
    });
    representatives.set(name, list[0].ref);
    options.push({ name, version: list[0].info.major, vendor: list[0].info.vendor });
  }

  options.sort((a, b) =>
    a.version !== b.version ? b.version - a.version : a.vendor < b.vendor ? -1 : a.vendor > b.vendor ? 1 : 0
  );

  return {
    current: configured ? { name: configured.name, version: configured.major } : null,
    options: options.map(({ name, version }) => ({ name, version })),
    representatives
  };
}

export function isJavaFamilyMinecraftType(type: unknown) {
  if (typeof type !== "string") return false;
  return (
    type === "minecraft/java" ||
    type.startsWith("minecraft/java/") ||
    type === "minecraft/bedrock/nukkit"
  );
}

/**
 * Panel-side authority for Java container eligibility, judged from the stored config.
 */
export function isJavaContainerEligible(config: { processType?: unknown; type?: unknown } | null) {
  if (!config) return false;
  return config.processType === "docker" && isJavaFamilyMinecraftType(config.type);
}

async function loadEligibleConfig(daemonId: string, instanceUuid: string) {
  const remoteService = RemoteServiceSubsystem.getInstance(daemonId);
  const detail = await new RemoteRequest(remoteService).request("instance/detail", {
    instanceUuid
  });
  const config = detail?.config;
  if (!isJavaContainerEligible(config)) {
    throw new Error($t("TXT_CODE_JAVA_CONTAINER_NOT_SUPPORTED"));
  }
  return { remoteService, config };
}

async function loadEnvironments(daemonId: string, instanceUuid: string) {
  const { remoteService, config } = await loadEligibleConfig(daemonId, instanceUuid);
  const images = await new RemoteRequest(remoteService).request("environment/images", {});
  return {
    remoteService,
    environments: buildJavaEnvironments(images, config?.docker?.image)
  };
}

/**
 * List Java environments of an instance. Only names and majors are returned.
 */
export async function listJavaEnvironments(daemonId: string, instanceUuid: string) {
  const { environments } = await loadEnvironments(daemonId, instanceUuid);
  return { current: environments.current, options: environments.options };
}

/**
 * Validate an environment key and resolve it against the node's current local images.
 * Returns the resolved image reference and the remote service to update through.
 */
export async function resolveJavaEnvironment(daemonId: string, instanceUuid: string, key: unknown) {
  if (typeof key !== "string" || !JAVA_ENV_KEY_PATTERN.test(key)) {
    throw new Error($t("TXT_CODE_JAVA_CONTAINER_INVALID_KEY"));
  }
  const { remoteService, environments } = await loadEnvironments(daemonId, instanceUuid);
  const image = environments.representatives.get(key);
  if (!image) throw new Error($t("TXT_CODE_JAVA_CONTAINER_NOT_FOUND"));
  return { remoteService, image };
}
