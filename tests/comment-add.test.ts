import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { invoke, firstText } from "./_helpers";

beforeEach(() => {
  process.env.ASANA_ACCESS_TOKEN = "test-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ASANA_ACCESS_TOKEN;
});

function storyResponse(gid: string, createdAt: string) {
  return {
    ok: true,
    status: 201,
    text: async () =>
      JSON.stringify({
        data: { gid, text: "hi", resource_type: "story", created_at: createdAt },
      }),
    json: async () => ({
      data: { gid, text: "hi", resource_type: "story", created_at: createdAt },
    }),
  } as unknown as Response;
}

function taskResponse(gid: string, permalink?: string) {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        data: { gid, name: "Some Task", permalink_url: permalink ?? null },
      }),
    json: async () => ({
      data: { gid, name: "Some Task", permalink_url: permalink ?? null },
    }),
  } as unknown as Response;
}

describe("asana_add_comment success summary", () => {
  it("includes the task permalink URL after a successful post", async () => {
    // Default NO_UI ctx: confirm gate short-circuits to "proceed" (headless),
    // so resolveTasks is NOT called up front; it fires once after the POST.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(storyResponse("999", "2026-07-29T14:44:49.151Z"))
      .mockResolvedValueOnce(
        taskResponse(
          "1216960660986098",
          "https://app.asana.com/0/1/1216960660986098",
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { addCommentTool } = await import("../lib/tools/comment-add");
    const text = firstText(
      await invoke(addCommentTool, {
        task_gid: "1216960660986098",
        text: "Deploy confirmed.",
      }),
    );

    expect(text).toContain("story gid: 999");
    expect(text).toContain("URL: https://app.asana.com/0/1/1216960660986098");
  });

  it("omits the URL gracefully when the task has no permalink_url", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(storyResponse("999", "2026-07-29T14:44:49.151Z"))
      .mockResolvedValueOnce(taskResponse("1216960660986098"));
    vi.stubGlobal("fetch", fetchMock);

    const { addCommentTool } = await import("../lib/tools/comment-add");
    const text = firstText(
      await invoke(addCommentTool, {
        task_gid: "1216960660986098",
        text: "Deploy confirmed.",
      }),
    );

    expect(text).toContain("story gid: 999");
    expect(text).not.toContain("URL:");
  });
});
