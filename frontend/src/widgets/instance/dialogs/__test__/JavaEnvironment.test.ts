// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import JavaEnvironment from "../JavaEnvironment.vue";

const mocks = vi.hoisted(() => ({
  getOptions: vi.fn(),
  switchEnv: vi.fn(),
  success: vi.fn(),
  reportErrorMsg: vi.fn()
}));

vi.mock("@/lang/i18n", () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key
}));
vi.mock("@/hooks/useScreen", async () => {
  const { ref } = await import("vue");
  return { useScreen: () => ({ isPhone: ref(false) }) };
});
vi.mock("@/tools/validator", () => ({ reportErrorMsg: mocks.reportErrorMsg }));
vi.mock("@/types/const", () => ({
  INSTANCE_STATUS_CODE: { BUSY: -1, STOPPED: 0, STOPPING: 1, STARTING: 2, RUNNING: 3 },
  INSTANCE_STATUS: { "-1": "BUSY", 0: "STOPPED", 1: "STOPPING", 2: "STARTING", 3: "RUNNING" }
}));
vi.mock("@/services/apis/javaContainer", () => ({
  getJavaContainerOptions: () => ({ execute: mocks.getOptions }),
  switchJavaContainer: () => ({ execute: mocks.switchEnv })
}));

vi.mock("ant-design-vue", () => ({ message: { success: mocks.success, error: vi.fn() } }));

// Lightweight stand-ins for the ant-design-vue components the dialog uses
const passthrough = (name: string, tag = "div") =>
  defineComponent({
    name,
    setup(_, { slots }) {
      return () => h(tag, { class: `stub-${name}` }, slots.default?.());
    }
  });

const ModalStub = defineComponent({
  props: {
    open: Boolean,
    title: { type: String, default: "" },
    okText: { type: String, default: "" },
    confirmLoading: Boolean,
    okButtonProps: { type: Object, default: () => ({}) }
  },
  emits: ["ok", "update:open"],
  setup(props, { slots, emit }) {
    return () =>
      props.open
        ? h("div", { class: "stub-modal" }, [
            h("div", { class: "modal-title" }, props.title),
            slots.default?.(),
            h(
              "button",
              {
                class: "modal-ok",
                disabled: !!props.okButtonProps?.disabled,
                "data-loading": String(props.confirmLoading),
                onClick: () => emit("ok")
              },
              props.okText
            ),
            h("button", { class: "modal-cancel", onClick: () => emit("update:open", false) })
          ])
        : null;
  }
});

const AlertStub = defineComponent({
  props: { message: { type: String, default: "" }, type: { type: String, default: "" } },
  setup(props) {
    return () => h("div", { class: "stub-alert", "data-type": props.type }, props.message);
  }
});

const stubs = {
  AModal: ModalStub,
  AAlert: AlertStub,
  ABadge: passthrough("badge", "span"),
  ATag: passthrough("tag", "span"),
  ACard: passthrough("card"),
  ARow: passthrough("row"),
  ACol: passthrough("col"),
  ASkeleton: passthrough("skeleton"),
  ATypographyText: passthrough("text", "span")
};

const OPTIONS = {
  current: { name: "temurin-jdk21", version: 21 },
  options: [
    { name: "temurin-jdk21", version: 21 },
    { name: "zulu-jdk17", version: 17 }
  ]
};

function mountDialog(status = 0) {
  return mount(JavaEnvironment, {
    props: {
      instanceInfo: { status, config: { type: "minecraft/java", processType: "docker" } } as any,
      instanceId: "inst-1",
      daemonId: "daemon-1"
    },
    global: { stubs }
  });
}

async function openWith(data: any, status = 0) {
  mocks.getOptions.mockResolvedValue({ value: structuredClone(data) });
  const wrapper = mountDialog(status);
  await (wrapper.vm as any).openDialog();
  await flushPromises();
  return wrapper;
}

const okButton = (w: any) => w.find(".modal-ok");
const tile = (w: any, name: string) => w.find(`[data-name="${name}"]`);

describe("JavaEnvironment dialog: Java Environment Dialog", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
  });

  it("uses the Java Manager label and the Switch button text", async () => {
    const w = await openWith(OPTIONS);
    expect(w.find(".modal-title").text()).toBe("TXT_CODE_3fee13ed");
    expect(okButton(w).text()).toBe("TXT_CODE_JAVA_CONTAINER_SWITCH");
  });

  it("loads options for the same instance and node and shows the current environment", async () => {
    const w = await openWith(OPTIONS);
    expect(mocks.getOptions).toHaveBeenCalledWith({
      params: { uuid: "inst-1", daemonId: "daemon-1" }
    });
    expect(w.text()).toContain("TXT_CODE_JAVA_CONTAINER_CURRENT");
    expect(w.find(".java-env-current").text()).toBe("temurin-jdk21");
    expect(w.find(".java-env-status").text()).toContain("STOPPED");
    expect(w.text()).toContain('TXT_CODE_JAVA_CONTAINER_VERSION:{"version":17}');
  });

  it("marks the current tile and pre-selects it", async () => {
    const w = await openWith(OPTIONS);
    expect(tile(w, "temurin-jdk21").find(".java-env-current-tag").exists()).toBe(true);
    expect(tile(w, "zulu-jdk17").find(".java-env-current-tag").exists()).toBe(false);
    expect(tile(w, "temurin-jdk21").classes()).toContain("selected");
  });

  it("current environment selected keeps Switch inactive and does nothing", async () => {
    const w = await openWith(OPTIONS);
    expect(okButton(w).attributes("disabled")).toBeDefined();
    await okButton(w).trigger("click");
    expect(mocks.switchEnv).not.toHaveBeenCalled();
  });

  it("selecting another environment enables Switch", async () => {
    const w = await openWith(OPTIONS);
    await tile(w, "zulu-jdk17").trigger("click");
    expect(tile(w, "zulu-jdk17").classes()).toContain("selected");
    expect(tile(w, "temurin-jdk21").classes()).not.toContain("selected");
    expect(okButton(w).attributes("disabled")).toBeUndefined();
  });

  it("only one environment available shows it as current and Switch stays inactive", async () => {
    const w = await openWith({
      current: { name: "temurin-jdk21", version: 21 },
      options: [{ name: "temurin-jdk21", version: 21 }]
    });
    expect(w.findAll(".java-env-tile")).toHaveLength(1);
    expect(tile(w, "temurin-jdk21").find(".java-env-current-tag").exists()).toBe(true);
    expect(okButton(w).attributes("disabled")).toBeDefined();
  });

  it("no environment available keeps Switch inactive", async () => {
    const w = await openWith({ current: null, options: [] });
    expect(w.findAll(".java-env-tile")).toHaveLength(0);
    expect(okButton(w).attributes("disabled")).toBeDefined();
  });

  it("custom image: label shows Custom image, no tile current, nothing pre-selected", async () => {
    const w = await openWith({ current: null, options: OPTIONS.options });
    expect(w.find(".java-env-current").text()).toBe("TXT_CODE_JAVA_CONTAINER_CUSTOM_IMAGE");
    expect(w.findAll(".java-env-current-tag")).toHaveLength(0);
    expect(w.findAll(".selected")).toHaveLength(0);
    expect(okButton(w).attributes("disabled")).toBeDefined();
  });

  it("recognized but missing local image: keeps the name, marks no tile current", async () => {
    const w = await openWith({
      current: { name: "corretto-jdk11", version: 11 },
      options: OPTIONS.options
    });
    expect(w.find(".java-env-current").text()).toBe("corretto-jdk11");
    expect(w.findAll(".java-env-current-tag")).toHaveLength(0);
    expect(w.findAll(".selected")).toHaveLength(0);
  });

  it("reloads options and resets the selection on each open", async () => {
    const w = await openWith(OPTIONS);
    await tile(w, "zulu-jdk17").trigger("click");
    await w.find(".modal-cancel").trigger("click");
    mocks.getOptions.mockResolvedValue({
      value: { current: { name: "zulu-jdk17", version: 17 }, options: OPTIONS.options }
    });
    await (w.vm as any).openDialog();
    await flushPromises();
    expect(mocks.getOptions).toHaveBeenCalledTimes(2);
    expect(tile(w, "zulu-jdk17").classes()).toContain("selected");
    expect(tile(w, "zulu-jdk17").find(".java-env-current-tag").exists()).toBe(true);
  });

  it("cancel sends nothing", async () => {
    const w = await openWith(OPTIONS);
    await tile(w, "zulu-jdk17").trigger("click");
    await w.find(".modal-cancel").trigger("click");
    await flushPromises();
    expect(w.find(".stub-modal").exists()).toBe(false);
    expect(mocks.switchEnv).not.toHaveBeenCalled();
  });

  it("never renders raw image references", async () => {
    const w = await openWith(OPTIONS);
    const html = w.html();
    expect(html).not.toMatch(/eclipse-temurin|azul\/|zulu-openjdk|sha256:|:\d+-/);
  });
});

describe("JavaEnvironment dialog: Running Instance Notice", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
  });

  it.each([
    [3, true],
    [2, true],
    [0, false],
    [1, false],
    [-1, false]
  ])("status %s shows running notice: %s", async (status, shown) => {
    const w = await openWith(OPTIONS, status);
    const alert = w.find(".stub-alert");
    expect(alert.exists()).toBe(shown);
    if (shown) {
      expect(alert.text()).toBe("TXT_CODE_JAVA_CONTAINER_RUNNING_TIP");
      expect(alert.attributes("data-type")).toBe("warning");
    }
  });

  it("running instance submits without a second dialog", async () => {
    mocks.switchEnv.mockResolvedValue({ value: true });
    const w = await openWith(OPTIONS, 3);
    await tile(w, "zulu-jdk17").trigger("click");
    await okButton(w).trigger("click");
    await flushPromises();
    expect(mocks.switchEnv).toHaveBeenCalledTimes(1);
    expect(document.body.querySelectorAll(".ant-modal-confirm").length).toBe(0);
  });
});

describe("JavaEnvironment dialog: Switch Completion Feedback", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
  });

  it("success submits only the name, closes, emits update, then shows Update Successful", async () => {
    mocks.switchEnv.mockResolvedValue({ value: true });
    const w = await openWith(OPTIONS);
    await tile(w, "zulu-jdk17").trigger("click");
    await okButton(w).trigger("click");
    await flushPromises();
    expect(mocks.switchEnv).toHaveBeenCalledWith({
      params: { uuid: "inst-1", daemonId: "daemon-1" },
      data: { key: "zulu-jdk17" }
    });
    expect(w.find(".stub-modal").exists()).toBe(false);
    expect(w.emitted("update")).toHaveLength(1);
    expect(mocks.success).toHaveBeenCalledWith("TXT_CODE_d3de39b4");
    expect(mocks.reportErrorMsg).not.toHaveBeenCalled();
  });

  it("failure reports the error, keeps the dialog open, and reloads options", async () => {
    mocks.switchEnv.mockRejectedValue(new Error("boom"));
    const w = await openWith(OPTIONS);
    await tile(w, "zulu-jdk17").trigger("click");
    await okButton(w).trigger("click");
    await flushPromises();
    expect(mocks.reportErrorMsg).toHaveBeenCalledWith("boom");
    expect(w.find(".stub-modal").exists()).toBe(true);
    expect(mocks.getOptions).toHaveBeenCalledTimes(2);
    expect(w.emitted("update")).toBeUndefined();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("shows the pending state and ignores tile clicks while pending", async () => {
    let resolve: () => void = () => {};
    mocks.switchEnv.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    const w = await openWith({
      current: OPTIONS.current,
      options: [...OPTIONS.options, { name: "corretto-jdk8", version: 8 }]
    });
    await tile(w, "zulu-jdk17").trigger("click");
    await okButton(w).trigger("click");
    await flushPromises();
    expect(okButton(w).attributes("data-loading")).toBe("true");
    await tile(w, "corretto-jdk8").trigger("click");
    expect(tile(w, "zulu-jdk17").classes()).toContain("selected");
    resolve();
    await flushPromises();
    expect(mocks.switchEnv).toHaveBeenCalledTimes(1);
  });
});
