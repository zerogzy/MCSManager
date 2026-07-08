const UPDATE_ASSET_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  linux: "mcsmanager_linux_release.tar.gz",
  win32: "mcsmanager_windows_release.zip"
};

const UPDATE_RESTART_COMMANDS: Partial<Record<NodeJS.Platform, string>> = {
  linux: "systemctl restart mcsm-web mcsm-daemon",
  win32:
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "Restart-Service mcsm-web,mcsm-daemon"'
};

const INSTANCE_STATUS_STOP = 0;

export type UpdateInstanceSnapshot = {
  instanceUuid: string;
  status: number;
  config?: {
    nickname?: string;
    processType?: string;
  };
};

export function getUpdateAssetName(platform: NodeJS.Platform = process.platform) {
  const assetName = UPDATE_ASSET_NAMES[platform];
  if (!assetName) throw new Error("自动更新仅支持 Linux 和 Windows 环境");
  return assetName;
}

export function getUpdateRestartCommand(platform: NodeJS.Platform = process.platform) {
  const command = UPDATE_RESTART_COMMANDS[platform];
  if (!command) throw new Error("自动更新仅支持 Linux 和 Windows 环境");
  return command;
}

export function findBlockingUpdateInstances(instances: UpdateInstanceSnapshot[]) {
  return instances
    .filter((instance) => {
      return instance.status !== INSTANCE_STATUS_STOP && instance.config?.processType !== "docker";
    })
    .map((instance) => ({
      instanceUuid: instance.instanceUuid,
      nickname: instance.config?.nickname || instance.instanceUuid,
      processType: instance.config?.processType || "general",
      status: instance.status
    }));
}
