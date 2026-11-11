import { describe, it, expect } from "vitest";
import { UserRole } from "~/db/schema";
import type { PreferenceSet } from "@knocklabs/client";
import {
  isEmailOn,
  notificationCategoriesFor,
  withEmail,
} from "./notification-preferences";

describe("notificationCategoriesFor", () => {
  it("gives a Student only Discussions", () => {
    expect(
      notificationCategoriesFor({ role: UserRole.Student, isTeamAdmin: false })
    ).toEqual(["discussions"]);
  });

  it("gives a Platform Admin Refunds and Discussions", () => {
    expect(
      notificationCategoriesFor({ role: UserRole.Admin, isTeamAdmin: false })
    ).toEqual(["refunds", "discussions"]);
  });

  it("gives a Team Admin Team and Discussions", () => {
    expect(
      notificationCategoriesFor({ role: UserRole.Student, isTeamAdmin: true })
    ).toEqual(["team", "discussions"]);
  });

  it("gives an Instructor only Discussions", () => {
    expect(
      notificationCategoriesFor({
        role: UserRole.Instructor,
        isTeamAdmin: false,
      })
    ).toEqual(["discussions"]);
  });

  it("gives a Platform Admin who is also a Team Admin all three", () => {
    expect(
      notificationCategoriesFor({ role: UserRole.Admin, isTeamAdmin: true })
    ).toEqual(["refunds", "team", "discussions"]);
  });
});

function preferenceSet(categories: PreferenceSet["categories"]): PreferenceSet {
  return {
    id: "default",
    categories,
    workflows: null,
    channel_types: null,
    channels: null,
  };
}

describe("isEmailOn", () => {
  it("is on when nothing is set", () => {
    expect(isEmailOn(preferenceSet(null), "discussions")).toBe(true);
  });

  it("is off when the category's email channel is off", () => {
    const preferences = preferenceSet({
      discussions: { channel_types: { email: false, in_app_feed: true } },
    });
    expect(isEmailOn(preferences, "discussions")).toBe(false);
    expect(isEmailOn(preferences, "refunds")).toBe(true);
  });

  it("is off when the whole category is off", () => {
    expect(isEmailOn(preferenceSet({ team: false }), "team")).toBe(false);
  });
});

describe("withEmail", () => {
  it("turns email off for one category and keeps the Notification Feed on", () => {
    const update = withEmail(preferenceSet(null), "discussions", false);
    expect(update.categories).toEqual({
      discussions: { channel_types: { email: false, in_app_feed: true } },
    });
  });

  it("leaves the person's other preferences as they were", () => {
    const preferences: PreferenceSet = {
      ...preferenceSet({
        refunds: { channel_types: { email: false, in_app_feed: true } },
      }),
      workflows: { "seat-claimed": true },
    };
    const update = withEmail(preferences, "team", false);
    expect(update.categories).toEqual({
      refunds: { channel_types: { email: false, in_app_feed: true } },
      team: { channel_types: { email: false, in_app_feed: true } },
    });
    expect(update.workflows).toEqual({ "seat-claimed": true });
  });

  it("turns email back on, including for a category that was wholly off", () => {
    const update = withEmail(preferenceSet({ team: false }), "team", true);
    expect(isEmailOn({ ...preferenceSet(null), ...update }, "team")).toBe(true);
    expect(update.categories).toEqual({
      team: { channel_types: { email: true, in_app_feed: true } },
    });
  });
});
