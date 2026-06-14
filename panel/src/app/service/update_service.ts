import axios from "axios";
import { ChildProcessWithoutNullStreams, execFile, spawn } from "child_process";
import * as fs from "fs-extra";
import { GlobalVariable } from "mcsmanager-common";
import path from "path";
import { v4 } from "uuid";
import { systemConfig } from "../setting";
import { logger } from "./log";

const DEFAULT_RELEASE_API = "https://api.github.com/repos/zerogzy/MCSManager/releases/latest";
const LINUX_FULL_ASSET = "mcsmanager_linux_release.tar.gz";
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
    this.ensureLinux();
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
    this.ensureLinux();
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

      await this.extractPackage(packagePath, extractDir);
      this.updateStatus("extracted", 65, "更新包解压完成");

      const sourceRoot = path.join(extractDir, "mcsmanager");
      await this.validatePackage(sourceRoot);
      const backupPath = await this.backupCurrent(rootDir);
      this.task.backupPath = backupPath;
      this.updateStatus("backed_up", 78, "当前版本备份完成");

      await this.replaceProgram(rootDir, sourceRoot, backupPath);
      this.updateStatus("replaced", 90, "程序文件替换完成");

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
    if (data.prerelease && !systemConfig?.updateAllowPrerelease) {
      throw new Error("最新版本是预发布版本，当前设置不允许自动更新预发布版本");
    }
    const latestVersion = this.normalizeVersion(data.tag_name || data.name || "");
    if (!latestVersion) throw new Error("Release 信息中缺少版本号");

    const asset = data.assets?.find((item) => item.name === LINUX_FULL_ASSET);
    if (!asset?.browser_download_url) throw new Error(`未找到适用于 Linux 的完整更新包：${LINUX_FULL_ASSET}`);
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
      downloadUrl: asset.browser_download_url
    };
  }

  private async download(url: string, targetPath: string, expectedSize: number) {
    this.updateStatus("downloading", 5, "正在下载更新包");
    await fs.ensureDir(path.dirname(targetPath));
    const response = await axios.get(url, {
      responseType: "stream",
      timeout: 30000,
      headers: { "User-Agent": "MCSManager-Update" }
    });
    const total = Number(response.headers["content-length"] || expectedSize || 0);
    this.task.totalBytes = total;
    let downloaded = 0;
    const writer = fs.createWriteStream(targetPath);
    response.data.on("data", (chunk: Buffer) => {
      downloaded += chunk.length;
      this.task.downloadedBytes = downloaded;
      if (total > 0) this.task.progress = Math.min(45, Math.floor((downloaded / total) * 40) + 5);
    });
    response.data.pipe(writer);
    await new Promise<void>((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
      response.data.on("error", reject);
    });
    if (total > 0 && downloaded !== total) throw new Error("更新包下载不完整，请重试");
  }

  private async extractPackage(packagePath: string, extractDir: string) {
    this.updateStatus("extracting", 50, "正在解压更新包");
    await fs.remove(extractDir);
    await fs.ensureDir(extractDir);
    const entries = await this.execFileText("tar", ["-tzf", packagePath]);
    for (const entry of entries.split("\n").filter(Boolean)) {
      if (path.isAbsolute(entry) || entry.includes("..") || !entry.startsWith("mcsmanager/")) {
        throw new Error(`更新包包含非法路径：${entry}`);
      }
    }
    await this.execFileText("tar", ["-xzf", packagePath, "-C", extractDir]);
  }

  private async validatePackage(sourceRoot: string) {
    const web = path.join(sourceRoot, "web", "app.js");
    const daemon = path.join(sourceRoot, "daemon", "app.js");
    if (!(await fs.pathExists(web))) throw new Error("更新包缺少 web/app.js");
    if (!(await fs.pathExists(daemon))) throw new Error("更新包缺少 daemon/app.js");
  }

  private async backupCurrent(rootDir: string) {
    this.updateStatus("backing_up", 70, "正在备份当前版本");
    const backupPath = path.join(rootDir, UPDATE_DIR, "backups", `${Date.now()}-${this.task.currentVersion}`);
    await fs.ensureDir(backupPath);
    await fs.copy(path.join(rootDir, "web"), path.join(backupPath, "web"));
    await fs.copy(path.join(rootDir, "daemon"), path.join(backupPath, "daemon"));
    return backupPath;
  }

  private async replaceProgram(rootDir: string, sourceRoot: string, backupPath: string) {
    this.updateStatus("replacing", 80, "正在替换程序文件");
    try {
      await fs.remove(path.join(rootDir, "web"));
      await fs.copy(path.join(sourceRoot, "web"), path.join(rootDir, "web"));
      await this.restoreRuntimeData(backupPath, rootDir, "web");
      await fs.remove(path.join(rootDir, "daemon"));
      await fs.copy(path.join(sourceRoot, "daemon"), path.join(rootDir, "daemon"));
      await this.restoreRuntimeData(backupPath, rootDir, "daemon");
    } catch (error) {
      await fs.remove(path.join(rootDir, "web")).catch(() => {});
      await fs.remove(path.join(rootDir, "daemon")).catch(() => {});
      await fs.copy(path.join(backupPath, "web"), path.join(rootDir, "web")).catch(() => {});
      await fs.copy(path.join(backupPath, "daemon"), path.join(rootDir, "daemon")).catch(() => {});
      throw error;
    }
  }

  private async restoreRuntimeData(backupPath: string, rootDir: string, name: "web" | "daemon") {
    const dataDir = path.join(backupPath, name, "data");
    if (await fs.pathExists(dataDir)) {
      await fs.copy(dataDir, path.join(rootDir, name, "data"));
    }
  }

  private async restartServices() {
    const command = systemConfig?.updateServiceRestartCommand?.trim();
    if (!command) throw new Error("未配置服务重启命令");
    this.updateStatus("restarting", 95, "正在执行服务重启命令");
    await this.execShell(command);
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

  private execFileText(command: string, args: string[]) {
    return new Promise<string>((resolve, reject) => {
      execFile(command, args, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
        if (error) return reject(new Error(stderr || error.message));
        resolve(stdout);
      });
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
    this.task.status = "failed";
    this.task.error = error?.message || String(error);
    this.task.message = this.task.error;
    this.task.finishedAt = Date.now();
    this.log("error", this.task.error);
    this.running = false;
  }

  private log(level: UpdateLogLevel, message: string) {
    this.task.logs.push({ time: Date.now(), level, message });
    if (this.task.logs.length > 100) this.task.logs.shift();
  }

  private getReleaseApiUrl() {
    return systemConfig?.updateReleaseApiUrl || DEFAULT_RELEASE_API;
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

  private ensureLinux() {
    if (process.platform !== "linux") throw new Error("第一版自动更新仅支持 Linux 环境");
  }
}

export const panelUpdateService = new PanelUpdateService();
