import { execFile } from "child_process";
import * as fs from "fs-extra";
import path from "path";

export type ReplacementPart = "web" | "daemon";

export type ReplacementHelperOptions = {
  rootDir: string;
  taskDir: string;
  sourceRoot: string;
  statusFile: string;
  task: any;
  parts: ReplacementPart[];
  serviceName: "mcsm-web" | "mcsm-daemon";
  unitName: string;
};

export async function launchReplacementHelper(options: ReplacementHelperOptions) {
  await fs.ensureDir(options.taskDir);
  const scriptPath = path.join(options.taskDir, "apply-update-helper.js");
  const configPath = path.join(options.taskDir, "apply-update-helper.json");
  await fs.outputFile(scriptPath, HELPER_SCRIPT, "utf-8");
  await fs.outputJson(configPath, options, { spaces: 2 });

  if (process.platform === "win32") return launchWindows(scriptPath, configPath, options.taskDir);
  return execFileText("systemd-run", [
    "--unit",
    options.unitName,
    "--collect",
    process.execPath,
    scriptPath,
    configPath
  ]);
}

async function launchWindows(scriptPath: string, configPath: string, taskDir: string) {
  const helperNode = path.join(taskDir, "node-helper.exe");
  await fs.copy(process.execPath, helperNode);
  const ps = [
    `$exe = ${psQuote(helperNode)}`,
    `$args = @(${psQuote(scriptPath)}, ${psQuote(configPath)})`,
    "Start-Process -FilePath $exe -ArgumentList $args -WindowStyle Hidden"
  ].join("; ");
  await execFileText("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps]);
}

function psQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function execFileText(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 * 2 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout);
    });
  });
}

const HELPER_SCRIPT = String.raw`
const childProcess = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf-8"));

function execShell(command) {
  return new Promise((resolve, reject) => {
    childProcess.exec(command, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout);
    });
  });
}

async function exists(filePath) {
  try {
    await fsp.lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyProgramDir(source, target) {
  const stat = await fsp.lstat(source);
  if (stat.isSymbolicLink()) return;
  if (!stat.isDirectory()) {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(source, target);
    return;
  }
  await fsp.mkdir(target, { recursive: true });
  for (const entry of await fsp.readdir(source)) {
    await copyProgramDir(path.join(source, entry), path.join(target, entry));
  }
}

async function removeDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
}

async function removeProgramFiles(part) {
  const partDir = path.join(cfg.rootDir, part);
  if (!(await exists(partDir))) return;
  for (const entry of await fsp.readdir(partDir)) {
    if (entry === "data") continue;
    if (part === "web" && entry === "public") {
      const publicDir = path.join(partDir, "public");
      for (const publicEntry of await fsp.readdir(publicDir).catch(() => [])) {
        if (publicEntry !== "upload_files") await removeDir(path.join(publicDir, publicEntry));
      }
      continue;
    }
    await removeDir(path.join(partDir, entry));
  }
}

async function replacePart(part) {
  await removeProgramFiles(part);
  await copyProgramDir(path.join(cfg.sourceRoot, part), path.join(cfg.rootDir, part));
}

async function readStatus() {
  try {
    return JSON.parse(await fsp.readFile(cfg.statusFile, "utf-8"));
  } catch {
    return cfg.task || {};
  }
}

async function writeStatus(status, progress, message, level, error) {
  const task = await readStatus();
  task.status = status;
  task.progress = progress;
  task.message = message;
  task.error = error || undefined;
  task.logs = Array.isArray(task.logs) ? task.logs : [];
  task.logs.push({ time: Date.now(), level: level || "info", message });
  task.logs = task.logs.slice(-100);
  if (status === "completed" || status === "failed") task.finishedAt = Date.now();
  await fsp.mkdir(path.dirname(cfg.statusFile), { recursive: true });
  await fsp.writeFile(cfg.statusFile, JSON.stringify(task, null, 2));
}

function serviceCommand(action) {
  if (process.platform === "win32") {
    return "powershell -NoProfile -ExecutionPolicy Bypass -Command \"" + action + "-Service " + cfg.serviceName + (action === "Stop" ? " -Force" : "") + "\"";
  }
  return "systemctl " + action.toLowerCase() + " " + cfg.serviceName;
}

(async () => {
  try {
    await writeStatus("restarting", 92, "正在停止服务");
    await execShell(serviceCommand("Stop"));
    await writeStatus("replacing", 94, "正在替换程序文件");
    for (const part of cfg.parts) await replacePart(part);
    await writeStatus("replaced", 98, "程序文件替换完成");
    await execShell(serviceCommand("Start"));
    await writeStatus("completed", 100, "更新完成");
  } catch (error) {
    await execShell(serviceCommand("Start")).catch(() => {});
    await writeStatus("failed", 100, error.message || String(error), "error", error.message || String(error));
    process.exit(1);
  }
})();
`;
