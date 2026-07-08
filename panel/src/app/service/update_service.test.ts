import assert from "assert";
import * as fs from "fs-extra";
import os from "os";
import path from "path";
import { backupCurrent, replaceProgram } from "./update_files";
import {
  getUpdateAssetName,
  getUpdateRestartCommand,
  findBlockingUpdateInstances
} from "./update_helpers";

assert.strictEqual(getUpdateAssetName("linux"), "mcsmanager_linux_release.tar.gz");
assert.strictEqual(getUpdateAssetName("win32"), "mcsmanager_windows_release.zip");
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

async function assertBackupSkipsBrokenLinks() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcsm-update-"));
  try {
    await fs.ensureDir(path.join(root, "web", "node_modules"));
    await fs.ensureDir(path.join(root, "daemon"));
    await fs.outputFile(path.join(root, "web", "app.js"), "");
    await fs.outputFile(path.join(root, "daemon", "app.js"), "");
    await fs.symlink(path.join(root, "missing-common"), path.join(root, "web", "node_modules", "mcsmanager-common"), "junction");

    const backupPath = await backupCurrent(root, "10.16.7");

    assert.ok(await fs.pathExists(path.join(backupPath, "web", "app.js")));
    assert.strictEqual(await fs.pathExists(path.join(backupPath, "web", "node_modules", "mcsmanager-common")), false);
  } finally {
    await fs.remove(root);
  }
}

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

    const backupPath = await backupCurrent(root, "10.16.7");
    await replaceProgram(root, source, backupPath);

    assert.strictEqual(await fs.readFile(path.join(root, "web", "app.js"), "utf-8"), "new");
    assert.ok(await fs.pathExists(path.join(root, "web", "data", "config.json")));
    assert.strictEqual(await fs.pathExists(path.join(root, "web", "node_modules", "mcsmanager-common")), false);
  } finally {
    await fs.remove(root);
    await fs.remove(source);
  }
}

Promise.all([assertBackupSkipsBrokenLinks(), assertReplaceSkipsBrokenLinks()]).then(() => {
  console.log("update_service self-check passed");
});
