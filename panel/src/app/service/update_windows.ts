import path from "path";

export function buildWindowsApplyScript(rootDir: string, sourceRoot: string, backupPath: string) {
  return `
$ErrorActionPreference = "Stop"
$root = ${JSON.stringify(rootDir)}
$source = ${JSON.stringify(sourceRoot)}
$backup = ${JSON.stringify(backupPath)}

function Replace-AppDir($name) {
  $target = Join-Path $root $name
  $sourceDir = Join-Path $source $name
  $backupDir = Join-Path $backup $name
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  Copy-Item -LiteralPath $sourceDir -Destination $target -Recurse -Force
  $dataDir = Join-Path $backupDir "data"
  if (Test-Path -LiteralPath $dataDir) {
    Copy-Item -LiteralPath $dataDir -Destination (Join-Path $target "data") -Recurse -Force
  }
}

Start-Sleep -Seconds 2
try {
  Stop-Service mcsm-web,mcsm-daemon -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  Replace-AppDir "web"
  Replace-AppDir "daemon"
  Start-Service mcsm-daemon,mcsm-web
} catch {
  try {
    if (Test-Path -LiteralPath (Join-Path $root "web")) { Remove-Item -LiteralPath (Join-Path $root "web") -Recurse -Force }
    if (Test-Path -LiteralPath (Join-Path $root "daemon")) { Remove-Item -LiteralPath (Join-Path $root "daemon") -Recurse -Force }
    Copy-Item -LiteralPath (Join-Path $backup "web") -Destination (Join-Path $root "web") -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $backup "daemon") -Destination (Join-Path $root "daemon") -Recurse -Force
    Start-Service mcsm-daemon,mcsm-web
  } catch {}
  throw
}
`.trimStart();
}

export function getWindowsApplyCommand(rootDir: string) {
  const scriptPath = path.join(rootDir, ".update", "apply-update.ps1").replace(/'/g, "''");
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath}' -WindowStyle Hidden"`;
}
