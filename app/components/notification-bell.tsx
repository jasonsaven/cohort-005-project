import { useState } from "react";
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
import { useNotificationFeed } from "~/lib/use-notification-feed";

// ─── The Notification Feed ───
// A bell in the sidebar with a badge counting unseen Notifications. Opening it
// shows the newest Notifications and marks them seen; clicking one marks it
// read and goes to its page. If Knock is unreachable the bell shows no badge
// and the popover says so; the rest of the page carries on.

const SCROLL_END_THRESHOLD_PX = 48;

function actorOf(item: FeedItem) {
  const [actor] = item.actors;
  if (!actor || "collection" in actor) return null;
  return { name: actor.name ?? "Someone", avatarUrl: actor.avatar };
}

function NotificationRow({
  item,
  onOpen,
}: {
  item: FeedItem;
  onOpen: (item: FeedItem, url: string) => void;
}) {
  const description = describeNotification(item.source.key, item.data);
  if (!description) return null;

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

export function NotificationBell({
  config,
}: {
  config: NotificationFeedConfig;
}) {
  const feed = useNotificationFeed(config);
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);

  const showBadge = feed.status !== "error" && feed.unseenCount > 0;

  function onOpenChange(open: boolean) {
    setIsOpen(open);
    if (open) feed.markLoadedAsSeen();
  }

  function openNotification(item: FeedItem, url: string) {
    feed.markAsRead(item);
    setIsOpen(false);
    navigate(url);
  }

  function onScroll(event: React.UIEvent<HTMLDivElement>) {
    const list = event.currentTarget;
    const distanceToEnd =
      list.scrollHeight - list.scrollTop - list.clientHeight;
    if (distanceToEnd < SCROLL_END_THRESHOLD_PX && !feed.isFetchingMore) {
      feed.fetchNextPage();
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            showBadge
              ? `Notifications, ${feed.unseenCount} unseen`
              : "Notifications"
          }
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <span className="relative">
            <Bell className="size-4" />
            {showBadge && (
              <span className="absolute -top-2 -right-2 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
                {feed.unseenCount > 99 ? "99+" : feed.unseenCount}
              </span>
            )}
          </span>
          Notifications
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Notifications</h2>
          {feed.status === "ready" && feed.items.some((i) => !i.read_at) && (
            <button
              type="button"
              onClick={feed.markAllAsRead}
              className="text-xs font-medium text-primary hover:underline"
            >
              Mark all as read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto" onScroll={onScroll}>
          {feed.status === "error" ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Notifications couldn't be loaded. Try again in a moment.
            </p>
          ) : feed.status === "loading" ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : feed.items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              You're all caught up. Nothing new to show.
            </p>
          ) : (
            <ul className="divide-y">
              {feed.items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
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
        </div>
      </PopoverContent>
    </Popover>
  );
}
