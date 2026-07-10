<script setup lang="ts">
import {
  checkPanelUpdate,
  getPanelUpdateStatus,
  getUpdateTargets,
  startPanelUpdate
} from "@/services/apis";
import { reportErrorMsg } from "@/tools/validator";
import type { Settings } from "@/types";
import { Modal, message, notification } from "ant-design-vue";
import { computed, onMounted, onUnmounted, ref } from "vue";

const props = defineProps<{
  formData: Settings;
  submitLoading: boolean;
  submitSettings: (needReload?: boolean) => Promise<void>;
}>();

type UpdateTarget = {
  key: string;
  targetType: "web" | "daemon";
  daemonId?: string;
  name: string;
  currentVersion: string;
  platform?: string;
  available: boolean;
  address?: string;
};

const { execute: targetsExecute, isLoading: targetsLoading } = getUpdateTargets();
const { execute: checkExecute } = checkPanelUpdate();
const { execute: startExecute } = startPanelUpdate();
const { execute: statusExecute } = getPanelUpdateStatus();

const targets = ref<UpdateTarget[]>([]);
const updateInfoMap = ref<Record<string, any>>({});
const updateStatusMap = ref<Record<string, any>>({});
const checkLoadingMap = ref<Record<string, boolean>>({});
const startLoadingMap = ref<Record<string, boolean>>({});
let timer: ReturnType<typeof setInterval> | undefined;
const completedStatusTimers = new Map<string, ReturnType<typeof setTimeout>>();
const COMPLETED_STATUS_VISIBLE_MS = 5000;

const GITHUB_PROXY_OPTIONS = [
  { value: "https://v4.gh-proxy.org" },
  { value: "https://ghproxy.vip" }
];

const columns = [
  { title: "更新目标", key: "target", width: 150 },
  { title: "当前版本", key: "currentVersion", width: 96 },
  { title: "最新版本", key: "latestVersion", width: 170 },
  { title: "操作", key: "action", width: 280 }
];

const STATUS_LABELS: Record<string, string> = {
  idle: "暂无更新任务",
  checking: "正在检查...",
  checked: "检查完成",
  downloading: "正在下载更新包...",
  downloaded: "下载完成",
  extracting: "正在解压更新包...",
  extracted: "解压完成",
  replacing: "正在替换程序文件...",
  replaced: "替换完成",
  restarting: "正在重启服务...",
  completed: "更新完成",
  failed: "更新失败"
};

const activeStatuses = computed(() => {
  return targets.value
    .map((target) => ({ target, status: updateStatusMap.value[target.key] }))
    .filter((item) => showUpdateProgress(item.status));
});

const targetPayload = (target: any) => ({
  targetType: target.targetType,
  daemonId: target.daemonId
});

const setCheckLoading = (key: string, value: boolean) => {
  checkLoadingMap.value = { ...checkLoadingMap.value, [key]: value };
};

const setStartLoading = (key: string, value: boolean) => {
  startLoadingMap.value = { ...startLoadingMap.value, [key]: value };
};

const setInfo = (key: string, value: any) => {
  updateInfoMap.value = { ...updateInfoMap.value, [key]: value };
};

const hideStatus = (key: string) => {
  updateStatusMap.value = Object.fromEntries(
    Object.entries(updateStatusMap.value).filter(([itemKey]) => itemKey !== key)
  );
};

const scheduleCompletedStatusHide = (key: string, status: any) => {
  const oldTimer = completedStatusTimers.get(key);
  if (oldTimer) clearTimeout(oldTimer);
  if (status?.status !== "completed") return completedStatusTimers.delete(key);
  const age = status.finishedAt ? Date.now() - Number(status.finishedAt) : 0;
  const delay = Math.max(0, COMPLETED_STATUS_VISIBLE_MS - age);
  completedStatusTimers.set(
    key,
    setTimeout(() => {
      hideStatus(key);
      completedStatusTimers.delete(key);
    }, delay)
  );
};

const setStatus = (key: string, value: any) => {
  updateStatusMap.value = { ...updateStatusMap.value, [key]: value };
  scheduleCompletedStatusHide(key, value);
};

const getInfo = (target: any) => updateInfoMap.value[target.key];
const getStatus = (target: any) => updateStatusMap.value[target.key];

const isRunning = (status: any) => {
  const s = status?.status;
  return s && s !== "idle" && s !== "completed" && s !== "failed" && s !== "checked";
};

const showUpdateProgress = (status: any) => {
  const s = status?.status;
  return s && s !== "idle" && s !== "checked";
};

const statusType = (status: any) => {
  if (status?.status === "completed") return "success";
  if (status?.status === "failed") return "exception";
  if (isRunning(status)) return "active";
  return "normal";
};

const canStart = (target: any) => {
  const info = getInfo(target);
  return target.available && !isRunning(getStatus(target)) && info?.hasUpdate !== false;
};

const loadTargets = async () => {
  const res = await targetsExecute();
  targets.value = res.value || [];
};

const refreshStatus = async (target: any) => {
  const res = await statusExecute({ params: targetPayload(target) });
  setStatus(target.key, res.value);
};

const refreshRunningStatuses = async () => {
  const runningTargets = targets.value.filter((target) => isRunning(getStatus(target)));
  await Promise.all(runningTargets.map((target) => refreshStatus(target).catch(() => {})));
  if (!targets.value.some((target) => isRunning(getStatus(target)))) stopPolling();
};

const startPolling = () => {
  if (timer) return;
  timer = setInterval(refreshRunningStatuses, 1500);
};

const stopPolling = () => {
  if (timer) clearInterval(timer);
  timer = undefined;
};

const saveUpdateSettings = async () => {
  await props.submitSettings(false);
};

const checkUpdate = async (target: any) => {
  setCheckLoading(target.key, true);
  try {
    const res = await checkExecute({ data: targetPayload(target) });
    setInfo(target.key, res.value);
    await refreshStatus(target);
    if (res.value?.hasUpdate) message.success(`${target.name} 发现新版本 ${res.value.latestVersion}`);
    else message.success(`${target.name} 当前已经是最新版本`);
  } catch (error: any) {
    reportErrorMsg(error);
  } finally {
    setCheckLoading(target.key, false);
  }
};

const startUpdate = async (target: any) => {
  if (!canStart(target)) return;
  Modal.confirm({
    title: `确认更新 ${target.name}？`,
    content:
      target.targetType === "web"
        ? "将下载 Web 更新包并替换 Web 程序文件，然后自动重启 Web 服务。"
        : "将通过 Web 面板通知该 Daemon 下载更新包并替换 Daemon 程序文件，然后自动重启 Daemon 服务。Docker 实例会在重启后重新接管。",
    okType: "danger",
    async onOk() {
      setStartLoading(target.key, true);
      try {
        const res = await startExecute({ data: targetPayload(target) });
        setStatus(target.key, res.value);
        notification.info({ message: "更新任务已开始", description: target.name });
        startPolling();
      } catch (error: any) {
        reportErrorMsg(error);
      } finally {
        setStartLoading(target.key, false);
      }
    }
  });
};

const formatTime = (ts: number) => new Date(ts).toLocaleTimeString();

onMounted(async () => {
  await loadTargets();
  await Promise.all(targets.value.map((target) => refreshStatus(target).catch(() => {})));
  if (targets.value.some((target) => isRunning(getStatus(target)))) startPolling();
});
onUnmounted(stopPolling);
onUnmounted(() => {
  completedStatusTimers.forEach((item) => clearTimeout(item));
  completedStatusTimers.clear();
});
</script>

<template>
  <a-form :model="formData" layout="vertical">
    <a-form-item>
      <a-typography-title :level="5">GitHub 加速镜像地址</a-typography-title>
      <a-typography-paragraph type="secondary">
        可选。使用加速镜像加速访问 GitHub，内置 2 个可选加速镜像：
        <code>https://v4.gh-proxy.org</code> 和 <code>https://ghproxy.vip</code>。
      </a-typography-paragraph>
      <a-auto-complete
        v-model:value="formData.updateDownloadProxyUrl"
        :options="GITHUB_PROXY_OPTIONS"
        placeholder="留空则直接访问 GitHub"
        style="max-width: 640px"
      />
    </a-form-item>

    <div class="button mb-24">
      <a-button type="primary" :loading="submitLoading" @click="saveUpdateSettings">
        保存更新设置
      </a-button>
    </div>

    <a-divider />
    <a-typography-title :level="5" class="mb-16">版本检查与更新</a-typography-title>

    <a-table
      :columns="columns"
      :data-source="targets"
      :loading="targetsLoading"
      :pagination="false"
      row-key="key"
      size="small"
      class="mb-20"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'target'">
          <div class="target-name">{{ record.name }}</div>
          <div class="target-meta">
            {{ record.targetType === "web" ? "Web 面板" : record.address || "Daemon" }}
            <a-tag v-if="!record.available" color="red" class="ml-8">离线</a-tag>
          </div>
        </template>
        <template v-else-if="column.key === 'currentVersion'">
          <span class="version-text">{{ getInfo(record)?.currentVersion || record.currentVersion || "-" }}</span>
        </template>
        <template v-else-if="column.key === 'latestVersion'">
          <div v-if="getInfo(record)" class="latest-version-cell">
            <span class="version-text">{{ getInfo(record).latestVersion }}</span>
            <a-tag v-if="getInfo(record).hasUpdate" color="green" class="version-tag">有新版本</a-tag>
            <a-tag v-else class="version-tag">已是最新</a-tag>
          </div>
          <span v-else>-</span>
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space :size="8" wrap>
            <a-button
              :loading="checkLoadingMap[record.key]"
              :disabled="!record.available || isRunning(getStatus(record))"
              @click="checkUpdate(record)"
            >
              检查更新
            </a-button>
            <a-button
              type="primary"
              danger
              :loading="startLoadingMap[record.key]"
              :disabled="!canStart(record)"
              @click="startUpdate(record)"
            >
              立即更新
            </a-button>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-card
      v-for="{ target, status } in activeStatuses"
      :key="target.key"
      size="small"
      class="update-status-card mb-20"
    >
      <template #title>
        <span>{{ target.name }} 更新进度</span>
        <a-tag
          :color="status.status === 'completed' ? 'green' : status.status === 'failed' ? 'red' : 'blue'"
          class="ml-8"
        >
          {{ STATUS_LABELS[status.status] || "未知状态" }}
        </a-tag>
      </template>

      <a-progress
        :percent="status.progress || 0"
        :status="statusType(status)"
        :stroke-color="status.status === 'failed' ? '#ff4d4f' : undefined"
      />

      <p v-if="status.message && status.status !== 'failed'" class="status-message">
        {{ status.message }}
      </p>

      <a-alert v-if="status.error" type="error" :message="status.error" show-icon class="mt-12" />

      <div v-if="status.logs?.length" class="update-logs mt-12">
        <a-typography-text type="secondary" style="font-size: 12px">操作日志</a-typography-text>
        <div class="log-list">
          <div
            v-for="(item, index) in status.logs"
            :key="index"
            class="log-item"
            :class="'log-' + item.level"
          >
            <span class="log-time">{{ formatTime(item.time) }}</span>
            <span class="log-msg">{{ item.message }}</span>
          </div>
        </div>
      </div>
    </a-card>
  </a-form>
</template>

<style scoped>
.mb-16 { margin-bottom: 16px; }
.mb-20 { margin-bottom: 20px; }
.mb-24 { margin-bottom: 24px; }
.mt-12 { margin-top: 12px; }
.ml-8 { margin-left: 8px; }
.target-name { font-weight: 600; }

.target-meta,
.status-message {
  color: #8c8c8c;
}

.version-text { white-space: nowrap; }

.latest-version-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.latest-version-cell .version-text { min-width: 64px; }

.version-tag { margin-left: 0; }

.update-status-card { max-width: 1120px; }

.log-list {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #f0f0f0;
}

.log-item {
  display: flex;
  gap: 12px;
  font-size: 12px;
  line-height: 1.8;
}

.log-time {
  color: #999;
  min-width: 64px;
}

.log-error .log-msg { color: #ff4d4f; }
.log-warn .log-msg { color: #faad14; }
</style>
