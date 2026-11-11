import { z } from "zod";

// ─── Notifications ───
// The catalogue of Notifications Cadence sends. Each kind is one Knock
// workflow, kept as code in knock/workflows/<kind>/ (see knock/README.md).
//
// Domain functions return the Notifications their action causes next to their
// other results; routes hand them to `sendNotifications` once the database
// write has committed. Nothing here talks to Knock, so the Notification Feed
// in the browser uses the same catalogue to read each row's payload.
//
// Adding a kind: add its payload schema and sentence to `catalogue`, a type
// and builder below, and its workflow under knock/workflows/.

/** Someone a Notification is about or for. Sent to Knock inline on every trigger. */
export type NotificationPerson = {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
};

/**
 * What the browser needs to open the session user's Notification Feed. The
 * token is signed on the server; the signing key never leaves it.
 */
export type NotificationFeedConfig = {
  publicApiKey: string;
  feedChannelId: string;
  userId: string;
  userToken: string;
};

// ─── The catalogue ───

/** How a Notification Feed row reads. */
export type NotificationDescription = { text: string; detail?: string };

type FeedRow = NotificationDescription & { url: string };

// Every payload carries `url`, the page the Notification is about.
function kind<Data extends z.ZodObject<{ url: z.ZodString }>>(
  data: Data,
  describe: (data: z.infer<Data>) => NotificationDescription
) {
  return {
    data,
    read(payload: unknown): FeedRow | null {
      const parsed = data.safeParse(payload);
      if (!parsed.success) return null;
      return { ...describe(parsed.data), url: parsed.data.url };
    },
  };
}

const catalogue = {
  // N1: a buyer raised a Refund Request.
  "refund-request-raised": kind(
    z.object({
      buyerName: z.string(),
      courseTitle: z.string(),
      purchaseKind: z.enum(["individual_purchase", "team_licence"]),
      reason: z.string(),
      url: z.string(),
    }),
    (data) => ({
      text:
        data.purchaseKind === "team_licence"
          ? `${data.buyerName} asked for a refund on a Team Licence for ${data.courseTitle}`
          : `${data.buyerName} asked for a refund on ${data.courseTitle}`,
      detail: data.reason,
    })
  ),

  // N2: the buyer's Refund Request was approved. Feed only: the buyer already
  // gets the decision email from Postmark.
  "refund-request-approved": kind(
    z.object({
      courseTitle: z.string(),
      // What the approval ended. Nothing, for an Individual Purchase whose
      // buyer also holds a Claimed Seat for the course (docs/adr/0004).
      ended: z.enum(["enrollment", "unclaimed_seats", "nothing"]),
      decisionNote: z.string().nullable(),
      url: z.string(),
    }),
    (data) => ({
      text: {
        enrollment: `Your refund on ${data.courseTitle} was approved, and your Enrollment has ended`,
        unclaimed_seats: `Your refund on a Team Licence for ${data.courseTitle} was approved, and its Unclaimed Seats can no longer be claimed`,
        nothing: `Your refund on ${data.courseTitle} was approved`,
      }[data.ended],
      detail: data.decisionNote ?? undefined,
    })
  ),

  // N3: the buyer's Refund Request was declined. Feed only, like N2.
  "refund-request-declined": kind(
    z.object({
      courseTitle: z.string(),
      decisionNote: z.string(),
      url: z.string(),
    }),
    (data) => ({
      text: `Your refund on ${data.courseTitle} was declined. You can raise a new Refund Request`,
      detail: data.decisionNote,
    })
  ),

  // N7: another Platform Admin decided a Refund Request.
  "refund-request-decided": kind(
    z.object({
      deciderName: z.string(),
      decision: z.enum(["approved", "declined"]),
      buyerName: z.string(),
      courseTitle: z.string(),
      url: z.string(),
    }),
    (data) => ({
      text: `${data.deciderName} ${data.decision} ${data.buyerName}'s refund on ${data.courseTitle}`,
    })
  ),
};

export type NotificationKind = keyof typeof catalogue;

type DataOf<Kind extends NotificationKind> = z.infer<
  (typeof catalogue)[Kind]["data"]
>;

type NotificationOf<Kind extends NotificationKind> = {
  kind: Kind;
  recipients: NotificationPerson[];
  actor: NotificationPerson;
  /** Built from the source record, so a retried action doesn't notify twice. */
  idempotencyKey: string;
  data: DataOf<Kind>;
};

export type RefundRequestRaised = NotificationOf<"refund-request-raised">;

export type RefundRequestApproved = NotificationOf<"refund-request-approved">;
export type RefundRequestDeclined = NotificationOf<"refund-request-declined">;
export type RefundRequestDecided = NotificationOf<"refund-request-decided">;

export type Notification =
  | RefundRequestRaised
  | RefundRequestApproved
  | RefundRequestDeclined
  | RefundRequestDecided;

// ─── Builders ───
// Every builder leaves the actor out of the recipients: nobody is told about
// their own action.

function notify<Kind extends NotificationKind>(
  kind: Kind,
  sourceId: number,
  actor: NotificationPerson,
  recipients: NotificationPerson[],
  data: DataOf<Kind>
): NotificationOf<Kind> {
  return {
    kind,
    recipients: recipients.filter((recipient) => recipient.id !== actor.id),
    actor,
    idempotencyKey: `${kind}:${sourceId}`,
    data,
  };
}

/** N1. Goes to every Platform Admin but the buyer. */
export function refundRequestRaised(
  refundRequestId: number,
  buyer: NotificationPerson,
  platformAdmins: NotificationPerson[],
  data: DataOf<"refund-request-raised">
): RefundRequestRaised {
  return notify(
    "refund-request-raised",
    refundRequestId,
    buyer,
    platformAdmins,
    data
  );
}

/** N2. Goes to the buyer, from the deciding Platform Admin. */
export function refundRequestApproved(
  refundRequestId: number,
  decider: NotificationPerson,
  buyer: NotificationPerson,
  data: DataOf<"refund-request-approved">
): RefundRequestApproved {
  return notify(
    "refund-request-approved",
    refundRequestId,
    decider,
    [buyer],
    data
  );
}

/** N3. Goes to the buyer, from the deciding Platform Admin. */
export function refundRequestDeclined(
  refundRequestId: number,
  decider: NotificationPerson,
  buyer: NotificationPerson,
  data: DataOf<"refund-request-declined">
): RefundRequestDeclined {
  return notify(
    "refund-request-declined",
    refundRequestId,
    decider,
    [buyer],
    data
  );
}

/** N7. Goes to every Platform Admin but the decider. */
export function refundRequestDecided(
  refundRequestId: number,
  decider: NotificationPerson,
  platformAdmins: NotificationPerson[],
  data: DataOf<"refund-request-decided">
): RefundRequestDecided {
  return notify(
    "refund-request-decided",
    refundRequestId,
    decider,
    platformAdmins,
    data
  );
}

/** Drops Notifications nobody would receive (e.g. the actor was the only recipient). */
export function withRecipients(notifications: Notification[]): Notification[] {
  return notifications.filter((n) => n.recipients.length > 0);
}

// ─── Reading a row of the Notification Feed ───

function isKind(key: string): key is NotificationKind {
  return Object.hasOwn(catalogue, key);
}

/**
 * The sentence and link for a Notification Feed row, read from the workflow
 * key and payload Knock hands back. Null when the payload isn't one we know,
 * e.g. a workflow triggered by hand from the Knock dashboard.
 */
export function describeNotification(
  workflowKey: string,
  data: unknown
): FeedRow | null {
  return isKind(workflowKey) ? catalogue[workflowKey].read(data) : null;
}
