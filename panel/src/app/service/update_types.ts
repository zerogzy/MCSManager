import type { UpdateTargetType } from "./update_helpers";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "checked"
  | "downloading"
  | "downloaded"
  | "extracting"
  | "extracted"
  | "replacing"
  | "replaced"
  | "restarting"
  | "completed"
  | "failed";

export type UpdateLogLevel = "info" | "warn" | "error";
export type UpdateTargetRequest = { targetType?: UpdateTargetType; daemonId?: string };

export type UpdateTargetInfo = {
  key: string;
  targetType: UpdateTargetType;
  daemonId?: string;
  name: string;
  currentVersion: string;
  platform?: string;
  available: boolean;
  address?: string;
};

export type UpdateCheckResult = {
  targetType: UpdateTargetType;
  daemonId?: string;
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
  targetType: UpdateTargetType;
  daemonId?: string;
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
