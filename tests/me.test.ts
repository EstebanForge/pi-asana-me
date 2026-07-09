import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { invoke, firstText, makePi } from "./_helpers";

beforeEach(() => {
  process.env.ASANA_ACCESS_TOKEN = "test-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ASANA_ACCESS_TOKEN;
});

describe("asana_get_me", () => {
  it("renders user identity and workspace list", async () => {
    const body = {
      data: {
        gid: "u1",
        name: "Esteban",
        email: "esteban@example.com",
        workspaces: [
          { gid: "ws1", name: "Wicket", resource_type: "workspace" },
          { gid: "ws2", name: "Personal", resource_type: "workspace" },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
        json: async () => body,
      } as unknown as Response),
    );
    const { getMeTool } = await import("../lib/tools/me");
    const text = firstText(await invoke(getMeTool, {}));
    expect(text).toContain("esteban@example.com");
    expect(text).toContain("User GID: u1");
    expect(text).toContain("Wicket");
    expect(text).toContain("gid: ws1");
    expect(text).toContain("Personal");
  });

  it("surfaces a hint when the PAT returns no workspaces", async () => {
    const body = { data: { gid: "u", name: "X", email: "x@y", workspaces: [] } };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
        json: async () => body,
      } as unknown as Response),
    );
    const { getMeTool } = await import("../lib/tools/me");
    const text = firstText(await invoke(getMeTool, {}));
    expect(text).toMatch(/Workspaces: none returned/);
  });
});

describe("asana_add_comment", () => {
  it("POSTs to /tasks/{gid}/stories with text by default, html_text when html=true", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({
          data: { gid: "new-story", created_at: "2026-07-01T00:00:00.000Z" },
        }),
      json: async () => ({}),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { createAddCommentTool } = await import("../lib/tools/comment");
    const addCommentTool = createAddCommentTool(makePi());
    await invoke(addCommentTool, { task_gid: "t1", text: "hi" });

    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string) as { data: Record<string, unknown> };
    expect(body).toEqual({ data: { text: "hi" } });

    // Now with html=true
    fetchMock.mockClear();
    await invoke(addCommentTool, { task_gid: "t2", text: "<b>hi</b>", html: true });
    // Note: addCommentTool above was built with makePi() (flag off), so the
    // confirm gate is bypassed and these assertions exercise the POST path.
    const [, init2] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    const body2 = JSON.parse(init2.body as string) as { data: Record<string, unknown> };
    expect(body2).toEqual({ data: { html_text: "<b>hi</b>" } });
  });
});
