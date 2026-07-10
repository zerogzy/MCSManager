import * as fs from "fs-extra";
import { GlobalVariable, launchReplacementHelper } from "mcsmanager-common";
import path from "path";
import { v4 } from "uuid";
import { globalConfiguration } from "../entity/config";
import logger from "./log";
import InstanceSubsystem from "./system_instance";
import { downloadUpdatePackage } from "./update_download";
import { extractPackage, validatePackage } from "./update_files";
import { findBlockingUpdateInstances, getUpdateAssetName } from "./update_helpers";

type UpdateStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "downloaded"
  | "extracting"
  | "extracted"
  | "replacing"
  | "replaced"
  | "restarting"
  | "completed"
  | "failed";

type UpdateLogLevel = "info" | "warn" | "error";

export type DaemonUpdateStartOptions = {
  latestVersion: string;
  assetName: string;
  assetSize: number;
  downloadUrl: string;
  releaseUrl?: string;
};

export type UpdateTaskSnapshot = {
  taskId: string;
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  assetName?: string;
  releaseUrl?: string;
  progress: number;
  downloadedBytes?: number;
  totalBytes?: number;
  message: string;
  logs: Array<{ time: number; level: UpdateLogLevel; message: string }>;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
};

const UPDATE_DIR = ".update";

class DaemonUpdateService {
  private task: UpdateTaskSnapshot = this.createIdleTask();
  private running = false;

  getStatus() {
    return this.readStatusFile() || this.task;
  }

  async startUpdate(options: DaemonUpdateStartOptions) {
    this.ensureSupportedPlatform();
    if (this.running) throw new Error("已有更新任务正在运行，请等待当前任务结束");
    if (this.normalizeVersion(options.latestVersion) === this.currentVersion()) {
      throw new Error("当前已经是最新版本");
    }
    if (options.assetName !== getUpdateAssetName("daemon")) {
      throw new Error(`更新包不适用于当前 daemon：${options.assetName}`);
    }
    this.running = true;
    this.task = this.createBaseTask("checking", "正在准备 daemon 更新任务");
    this.task.latestVersion = this.normalizeVersion(options.latestVersion);
    this.task.assetName = options.assetName;
    this.task.releaseUrl = options.releaseUrl;
    await this.writeStatusFile(this.task);
    this.runUpdate(options).catch((error) => {
      this.fail(error);
      logger.error("Daemon update failed:", error);
    });
    return this.task;
  }

  private async runUpdate(options: DaemonUpdateStartOptions) {
    try {
      await this.ensureSafeToRestart();
      const rootDir = this.getRootDir();
      await this.ensureProgramRoot(rootDir);
      const taskDir = path.join(rootDir, UPDATE_DIR, "tasks", this.task.taskId);
      const extractDir = path.join(taskDir, "extract");
      const packagePath = path.join(taskDir, options.assetName);
      await fs.ensureDir(taskDir);

      await this.download(options.downloadUrl, packagePath, options.assetSize || 0);
      this.updateStatus("downloaded", 45, "更新包下载完成");

      this.updateStatus("extracting", 50, "正在解压更新包");
      await extractPackage(packagePath, extractDir);
      this.updateStatus("extracted", 65, "更新包解压完成");

      const sourceRoot = path.join(extractDir, "mcsmanager");
      await validatePackage(sourceRoot, ["daemon"]);
      this.updateStatus("replacing", 82, "正在启动 daemon 替换任务");
      await this.launchHelper(rootDir, taskDir, sourceRoot);
      this.updateStatus("restarting", 90, "daemon 替换任务已启动");
    } catch (error: any) {
      this.fail(error);
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async launchHelper(
    rootDir: string,
    taskDir: string,
    sourceRoot: string
  ) {
    await launchReplacementHelper({
      rootDir,
      taskDir,
      sourceRoot,
      parts: ["daemon"],
      serviceName: "mcsm-daemon",
      unitName: `mcsm-daemon-update-${this.task.taskId}`,
      statusFile: this.getStatusFile(),
      task: this.task
    });
  }

  private async ensureSafeToRestart() {
    globalConfiguration.config.enableSoftShutdown = true;
    globalConfiguration.config.softShutdownSkipDocker = true;
    globalConfiguration.store();

    const instances = InstanceSubsystem.getInstances().map((instance) => ({
      instanceUuid: instance.instanceUuid,
      status: instance.status(),
      config: instance.config
    }));
    const blockingInstances = findBlockingUpdateInstances(instances);
    if (blockingInstances.length === 0) return;
    const names = blockingInstances.map((item) => `${item.nickname}(${item.instanceUuid})`);
    throw new Error(`存在运行中的普通进程实例，请停止后再更新：${names.join(", ")}`);
  }

  private async download(url: string, targetPath: string, expectedSize: number) {
    this.updateStatus("downloading", 5, "正在下载更新包");
    this.log("info", `下载地址：${url}`);
    await downloadUpdatePackage(url, targetPath, expectedSize, {
      setTotal: (total) => {
        this.task.totalBytes = total;
      },
      setProgress: (downloaded, total) => {
        this.task.downloadedBytes = downloaded;
        if (total > 0) this.task.progress = Math.min(45, Math.floor((downloaded / total) * 40) + 5);
        this.writeStatusFile(this.task).catch(() => {});
      },
      logWarn: (message) => this.log("warn", message)
    });
  }

  private updateStatus(status: UpdateStatus, progress: number, message: string) {
    this.task.status = status;
    this.task.progress = progress;
    this.task.message = message;
    this.log("info", message);
    this.writeStatusFile(this.task).catch(() => {});
  }

  private fail(error: any) {
    const message = error?.message || String(error);
    this.task.status = "failed";
    this.task.error = message;
    this.task.message = message;
    this.task.finishedAt = Date.now();
    this.log("error", message);
    this.running = false;
    this.writeStatusFile(this.task).catch(() => {});
  }

  private log(level: UpdateLogLevel, message: string) {
    this.task.logs.push({ time: Date.now(), level, message });
    if (this.task.logs.length > 100) this.task.logs.shift();
  }

  private createIdleTask(): UpdateTaskSnapshot {
    return this.createBaseTask("idle", "暂无更新任务");
  }

  private createBaseTask(status: UpdateStatus, message: string): UpdateTaskSnapshot {
    return {
      taskId: v4(),
      status,
      currentVersion: this.currentVersion(),
      progress: 0,
      message,
      logs: [],
      startedAt: Date.now()
    };
  }

  private currentVersion() {
    return this.normalizeVersion(String(GlobalVariable.get("version", "Unknown")));
  }

  private normalizeVersion(version: string) {
    return version.trim().replace(/^v/i, "");
  }

  private getRootDir() {
    return path.resolve(process.cwd(), "..");
  }

  private getStatusFile() {
    return path.join(this.getRootDir(), UPDATE_DIR, "status-daemon.json");
  }

  private async writeStatusFile(task: UpdateTaskSnapshot) {
    await fs.outputJson(this.getStatusFile(), task, { spaces: 2 });
  }

  private readStatusFile() {
    try {
      return fs.readJsonSync(this.getStatusFile()) as UpdateTaskSnapshot;
    } catch {
      return null;
    }
  }

  private async ensureProgramRoot(rootDir: string) {
    if (!(await fs.pathExists(path.join(rootDir, "daemon")))) {
      throw new Error("当前运行目录缺少 daemon 目录，无法确认 MCSManager 安装根目录");
    }
  }

  private ensureSupportedPlatform() {
    getUpdateAssetName("daemon");
  }
}

export const daemonUpdateService = new DaemonUpdateService();
