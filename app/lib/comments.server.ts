import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import type { Db } from "~/lib/refunds.server";

// ─── Comments ───
// Posting a comment on a lesson: a Discussion Question, or a Discussion Reply
// to one. See GLOSSARY.md for the language. Takes the database first, so tests
// can hand in an in-memory one.

type Comment = typeof comments.$inferSelect;

export type PostCommentResult =
  { ok: true; comment: Comment } | { ok: false; error: string };

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
      .select({ id: lessons.id })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .innerJoin(courses, eq(modules.courseId, courses.id))
      .where(eq(lessons.id, lessonId))
      .get();
    if (!lesson) {
      return { ok: false, error: "Lesson not found" };
    }

    if (parentId !== null) {
      const parent = tx
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

    return { ok: true, comment };
  });
}
