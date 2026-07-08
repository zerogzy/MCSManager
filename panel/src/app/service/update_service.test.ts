import assert from "assert";
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

console.log("update_service self-check passed");
