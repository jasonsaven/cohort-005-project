// ─── Reading the Notification Feed ───
// Pure decisions behind the bell and its popover, kept apart from Knock's
// client so they can be tested. `use-notification-feed.ts` feeds them the
// Knock store's state; `notification-bell.tsx` renders the result.

/** Knock's NetworkStatus values, as plain strings. */
export type FeedNetworkStatus = "loading" | "fetchMore" | "ready" | "error";

/**
 * - loading: the first page hasn't arrived.
 * - ready: showing what's loaded (possibly nothing).
 * - error: nothing could be loaded; Knock is unreachable.
 * - stale: Notifications are showing, but a later fetch failed.
 */
export type FeedStatus = "loading" | "ready" | "error" | "stale";

export function readFeedStatus(
  networkStatus: FeedNetworkStatus | null,
  itemCount: number
): FeedStatus {
  if (networkStatus === "error") return itemCount > 0 ? "stale" : "error";
  // A real-time update refetches with status "loading"; keep the list up.
  if (itemCount > 0) return "ready";
  if (networkStatus === null || networkStatus === "loading") return "loading";
  return "ready";
}

/** Start fetching the next page this close to the bottom of the list. */
const LOAD_MORE_WITHIN_PX = 48;

type ScrollPosition = {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
};

/**
 * Whether to fetch the next page: near the bottom of the list (or the list
 * doesn't fill its box), more pages exist, and no request is in flight. After
 * a failed fetch it waits for the person to choose "Try again".
 */
export function shouldLoadMore(
  list: ScrollPosition,
  feed: { hasMore: boolean; networkStatus: FeedNetworkStatus | null }
): boolean {
  if (!feed.hasMore || feed.networkStatus !== "ready") return false;
  const distanceToEnd = list.scrollHeight - list.scrollTop - list.clientHeight;
  return distanceToEnd < LOAD_MORE_WITHIN_PX;
}

/**
 * What the bell's badge says, or null for no badge. When Knock can't be
 * reached the count may be wrong, so the bell shows none.
 */
export function badgeText(
  unseenCount: number,
  status: FeedStatus
): string | null {
  if (status === "error" || status === "stale" || unseenCount <= 0) return null;
  return unseenCount > 99 ? "99+" : String(unseenCount);
}
