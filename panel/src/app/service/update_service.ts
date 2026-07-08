import axios from "axios";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs-extra";
import { GlobalVariable } from "mcsmanager-common";
import path from "path";
import { v4 } from "uuid";
import { systemConfig } from "../setting";
import { downloadUpdatePackage } from "./update_download";
import { logger } from "./log";
import RemoteRequest from "./remote_command";
import RemoteServiceSubsystem from "./remote_service";
import {
  findBlockingUpdateInstances,
  getUpdateAssetName,
  getUpdateRestartCommand,
  UpdateInstanceSnapshot
} from "./update_helpers";
import { buildWindowsApplyScript, getWindowsApplyCommand } from "./update_windows";
import { backupCurrent, extractPackage, replaceProgram, validatePackage } from "./update_files";

const DEFAULT_RELEASE_API = "https://api.github.com/repos/zerogzy/MCSManager/releases/latest";
const UPDATE_DIR = ".update";

type UpdateStatus =
  | "idle"
  | "checking"
  | "checked"
  | "downloading"
  | "downloaded"
  | "extracting"
  | "extracted"
  | "backing_up"
  | "backed_up"
  | "replacing"
  | "replaced"
  | "restarting"
  | "completed"
  | "failed";

type UpdateLogLevel = "info" | "warn" | "error";

type ReleaseAsset = {
  name: string;
  size?: number;
  browser_download_url?: string;
};

type ReleaseInfo = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  prerelease?: boolean;
  body?: string;
  assets?: ReleaseAsset[];
};

export type UpdateCheckResult = {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseName: string;
  releaseUrl: string;
  publishedAt: string;
  body: string;
  assetName: string;
  assetSize: number;
  downloadUrl: string;
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
  backupPath?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
};

class PanelUpdateService {
  private task: UpdateTaskSnapshot = this.createIdleTask();
  private running = false;

  getStatus() {
    return this.task;
  }

  async checkUpdate() {
    this.ensureSupportedPlatform();
    this.setTask(this.createBaseTask("checking", "正在检查最新版本"));
    try {
      const result = await this.fetchRelease();
      this.task = {
        ...this.task,
        status: "checked",
        latestVersion: result.latestVersion,
        assetName: result.assetName,
        releaseUrl: result.releaseUrl,
        progress: 0,
        message: result.hasUpdate ? `发现新版本 ${result.latestVersion}` : "当前已是最新版本"
      };
      this.log("info", this.task.message);
      return result;
    } catch (error: any) {
      this.fail(error);
      throw error;
    }
  }

  async startUpdate() {
    this.ensureSupportedPlatform();
    if (this.running) throw new Error("已有更新任务正在运行，请等待当前任务结束");
    this.running = true;
    this.task = this.createBaseTask("checking", "正在准备更新任务");
    this.runUpdate().catch((error) => {
      this.fail(error);
      logger.error("Panel update failed:", error);
    });
    return this.task;
  }

  private async runUpdate() {
    let packagePath = "";
    let extractDir = "";
    try {
      const release = await this.fetchRelease();
      await this.ensureSafeToRestartDaemon();
      this.task.latestVersion = release.latestVersion;
      this.task.assetName = release.assetName;
      this.task.releaseUrl = release.releaseUrl;
      this.log("info", `目标版本：${release.latestVersion}`);

      const rootDir = this.getRootDir();
      await this.ensureProgramRoot(rootDir);
      const taskDir = path.join(rootDir, UPDATE_DIR, "tasks", this.task.taskId);
      extractDir = path.join(taskDir, "extract");
      packagePath = path.join(taskDir, release.assetName);
      await fs.ensureDir(taskDir);

      await this.download(release.downloadUrl, packagePath, release.assetSize || 0);
      this.updateStatus("downloaded", 45, "更新包下载完成");

      this.updateStatus("extracting", 50, "正在解压更新包");
      await extractPackage(packagePath, extractDir);
      this.updateStatus("extracted", 65, "更新包解压完成");

      const sourceRoot = path.join(extractDir, "mcsmanager");
      await validatePackage(sourceRoot);
      this.updateStatus("backing_up", 70, "正在备份当前版本");
      const backupPath = await backupCurrent(rootDir, this.task.currentVersion);
      this.task.backupPath = backupPath;
      this.updateStatus("backed_up", 78, "当前版本备份完成");

      if (process.platform === "win32") {
        await this.writeWindowsApplyScript(rootDir, sourceRoot, backupPath);
        this.updateStatus("replaced", 90, "更新脚本已准备完成");
      } else {
        this.updateStatus("replacing", 80, "正在替换程序文件");
        await replaceProgram(rootDir, sourceRoot, backupPath);
        this.updateStatus("replaced", 90, "程序文件替换完成");
      }

      await this.restartServices();
      this.updateStatus("completed", 100, "更新完成，重启命令已执行");
    } catch (error: any) {
      this.fail(error);
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async fetchRelease(): Promise<UpdateCheckResult> {
    const releaseApiUrl = this.getReleaseApiUrl();
    this.validateUrl(releaseApiUrl, "Release API 地址");
    const { data } = await axios.get<ReleaseInfo>(releaseApiUrl, {
      timeout: 30000,
      headers: { "User-Agent": "MCSManager-Update" }
    });
    const latestVersion = this.normalizeVersion(data.tag_name || data.name || "");
    if (!latestVersion) throw new Error("Release 信息中缺少版本号");

    const assetName = getUpdateAssetName();
    const asset = data.assets?.find((item) => item.name === assetName);
    if (!asset?.browser_download_url) throw new Error(`未找到适用于当前系统的完整更新包：${assetName}`);
    this.validateUrl(asset.browser_download_url, "更新包下载地址");

    const currentVersion = this.normalizeVersion(String(GlobalVariable.get("version", "Unknown")));
    return {
      currentVersion,
      latestVersion,
      hasUpdate: currentVersion !== latestVersion,
      releaseName: data.name || data.tag_name || latestVersion,
      releaseUrl: data.html_url || releaseApiUrl,
      publishedAt: data.published_at || "",
      body: data.body || "",
      assetName: asset.name,
      assetSize: Number(asset.size || 0),
      downloadUrl: this.resolveDownloadUrl(asset.browser_download_url)
    };
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
      },
      logWarn: (message) => this.log("warn", message)
    });
  }

  private async writeWindowsApplyScript(rootDir: string, sourceRoot: string, backupPath: string) {
    const scriptPath = path.join(rootDir, UPDATE_DIR, "apply-update.ps1");
    await fs.outputFile(scriptPath, buildWindowsApplyScript(rootDir, sourceRoot, backupPath), "utf-8");
  }

  private async restartServices() {
    this.updateStatus("restarting", 95, "正在重启 MCSManager 服务");
    if (process.platform === "win32") {
      await this.execShell(getWindowsApplyCommand(this.getRootDir()));
      return;
    }
    await this.execShell(getUpdateRestartCommand());
  }

  private async ensureSafeToRestartDaemon() {
    const remoteService = Array.from(RemoteServiceSubsystem.services.values()).find((service) => {
      return service.available && ["localhost", "127.0.0.1", "::1"].includes(service.config.ip);
    });
    if (!remoteService) {
      this.log("warn", "未连接本机 Daemon，跳过运行实例预检查");
      return;
    }

    await new RemoteRequest(remoteService).request("info/setting", {
      enableSoftShutdown: true,
      softShutdownSkipDocker: true
    });
    const instances = await new RemoteRequest(remoteService).request<UpdateInstanceSnapshot[]>(
      "instance/overview"
    );
    const blockingInstances = findBlockingUpdateInstances(instances || []);
    if (blockingInstances.length === 0) return;
    const names = blockingInstances.map((item) => `${item.nickname}(${item.instanceUuid})`);
    throw new Error(`存在运行中的普通进程实例，请停止后再更新：${names.join(", ")}`);
  }

  private execShell(command: string) {
    return new Promise<void>((resolve, reject) => {
      const child: ChildProcessWithoutNullStreams = spawn(command, { shell: true });
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
      child.on("close", (code) => {
        if (code === 0) return resolve();
        reject(new Error(stderr || `重启命令执行失败，退出码：${code}`));
      });
      child.on("error", reject);
    });
  }

  private createIdleTask(): UpdateTaskSnapshot {
    return this.createBaseTask("idle", "暂无更新任务");
  }

  private createBaseTask(status: UpdateStatus, message: string): UpdateTaskSnapshot {
    return {
      taskId: v4(),
      status,
      currentVersion: this.normalizeVersion(String(GlobalVariable.get("version", "Unknown"))),
      progress: 0,
      message,
      logs: [],
      startedAt: Date.now()
    };
  }

  private setTask(task: UpdateTaskSnapshot) {
    this.task = task;
    this.log("info", task.message);
  }

  private updateStatus(status: UpdateStatus, progress: number, message: string) {
    this.task.status = status;
    this.task.progress = progress;
    this.task.message = message;
    this.log("info", message);
  }

  private fail(error: any) {
    const message = error?.message || String(error);
    this.task.status = "failed";
    this.task.error = message;
    this.task.message = message;
    this.task.finishedAt = Date.now();
    this.log("error", message);
    this.running = false;
  }

  private log(level: UpdateLogLevel, message: string) {
    this.task.logs.push({ time: Date.now(), level, message });
    if (this.task.logs.length > 100) this.task.logs.shift();
  }

  private getReleaseApiUrl() {
    return this.resolveProxyUrl(DEFAULT_RELEASE_API);
  }

  private resolveDownloadUrl(downloadUrl: string) {
    return this.resolveProxyUrl(downloadUrl);
  }

  private resolveProxyUrl(downloadUrl: string) {
    const proxyUrl = systemConfig?.updateDownloadProxyUrl?.trim();
    if (!proxyUrl) return downloadUrl;
    const url = new URL(downloadUrl);
    const urlNoProtocol = `${url.protocol.replace(":", "")}/${url.host}${url.pathname}${url.search}`;
    if (proxyUrl.includes("{urlEncoded}")) {
      return proxyUrl.split("{urlEncoded}").join(encodeURIComponent(downloadUrl));
    }
    if (proxyUrl.includes("{urlNoProtocol}")) {
      return proxyUrl.split("{urlNoProtocol}").join(urlNoProtocol);
    }
    if (proxyUrl.includes("{url}")) {
      return proxyUrl.split("{url}").join(downloadUrl);
    }
    const normalizedProxy = proxyUrl.endsWith("/") ? proxyUrl : `${proxyUrl}/`;
    return `${normalizedProxy}${downloadUrl}`;
  }

  private getRootDir() {
    return path.resolve(process.cwd(), "..");
  }

  private async ensureProgramRoot(rootDir: string) {
    if (!(await fs.pathExists(path.join(rootDir, "web")))) {
      throw new Error("当前运行目录缺少 web 目录，无法确认 MCSManager 安装根目录");
    }
    if (!(await fs.pathExists(path.join(rootDir, "daemon")))) {
      throw new Error("当前运行目录缺少 daemon 目录，无法确认 MCSManager 安装根目录");
    }
  }

  private normalizeVersion(version: string) {
    return version.trim().replace(/^v/i, "");
  }

  private validateUrl(url: string, name: string) {
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      throw new Error(`${name} 必须使用 http(s) 协议`);
    }
  }

  private ensureSupportedPlatform() {
    getUpdateAssetName();
    getUpdateRestartCommand();
  }
}

export const panelUpdateService = new PanelUpdateService();
