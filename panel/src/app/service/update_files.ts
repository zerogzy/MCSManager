import { execFile } from "child_process";
import * as fs from "fs-extra";
import path from "path";

export type ProgramPart = "web" | "daemon";
const ALL_PARTS: ProgramPart[] = ["web", "daemon"];

export async function extractPackage(packagePath: string, extractDir: string) {
  await fs.remove(extractDir);
  await fs.ensureDir(extractDir);
  if (process.platform === "win32") return extractZip(packagePath, extractDir);
  return extractTarGz(packagePath, extractDir);
}

export async function validatePackage(sourceRoot: string, parts: ProgramPart[] = ALL_PARTS) {
  if (parts.includes("web") && !(await fs.pathExists(path.join(sourceRoot, "web", "app.js")))) {
    throw new Error("更新包缺少 web/app.js");
  }
  if (
    parts.includes("daemon") &&
    !(await fs.pathExists(path.join(sourceRoot, "daemon", "app.js")))
  ) {
    throw new Error("更新包缺少 daemon/app.js");
  }
}

export async function replaceProgram(
  rootDir: string,
  sourceRoot: string,
  parts: ProgramPart[] = ALL_PARTS
) {
  for (const part of parts) {
    await removeProgramFiles(rootDir, part);
    await copyProgramDir(path.join(sourceRoot, part), path.join(rootDir, part));
  }
}

async function removeProgramFiles(rootDir: string, part: ProgramPart) {
  const partDir = path.join(rootDir, part);
  if (!(await fs.pathExists(partDir))) return;
  for (const entry of await fs.readdir(partDir)) {
    if (entry === "data") continue;
    if (part === "web" && entry === "public") {
      const publicDir = path.join(partDir, "public");
      for (const publicEntry of await fs.readdir(publicDir).catch(() => [])) {
        if (publicEntry !== "upload_files") await fs.remove(path.join(publicDir, publicEntry));
      }
      continue;
    }
    await fs.remove(path.join(partDir, entry));
  }
}

async function copyProgramDir(source: string, target: string) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) return;
  if (!stat.isDirectory()) {
    await fs.ensureDir(path.dirname(target));
    return fs.copyFile(source, target);
  }

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
