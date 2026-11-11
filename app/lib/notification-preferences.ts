import type {
  PreferenceSet,
  SetPreferencesProperties,
} from "@knocklabs/client";
import { UserRole } from "~/db/schema";
import type { NotificationCategory } from "~/lib/notifications";

export type { NotificationCategory };

// ─── Notification preferences ───
// People turn email on or off per Notification category in Settings. The
// preferences live in Knock; Cadence's database stores none of them.

export function notificationCategoriesFor(person: {
  role: UserRole;
  isTeamAdmin: boolean;
}): NotificationCategory[] {
  const categories: NotificationCategory[] = [];
  if (person.role === UserRole.Admin) categories.push("refunds");
  if (person.isTeamAdmin) categories.push("team");
  categories.push("discussions");
  return categories;
}

/** Email is on unless the person has turned it, or the whole category, off. */
export function isEmailOn(
  preferences: PreferenceSet,
  category: NotificationCategory
): boolean {
  const setting = preferences.categories?.[category];
  if (setting === false) return false;
  if (setting && typeof setting === "object" && "channel_types" in setting) {
    return setting.channel_types.email !== false;
  }
  return true;
}

/**
 * The preference set to save when the person flips a category's email
 * switch. Knock replaces the whole set on save, so everything else is carried
 * over. The Notification Feed can't be turned off, so it's always on.
 */
export function withEmail(
  preferences: PreferenceSet,
  category: NotificationCategory,
  on: boolean
): SetPreferencesProperties {
  return {
    categories: {
      ...preferences.categories,
      [category]: { channel_types: { email: on, in_app_feed: true } },
    },
    workflows: preferences.workflows ?? undefined,
    channel_types: preferences.channel_types ?? undefined,
    channels: preferences.channels ?? undefined,
  };
}
