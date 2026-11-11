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
  // N4: a Student claimed a Seat on a Team Licence.
  "seat-claimed": kind(
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
    z.object({
      studentName: z.string(),
      lessonTitle: z.string(),
      courseTitle: z.string(),
      url: z.string(),
    }),
    (data) => ({
      text: `${data.studentName} asked a Question on ${data.lessonTitle} in ${data.courseTitle}`,
    })
  ),
  // N6: someone posted a Discussion Reply. `answered` when the reply is from
  // staff (the course's Instructor or a Platform Admin).
  "discussion-reply-posted": kind(
    z.object({
      replierName: z.string(),
      lessonTitle: z.string(),
      courseTitle: z.string(),
      answered: z.boolean(),
      url: z.string(),
    }),
    (data) => ({
      text: data.answered
        ? `${data.replierName} answered your Question on ${data.lessonTitle}`
        : `${data.replierName} replied to your comment on ${data.lessonTitle}`,
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

export type SeatClaimed = NotificationOf<"seat-claimed">;

export type DiscussionQuestionPosted =
  NotificationOf<"discussion-question-posted">;

export type DiscussionReplyPosted = NotificationOf<"discussion-reply-posted">;

export type Notification =
  | RefundRequestRaised
  | SeatClaimed
  | DiscussionQuestionPosted
  | DiscussionReplyPosted;

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

/** N4. Goes to the Team Licence's Team Admin, unless they claimed the Seat. */
export function seatClaimed(
  seatId: number,
  student: NotificationPerson,
  teamAdmin: NotificationPerson,
  data: DataOf<"seat-claimed">
): SeatClaimed {
  return notify("seat-claimed", seatId, student, [teamAdmin], data);
}

/** N5. Goes to the course's Instructor, keyed by the Discussion Question's id. */
export function discussionQuestionPosted(
  commentId: number,
  student: NotificationPerson,
  instructor: NotificationPerson,
  data: DataOf<"discussion-question-posted">
): DiscussionQuestionPosted {
  return notify(
    "discussion-question-posted",
    commentId,
    student,
    [instructor],
    data
  );
}

/** N6. Goes to the Discussion Question's author, keyed by the reply's id. */
export function discussionReplyPosted(
  commentId: number,
  replier: NotificationPerson,
  questionAuthor: NotificationPerson,
  data: DataOf<"discussion-reply-posted">
): DiscussionReplyPosted {
  return notify(
    "discussion-reply-posted",
    commentId,
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
