import { afterEach, describe, expect, it, vi } from "vitest";

import { defineWorkspaceAgent } from "./workspace-agent.js";

vi.mock("#compiled/@vercel/oidc/index.js", () => ({
  getVercelOidcToken: vi.fn().mockResolvedValue("oidc-token"),
}));

afterEach(() => vi.unstubAllEnvs());

describe("defineWorkspaceAgent", () => {
  it("selects the named workspace route in a Vercel environment", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "preview.example.com");
    const subagent = defineWorkspaceAgent({ name: "research" });

    expect(subagent).toMatchObject({ description: "", kind: "remote", path: "/eve/v1/session" });
    expect(await (subagent.url as () => Promise<string>)()).toBe(
      "https://preview.example.com/eve/research",
    );
    await expect(subagent.auth?.()).resolves.toEqual({
      headers: {
        authorization: "Bearer oidc-token",
        "x-vercel-trusted-oidc-idp-token": "oidc-token",
      },
    });
  });

  it("uses the named workspace route regardless of the caller mount", async () => {
    vi.stubEnv("EVE_PUBLIC_ROUTE_PREFIX", "/eve/support");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "preview.example.com");

    const subagent = defineWorkspaceAgent({ name: "research" });

    expect((subagent.url as () => string)()).toBe("https://preview.example.com/eve/research");
  });

  it("requires an explicit transport outside Vercel", async () => {
    vi.stubEnv("VERCEL", undefined);
    const subagent = defineWorkspaceAgent({ name: "research" });

    expect(() => (subagent.url as () => string)()).toThrow(
      "No default workspace-agent transport is available",
    );
  });

  it("uses an explicit transport instead of the environment default", async () => {
    vi.stubEnv("VERCEL", undefined);
    const auth = vi.fn(async () => ({ headers: { authorization: "Bearer custom" } }));
    const subagent = defineWorkspaceAgent({
      name: "research",
      transport: {
        auth,
        headers: { "x-workspace": "custom" },
        url: "https://research.internal",
      },
    });

    expect(subagent).toMatchObject({
      auth,
      headers: { "x-workspace": "custom" },
      url: "https://research.internal",
    });
  });
});
