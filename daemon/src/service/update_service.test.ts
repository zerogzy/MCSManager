import assert from "assert";
import * as fs from "fs-extra";
import os from "os";
import path from "path";
import { replaceProgram, validatePackage } from "./update_files";
import { findBlockingUpdateInstances, getUpdateAssetName } from "./update_helpers";

assert.strictEqual(getUpdateAssetName("daemon", "linux"), "mcsmanager_linux_daemon_only_release.tar.gz");
assert.strictEqual(getUpdateAssetName("daemon", "win32"), "mcsmanager_windows_daemon_only_release.zip");

assert.deepStrictEqual(
  findBlockingUpdateInstances([
    { instanceUuid: "docker-1", status: 3, config: { processType: "docker", nickname: "docker" } },
    { instanceUuid: "pty-1", status: 3, config: { processType: "pty", nickname: "shell" } }
  ]),
  [{ instanceUuid: "pty-1", nickname: "shell", processType: "pty", status: 3 }]
);

async function assertDaemonOnlyPackageAndReplace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcsm-daemon-only-root-"));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "mcsm-daemon-only-source-"));
  try {
    await fs.outputFile(path.join(root, "daemon", "app.js"), "old");
    await fs.outputFile(path.join(root, "daemon", "data", "global.json"), "{}");
    await fs.outputFile(path.join(source, "daemon", "app.js"), "new");

    await validatePackage(source, ["daemon"]);
    await replaceProgram(root, source, ["daemon"]);

    assert.strictEqual(await fs.readFile(path.join(root, "daemon", "app.js"), "utf-8"), "new");
    assert.ok(await fs.pathExists(path.join(root, "daemon", "data", "global.json")));
    assert.strictEqual(await fs.pathExists(path.join(root, "web")), false);
  } finally {
    await fs.remove(root);
    await fs.remove(source);
  }
}

assertDaemonOnlyPackageAndReplace().then(() => {
  console.log("daemon update_service self-check passed");
});
