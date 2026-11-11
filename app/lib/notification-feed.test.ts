import { describe, expect, it } from "vitest";
import {
  badgeText,
  readFeedStatus,
  shouldLoadMore,
} from "./notification-feed";

describe("readFeedStatus", () => {
  it("is loading until the first page arrives", () => {
    expect(readFeedStatus(null, 0)).toBe("loading");
    expect(readFeedStatus("loading", 0)).toBe("loading");
  });

  it("is ready once a page has loaded, even an empty one", () => {
    expect(readFeedStatus("ready", 0)).toBe("ready");
    expect(readFeedStatus("ready", 3)).toBe("ready");
  });

  it("is an error when nothing could be loaded", () => {
    expect(readFeedStatus("error", 0)).toBe("error");
  });

  it("keeps showing loaded Notifications when a later fetch fails", () => {
    expect(readFeedStatus("error", 3)).toBe("stale");
  });

  it("keeps showing loaded Notifications while a real-time update fetches", () => {
    expect(readFeedStatus("loading", 3)).toBe("ready");
  });

  it("stays ready while fetching more", () => {
    expect(readFeedStatus("fetchMore", 3)).toBe("ready");
  });
});

describe("shouldLoadMore", () => {
  const nearEnd = { scrollHeight: 1000, scrollTop: 620, clientHeight: 360 };
  const farFromEnd = { scrollHeight: 1000, scrollTop: 0, clientHeight: 360 };
  const ready = { hasMore: true, networkStatus: "ready" } as const;

  it("loads the next page near the bottom of the list", () => {
    expect(shouldLoadMore(nearEnd, ready)).toBe(true);
  });

  it("waits until the person scrolls near the bottom", () => {
    expect(shouldLoadMore(farFromEnd, ready)).toBe(false);
  });

  it("loads more when the first page doesn't fill the list", () => {
    const short = { scrollHeight: 200, scrollTop: 0, clientHeight: 360 };
    expect(shouldLoadMore(short, ready)).toBe(true);
  });

  it("stops when there are no pages left", () => {
    expect(shouldLoadMore(nearEnd, { ...ready, hasMore: false })).toBe(false);
  });

  it("doesn't start a second request while one is in flight", () => {
    expect(
      shouldLoadMore(nearEnd, { ...ready, networkStatus: "fetchMore" })
    ).toBe(false);
    expect(shouldLoadMore(nearEnd, { ...ready, networkStatus: "loading" })).toBe(
      false
    );
  });

  it("doesn't retry on every scroll after a failed fetch", () => {
    expect(shouldLoadMore(nearEnd, { ...ready, networkStatus: "error" })).toBe(
      false
    );
  });
});

describe("badgeText", () => {
  it("counts unseen Notifications", () => {
    expect(badgeText(3, "ready")).toBe("3");
  });

  it("caps the count at 99+", () => {
    expect(badgeText(99, "ready")).toBe("99");
    expect(badgeText(100, "ready")).toBe("99+");
  });

  it("shows no badge when nothing is unseen", () => {
    expect(badgeText(0, "ready")).toBeNull();
  });

  it("shows no badge when Knock can't be reached", () => {
    expect(badgeText(3, "error")).toBeNull();
    expect(badgeText(3, "stale")).toBeNull();
  });
});
