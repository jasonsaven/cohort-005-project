import type Knock from "@knocklabs/client";
import { z } from "zod";

// ─── Signing the browser in to Knock ───
// The Notification Feed and the preferences card each open their own Knock
// client with the session user's signed token. The token lasts an hour, so
// both swap it for a fresh one shortly before it runs out.

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

/**
 * Signs this Knock client in as the session user, refreshing the token before
 * it expires. The token only seeds the connection, so callers don't need to
 * reconnect when the layout hands them a newer one.
 */
export function authenticateKnock(
  knock: Knock,
  userId: string,
  userToken: string
) {
  knock.authenticate({ id: userId }, userToken, {
    // Our server identifies users inline when it triggers a workflow.
    identificationStrategy: "skip",
    onUserTokenExpiring: () => fetchFreshToken(userId),
    timeBeforeExpirationInMs: REFRESH_BEFORE_EXPIRY_MS,
  });
}
