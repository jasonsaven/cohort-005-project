import { eq } from "drizzle-orm";
import { users, UserRole } from "~/db/schema";
import type { Queryable } from "~/db/types";
import type { NotificationPerson } from "~/lib/notifications";

// ─── People ───
// Looking up the people a domain action concerns, and how they appear on a
// Notification.

type User = typeof users.$inferSelect;

export function getUser(db: Queryable, userId: number): User | undefined {
  return db.select().from(users).where(eq(users.id, userId)).get();
}

export function toPerson(user: User): NotificationPerson {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
}

/** Every Platform Admin, worked out from our users table each time. */
export function getPlatformAdmins(db: Queryable): NotificationPerson[] {
  return db
    .select()
    .from(users)
    .where(eq(users.role, UserRole.Admin))
    .all()
    .map(toPerson);
}
