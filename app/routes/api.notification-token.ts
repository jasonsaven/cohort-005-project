import { data } from "react-router";
import type { Route } from "./+types/api.notification-token";
import { getCurrentUserId } from "~/lib/session";
import { getNotificationFeedConfig } from "~/lib/notifications.server";

// A fresh Knock user token for the session user. The Notification Feed asks
// for one shortly before its current token expires, so a tab left open keeps
// working without a page reload.
export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  const config = await getNotificationFeedConfig(currentUserId);
  if (!config) throw data("Notifications are not set up.", { status: 404 });

  return { userId: config.userId, userToken: config.userToken };
}
