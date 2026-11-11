import { afterEach, describe, expect, it, vi } from "vitest";
import type { Notification } from "./notifications";
import {
  identifyNotificationUser,
  recordingTransport,
  sendNotifications,
  type NotificationTransport,
} from "./notifications.server";

const pat = { id: 3, name: "Pat Admin", email: "pat@example.com", avatarUrl: null };
const liam = { id: 7, name: "Liam", email: "liam@example.com", avatarUrl: null };

function raised(refundRequestId: number): Notification {
  return {
    kind: "refund-request-raised",
    recipients: [pat],
    actor: liam,
    idempotencyKey: `refund-request-raised:${refundRequestId}`,
    data: {
      buyerName: "Liam",
      courseTitle: "Test Course",
      purchaseKind: "individual_purchase",
      reason: "Not for me.",
      url: "/admin/refunds",
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendNotifications", () => {
  it("hands every Notification to the transport", async () => {
    const transport = recordingTransport();

    await sendNotifications([raised(1), raised(2)], transport);

    expect(transport.sent).toEqual([raised(1), raised(2)]);
  });

  it("logs a transport failure instead of throwing, so the action still succeeds", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: NotificationTransport = {
      async send() {
        throw new Error("Knock is down");
      },
      async identify() {},
    };

    await expect(
      sendNotifications([raised(1)], failing)
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});

describe("identifyNotificationUser", () => {
  it("hands the person to the transport, so Knock knows them before Settings reads their preferences", async () => {
    const transport = recordingTransport();

    await identifyNotificationUser(liam, transport);

    expect(transport.identified).toEqual([liam]);
  });

  it("logs a transport failure instead of throwing, so Settings still loads", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: NotificationTransport = {
      async send() {},
      async identify() {
        throw new Error("Knock is down");
      },
    };

    await expect(
      identifyNotificationUser(liam, failing)
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
