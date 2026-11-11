import { Knock, signUserToken } from "@knocklabs/node";
import type {
  Notification,
  NotificationFeedConfig,
  NotificationPerson,
} from "~/lib/notifications";

// ─── Sending Notifications ───
// Knock delivers every Notification when KNOCK_API_KEY is set. Without it
// (a fresh clone, local dev) each one is logged instead, and the bell is
// hidden. Tests hand in a recording transport. Follows the mailer's pattern.

export interface NotificationTransport {
  send(notifications: Notification[]): Promise<void>;
  /** Creates or updates the person in Knock. */
  identify(person: NotificationPerson): Promise<void>;
}

// A Knock user id is the Cadence user id as a string. Recipients and the
// actor are sent inline, so Knock upserts them and no separate sync is needed.
function toKnockUser(person: NotificationPerson) {
  return {
    id: String(person.id),
    name: person.name,
    email: person.email,
    avatar: person.avatarUrl,
  };
}

export function knockTransport(apiKey: string): NotificationTransport {
  const knock = new Knock({ apiKey });

  return {
    async send(notifications) {
      // One failed trigger shouldn't stop the others going out.
      const results = await Promise.allSettled(
        notifications.map((notification) =>
          knock.workflows.trigger(
            notification.kind,
            {
              recipients: notification.recipients.map(toKnockUser),
              actor: toKnockUser(notification.actor),
              data: notification.data,
            },
            { idempotencyKey: notification.idempotencyKey }
          )
        )
      );

      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : []
      );
      if (failures.length > 0) {
        throw new AggregateError(failures, "Knock rejected a Notification");
      }
    },
    async identify(person) {
      const { id, ...properties } = toKnockUser(person);
      await knock.users.update(id, properties);
    },
  };
}

export function loggingTransport(): NotificationTransport {
  return {
    async send(notifications) {
      for (const notification of notifications) {
        console.log(
          `[notifications] ${notification.kind} → ${notification.recipients
            .map((r) => r.id)
            .join(", ")}`,
          notification.data
        );
      }
    },
    async identify() {},
  };
}

export function recordingTransport(): NotificationTransport & {
  sent: Notification[];
  identified: NotificationPerson[];
} {
  const sent: Notification[] = [];
  const identified: NotificationPerson[] = [];
  return {
    sent,
    identified,
    async send(notifications) {
      sent.push(...notifications);
    },
    async identify(person) {
      identified.push(person);
    },
  };
}

function defaultTransport(): NotificationTransport {
  const apiKey = process.env.KNOCK_API_KEY;
  return apiKey ? knockTransport(apiKey) : loggingTransport();
}

/**
 * Sends Notifications best-effort. Call it after the database write commits.
 * A failure is logged and swallowed: Knock being down must never undo or
 * block the action that caused the Notification.
 */
export async function sendNotifications(
  notifications: Notification[],
  transport: NotificationTransport = defaultTransport()
): Promise<void> {
  if (notifications.length === 0) return;

  try {
    await transport.send(notifications);
  } catch (error) {
    console.error("[notifications] Could not send Notifications", error);
  }
}

/**
 * Makes sure Knock knows this person. Triggers create recipients inline, but
 * someone who has never been sent a Notification doesn't exist in Knock yet,
 * and the browser (which skips identifying) can't read their preferences.
 * Best-effort like `sendNotifications`: a failure is logged, and the
 * preferences card shows its own error.
 */
export async function identifyNotificationUser(
  person: NotificationPerson,
  transport: NotificationTransport = defaultTransport()
): Promise<void> {
  try {
    await transport.identify(person);
  } catch (error) {
    console.error("[notifications] Could not identify a Knock user", error);
  }
}

// ─── The Notification Feed's credentials ───

// The `in-app` channel's id in the Knock account. Channels are shared by
// every Knock environment, so this isn't a secret or per-environment value.
const IN_APP_FEED_CHANNEL_ID = "8e8e8a59-dc80-42f7-91e4-1e1b0a1e827e";

const USER_TOKEN_LIFETIME_SECONDS = 60 * 60;

/**
 * Signs a short-lived RS256 token for the session user so the browser can
 * read only their own Notification Feed. The signing key stays on the server.
 * Returns null when Knock isn't configured, which hides the bell.
 */
export async function getNotificationFeedConfig(
  userId: number
): Promise<NotificationFeedConfig | null> {
  const apiKey = process.env.KNOCK_API_KEY;
  const publicApiKey = process.env.KNOCK_PUBLIC_API_KEY;
  const signingKey = process.env.KNOCK_SIGNING_KEY;
  if (!apiKey || !publicApiKey || !signingKey) return null;

  try {
    const userToken = await signUserToken(String(userId), {
      signingKey,
      expiresInSeconds: USER_TOKEN_LIFETIME_SECONDS,
    });
    return {
      publicApiKey,
      feedChannelId:
        process.env.KNOCK_FEED_CHANNEL_ID ?? IN_APP_FEED_CHANNEL_ID,
      userId: String(userId),
      userToken,
    };
  } catch (error) {
    console.error("[notifications] Could not sign a Knock user token", error);
    return null;
  }
}
