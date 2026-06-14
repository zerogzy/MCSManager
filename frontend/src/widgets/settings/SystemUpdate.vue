<script setup lang="ts">
import { checkPanelUpdate, getPanelUpdateStatus, startPanelUpdate } from "@/services/apis";
import { reportErrorMsg } from "@/tools/validator";
import type { Settings } from "@/types";
import { Modal, message, notification } from "ant-design-vue";
import { computed, onMounted, onUnmounted, ref } from "vue";

const props = defineProps<{
  formData: Settings;
  submitLoading: boolean;
  submitSettings: (needReload?: boolean) => Promise<void>;
}>();

const { execute: checkExecute, isLoading: checkLoading } = checkPanelUpdate();
const { execute: startExecute, isLoading: startLoading } = startPanelUpdate();
const { execute: statusExecute } = getPanelUpdateStatus();

const updateInfo = ref<any>();
const updateStatus = ref<any>();
let timer: ReturnType<typeof setInterval> | undefined;

const STATUS_LABELS: Record<string, string> = {
  idle: "暂无更新任务",
  checking: "正在检查更新...",
  checked: "检查完成",
  downloading: "正在下载更新包...",
  downloaded: "下载完成",
  extracting: "正在解压更新包...",
  extracted: "解压完成",
  backing_up: "正在备份当前版本...",
  backed_up: "备份完成",
  replacing: "正在替换程序文件...",
  replaced: "替换完成",
  restarting: "正在重启服务...",
  completed: "更新完成",
  failed: "更新失败"
};

const statusLabel = computed(() => {
  return STATUS_LABELS[updateStatus.value?.status] || "未知状态";
});

const isRunning = computed(() => {
  const s = updateStatus.value?.status;
  return s && s !== "idle" && s !== "completed" && s !== "failed" && s !== "checked";
});

const statusType = computed(() => {
  const s = updateStatus.value?.status;
  if (s === "completed") return "success";
  if (s === "failed") return "exception";
  if (isRunning.value) return "active";
  return "normal";
});

const refreshStatus = async () => {
  try {
    const res = await statusExecute();
    updateStatus.value = res.value;
    const status = updateStatus.value?.status;
    if (status === "completed" || status === "failed" || status === "idle") stopPolling();
  } catch (error) {
    stopPolling();
  }
};

const startPolling = () => {
  stopPolling();
  timer = setInterval(refreshStatus, 1500);
};

const stopPolling = () => {
  if (timer) clearInterval(timer);
  timer = undefined;
};

const saveUpdateSettings = async () => {
  await props.submitSettings(false);
};

const checkUpdate = async () => {
  try {
    const res = await checkExecute();
    updateInfo.value = res.value;
    updateStatus.value = await statusExecute().then((statusRes) => statusRes.value);
    if (updateInfo.value?.hasUpdate) {
      message.success(`发现新版本 ${updateInfo.value.latestVersion}`);
    } else {
      message.success("当前已是最新版本");
    }
  } catch (error: any) {
    reportErrorMsg(error);
  }
};

const startUpdate = async () => {
  Modal.confirm({
    title: "确认开始自动更新？",
    content:
      "系统将下载完整 Release 包，备份并替换 web/daemon 程序文件，然后执行配置的 systemd 重启命令。请确认当前环境由 systemd 管理。",
    okType: "danger",
    async onOk() {
      try {
        const res = await startExecute();
        updateStatus.value = res.value;
        notification.info({ message: "更新任务已开始", description: "页面将自动刷新更新进度。" });
        startPolling();
      } catch (error: any) {
        reportErrorMsg(error);
      }
    }
  });
};

const formatTime = (ts: number) => {
  return new Date(ts).toLocaleTimeString();
};

onMounted(refreshStatus);
onUnmounted(stopPolling);
</script>

<template>
  <a-form :model="formData" layout="vertical">
    <!-- 更新源配置 -->
    <a-form-item>
      <a-typography-title :level="5">Release API 地址</a-typography-title>
      <a-typography-paragraph type="secondary">
        用于检查最新版本，默认使用 GitHub Releases latest API。可填写兼容的镜像站地址以解决网络问题。
      </a-typography-paragraph>
      <a-input v-model:value="formData.updateReleaseApiUrl" style="max-width: 640px" />
    </a-form-item>

    <a-form-item>
      <a-typography-title :level="5">服务重启命令</a-typography-title>
      <a-typography-paragraph type="secondary">
        更新替换完成后执行的命令。默认适用于 systemd 部署方式。
      </a-typography-paragraph>
      <a-input v-model:value="formData.updateServiceRestartCommand" style="max-width: 640px" />
    </a-form-item>

    <a-form-item>
      <a-typography-title :level="5">允许预发布版本</a-typography-title>
      <a-typography-paragraph type="secondary">
        关闭时，若最新 Release 为 prerelease 则不会被用于自动更新。
      </a-typography-paragraph>
      <a-switch v-model:checked="formData.updateAllowPrerelease" />
    </a-form-item>

    <div class="button mb-24">
      <a-button type="primary" :loading="submitLoading" @click="saveUpdateSettings">
        保存更新设置
      </a-button>
    </div>

    <a-divider />

    <!-- 更新操作 -->
    <a-typography-title :level="5" class="mb-16">版本检查与更新</a-typography-title>

    <a-space class="mb-20">
      <a-button :loading="checkLoading" @click="checkUpdate">检查更新</a-button>
      <a-button
        type="primary"
        danger
        :loading="startLoading"
        :disabled="isRunning"
        @click="startUpdate"
      >
        立即更新
      </a-button>
    </a-space>

    <!-- 检查结果 -->
    <div v-if="updateInfo" class="mb-20">
      <a-descriptions bordered size="small" :column="{ xs: 1, sm: 2 }">
        <a-descriptions-item label="当前版本">
          {{ updateInfo.currentVersion }}
        </a-descriptions-item>
        <a-descriptions-item label="最新版本">
          <span :style="{ color: updateInfo.hasUpdate ? '#52c41a' : undefined, fontWeight: updateInfo.hasUpdate ? 600 : 400 }">
            {{ updateInfo.latestVersion }}
          </span>
          <a-tag v-if="updateInfo.hasUpdate" color="green" style="margin-left: 8px">有新版本</a-tag>
          <a-tag v-else color="default" style="margin-left: 8px">已是最新</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="更新包">
          {{ updateInfo.assetName }}
        </a-descriptions-item>
        <a-descriptions-item label="Release 页面">
          <a :href="updateInfo.releaseUrl" target="_blank" rel="noopener">查看详情</a>
        </a-descriptions-item>
      </a-descriptions>
    </div>

    <!-- 更新任务状态 -->
    <div v-if="updateStatus && updateStatus.status !== 'idle'">
      <a-card size="small" class="update-status-card">
        <template #title>
          <span>更新进度</span>
          <a-tag
            :color="updateStatus.status === 'completed' ? 'green' : updateStatus.status === 'failed' ? 'red' : 'blue'"
            style="margin-left: 8px"
          >
            {{ statusLabel }}
          </a-tag>
        </template>

        <a-progress
          :percent="updateStatus.progress || 0"
          :status="statusType"
          :stroke-color="updateStatus.status === 'failed' ? '#ff4d4f' : undefined"
        />

        <p v-if="updateStatus.message && updateStatus.status !== 'failed'" class="status-message">
          {{ updateStatus.message }}
        </p>

        <a-alert
          v-if="updateStatus.error"
          type="error"
          :message="updateStatus.error"
          show-icon
          class="mt-12"
        />

        <p v-if="updateStatus.backupPath" class="backup-path">
          备份目录：<code>{{ updateStatus.backupPath }}</code>
        </p>

        <!-- 日志区域 -->
        <div v-if="updateStatus.logs?.length" class="update-logs mt-12">
          <a-typography-text type="secondary" style="font-size: 12px">操作日志</a-typography-text>
          <div class="log-list">
            <div
              v-for="(item, index) in updateStatus.logs"
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
    </div>
  </a-form>
</template>

<style scoped>
.mb-20 {
  margin-bottom: 20px;
}

.mt-12 {
  margin-top: 12px;
}

.status-message {
  margin: 8px 0 0;
  color: rgba(0, 0, 0, 0.65);
  font-size: 13px;
}

.backup-path {
  margin: 8px 0 0;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
}

.backup-path code {
  background: rgba(0, 0, 0, 0.04);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}

.update-status-card {
  margin-top: 4px;
}

.update-logs {
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  padding-top: 8px;
}

.log-list {
  max-height: 200px;
  overflow-y: auto;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.8;
}

.log-item {
  display: flex;
  gap: 8px;
}

.log-time {
  color: rgba(0, 0, 0, 0.35);
  flex-shrink: 0;
}

.log-msg {
  color: rgba(0, 0, 0, 0.65);
  word-break: break-all;
}

.log-error .log-msg {
  color: #ff4d4f;
}

.log-warn .log-msg {
  color: #faad14;
}
</style>
