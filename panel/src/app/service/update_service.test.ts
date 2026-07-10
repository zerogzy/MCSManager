import assert from "assert";
import * as fs from "fs-extra";
import os from "os";
import path from "path";
import { replaceProgram } from "./update_files";
import {
  getUpdateAssetName,
  getUpdateRestartCommand,
  findBlockingUpdateInstances,
  getReleaseApiUrl
} from "./update_helpers";

assert.strictEqual(getUpdateAssetName("web", "linux"), "mcsmanager_linux_web_only_release.tar.gz");
assert.strictEqual(getUpdateAssetName("web", "win32"), "mcsmanager_windows_web_only_release.zip");
assert.strictEqual(getUpdateAssetName("daemon", "linux"), "mcsmanager_linux_daemon_only_release.tar.gz");
assert.strictEqual(getUpdateAssetName("daemon", "win32"), "mcsmanager_windows_daemon_only_release.zip");
assert.strictEqual(
  getReleaseApiUrl("web"),
  "https://api.github.com/repos/zerogzy/MCSManager-Web/releases/latest"
);
assert.strictEqual(
  getReleaseApiUrl("daemon"),
  "https://api.github.com/repos/zerogzy/MCSManager-Daemon/releases/latest"
);
assert.strictEqual(getUpdateRestartCommand("linux"), "systemctl restart mcsm-web mcsm-daemon");
assert.strictEqual(
  getUpdateRestartCommand("win32"),
  'powershell -NoProfile -ExecutionPolicy Bypass -Command "Restart-Service mcsm-web,mcsm-daemon"'
);

assert.deepStrictEqual(
  findBlockingUpdateInstances([
    { instanceUuid: "docker-1", status: 3, config: { processType: "docker", nickname: "docker" } },
    {
      instanceUuid: "general-1",
      status: 3,
      config: { processType: "general", nickname: "vanilla" }
    },
    {
      instanceUuid: "stopped-1",
      status: 0,
      config: { processType: "general", nickname: "stopped" }
    }
  ]),
  [{ instanceUuid: "general-1", nickname: "vanilla", processType: "general", status: 3 }]
);

async function assertReplaceSkipsBrokenLinks() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcsm-replace-root-"));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "mcsm-replace-source-"));
  try {
    await fs.ensureDir(path.join(root, "web", "data"));
    await fs.ensureDir(path.join(root, "daemon"));
    await fs.outputFile(path.join(root, "web", "data", "config.json"), "{}");
    await fs.outputFile(path.join(root, "web", "app.js"), "old");
    await fs.outputFile(path.join(root, "daemon", "app.js"), "old");

    await fs.ensureDir(path.join(source, "web", "node_modules"));
    await fs.ensureDir(path.join(source, "daemon"));
    await fs.outputFile(path.join(source, "web", "app.js"), "new");
    await fs.outputFile(path.join(source, "daemon", "app.js"), "new");
    await fs.symlink(path.join(source, "missing-common"), path.join(source, "web", "node_modules", "mcsmanager-common"), "junction");

    await replaceProgram(root, source);

    assert.strictEqual(await fs.readFile(path.join(root, "web", "app.js"), "utf-8"), "new");
    assert.ok(await fs.pathExists(path.join(root, "web", "data", "config.json")));
    assert.strictEqual(await fs.pathExists(path.join(root, "web", "node_modules", "mcsmanager-common")), false);
  } finally {
    await fs.remove(root);
    await fs.remove(source);
  }
}

async function assertWebOnlyReplacePreservesUploads() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcsm-web-only-root-"));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "mcsm-web-only-source-"));
  try {
    await fs.outputFile(path.join(root, "web", "app.js"), "old");
    await fs.outputFile(path.join(root, "web", "public", "upload_files", "keep.txt"), "keep");

    await fs.outputFile(path.join(source, "web", "app.js"), "new");
    await fs.outputFile(path.join(source, "web", "public", "index.html"), "index");

    await replaceProgram(root, source, ["web"]);

    assert.strictEqual(await fs.readFile(path.join(root, "web", "app.js"), "utf-8"), "new");
    assert.strictEqual(
      await fs.readFile(path.join(root, "web", "public", "upload_files", "keep.txt"), "utf-8"),
      "keep"
    );
    assert.strictEqual(await fs.pathExists(path.join(root, "daemon")), false);
  } finally {
    await fs.remove(root);
    await fs.remove(source);
  }
}

Promise.all([
  assertReplaceSkipsBrokenLinks(),
  assertWebOnlyReplacePreservesUploads()
]).then(() => {
  console.log("update_service self-check passed");
});
