import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Bell } from "lucide-react";
import type { FeedItem } from "@knocklabs/client";
import { cn, formatRelativeTime } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  describeNotification,
  type NotificationFeedConfig,
} from "~/lib/notifications";
import { badgeText, shouldLoadMore } from "~/lib/notification-feed";
import { useNotificationFeed } from "~/lib/use-notification-feed";

// ─── The Notification Feed ───
// A bell in the sidebar with a badge counting unseen Notifications. Opening it
// shows the newest Notifications and marks them seen; clicking one marks it
// read and goes to its page. Older pages load as the list scrolls; new
// Notifications arrive over Knock's socket. If Knock is unreachable the bell
// shows no badge and the popover says so; the rest of the page carries on.

function actorOf(item: FeedItem) {
  const [actor] = item.actors;
  if (!actor || "collection" in actor) return null;
  return { name: actor.name ?? "Someone", avatarUrl: actor.avatar };
}

type Row = {
  item: FeedItem;
  description: NonNullable<ReturnType<typeof describeNotification>>;
};

// Rows we know how to show; a workflow triggered by hand from the Knock
// dashboard, say, is left out.
function rowsOf(items: FeedItem[]): Row[] {
  return items.flatMap((item) => {
    const description = describeNotification(item.source.key, item.data);
    return description ? [{ item, description }] : [];
  });
}

function NotificationRow({
  row: { item, description },
  onOpen,
}: {
  row: Row;
  onOpen: (item: FeedItem, url: string) => void;
}) {
  const actor = actorOf(item);
  const isUnread = !item.read_at;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item, description.url)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
      >
        {actor ? (
          <UserAvatar name={actor.name} avatarUrl={actor.avatarUrl} />
        ) : (
          <div className="size-8 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm",
              isUnread ? "font-semibold text-foreground" : "text-muted-foreground"
            )}
          >
            {description.text}
          </p>
          {description.detail && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              “{description.detail}”
            </p>
          )}
          <p
            className="mt-1 text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            {formatRelativeTime(item.inserted_at)}
          </p>
        </div>
        {isUnread && (
          <span
            aria-label="Unread"
            className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
          />
        )}
      </button>
    </li>
  );
}

function TryAgain({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-medium text-primary hover:underline"
    >
      Try again
    </button>
  );
}

export function NotificationBell({
  config,
}: {
  config: NotificationFeedConfig;
}) {
  const feed = useNotificationFeed(config);
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = rowsOf(feed.items);
  const badge = badgeText(feed.unseenCount, feed.status);
  const hasUnread =
    badge !== null || rows.some(({ item }) => !item.read_at);
  const canMarkAllAsRead =
    (feed.status === "ready" || feed.status === "stale") && hasUnread;

  function loadMoreIfNeeded() {
    const list = listRef.current;
    if (list && shouldLoadMore(list, feed)) feed.fetchNextPage();
  }

  // While the list is open, whatever arrives in it (a later page, a real-time
  // update) has been seen. A page that doesn't fill the list can't be
  // scrolled, so check whether to load more too.
  useEffect(() => {
    if (!isOpen) return;
    feed.markLoadedAsSeen();
    loadMoreIfNeeded();
  });

  function openNotification(item: FeedItem, url: string) {
    feed.markAsRead(item);
    setIsOpen(false);
    navigate(url);
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={badge ? `Notifications, ${badge} unseen` : "Notifications"}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <span className="relative">
            <Bell className="size-4" />
            {badge && (
              <span className="absolute -top-2 -right-2 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
                {badge}
              </span>
            )}
          </span>
          Notifications
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Notifications</h2>
          {canMarkAllAsRead && (
            <button
              type="button"
              onClick={feed.markAllAsRead}
              className="text-xs font-medium text-primary hover:underline"
            >
              Mark all as read
            </button>
          )}
        </div>
        {!feed.isLive && feed.status !== "error" && (
          <p className="border-b bg-muted px-4 py-2 text-xs text-muted-foreground">
            Live updates are paused. Reconnecting…
          </p>
        )}
        <div
          ref={listRef}
          className="max-h-96 overflow-y-auto"
          onScroll={loadMoreIfNeeded}
        >
          {feed.status === "error" ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Notifications couldn't be loaded.{" "}
              <TryAgain onClick={feed.retry} />
            </p>
          ) : feed.status === "loading" ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : rows.length === 0 && !feed.hasMore ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              You're all caught up. Nothing new to show.
            </p>
          ) : (
            <ul className="divide-y">
              {rows.map((row) => (
                <NotificationRow
                  key={row.item.id}
                  row={row}
                  onOpen={openNotification}
                />
              ))}
            </ul>
          )}
          {feed.isFetchingMore && (
            <p className="px-4 py-3 text-center text-xs text-muted-foreground">
              Loading more…
            </p>
          )}
          {feed.status === "stale" && (
            <p className="px-4 py-3 text-center text-xs text-muted-foreground">
              Some Notifications couldn't be loaded.{" "}
              <TryAgain onClick={feed.retry} />
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
