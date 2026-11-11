import { eq } from "drizzle-orm";
import {
  comments,
  courses,
  lessons,
  modules,
  users,
  UserRole,
} from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import {
  discussionQuestionPosted,
  discussionReplyPosted,
  withRecipients,
  type Notification,
  type NotificationPerson,
} from "~/lib/notifications";
import type { Db } from "~/lib/refunds.server";

// ─── Comments ───
// Posting a comment on a lesson: a Discussion Question, or a Discussion Reply
// to one. See GLOSSARY.md for the language. Takes the database first, so tests
// can hand in an in-memory one.

type Comment = typeof comments.$inferSelect;
type User = typeof users.$inferSelect;

export type PostCommentResult =
  | { ok: true; comment: Comment; notifications: Notification[] }
  | { ok: false; error: string };

function toPerson(user: User): NotificationPerson {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
}

export function postComment(
  db: Db,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string
): PostCommentResult {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    return { ok: false, error: "Comment cannot be empty" };
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      error: `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`,
    };
  }

  return db.transaction((tx): PostCommentResult => {
    const lesson = tx
      .select({
        id: lessons.id,
        title: lessons.title,
        courseTitle: courses.title,
        courseSlug: courses.slug,
        instructorId: courses.instructorId,
      })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .innerJoin(courses, eq(modules.courseId, courses.id))
      .where(eq(lessons.id, lessonId))
      .get();
    if (!lesson) {
      return { ok: false, error: "Lesson not found" };
    }

    let parent: Comment | undefined;
    if (parentId !== null) {
      parent = tx
        .select()
        .from(comments)
        .where(eq(comments.id, parentId))
        .get();
      if (!parent) {
        return { ok: false, error: "Parent comment not found" };
      }
      if (parent.lessonId !== lessonId) {
        return {
          ok: false,
          error: "Parent comment belongs to a different lesson",
        };
      }
      if (parent.parentId !== null) {
        return { ok: false, error: "Replies can only be one level deep" };
      }
    }

    const comment = tx
      .insert(comments)
      .values({ userId, lessonId, parentId, body: trimmed })
      .returning()
      .get();

    const getUser = (id: number) =>
      tx.select().from(users).where(eq(users.id, id)).get();
    const author = getUser(userId);
    const url = `/courses/${lesson.courseSlug}/lessons/${lesson.id}`;
    // Staff are the course's Instructor and Platform Admins. Their top-level
    // comments aren't Discussion Questions, and their replies are answers.
    const isStaff = (user: User) =>
      user.role === UserRole.Admin || user.id === lesson.instructorId;

    const notifications: Notification[] = [];
    if (author && !parent && !isStaff(author)) {
      const instructor = getUser(lesson.instructorId);
      if (instructor) {
        notifications.push(
          discussionQuestionPosted(
            comment.id,
            toPerson(author),
            toPerson(instructor),
            {
              studentName: author.name,
              lessonTitle: lesson.title,
              courseTitle: lesson.courseTitle,
              url,
            }
          )
        );
      }
    }
    if (author && parent) {
      const questionAuthor = getUser(parent.userId);
      if (questionAuthor) {
        notifications.push(
          discussionReplyPosted(
            comment.id,
            toPerson(author),
            toPerson(questionAuthor),
            {
              replierName: author.name,
              lessonTitle: lesson.title,
              courseTitle: lesson.courseTitle,
              answered: isStaff(author),
              url,
            }
          )
        );
      }
    }

    return { ok: true, comment, notifications: withRecipients(notifications) };
  });
}
