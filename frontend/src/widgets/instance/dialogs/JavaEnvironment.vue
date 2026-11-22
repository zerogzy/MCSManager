<script setup lang="ts">
import { useScreen } from "@/hooks/useScreen";
import { t } from "@/lang/i18n";
import {
  getJavaContainerOptions,
  switchJavaContainer,
  type JavaContainerOptions
} from "@/services/apis/javaContainer";
import { reportErrorMsg } from "@/tools/validator";
import type { InstanceDetail } from "@/types";
import { INSTANCE_STATUS, INSTANCE_STATUS_CODE } from "@/types/const";
import {
  CheckCircleOutlined,
  CoffeeOutlined,
  ExclamationCircleOutlined
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { computed, ref } from "vue";

const props = defineProps<{
  instanceInfo?: InstanceDetail;
  instanceId?: string;
  daemonId?: string;
}>();

const emit = defineEmits(["update"]);

const { isPhone } = useScreen();

const open = ref(false);
const loading = ref(false);
const submitting = ref(false);
const data = ref<JavaContainerOptions>();
const selectedName = ref<string>();

const status = computed(() => props.instanceInfo?.status ?? INSTANCE_STATUS_CODE.BUSY);
const statusText = computed(
  () => INSTANCE_STATUS[status.value as INSTANCE_STATUS_CODE] ?? t("TXT_CODE_c8333afa")
);
const isRunning = computed(() => status.value === INSTANCE_STATUS_CODE.RUNNING);
const isStopped = computed(() => status.value === INSTANCE_STATUS_CODE.STOPPED);
// The running notice covers RUNNING and STARTING only
const showRunningTip = computed(
  () =>
    status.value === INSTANCE_STATUS_CODE.RUNNING || status.value === INSTANCE_STATUS_CODE.STARTING
);

const current = computed(() => data.value?.current ?? null);
const options = computed(() => data.value?.options ?? []);
// A configured image that is recognized but no longer present locally marks no tile as current
const currentName = computed(() =>
  options.value.some((o) => o.name === current.value?.name) ? current.value?.name : undefined
);

const canSwitch = computed(
  () => !!selectedName.value && selectedName.value !== currentName.value && !submitting.value
);

const requestParams = () => ({
  uuid: props.instanceId ?? "",
  daemonId: props.daemonId ?? ""
});

const loadOptions = async () => {
  loading.value = true;
  try {
    const res = await getJavaContainerOptions().execute({ params: requestParams() });
    data.value = res.value;
    selectedName.value = currentName.value;
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    loading.value = false;
  }
};

const openDialog = async () => {
  data.value = undefined;
  selectedName.value = undefined;
  open.value = true;
  await loadOptions();
};

const selectTile = (name: string) => {
  if (submitting.value) return;
  selectedName.value = name;
};

const submit = async () => {
  if (!canSwitch.value || !selectedName.value) return;
  submitting.value = true;
  try {
    await switchJavaContainer().execute({
      params: requestParams(),
      data: { key: selectedName.value }
    });
    open.value = false;
    emit("update");
    message.success(t("TXT_CODE_d3de39b4"));
  } catch (err: any) {
    reportErrorMsg(err.message);
    await loadOptions();
  } finally {
    submitting.value = false;
  }
};

defineExpose({ openDialog });
</script>

<template>
  <a-modal
    v-model:open="open"
    centered
    :width="isPhone ? '100%' : '720px'"
    :title="t('TXT_CODE_3fee13ed')"
    :confirm-loading="submitting"
    :ok-text="t('TXT_CODE_JAVA_CONTAINER_SWITCH')"
    :ok-button-props="{ disabled: !canSwitch }"
    @ok="submit"
  >
    <div class="java-env-header">
      <a-badge
        :count="current ? current.version : 0"
        :number-style="{ backgroundColor: 'var(--color-blue-6)' }"
        :show-zero="false"
      />
      <a-typography-text class="ml-6">
        {{ t("TXT_CODE_JAVA_CONTAINER_CURRENT") }}:
      </a-typography-text>
      <a-typography-text strong class="java-env-current ml-6">
        {{ current ? current.name : t("TXT_CODE_JAVA_CONTAINER_CUSTOM_IMAGE") }}
      </a-typography-text>
      <a-tag v-if="isRunning" color="green" class="java-env-status ml-10">
        <CheckCircleOutlined />
        {{ statusText }}
      </a-tag>
      <a-tag v-else-if="isStopped" class="java-env-status ml-10">
        <ExclamationCircleOutlined />
        {{ statusText }}
      </a-tag>
      <a-tag v-else color="pink" class="java-env-status ml-10">
        {{ statusText }}
      </a-tag>
    </div>

    <a-alert
      v-if="showRunningTip"
      class="java-env-running-tip mt-12"
      type="warning"
      show-icon
      :message="t('TXT_CODE_JAVA_CONTAINER_RUNNING_TIP')"
    />

    <div class="mt-16">
      <a-skeleton v-if="loading && !data" active />
      <a-row v-else :gutter="[12, 12]">
        <a-col v-for="item in options" :key="item.name" :xs="12" :sm="8" :md="6">
          <div
            class="java-env-tile"
            :class="{ selected: item.name === selectedName, 'is-current': item.name === currentName }"
            :data-name="item.name"
            role="button"
            tabindex="0"
            @click="selectTile(item.name)"
            @keydown.enter="selectTile(item.name)"
          >
            <!-- Corner badge: kept out of the flow so every tile has the same height -->
            <a-tag v-if="item.name === currentName" color="blue" class="java-env-current-tag">
              {{ t("TXT_CODE_JAVA_CONTAINER_CURRENT_TAG") }}
            </a-tag>
            <CoffeeOutlined class="java-env-tile-icon" />
            <div class="java-env-tile-name">{{ item.name }}</div>
            <div class="java-env-tile-version">
              {{ t("TXT_CODE_JAVA_CONTAINER_VERSION", { version: item.version }) }}
            </div>
          </div>
        </a-col>
      </a-row>
    </div>
  </a-modal>
</template>

<style lang="scss" scoped>
.java-env-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.java-env-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 120px;
  padding: 12px 8px;
  text-align: center;
  cursor: pointer;
  border: 1px solid var(--color-gray-4);
  border-radius: 8px;
  transition: all 0.2s;

  &:hover {
    border-color: var(--color-blue-5);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  &.is-current {
    background-color: rgba(22, 119, 255, 0.04);
  }
}

.java-env-current-tag {
  position: absolute;
  top: 8px;
  right: 8px;
  margin: 0;
  font-size: 12px;
  line-height: 18px;
}

.java-env-tile-icon {
  font-size: 22px;
  color: var(--color-blue-6);
  margin-bottom: 2px;
}

.java-env-tile-name {
  font-weight: 600;
  line-height: 20px;
  word-break: break-all;
}

.java-env-tile-version {
  font-size: 12px;
  color: var(--color-gray-7);
}
</style>
