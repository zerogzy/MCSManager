import * as fs from "fs-extra";
import { GlobalVariable, launchReplacementHelper } from "mcsmanager-common";
import path from "path";
import { v4 } from "uuid";
import { logger } from "./log";
import RemoteRequest, { RemoteRequestTimeoutError } from "./remote_command";
import RemoteServiceSubsystem from "./remote_service";
import { downloadUpdatePackage } from "./update_download";
import { extractPackage, validatePackage } from "./update_files";
import type { UpdateTargetType } from "./update_helpers";
import { fetchUpdateRelease } from "./update_release";
import type {
  UpdateCheckResult,
  UpdateLogLevel,
  UpdateStatus,
  UpdateTargetInfo,
  UpdateTargetRequest,
  UpdateTaskSnapshot
} from "./update_types";

const UPDATE_DIR = ".update";

type DaemonOverview = {
  version?: string;
  system?: { platform?: NodeJS.Platform };
};

class PanelUpdateService {
  private tasks = new Map<string, UpdateTaskSnapshot>();
  private running = new Set<string>();

  async getTargets(): Promise<UpdateTargetInfo[]> {
    const targets: UpdateTargetInfo[] = [
      {
        key: "web",
        targetType: "web",
        name: "Web 面板",
        currentVersion: this.currentVersion(),
        platform: process.platform,
        available: true,
        address: "local"
      }
    ];

    const daemonTargets = Array.from(RemoteServiceSubsystem.services.values()).map(async (service) => {
      let version = "Unknown";
      let platform: string | undefined;
      if (service.available) {
        try {
          const overview = await this.getDaemonOverview(service.uuid);
          version = this.normalizeVersion(String(overview.version || version));
          platform = overview.system?.platform;
        } catch {
          // keep Unknown
        }
      }
      targets.push({
        key: this.targetKey({ targetType: "daemon", daemonId: service.uuid }),
        targetType: "daemon",
        daemonId: service.uuid,
        name: service.config.remarks || service.uuid,
        currentVersion: version,
        platform,
        available: service.available,
        address: `${service.config.ip}:${service.config.port}`
      });
    });
    await Promise.all(daemonTargets);
    return targets;
  }

  async getStatus(request: UpdateTargetRequest = {}) {
    const target = this.normalizeTarget(request);
    if (target.targetType === "daemon") return this.getDaemonStatus(target.daemonId || "");
    return this.getWebStatus();
  }

  async checkUpdate(request: UpdateTargetRequest = {}) {
    const target = this.normalizeTarget(request);
    if (target.targetType === "daemon") return this.checkDaemonUpdate(target.daemonId || "");
    return this.checkWebUpdate();
  }

  async startUpdate(request: UpdateTargetRequest = {}) {
    const target = this.normalizeTarget(request);
    if (target.targetType === "daemon") return this.startDaemonUpdate(target.daemonId || "");
    return this.startWebUpdate();
  }

  private async checkWebUpdate() {
    const key = "web";
    this.setTask(key, this.createBaseTask("web", "checking", "正在检查 Web 面板最新版本"));
    try {
      const result = await fetchUpdateRelease("web", this.currentVersion(), process.platform);
      this.markChecked(key, result);
      return result;
    } catch (error: any) {
      this.fail(key, error);
      throw error;
    }
  }

  private async checkDaemonUpdate(daemonId: string) {
    const key = this.targetKey({ targetType: "daemon", daemonId });
    this.setTask(key, this.createBaseTask("daemon", "checking", "正在检查 Daemon 最新版本", daemonId));
    const overview = await this.getDaemonOverview(daemonId);
    const platform = overview.system?.platform;
    const currentVersion = this.normalizeVersion(String(overview.version || "Unknown"));
    const result = await fetchUpdateRelease("daemon", currentVersion, platform);
    result.daemonId = daemonId;
    this.markChecked(key, result);
    return result;
  }

  private async startWebUpdate() {
    const key = "web";
    if (this.running.has(key)) throw new Error("Web 面板已有更新任务正在运行");
    const release = await fetchUpdateRelease("web", this.currentVersion(), process.platform);
    if (!release.hasUpdate) throw new Error("当前已经是最新版本");
    this.running.add(key);
    const task = this.createBaseTask("web", "checking", "正在准备 Web 面板更新任务");
    this.setTask(key, task);
    await this.writeWebStatusFile(task);
    this.runWebUpdate(release).catch((error) => {
      this.fail(key, error);
      logger.error("Web update failed:", error);
    });
    return task;
  }

  private async startDaemonUpdate(daemonId: string) {
    const key = this.targetKey({ targetType: "daemon", daemonId });
    if (this.running.has(key)) throw new Error("该 Daemon 已有更新任务正在运行");
    this.running.add(key);
    this.setTask(key, this.createBaseTask("daemon", "checking", "正在准备 Daemon 更新任务", daemonId));
    try {
      const overview = await this.getDaemonOverview(daemonId);
      const release = await fetchUpdateRelease(
        "daemon",
        this.normalizeVersion(String(overview.version || "Unknown")),
        overview.system?.platform
      );
      if (!release.hasUpdate) throw new Error("当前已经是最新版本");
      const service = this.requireDaemon(daemonId);
      const task = await new RemoteRequest(service).request<UpdateTaskSnapshot>(
        "update/start",
        release,
        8000
      );
      this.setTask(key, { ...task, targetType: "daemon", daemonId });
      return this.tasks.get(key);
    } catch (error: any) {
      const message =
        error instanceof RemoteRequestTimeoutError
          ? "该 daemon 版本不支持自动更新，请先手动升级一次"
          : error?.message || "Daemon 更新启动失败";
      this.fail(key, new Error(message));
      throw new Error(message);
    } finally {
      this.running.delete(key);
    }
  }

  private async runWebUpdate(release: UpdateCheckResult) {
    const key = "web";
    try {
      const task = this.requireTask(key);
      task.latestVersion = release.latestVersion;
      task.assetName = release.assetName;
      task.releaseUrl = release.releaseUrl;
      const rootDir = this.getRootDir();
      await this.ensureProgramRoot(rootDir, "web");
      const taskDir = path.join(rootDir, UPDATE_DIR, "tasks", task.taskId);
      const extractDir = path.join(taskDir, "extract");
      const packagePath = path.join(taskDir, release.assetName);
      await fs.ensureDir(taskDir);

      await this.download(key, release.downloadUrl, packagePath, release.assetSize || 0);
      this.updateStatus(key, "downloaded", 45, "更新包下载完成");
      this.updateStatus(key, "extracting", 50, "正在解压更新包");
      await extractPackage(packagePath, extractDir);
      this.updateStatus(key, "extracted", 65, "更新包解压完成");

      const sourceRoot = path.join(extractDir, "mcsmanager");
      await validatePackage(sourceRoot, ["web"]);
      this.updateStatus(key, "replacing", 82, "正在启动 Web 面板替换任务");
      await launchReplacementHelper({
        rootDir,
        taskDir,
        sourceRoot,
        parts: ["web"],
        serviceName: "mcsm-web",
        unitName: `mcsm-web-update-${task.taskId}`,
        statusFile: this.getWebStatusFile(),
        task
      });
      this.updateStatus(key, "restarting", 90, "Web 面板替换任务已启动");
    } catch (error: any) {
      this.fail(key, error);
      throw error;
    } finally {
      this.running.delete(key);
    }
  }

  private async getDaemonStatus(daemonId: string) {
    const key = this.targetKey({ targetType: "daemon", daemonId });
    try {
      const service = this.requireDaemon(daemonId);
      const task = await new RemoteRequest(service).request<UpdateTaskSnapshot>("update/status", {}, 3000);
      this.setTask(key, { ...task, targetType: "daemon", daemonId });
      return this.tasks.get(key);
    } catch {
      return this.tasks.get(key) || this.createIdleTask("daemon", daemonId, "Daemon 更新状态不可用");
    }
  }

  private async download(key: string, url: string, targetPath: string, expectedSize: number) {
    this.updateStatus(key, "downloading", 5, "正在下载更新包");
    this.log(key, "info", `下载地址：${url}`);
    await downloadUpdatePackage(url, targetPath, expectedSize, {
      setTotal: (total) => {
        this.requireTask(key).totalBytes = total;
      },
      setProgress: (downloaded, total) => {
        const task = this.requireTask(key);
        task.downloadedBytes = downloaded;
        if (total > 0) task.progress = Math.min(45, Math.floor((downloaded / total) * 40) + 5);
        this.writeWebStatusFile(task).catch(() => {});
      },
      logWarn: (message) => this.log(key, "warn", message)
    });
  }

  private async getDaemonOverview(daemonId: string) {
    return new RemoteRequest(this.requireDaemon(daemonId)).request<DaemonOverview>("info/overview", {}, 6000);
  }

  private requireDaemon(daemonId: string) {
    const service = RemoteServiceSubsystem.getInstance(daemonId);
    if (!service) throw new Error("Daemon 不存在");
    if (!service.available) throw new Error("Daemon 当前不可用");
    return service;
  }

  private markChecked(key: string, result: UpdateCheckResult) {
    const task = this.requireTask(key);
    task.status = "checked";
    task.latestVersion = result.latestVersion;
    task.assetName = result.assetName;
    task.releaseUrl = result.releaseUrl;
    task.progress = 0;
    task.message = result.hasUpdate ? `发现新版本 ${result.latestVersion}` : "当前已经是最新版本";
    this.log(key, "info", task.message);
  }

  private createIdleTask(targetType: UpdateTargetType, daemonId?: string, message = "暂无更新任务") {
    return this.createBaseTask(targetType, "idle", message, daemonId);
  }

  private createBaseTask(
    targetType: UpdateTargetType,
    status: UpdateStatus,
    message: string,
    daemonId?: string
  ): UpdateTaskSnapshot {
    return {
      taskId: v4(),
      targetType,
      daemonId,
      status,
      currentVersion: this.currentVersion(),
      progress: 0,
      message,
      logs: [],
      startedAt: Date.now()
    };
  }

  private setTask(key: string, task: UpdateTaskSnapshot) {
    this.tasks.set(key, task);
    this.log(key, "info", task.message);
  }

  private updateStatus(key: string, status: UpdateStatus, progress: number, message: string) {
    const task = this.requireTask(key);
    task.status = status;
    task.progress = progress;
    task.message = message;
    this.log(key, "info", message);
    if (key === "web") this.writeWebStatusFile(task).catch(() => {});
  }

  private fail(key: string, error: any) {
    const task = this.tasks.get(key) || this.createIdleTask("web");
    const message = error?.message || String(error);
    task.status = "failed";
    task.error = message;
    task.message = message;
    task.finishedAt = Date.now();
    this.tasks.set(key, task);
    this.log(key, "error", message);
    if (key === "web") this.writeWebStatusFile(task).catch(() => {});
    this.running.delete(key);
  }

  private log(key: string, level: UpdateLogLevel, message: string) {
    const task = this.tasks.get(key);
    if (!task) return;
    task.logs.push({ time: Date.now(), level, message });
    if (task.logs.length > 100) task.logs.shift();
  }

  private requireTask(key: string) {
    const task = this.tasks.get(key);
    if (!task) throw new Error("更新任务不存在");
    return task;
  }

  private normalizeTarget(request: UpdateTargetRequest): Required<UpdateTargetRequest> {
    return {
      targetType: request.targetType === "daemon" ? "daemon" : "web",
      daemonId: request.daemonId || ""
    };
  }

  private targetKey(request: UpdateTargetRequest) {
    return request.targetType === "daemon" ? `daemon:${request.daemonId || ""}` : "web";
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

  private getWebStatusFile() {
    return path.join(this.getRootDir(), UPDATE_DIR, "status-web.json");
  }

  private async writeWebStatusFile(task: UpdateTaskSnapshot) {
    await fs.outputJson(this.getWebStatusFile(), task, { spaces: 2 });
  }

  private readWebStatusFile() {
    try {
      return fs.readJsonSync(this.getWebStatusFile()) as UpdateTaskSnapshot;
    } catch {
      return null;
    }
  }

  private getWebStatus() {
    const memoryTask = this.tasks.get("web");
    const fileTask = this.readWebStatusFile();
    if (memoryTask && (!fileTask || Number(memoryTask.startedAt || 0) >= Number(fileTask.startedAt || 0))) {
      return memoryTask;
    }
    return fileTask || memoryTask || this.createIdleTask("web");
  }

  private async ensureProgramRoot(rootDir: string, part: "web" | "daemon") {
    if (!(await fs.pathExists(path.join(rootDir, part)))) throw new Error(`当前运行目录缺少 ${part} 目录`);
  }

}

export const panelUpdateService = new PanelUpdateService();
