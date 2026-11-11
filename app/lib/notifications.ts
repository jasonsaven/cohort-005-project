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
// Adding a kind: add its category, payload schema and sentence to
// `catalogue`, a builder below, and its workflow under knock/workflows/ in the
// same category (notifications.test.ts checks they agree).

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

/**
 * People turn email on or off per category in Settings. Every kind belongs to
 * exactly one. `npm run knock:push` creates them in Knock first.
 */
export const NOTIFICATION_CATEGORIES = ["refunds", "team", "discussions"] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** How a Notification Feed row reads. */
export type NotificationDescription = { text: string; detail?: string };

type FeedRow = NotificationDescription & { url: string };

// Every payload carries `url`, the page the Notification is about.
function kind<Data extends z.ZodObject<{ url: z.ZodString }>>(
  category: NotificationCategory,
  data: Data,
  describe: (data: z.infer<Data>) => NotificationDescription
) {
  return {
    category,
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
    "refunds",
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
    "refunds",
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
    "refunds",
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
    "refunds",
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
  // N4: a Student claimed a Seat on a Team Licence.
  "seat-claimed": kind(
    "team",
    z.object({
      studentName: z.string(),
      courseTitle: z.string(),
      claimedSeats: z.number(),
      totalSeats: z.number(),
      url: z.string(),
    }),
    (data) => ({
      text: `${data.studentName} claimed a Seat on ${data.courseTitle} (${data.claimedSeats} of ${data.totalSeats} Seats claimed)`,
    })
  ),
  // N5: a Student posted a Discussion Question on the Instructor's course.
  "discussion-question-posted": kind(
    "discussions",
    z.object({
      studentName: z.string(),
      lessonTitle: z.string(),
      courseTitle: z.string(),
      url: z.string(),
    }),
    (data) => ({
      text: `${data.studentName} asked a Discussion Question on ${data.lessonTitle} in ${data.courseTitle}`,
    })
  ),
  // N6: someone posted a Discussion Reply. `answered` when the reply is from
  // the course's Instructor or a Platform Admin.
  "discussion-reply-posted": kind(
    "discussions",
    z.object({
      replierName: z.string(),
      lessonTitle: z.string(),
      courseTitle: z.string(),
      answered: z.boolean(),
      url: z.string(),
    }),
    (data) => ({
      text: data.answered
        ? `${data.replierName} answered your Discussion Question on ${data.lessonTitle}`
        : `${data.replierName} replied to your comment on ${data.lessonTitle}`,
    })
  ),
};

export type NotificationKind = keyof typeof catalogue;

export const NOTIFICATION_KINDS = Object.keys(catalogue) as NotificationKind[];

export function notificationCategoryOf(
  kind: NotificationKind
): NotificationCategory {
  return catalogue[kind].category;
}

/** The payload a kind's workflow is triggered with. */
export type NotificationData<Kind extends NotificationKind> = z.infer<
  (typeof catalogue)[Kind]["data"]
>;

type NotificationOf<Kind extends NotificationKind> = {
  kind: Kind;
  recipients: NotificationPerson[];
  actor: NotificationPerson;
  /** Built from the source record, so a retried action doesn't notify twice. */
  idempotencyKey: string;
  data: NotificationData<Kind>;
};

/** One Notification of any kind in the catalogue. */
export type Notification = {
  [Kind in NotificationKind]: NotificationOf<Kind>;
}[NotificationKind];

// ─── Builders ───
// Every builder leaves the actor out of the recipients: nobody is told about
// their own action.

/**
 * The database row a Notification comes from, and when it was written (an ISO
 * timestamp). Ids alone repeat across databases that share one Knock
 * environment (a reseed, another developer's copy), and Knock would drop the
 * later trigger as a duplicate; the time keeps their keys apart.
 */
export type NotificationSource = { id: number; at: string };

function notify<Kind extends NotificationKind>(
  kind: Kind,
  source: NotificationSource,
  actor: NotificationPerson,
  recipients: NotificationPerson[],
  data: NotificationData<Kind>
): NotificationOf<Kind> {
  return {
    kind,
    recipients: recipients.filter((recipient) => recipient.id !== actor.id),
    actor,
    idempotencyKey: `${kind}:${source.id}:${Date.parse(source.at)}`,
    data,
  };
}

/** N1. Goes to every Platform Admin but the buyer. */
export function refundRequestRaised(
  source: NotificationSource,
  buyer: NotificationPerson,
  platformAdmins: NotificationPerson[],
  data: NotificationData<"refund-request-raised">
): NotificationOf<"refund-request-raised"> {
  return notify(
    "refund-request-raised",
    source,
    buyer,
    platformAdmins,
    data
  );
}

/** N2. Goes to the buyer, from the deciding Platform Admin. */
export function refundRequestApproved(
  source: NotificationSource,
  decider: NotificationPerson,
  buyer: NotificationPerson,
  data: NotificationData<"refund-request-approved">
): NotificationOf<"refund-request-approved"> {
  return notify(
    "refund-request-approved",
    source,
    decider,
    [buyer],
    data
  );
}

/** N3. Goes to the buyer, from the deciding Platform Admin. */
export function refundRequestDeclined(
  source: NotificationSource,
  decider: NotificationPerson,
  buyer: NotificationPerson,
  data: NotificationData<"refund-request-declined">
): NotificationOf<"refund-request-declined"> {
  return notify(
    "refund-request-declined",
    source,
    decider,
    [buyer],
    data
  );
}

/** N7. Goes to every Platform Admin but the decider. */
export function refundRequestDecided(
  source: NotificationSource,
  decider: NotificationPerson,
  platformAdmins: NotificationPerson[],
  data: NotificationData<"refund-request-decided">
): NotificationOf<"refund-request-decided"> {
  return notify(
    "refund-request-decided",
    source,
    decider,
    platformAdmins,
    data
  );
}

/** N4. Goes to the Team Licence's Team Admin, unless they claimed the Seat. */
export function seatClaimed(
  source: NotificationSource,
  student: NotificationPerson,
  teamAdmin: NotificationPerson,
  data: NotificationData<"seat-claimed">
): NotificationOf<"seat-claimed"> {
  return notify("seat-claimed", source, student, [teamAdmin], data);
}

/** N5. Goes to the course's Instructor, keyed by the Discussion Question's id. */
export function discussionQuestionPosted(
  source: NotificationSource,
  student: NotificationPerson,
  instructor: NotificationPerson,
  data: NotificationData<"discussion-question-posted">
): NotificationOf<"discussion-question-posted"> {
  return notify(
    "discussion-question-posted",
    source,
    student,
    [instructor],
    data
  );
}

/** N6. Goes to the Discussion Question's author, keyed by the reply's id. */
export function discussionReplyPosted(
  source: NotificationSource,
  replier: NotificationPerson,
  questionAuthor: NotificationPerson,
  data: NotificationData<"discussion-reply-posted">
): NotificationOf<"discussion-reply-posted"> {
  return notify(
    "discussion-reply-posted",
    source,
    replier,
    [questionAuthor],
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
