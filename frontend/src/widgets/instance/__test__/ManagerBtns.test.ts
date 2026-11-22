// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoffeeOutlined } from "@ant-design/icons-vue";
import { defineComponent, h, ref } from "vue";
import ManagerBtns from "../ManagerBtns.vue";

const instanceInfo = ref<any>();
const toPageSpy = vi.fn();
const dialogs = vi.hoisted(() => ({ javaManager: vi.fn(), javaEnvironment: vi.fn() }));
const modFolders = ref<string[]>([]);

vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
vi.mock("ant-design-vue", () => ({ message: {}, Modal: {} }));
vi.mock("@/services/apis/instance", () => ({}));

vi.mock("@/hooks/useInstance", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useInstance")>("@/hooks/useInstance");
  return {
    ...actual,
    useInstanceInfo: () => ({
      instanceInfo,
      execute: vi.fn(),
      isGlobalTerminal: ref(false)
    })
  };
});
vi.mock("@/hooks/useAppRouters", () => ({
  useAppRouters: () => ({ toPage: toPageSpy })
}));
vi.mock("@/hooks/useServerConfig", () => ({
  useServerConfig: () => ({ serverConfigFiles: ref([]), refresh: vi.fn() })
}));
vi.mock("@/hooks/useCardTools", () => ({
  useLayoutCardTools: () => ({
    getMetaOrRouteValue: (key: string) => ({ instanceId: "inst-1", daemonId: "daemon-1" })[key]
  })
}));
vi.mock("@/services/apis/modManager", () => ({
  modListApi: () => ({
    execute: async () => ({ value: { folders: modFolders.value } })
  })
}));
vi.mock("@/stores/useAppStateStore", () => ({
  useAppStateStore: () => ({
    isAdmin: ref(false),
    state: { settings: { canFileManager: true, allowChangeCmd: false } }
  })
}));

vi.mock("../dialogs/EventConfig.vue", () => ({ default: { render: () => null } }));
vi.mock("../dialogs/InstanceDetail.vue", () => ({ default: { render: () => null } }));
vi.mock("../dialogs/InstanceFundamentalDetail.vue", () => ({ default: { render: () => null } }));
vi.mock("../dialogs/JavaManager.vue", async () => {
  const { defineComponent } = await import("vue");
  return {
    default: defineComponent({
      setup(_, { expose }) {
        expose({ openDialog: dialogs.javaManager });
        return () => null;
      }
    })
  };
});
vi.mock("../dialogs/JavaEnvironment.vue", async () => {
  const { defineComponent } = await import("vue");
  return {
    default: defineComponent({
      props: {
        instanceInfo: { type: Object, default: undefined },
        instanceId: { type: String, default: "" },
        daemonId: { type: String, default: "" }
      },
      setup(props, { expose }) {
        expose({ openDialog: () => dialogs.javaEnvironment(props.instanceId, props.daemonId) });
        return () => null;
      }
    })
  };
});
vi.mock("../dialogs/McPingSettings.vue", () => ({ default: { render: () => null } }));
vi.mock("../dialogs/PingConfig.vue", () => ({ default: { render: () => null } }));
vi.mock("../dialogs/RconSettings.vue", () => ({ default: { render: () => null } }));
vi.mock("../dialogs/TermConfig.vue", () => ({ default: { render: () => null } }));

const Empty = defineComponent({ render: () => null });

const ResponsiveLayoutGroupStub = defineComponent({
  props: { items: { type: Array, default: () => [] } },
  setup(props) {
    return () =>
      h(
        "div",
        (props.items as any[]).map((item) =>
          h(
            "div",
            {
              class: "entry",
              // Both Java entries share one label; the icon tells them apart
              "data-key": item.icon === CoffeeOutlined ? JAVA_ENV : item.title,
              "data-title": item.title,
              onClick: item.click
            },
            item.title
          )
        )
      );
  }
});

async function render(config: { type: string; processType: string }) {
  instanceInfo.value = { config: { ...config, docker: {} } };
  const wrapper = mount(ManagerBtns, {
    props: { card: { id: "c1", meta: {}, type: "InstanceManagerBtns", title: "", width: 6, height: "" } as any },
    global: {
      stubs: {
        CardPanel: { template: "<div><slot name='title' /><slot name='body' /></div>" },
        ResponsiveLayoutGroup: ResponsiveLayoutGroupStub,
        InnerCard: true,
        TermConfig: Empty,
        EventConfig: Empty,
        PingConfig: Empty,
        InstanceDetail: Empty,
        InstanceFundamentalDetail: Empty,
        RconSettings: Empty,
        McPingSettings: Empty
      }
    }
  });
  await flushPromises();
  return wrapper;
}

// Entry keys in display order; the Docker Java environment entry is keyed JAVA_ENV
const titles = (wrapper: any): string[] =>
  wrapper.findAll(".entry").map((e: any) => e.attributes("data-key"));

const JAVA_LABEL = "TXT_CODE_3fee13ed";
const JAVA_ENV = "java-environment";
const JAVA_MANAGER = JAVA_LABEL;
const MODS = "TXT_CODE_MOD_MANAGER";

describe("ManagerBtns: Java Selection Entries in Instance Features", () => {
  beforeEach(() => {
    toPageSpy.mockReset();
    dialogs.javaManager.mockReset();
    dialogs.javaEnvironment.mockReset();
    modFolders.value = ["plugins"];
  });

  it("Docker Java instance shows the Java environment entry right after Plugins/Mods and no Java Manager", async () => {
    const w = await render({ type: "minecraft/java/paper", processType: "docker" });
    const t = titles(w);
    expect(t).toContain(JAVA_ENV);
    expect(t).not.toContain(JAVA_MANAGER);
    expect(t.indexOf(JAVA_ENV)).toBe(t.indexOf(MODS) + 1);
  });

  it("the Java environment entry uses the Java Manager label", async () => {
    const w = await render({ type: "minecraft/java/paper", processType: "docker" });
    expect(w.find(`[data-key="${JAVA_ENV}"]`).attributes("data-title")).toBe(JAVA_LABEL);
    expect(w.findAll(`[data-title="${JAVA_LABEL}"]`)).toHaveLength(1);
  });

  it("Java environment entry keeps its position when Plugins/Mods is hidden", async () => {
    modFolders.value = [];
    const w = await render({ type: "minecraft/java/paper", processType: "docker" });
    const t = titles(w);
    expect(t).not.toContain(MODS);
    // Directly after the files entry, i.e. where Plugins/Mods would be
    expect(t.indexOf(JAVA_ENV)).toBe(t.indexOf("TXT_CODE_ae533703") + 1);
  });

  it("Docker Nukkit shows the Java environment entry", async () => {
    const w = await render({ type: "minecraft/bedrock/nukkit", processType: "docker" });
    expect(titles(w)).toContain(JAVA_ENV);
  });

  it("entry opens the Java environment dialog for the same instance and node without navigating", async () => {
    const w = await render({ type: "minecraft/java", processType: "docker" });
    await w.find(`[data-key="${JAVA_ENV}"]`).trigger("click");
    expect(dialogs.javaEnvironment).toHaveBeenCalledWith("inst-1", "daemon-1");
    expect(dialogs.javaManager).not.toHaveBeenCalled();
    expect(toPageSpy).not.toHaveBeenCalled();
  });

  it("host-process Java Manager entry still opens the Java Manager dialog", async () => {
    const w = await render({ type: "minecraft/java", processType: "general" });
    await w.find(`[data-key="${JAVA_MANAGER}"]`).trigger("click");
    expect(dialogs.javaManager).toHaveBeenCalledTimes(1);
    expect(dialogs.javaEnvironment).not.toHaveBeenCalled();
  });

  it("host-process Java instance keeps Java Manager only", async () => {
    const w = await render({ type: "minecraft/java/fabric", processType: "general" });
    const t = titles(w);
    expect(t).toContain(JAVA_MANAGER);
    expect(t).not.toContain(JAVA_ENV);
  });

  it("host-process Nukkit shows Java Manager", async () => {
    const w = await render({ type: "minecraft/bedrock/nukkit", processType: "general" });
    const t = titles(w);
    expect(t).toContain(JAVA_MANAGER);
    expect(t).not.toContain(JAVA_ENV);
  });

  it.each([
    ["steam/terraria", "docker"],
    ["steam/terraria", "general"],
    ["minecraft/bedrock/bds", "docker"],
    ["minecraft/bedrock/bds", "general"]
  ])("%s (%s) shows neither entry", async (type, processType) => {
    const w = await render({ type, processType });
    const t = titles(w);
    expect(t).not.toContain(JAVA_MANAGER);
    expect(t).not.toContain(JAVA_ENV);
  });

  it("Plugins/Mods stays limited to Minecraft types", async () => {
    expect(titles(await render({ type: "minecraft/bedrock/bds", processType: "docker" }))).toContain(
      MODS
    );
    expect(titles(await render({ type: "universal/mcdr", processType: "docker" }))).toContain(MODS);
    expect(titles(await render({ type: "steam/terraria", processType: "docker" }))).not.toContain(
      MODS
    );
  });
});
