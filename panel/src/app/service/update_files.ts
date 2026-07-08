import { execFile } from "child_process";
import * as fs from "fs-extra";
import path from "path";

export async function extractPackage(packagePath: string, extractDir: string) {
  await fs.remove(extractDir);
  await fs.ensureDir(extractDir);
  if (process.platform === "win32") return extractZip(packagePath, extractDir);
  return extractTarGz(packagePath, extractDir);
}

export async function validatePackage(sourceRoot: string) {
  const web = path.join(sourceRoot, "web", "app.js");
  const daemon = path.join(sourceRoot, "daemon", "app.js");
  if (!(await fs.pathExists(web))) throw new Error("更新包缺少 web/app.js");
  if (!(await fs.pathExists(daemon))) throw new Error("更新包缺少 daemon/app.js");
}

export async function backupCurrent(rootDir: string, currentVersion: string) {
  const backupPath = path.join(rootDir, ".update", "backups", `${Date.now()}-${currentVersion}`);
  await fs.ensureDir(backupPath);
  await copyProgramDir(path.join(rootDir, "web"), path.join(backupPath, "web"));
  await copyProgramDir(path.join(rootDir, "daemon"), path.join(backupPath, "daemon"));
  return backupPath;
}

export async function replaceProgram(rootDir: string, sourceRoot: string, backupPath: string) {
  try {
    await fs.remove(path.join(rootDir, "web"));
    await copyProgramDir(path.join(sourceRoot, "web"), path.join(rootDir, "web"));
    await restoreRuntimeData(backupPath, rootDir, "web");
    await fs.remove(path.join(rootDir, "daemon"));
    await copyProgramDir(path.join(sourceRoot, "daemon"), path.join(rootDir, "daemon"));
    await restoreRuntimeData(backupPath, rootDir, "daemon");
  } catch (error) {
    await fs.remove(path.join(rootDir, "web")).catch(() => {});
    await fs.remove(path.join(rootDir, "daemon")).catch(() => {});
    await fs.copy(path.join(backupPath, "web"), path.join(rootDir, "web")).catch(() => {});
    await fs.copy(path.join(backupPath, "daemon"), path.join(rootDir, "daemon")).catch(() => {});
    throw error;
  }
}

async function restoreRuntimeData(backupPath: string, rootDir: string, name: "web" | "daemon") {
  const dataDir = path.join(backupPath, name, "data");
  if (await fs.pathExists(dataDir)) await fs.copy(dataDir, path.join(rootDir, name, "data"));
}

async function copyProgramDir(source: string, target: string) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) return;
  if (!stat.isDirectory()) return fs.copyFile(source, target);

  await fs.ensureDir(target);
  const entries = await fs.readdir(source);
  for (const entry of entries) {
    await copyProgramDir(path.join(source, entry), path.join(target, entry));
  }
}

async function extractTarGz(packagePath: string, extractDir: string) {
  const entries = await execFileText("tar", ["-tzf", packagePath]);
  for (const entry of entries.split("\n").filter(Boolean)) {
    if (path.isAbsolute(entry) || entry.includes("..") || !entry.startsWith("mcsmanager/")) {
      throw new Error(`更新包包含非法路径：${entry}`);
    }
  }
  await execFileText("tar", ["-xzf", packagePath, "-C", extractDir]);
}

async function extractZip(packagePath: string, extractDir: string) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$zip = ${JSON.stringify(packagePath)}`,
    `$dest = ${JSON.stringify(extractDir)}`,
    "Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force"
  ].join("; ");
  await execFileText("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
  await validateExtractedPaths(extractDir);
}

async function validateExtractedPaths(extractDir: string) {
  const root = path.resolve(extractDir);
  const entries = await fs.readdir(root, { recursive: true });
  for (const entry of entries) {
    const fullPath = path.resolve(root, String(entry));
    if (!fullPath.startsWith(root + path.sep)) throw new Error(`更新包包含非法路径：${entry}`);
  }
}

function execFileText(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout);
    });
  });
}
