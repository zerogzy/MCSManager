<script setup lang="ts">
import { javaImageList } from "@/services/apis/envImage";
import { usingDockerJavaImage } from "@/services/apis/javaManager";
import type { ImageInfo, InstanceDetail } from "@/types";
import { ReloadOutlined } from "@ant-design/icons-vue";
import { Modal, message } from "ant-design-vue";
import { h, ref } from "vue";

const props = defineProps<{
  instanceInfo?: InstanceDetail;
  daemonId?: string;
  instanceId?: string;
}>();

const open = ref(false);
const loading = ref(false);
const submitLoading = ref(false);
const selectedImage = ref("");
const imageList = ref<{ label: string; value: string }[]>([]);

const getImageTags = (image: ImageInfo) => {
  return (image.RepoTags || []).filter((tag) => tag && tag !== "<none>:<none>");
};

const refreshImageList = async (out: boolean = false) => {
  loading.value = true;
  try {
    const res = await javaImageList().execute({
      params: {
        daemonId: props.daemonId ?? ""
      }
    });
    imageList.value = [];
    for (const image of res.value || []) {
      for (const tag of getImageTags(image)) {
        imageList.value.push({ label: tag, value: tag });
      }
    }
    if (out) message.success("刷新成功");
  } catch (err: any) {
    message.error(err.message);
  } finally {
    loading.value = false;
  }
};

const openDialog = async () => {
  selectedImage.value = props.instanceInfo?.config?.docker?.image || "";
  await refreshImageList();
  open.value = true;
};

const close = () => {
  open.value = false;
};

const submit = async () => {
  const image = selectedImage.value.trim();
  if (!image) return message.error("请选择 Java Docker 镜像");
  if (image === props.instanceInfo?.config?.docker?.image) return close();

  Modal.confirm({
    title: "确认切换 Java Docker 镜像？",
    content: "将把当前实例的 Docker 镜像改为所选 Java 镜像。已运行的容器不会立即改变，请重启实例后生效。",
    async onOk() {
      submitLoading.value = true;
      try {
        await usingDockerJavaImage().execute({
          params: {
            daemonId: props.daemonId ?? "",
            instanceId: props.instanceId ?? ""
          },
          data: {
            image
          }
        });
        if (props.instanceInfo) props.instanceInfo.config.docker.image = image;
        message.success("切换成功");
        close();
      } catch (err: any) {
        message.error(err.message);
      } finally {
        submitLoading.value = false;
      }
    }
  });
};

defineExpose({
  openDialog
});
</script>

<template>
  <a-modal
    v-model:open="open"
    width="640px"
    centered
    title="Java Docker 镜像"
    :confirm-loading="submitLoading"
    @ok="submit"
    @cancel="close"
  >
    <a-typography-paragraph>
      <a-typography-text type="secondary">
        当前实例是 Docker 模式，切换 Java 会修改实例使用的 Docker 镜像。
        <br />
        这里只会列出当前节点本机已存在的 Java 运行环境镜像，保存后请重启实例生效。
      </a-typography-text>
    </a-typography-paragraph>

    <a-form layout="vertical">
      <a-form-item label="当前 Docker 镜像">
        <a-input :value="instanceInfo?.config?.docker?.image" disabled />
      </a-form-item>

      <a-form-item>
        <div class="java-image-select-title">
          <span>选择 Java Docker 镜像</span>
          <a-button
            size="small"
            type="link"
            :icon="h(ReloadOutlined)"
            :loading="loading"
            @click="refreshImageList(true)"
          >
            刷新
          </a-button>
        </div>
        <a-select
          v-model:value="selectedImage"
          show-search
          :loading="loading"
          placeholder="请选择本机 Java Docker 镜像"
          style="width: 100%"
        >
          <a-select-option v-for="item in imageList" :key="item.value" :value="item.value">
            {{ item.label }}
          </a-select-option>
        </a-select>
      </a-form-item>
    </a-form>

    <a-alert
      v-if="!loading && !imageList.length"
      type="warning"
      show-icon
      message="当前节点未发现本机 Java Docker 镜像"
      description="请先在镜像管理中拉取或构建 Java/JDK/JRE/OpenJDK/Temurin 等运行环境镜像。"
    />
  </a-modal>
</template>

<style scoped>
.java-image-select-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
</style>
