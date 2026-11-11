import { useEffect, useState } from "react";
import Knock, {
  NetworkStatus,
  type Feed,
  type FeedItem,
  type FeedStoreState,
} from "@knocklabs/client";
import { z } from "zod";
import type { NotificationFeedConfig } from "~/lib/notifications";

// ─── The Notification Feed's data ───
// Wraps Knock's headless client: one Knock connection and feed per signed-in
// user, kept current over Knock's socket. Everything runs in the browser
// after hydration; on the server the feed is simply "loading".

const PAGE_SIZE = 20;
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60_000;

const freshTokenSchema = z.object({ userId: z.string(), userToken: z.string() });

async function fetchFreshToken(userId: string): Promise<string | undefined> {
  try {
    const response = await fetch("/api/notification-token");
    if (!response.ok) return undefined;
    const parsed = freshTokenSchema.safeParse(await response.json());
    // A different user means the session switched; the layout will rebuild
    // the feed for them, so don't hand this connection their token.
    if (!parsed.success || parsed.data.userId !== userId) return undefined;
    return parsed.data.userToken;
  } catch {
    return undefined;
  }
}

export type NotificationFeedState = {
  status: "loading" | "ready" | "error";
  items: FeedItem[];
  unseenCount: number;
  hasMore: boolean;
  isFetchingMore: boolean;
  /** Marks the Notifications loaded so far as seen, clearing them from the badge. */
  markLoadedAsSeen: () => void;
  markAsRead: (item: FeedItem) => void;
  markAllAsRead: () => void;
  fetchNextPage: () => void;
};

function statusOf(state: FeedStoreState | null): NotificationFeedState["status"] {
  if (!state) return "loading";
  if (state.networkStatus === NetworkStatus.error) return "error";
  if (state.networkStatus === NetworkStatus.loading) return "loading";
  return "ready";
}

export function useNotificationFeed(
  config: NotificationFeedConfig
): NotificationFeedState {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [state, setState] = useState<FeedStoreState | null>(null);
  const { publicApiKey, feedChannelId, userId, userToken } = config;

  useEffect(() => {
    const knock = new Knock(publicApiKey);
    knock.authenticate({ id: userId }, userToken, {
      // Our server identifies users inline when it triggers a workflow.
      identificationStrategy: "skip",
      onUserTokenExpiring: () => fetchFreshToken(userId),
      timeBeforeExpirationInMs: REFRESH_BEFORE_EXPIRY_MS,
    });

    const userFeed = knock.feeds.initialize(feedChannelId, {
      archived: "exclude",
      page_size: PAGE_SIZE,
    });
    const unsubscribe = userFeed.store.subscribe(setState);
    setState(userFeed.getState());
    setFeed(userFeed);

    userFeed.listenForUpdates();
    void userFeed.fetch();

    return () => {
      unsubscribe();
      userFeed.dispose();
      knock.logout();
      setFeed(null);
      setState(null);
    };
    // The token only seeds the connection; Knock refreshes it itself, and a
    // new token from a layout revalidation shouldn't tear the socket down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicApiKey, feedChannelId, userId]);

  return {
    status: statusOf(state),
    items: state?.items ?? [],
    unseenCount: state?.metadata.unseen_count ?? 0,
    hasMore: Boolean(state?.pageInfo.after),
    isFetchingMore: state?.networkStatus === NetworkStatus.fetchMore,
    markLoadedAsSeen: () => {
      const unseen = (state?.items ?? []).filter((item) => !item.seen_at);
      if (feed && unseen.length > 0) void feed.markAsSeen(unseen);
    },
    markAsRead: (item) => {
      if (feed && !item.read_at) void feed.markAsRead(item);
    },
    markAllAsRead: () => {
      if (feed) void feed.markAllAsRead();
    },
    fetchNextPage: () => {
      if (feed && state?.pageInfo.after) void feed.fetchNextPage();
    },
  };
}
