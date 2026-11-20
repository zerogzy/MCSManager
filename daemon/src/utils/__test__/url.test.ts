import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("dns", () => ({ promises: { lookup }, default: { promises: { lookup } } }));

import { checkSafeUrl, resolveSafeUrl } from "../url";

const PUBLIC_V4 = { address: "93.184.216.34", family: 4 };
const PUBLIC_V6 = { address: "2606:4700:4700::1111", family: 6 };

beforeEach(() => {
  lookup.mockReset();
  lookup.mockResolvedValue([PUBLIC_V4]);
});

describe("resolveSafeUrl: URL shape checks (rejected before any DNS lookup)", () => {
  it.each([
    ["ftp://example.com/a.jar", "Only HTTP and HTTPS"],
    ["file:///etc/passwd", "Only HTTP and HTTPS"],
    ["gopher://example.com/", "Only HTTP and HTTPS"]
  ])("rejects non-http(s) protocol: %s", async (url, message) => {
    await expect(resolveSafeUrl(url)).rejects.toThrow(message);
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    "http://127.0.0.1/a.jar",
    "http://10.0.0.5/a.jar",
    "http://93.184.216.34/a.jar",
    "http://[::1]/a.jar",
    "http://[2606:4700:4700::1111]/a.jar",
    // The URL parser normalizes these to dotted IPv4, so they must be rejected as IPs too.
    "http://2130706433/a.jar",
    "http://0x7f.0.0.1/a.jar",
    "http://127.1/a.jar",
    // Userinfo trick: the real host is the part after the "@".
    "http://example.com@127.0.0.1/a.jar"
  ])("rejects IP address hosts without resolving: %s", async (url) => {
    await expect(resolveSafeUrl(url)).rejects.toThrow("IP addresses are not allowed");
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    "http://localhost/a.jar",
    "http://LOCALHOST/a.jar",
    "http://app.localhost/a.jar",
    "http://printer.local/a.jar"
  ])("rejects local domains: %s", async (url) => {
    await expect(resolveSafeUrl(url)).rejects.toThrow("Local domains are not allowed");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects single-label hostnames (no dot)", async () => {
    await expect(resolveSafeUrl("http://intranet/a.jar")).rejects.toThrow("must contain a dot");
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(["http://example.com./a.jar", "http://.example.com/a.jar", "http://a..com/a.jar"])(
    "rejects malformed hostnames with empty labels: %s",
    async (url) => {
      await expect(resolveSafeUrl(url)).rejects.toThrow();
      expect(lookup).not.toHaveBeenCalled();
    }
  );

  it("rejects strings that are not URLs at all", async () => {
    await expect(resolveSafeUrl("not a url")).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("resolveSafeUrl: resolved address checks", () => {
  it.each([
    ["0.0.0.0", 4],
    ["0.1.2.3", 4],
    ["10.0.0.1", 4],
    ["10.255.255.255", 4],
    ["100.64.0.1", 4],
    ["100.127.255.255", 4],
    ["127.0.0.1", 4],
    ["127.255.255.254", 4],
    ["169.254.169.254", 4],
    ["172.16.0.1", 4],
    ["172.31.255.255", 4],
    ["192.168.0.1", 4],
    ["192.168.255.255", 4],
    ["::", 6],
    ["::1", 6],
    ["fc00::1", 6],
    ["fd12:3456::1", 6],
    ["fe80::1", 6],
    ["febf::1", 6],
    ["::ffff:127.0.0.1", 6],
    ["::ffff:7f00:1", 6]
  ])("rejects a hostname that resolves to private/reserved %s", async (address, family) => {
    lookup.mockResolvedValue([{ address, family }]);
    await expect(resolveSafeUrl("http://example.com/a.jar")).rejects.toThrow(
      "private or invalid address"
    );
  });

  it.each([
    ["1.1.1.1", 4],
    ["9.255.255.255", 4],
    ["11.0.0.1", 4],
    ["100.63.255.255", 4],
    ["100.128.0.1", 4],
    ["126.255.255.255", 4],
    ["128.0.0.1", 4],
    ["169.253.255.255", 4],
    ["169.255.0.1", 4],
    ["172.15.255.255", 4],
    ["172.32.0.1", 4],
    ["192.167.255.255", 4],
    ["192.169.0.1", 4],
    ["2606:4700:4700::1111", 6]
  ])("allows a hostname that resolves to public %s (range boundaries)", async (address, family) => {
    lookup.mockResolvedValue([{ address, family }]);
    const target = await resolveSafeUrl("https://example.com/a.jar");
    expect(target.address).toBe(address);
  });

  it("rejects when ANY resolved address is private (mixed public + private answer)", async () => {
    lookup.mockResolvedValue([PUBLIC_V4, { address: "10.0.0.1", family: 4 }]);
    await expect(resolveSafeUrl("http://example.com/a.jar")).rejects.toThrow(
      "private or invalid address"
    );

    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }, PUBLIC_V4]);
    await expect(resolveSafeUrl("http://example.com/a.jar")).rejects.toThrow(
      "private or invalid address"
    );
  });

  it("rejects an empty DNS answer", async () => {
    lookup.mockResolvedValue([]);
    await expect(resolveSafeUrl("http://example.com/a.jar")).rejects.toThrow(
      "private or invalid address"
    );
  });

  it("propagates DNS lookup failures instead of treating them as safe", async () => {
    lookup.mockRejectedValue(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));
    await expect(resolveSafeUrl("http://does-not-exist.example/a.jar")).rejects.toThrow("ENOTFOUND");
  });

  it("looks up the lowercased hostname with all=true and verbatim=true", async () => {
    await resolveSafeUrl("http://Example.COM/a.jar");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("example.com", { all: true, verbatim: true });
  });
});

describe("resolveSafeUrl: returned target (the address callers must pin)", () => {
  it("returns the parsed URL and the first validated IPv4 address", async () => {
    lookup.mockResolvedValue([PUBLIC_V4, { address: "93.184.216.35", family: 4 }]);
    const target = await resolveSafeUrl("https://example.com:8443/mods/a.jar?x=1");
    expect(target.url.toString()).toBe("https://example.com:8443/mods/a.jar?x=1");
    expect(target.address).toBe("93.184.216.34");
    expect(target.family).toBe(4);
  });

  it("reports family 6 for an IPv6 answer", async () => {
    lookup.mockResolvedValue([PUBLIC_V6]);
    const target = await resolveSafeUrl("http://example.com/a.jar");
    expect(target.address).toBe(PUBLIC_V6.address);
    expect(target.family).toBe(6);
  });

  it("allows http and https", async () => {
    await expect(resolveSafeUrl("http://example.com/")).resolves.toBeDefined();
    await expect(resolveSafeUrl("https://example.com/")).resolves.toBeDefined();
  });

  it("validates each call independently (a changed DNS answer is re-checked)", async () => {
    await expect(resolveSafeUrl("http://example.com/a.jar")).resolves.toBeDefined();
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(resolveSafeUrl("http://example.com/a.jar")).rejects.toThrow(
      "private or invalid address"
    );
  });
});

describe("checkSafeUrl", () => {
  it("returns true for a safe URL", async () => {
    await expect(checkSafeUrl("https://example.com/a.jar")).resolves.toBe(true);
  });

  it("returns false (never throws) for unsafe or invalid URLs", async () => {
    await expect(checkSafeUrl("http://127.0.0.1/")).resolves.toBe(false);
    await expect(checkSafeUrl("file:///etc/passwd")).resolves.toBe(false);
    await expect(checkSafeUrl("not a url")).resolves.toBe(false);
    lookup.mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    await expect(checkSafeUrl("http://example.com/")).resolves.toBe(false);
  });

  it("returns false when DNS fails", async () => {
    lookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(checkSafeUrl("http://example.com/")).resolves.toBe(false);
  });
});
