import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { init, type InitConfig } from "./index";

const NO_POINTER = { click: false, move: { enabled: false, throttleMs: 80 }, scroll: false } as const;

describe("page path and title (#25)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalDnt = Object.getOwnPropertyDescriptor(Navigator.prototype, "doNotTrack");

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as any).fetch = fetchMock;
    Object.defineProperty(Navigator.prototype, "doNotTrack", { value: "0", configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalDnt) Object.defineProperty(Navigator.prototype, "doNotTrack", originalDnt);
    history.replaceState({}, "", "/");
    document.title = "";
    document.body.innerHTML = "";
  });

  const pageviews = async (config: Partial<InitConfig> = {}, navigate?: () => void) => {
    const tracker = init({
      endpoint: "http://localhost:4000/ingest",
      projectKey: "test-key",
      ...config,
      capture: { ...NO_POINTER, pageview: true, ...config.capture }
    });
    navigate?.();
    await tracker.flush();
    await tracker.shutdown();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    return body.events.filter((event: any) => event.type === "pageview");
  };

  it("drops the query string and hash by default", async () => {
    history.replaceState({}, "", "/checkout?token=abc&utm_source=ads#step-2");
    const [view] = await pageviews();
    expect(view).toMatchObject({ path: "/checkout", to: "/checkout" });
  });

  it("keeps only allowlisted params, never ones whose folded name is sensitive or with email values", async () => {
    history.replaceState(
      {},
      "",
      "/p?utm_source=ads&access_token=t&api_key=k&X-Amz-Signature=s&ref=me%40x.com&email=plain&other=1"
    );
    const [view] = await pageviews({
      privacy: { keepQueryParams: ["utm_source", "access_token", "api_key", "X-Amz-Signature", "ref", "email"] }
    });
    expect(view.path).toBe("/p?utm_source=ads&email=plain");
  });

  it("replaces email-looking path segments with [email]", async () => {
    history.replaceState({}, "", "/users/ana%40example.com/orders");
    const [view] = await pageviews();
    expect(view.path).toBe("/users/[email]/orders");
  });

  it("sends the trimmed title, masks maskTextSelectors text and caps it at 200 characters", async () => {
    document.body.innerHTML = `<span class="pii">Ana Souza</span>`;
    document.title = `  Orders of   Ana Souza ${"🔥".repeat(300)} `;
    const [view] = await pageviews({ privacy: { maskTextSelectors: [".pii"] } });
    expect(view.title.startsWith("Orders of ••• 🔥")).toBe(true);
    expect(Array.from(view.title)).toHaveLength(200);
    expect(view.title).not.toContain("Ana");
  });

  it("omits the title when disabled, empty, or fully masked", async () => {
    document.title = "Secret";
    expect((await pageviews({ capture: { pageTitle: false } }))[0]).not.toHaveProperty("title");
    fetchMock.mockClear();
    document.body.innerHTML = `<b class="pii">Secret</b>`;
    expect((await pageviews({ privacy: { maskTextSelectors: [".pii"] } }))[0]).not.toHaveProperty("title");
  });

  it("does not send the previous page's title on an SPA navigation", async () => {
    document.title = "Home";
    const views = await pageviews({}, () => {
      history.pushState({}, "", "/pricing");
      document.title = "Pricing";
      history.pushState({}, "", "/docs?q=1");
    });
    expect(views.map((v: any) => [v.to, v.title])).toEqual([
      ["/", "Home"],
      ["/pricing", undefined],
      ["/docs", "Pricing"]
    ]);
  });
});
