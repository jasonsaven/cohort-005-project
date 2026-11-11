import { useEffect, useState } from "react";
import Knock, {
  type Feed,
  type FeedItem,
  type FeedStoreState,
} from "@knocklabs/client";
import type { NotificationFeedConfig } from "~/lib/notifications";
import { authenticateKnock } from "~/lib/knock-auth";
import {
  readFeedStatus,
  type FeedNetworkStatus,
  type FeedStatus,
} from "~/lib/notification-feed";

// ─── The Notification Feed's data ───
// Wraps Knock's headless client: one Knock connection and feed per signed-in
// user, kept current over Knock's socket. Everything runs in the browser
// after hydration; on the server the feed is simply "loading". If Knock
// can't be set up or reached, the feed reports an error rather than throwing,
// so the rest of the page keeps working.

const PAGE_SIZE = 20;

export type NotificationFeedState = {
  status: FeedStatus;
  /** Knock's raw network status, for deciding when to page. */
  networkStatus: FeedNetworkStatus | null;
  items: FeedItem[];
  unseenCount: number;
  hasMore: boolean;
  isFetchingMore: boolean;
  /** False once the real-time connection drops, until it reconnects. */
  isLive: boolean;
  /** Marks the Notifications loaded so far as seen, clearing them from the badge. */
  markLoadedAsSeen: () => void;
  markAsRead: (item: FeedItem) => void;
  /** Marks every Notification read and seen, clearing every dot and the badge. */
  markAllAsRead: () => void;
  fetchNextPage: () => void;
  /** After a failed fetch: fetch the next page if there is one, else start over. */
  retry: () => void;
};

export function useNotificationFeed(
  config: NotificationFeedConfig
): NotificationFeedState {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [state, setState] = useState<FeedStoreState | null>(null);
  const [setupFailed, setSetupFailed] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const { publicApiKey, feedChannelId, userId, userToken } = config;

  useEffect(() => {
    let knock: Knock;
    let userFeed: Feed;
    try {
      knock = new Knock(publicApiKey);
      authenticateKnock(knock, userId, userToken);
      userFeed = knock.feeds.initialize(feedChannelId, {
        archived: "exclude",
        page_size: PAGE_SIZE,
      });
    } catch (error) {
      console.error("[notifications] couldn't start the feed", error);
      setSetupFailed(true);
      return () => setSetupFailed(false);
    }

    const unsubscribe = userFeed.store.subscribe(setState);
    setState(userFeed.getState());
    setFeed(userFeed);

    // Knock's socket reconnects by itself; we only report whether it's up.
    const socket = knock.client().socket;
    const socketRefs = socket
      ? [
          socket.onError(() => setIsLive(false)),
          socket.onOpen(() => setIsLive(true)),
        ]
      : [];

    userFeed.listenForUpdates();
    void userFeed.fetch();

    return () => {
      socket?.off(socketRefs);
      unsubscribe();
      userFeed.dispose();
      knock.logout();
      setFeed(null);
      setState(null);
      setIsLive(true);
    };
    // The token only seeds the connection; Knock refreshes it itself, and a
    // new token from a layout revalidation shouldn't tear the socket down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicApiKey, feedChannelId, userId]);

  const items = state?.items ?? [];
  const networkStatus: FeedNetworkStatus | null = setupFailed
    ? "error"
    : (state?.networkStatus ?? null);
  const hasMore = Boolean(state?.pageInfo.after);

  return {
    status: readFeedStatus(networkStatus, items.length),
    networkStatus,
    items,
    unseenCount: state?.metadata.unseen_count ?? 0,
    hasMore,
    isFetchingMore: networkStatus === "fetchMore",
    isLive,
    markLoadedAsSeen: () => {
      const unseen = items.filter((item) => !item.seen_at);
      if (feed && unseen.length > 0) void feed.markAsSeen(unseen);
    },
    markAsRead: (item) => {
      if (feed && !item.read_at) void feed.markAsRead(item);
    },
    markAllAsRead: () => {
      if (!feed) return;
      // The badge counts unseen, not unread, and may include pages not yet
      // loaded, so clear both.
      void feed.markAllAsRead();
      void feed.markAllAsSeen();
    },
    fetchNextPage: () => {
      if (feed && hasMore) void feed.fetchNextPage();
    },
    retry: () => {
      if (!feed) return;
      void (items.length > 0 && hasMore ? feed.fetchNextPage() : feed.fetch());
    },
  };
}
