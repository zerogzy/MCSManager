import { useDefineApi } from "@/stores/useDefineApi";

// Java environments are described only by name (e.g. "zulu-jdk17") and major version;
// raw image references never reach the browser.
export interface JavaEnvironmentItem {
  name: string;
  version: number;
}

export interface JavaContainerOptions {
  current: JavaEnvironmentItem | null;
  options: JavaEnvironmentItem[];
}

export const getJavaContainerOptions = useDefineApi<
  {
    params: {
      uuid: string;
      daemonId: string;
    };
  },
  JavaContainerOptions
>({
  url: "/api/protected_instance/java_container",
  method: "GET"
});

export const switchJavaContainer = useDefineApi<
  {
    params: {
      uuid: string;
      daemonId: string;
    };
    data: {
      key: string;
    };
  },
  boolean
>({
  url: "/api/protected_instance/java_container",
  method: "PUT"
});
