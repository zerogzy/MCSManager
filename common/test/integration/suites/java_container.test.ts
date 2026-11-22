import { describe, it, expect, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  world,
  requestPanel,
  waitFor,
  setupSecurityWorld,
  createInstance,
  deleteInstance,
  assignToU1,
  getStatusOf,
  openOf,
  getUploadPassport,
  uploadToDaemon,
  setSetting,
  di,
  u1,
  u2,
  adm,
  FIXTURE,
  STOPPED,
  RUNNING
} from "../lib";

// Java container switch integration suite
// (GET/PUT /api/protected_instance/java_container).
//
// Real daemon + panel, no mocks. u1 owns every instance created here, u2 is never
// assigned. The non-Docker block only needs stored instance configs: creating a
// processType:"docker" instance writes config only, so no dockerd is required for
// it. Every case that needs real images or containers is gated with `dockerIt`
// (Linux + reachable dockerd), and shows as SKIPPED elsewhere.

const LANG = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../../languages/en_US.json"), "utf-8")
);
const MSG_NOT_SUPPORTED = LANG.TXT_CODE_JAVA_CONTAINER_NOT_SUPPORTED;
const MSG_INVALID_KEY = LANG.TXT_CODE_JAVA_CONTAINER_INVALID_KEY;
const MSG_NOT_FOUND = LANG.TXT_CODE_JAVA_CONTAINER_NOT_FOUND;

const isLinux = process.platform === "linux";
function detectDocker(): boolean {
  if (!isLinux) return false;
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const dockerOk = detectDocker();
const dockerIt = dockerOk ? it : it.skip;

const NODE_IMAGE = "node:22-alpine";
// Unusual majors so the test images never compete with real Java images on the node
// (e.g. an existing `azul/zulu-openjdk:17` would win representative selection).
const TEMURIN_TAG = "localhost/eclipse-temurin:98-mcsmtest";
const ZULU_TAG = "localhost/azul/zulu-openjdk:97-mcsmtest";
const TEMURIN_ENV = "temurin-jdk98";
const ZULU_ENV = "zulu-jdk97";
const LABEL_KEY = "mcsmanager.instance.uuid";
const RUN_ID = `${Date.now()}-${process.pid}`;

const created: string[] = [];

// Local images that would also resolve to the test environments (catalogued repository
// with the same major), ignoring the test tags themselves.
function conflictingLocalImages(): string[] {
  const refs = execSync("docker images --format '{{.Repository}}:{{.Tag}}'", { encoding: "utf-8" })
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l !== TEMURIN_TAG && l !== ZULU_TAG);
  const wanted: Record<string, string> = {
    "eclipse-temurin": "98",
    "mcsm-eclipse-temurin": "98",
    "azul/zulu-openjdk": "97",
    "azul/zulu-openjdk-alpine": "97",
    "azul/zulu-openjdk-debian": "97",
    "azul/zulu-openjdk-centos": "97"
  };
  return refs.filter((ref) => {
    const i = ref.lastIndexOf(":");
    const segs = ref.slice(0, i).toLowerCase().split("/");
    if (segs.length > 1 && /[.:]|^localhost$/.test(segs[0])) segs.shift();
    if (segs[0] === "library") segs.shift();
    const major = wanted[segs.join("/")];
    if (!major) return false;
    const tag = ref.slice(i + 1).toLowerCase().replace(/^((open|jdk|jre|java)-)+/, "");
    return new RegExp(`^${major}(\\D|$)`).test(tag);
  });
}

function dockerConfig(image: string, label: string) {
  return {
    image,
    containerName: `mcsm-it-javact-${label}-${RUN_ID}`,
    ports: [],
    workingDir: "/data",
    changeWorkdir: true,
    networkMode: "bridge",
    env: ["MCSM_IT=1"],
    extraVolumes: []
  };
}

async function createOwned(nickname: string, extra: any): Promise<string> {
  const uuid = await createInstance(nickname, extra);
  created.push(uuid);
  await assignToU1([world.instance.uuid!, ...created]);
  return uuid;
}

const asUser = (who: { cookie: string; token: string }, method: "GET" | "PUT", uuid: string, body?: any) =>
  requestPanel({
    method,
    path: "/protected_instance/java_container",
    cookie: who.cookie,
    token: who.token,
    query: { daemonId: di(), uuid },
    body
  });

// Stored config read through the administrator's detail view
async function adminConfig(uuid: string): Promise<any> {
  const r = await requestPanel({
    method: "GET",
    path: "/instance",
    cookie: adm().cookie,
    token: adm().token,
    query: { daemonId: di(), uuid }
  });
  expect(r.httpStatus, `admin detail: ${JSON.stringify(r.raw).slice(0, 200)}`).toBe(200);
  return r.data?.config;
}

function expectRejected(r: any, message: string) {
  expect(r.httpStatus, `expected rejection: ${JSON.stringify(r.raw).slice(0, 200)}`).not.toBe(200);
  expect(String(r.data)).toContain(message);
}

afterAll(async () => {
  for (const uuid of created) {
    try {
      await requestPanel({
        method: "GET",
        path: "/protected_instance/kill",
        cookie: u1().cookie,
        token: u1().token,
        query: { daemonId: di(), uuid }
      });
    } catch {
      /* best effort */
    }
    try {
      await deleteInstance(uuid);
    } catch {
      /* best effort */
    }
  }
  if (dockerOk) {
    for (const tag of [TEMURIN_TAG, ZULU_TAG]) {
      try {
        execSync(`docker rmi ${tag}`, { stdio: "ignore" });
      } catch {
        /* best effort */
      }
    }
  }
});

describe("java_container: setup", () => {
  it("ensure admin/u1/u2 and the main instance owned by u1", async () => {
    await setupSecurityWorld();
  });
});

describe("java_container: authorization and validation (no Docker needed)", () => {
  let dockerJava = "";
  let hostJava = "";
  let dockerBds = "";

  it("creates config-only Docker and host-process instances", async () => {
    dockerJava = await createOwned("mcsm-it-javact-docker", {
      type: "minecraft/java/paper",
      processType: "docker",
      docker: dockerConfig("eclipse-temurin:21", "cfg")
    });
    hostJava = await createOwned("mcsm-it-javact-host", {
      type: "minecraft/java",
      processType: "general"
    });
    dockerBds = await createOwned("mcsm-it-javact-bds", {
      type: "minecraft/bedrock/bds",
      processType: "docker",
      docker: dockerConfig("ubuntu:22.04", "bds")
    });
    expect((await adminConfig(dockerJava)).docker.image).toBe("eclipse-temurin:21");
  });

  it("unassigned u2 is refused with 403 on GET and PUT; nothing changes", async () => {
    const g = await asUser(u2(), "GET", dockerJava);
    expect(g.httpStatus).toBe(403);
    const p = await asUser(u2(), "PUT", dockerJava, { key: "temurin-jdk17" });
    expect(p.httpStatus).toBe(403);
    expect((await adminConfig(dockerJava)).docker.image).toBe("eclipse-temurin:21");
  });

  it("host-process minecraft/java is rejected as not supported, even with docker claims in the body", async () => {
    expectRejected(await asUser(u1(), "GET", hostJava), MSG_NOT_SUPPORTED);
    const before = await adminConfig(hostJava);
    const p = await asUser(u1(), "PUT", hostJava, {
      key: "temurin-jdk21",
      processType: "docker",
      image: "eclipse-temurin:21",
      docker: { image: "eclipse-temurin:21" }
    });
    expectRejected(p, MSG_NOT_SUPPORTED);
    const after = await adminConfig(hostJava);
    expect(after.processType).toBe("general");
    expect(after.docker?.image).toBe(before.docker?.image);
  });

  it("Docker minecraft/bedrock/bds is rejected as not supported", async () => {
    expectRejected(await asUser(u1(), "GET", dockerBds), MSG_NOT_SUPPORTED);
    expectRejected(await asUser(u1(), "PUT", dockerBds, { key: "temurin-jdk21" }), MSG_NOT_SUPPORTED);
    expect((await adminConfig(dockerBds)).docker.image).toBe("ubuntu:22.04");
  });

  it.each([
    ["raw image reference", "eclipse-temurin:17"],
    ["uppercase", "Temurin-jdk17"],
    ["three-digit major", "temurin-jdk123"],
    ["missing major", "temurin-jdk"],
    ["empty", ""],
    ["non-string", 17]
  ])("malformed key (%s) is rejected and the config is unchanged", async (_label, key) => {
    const p = await asUser(u1(), "PUT", dockerJava, { key });
    expectRejected(p, MSG_INVALID_KEY);
    expect((await adminConfig(dockerJava)).docker.image).toBe("eclipse-temurin:21");
  });

  it.each([false, true])(
    "low-privilege instance_update carrying docker.image leaves the image unchanged (allowChangeCmd=%s)",
    async (allowChangeCmd) => {
      await setSetting({ allowChangeCmd });
      try {
        const r = await requestPanel({
          method: "PUT",
          path: "/protected_instance/instance_update",
          cookie: u1().cookie,
          token: u1().token,
          query: { daemonId: di(), uuid: dockerJava },
          body: { docker: { image: "ubuntu:22.04", env: ["MCSM_IT=1"] } }
        });
        expect(r.httpStatus, `instance_update: ${JSON.stringify(r.raw).slice(0, 200)}`).toBe(200);
        expect((await adminConfig(dockerJava)).docker.image).toBe("eclipse-temurin:21");
      } finally {
        await setSetting({ allowChangeCmd: false });
      }
    }
  );
});

describe("java_container: Docker images and containers (Linux + Docker only)", () => {
  let stoppedUuid = "";
  let runningUuid = "";

  dockerIt(
    "tags node:22-alpine as catalogued Java repositories",
    async () => {
      try {
        execSync(`docker image inspect ${NODE_IMAGE}`, { stdio: "ignore" });
      } catch {
        execSync(`docker pull ${NODE_IMAGE}`, { stdio: "ignore", timeout: 300000 });
      }
      expect(conflictingLocalImages(), "node must not already hold the test environments").toEqual(
        []
      );
      execSync(`docker tag ${NODE_IMAGE} ${TEMURIN_TAG}`);
      execSync(`docker tag ${NODE_IMAGE} ${ZULU_TAG}`);
      stoppedUuid = await createOwned("mcsm-it-javact-stopped", {
        type: "minecraft/java/paper",
        processType: "docker",
        docker: dockerConfig(TEMURIN_TAG, "stopped")
      });
    },
    320000
  );

  dockerIt("owner listing returns names and majors only", async () => {
    const r = await asUser(u1(), "GET", stoppedUuid);
    expect(r.httpStatus, `GET: ${JSON.stringify(r.raw).slice(0, 300)}`).toBe(200);
    expect(r.data.current).toEqual({ name: TEMURIN_ENV, version: 98 });
    const names = r.data.options.map((o: any) => o.name);
    expect(names).toContain(TEMURIN_ENV);
    expect(names).toContain(ZULU_ENV);
    for (const o of r.data.options) expect(Object.keys(o).sort()).toEqual(["name", "version"]);
    const payload = JSON.stringify(r.raw);
    expect(payload).not.toContain("localhost/");
    expect(payload).not.toContain("mcsmtest");
    expect(payload).not.toContain("sha256:");
    expect(payload).not.toContain("node:");
  });

  dockerIt("stopped switch changes only docker.image and writes an operation-log entry", async () => {
    const before = await adminConfig(stoppedUuid);
    const p = await asUser(u1(), "PUT", stoppedUuid, { key: ZULU_ENV, image: "ubuntu:22.04" });
    expect(p.httpStatus, `PUT: ${JSON.stringify(p.raw).slice(0, 200)}`).toBe(200);
    const after = await adminConfig(stoppedUuid);
    expect(after.docker.image).toBe(ZULU_TAG);
    expect({ ...after.docker, image: undefined }).toEqual({ ...before.docker, image: undefined });
    expect({ ...after, docker: undefined, lastDatetime: undefined }).toEqual({
      ...before,
      docker: undefined,
      lastDatetime: undefined
    });

    const logs = await requestPanel({
      method: "GET",
      path: "/overview/operation_logs",
      key: world.key,
      query: { limit: 200 }
    });
    expect(logs.httpStatus).toBe(200);
    const entry = (logs.data || []).find(
      (e: any) =>
        e.type === "instance_config_change" &&
        e.instance_id === stoppedUuid &&
        e.operator_name === world.u1.name
    );
    expect(entry, "instance_config_change entry naming u1").toBeTruthy();
  });

  dockerIt("well-formed but unavailable name is rejected", async () => {
    const p = await asUser(u1(), "PUT", stoppedUuid, { key: "corretto-jdk11" });
    expectRejected(p, MSG_NOT_FOUND);
    expect((await adminConfig(stoppedUuid)).docker.image).toBe(ZULU_TAG);
  });

  dockerIt(
    "running switch keeps the container image until restart",
    async () => {
      runningUuid = await createOwned("mcsm-it-javact-running", {
        type: "minecraft/java/paper",
        processType: "docker",
        docker: dockerConfig(TEMURIN_TAG, "running")
      });
      const pp = await getUploadPassport(di(), runningUuid, u1().cookie, u1().token, ".");
      const up = await uploadToDaemon(pp, FIXTURE, "test.mjs", { unzip: false });
      expect(up.httpStatus).toBe(200);

      const containerImage = () =>
        execSync(`docker ps --filter label=${LABEL_KEY}=${runningUuid} --format {{.Image}}`, {
          encoding: "utf-8"
        }).trim();

      expect((await openOf(runningUuid)).httpStatus).toBe(200);
      await waitFor(async () => (await getStatusOf(runningUuid)) === RUNNING, {
        timeout: 60000,
        interval: 500,
        msg: "java container instance RUNNING"
      });
      expect(containerImage()).toBe(TEMURIN_TAG);

      const p = await asUser(u1(), "PUT", runningUuid, { key: ZULU_ENV });
      expect(p.httpStatus, `PUT: ${JSON.stringify(p.raw).slice(0, 200)}`).toBe(200);
      expect((await adminConfig(runningUuid)).docker.image).toBe(ZULU_TAG);
      expect(containerImage(), "running container keeps its image").toBe(TEMURIN_TAG);

      await requestPanel({
        method: "GET",
        path: "/protected_instance/kill",
        cookie: u1().cookie,
        token: u1().token,
        query: { daemonId: di(), uuid: runningUuid }
      });
      await waitFor(async () => (await getStatusOf(runningUuid)) === STOPPED, {
        timeout: 30000,
        interval: 500,
        msg: "java container instance STOPPED"
      });
      expect((await openOf(runningUuid)).httpStatus).toBe(200);
      await waitFor(async () => (await getStatusOf(runningUuid)) === RUNNING, {
        timeout: 60000,
        interval: 500,
        msg: "java container instance RUNNING again"
      });
      expect(containerImage(), "next start uses the new image").toBe(ZULU_TAG);
    },
    240000
  );
});
