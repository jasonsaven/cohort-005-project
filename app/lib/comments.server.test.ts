import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { postComment } from "./comments.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  lessonId = addLesson(1);
});

function addLesson(position: number) {
  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position })
    .returning()
    .get();
  return db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: `Lesson ${position}`, position })
    .returning()
    .get().id;
}

function post(
  userId: number,
  parentId: number | null,
  body: string,
  onLessonId = lessonId
) {
  const result = postComment(db, userId, onLessonId, parentId, body);
  if (!result.ok) throw new Error(result.error);
  return result.comment;
}

describe("postComment", () => {
  it("creates a top-level comment with the trimmed body", () => {
    const result = postComment(db, base.user.id, lessonId, null, "  Why?  ");

    expect(result).toMatchObject({
      ok: true,
      comment: {
        userId: base.user.id,
        lessonId,
        parentId: null,
        body: "Why?",
      },
    });
  });

  it("creates a reply to a top-level comment on the same lesson", () => {
    const question = post(base.user.id, null, "Why?");

    const result = postComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because."
    );

    expect(result).toMatchObject({
      ok: true,
      comment: { userId: base.instructor.id, lessonId, parentId: question.id },
    });
  });

  it("refuses an empty comment", () => {
    expect(postComment(db, base.user.id, lessonId, null, "   ")).toEqual({
      ok: false,
      error: "Comment cannot be empty",
    });
  });

  it("refuses a comment longer than the limit", () => {
    expect(
      postComment(db, base.user.id, lessonId, null, "a".repeat(5001))
    ).toEqual({
      ok: false,
      error: "Comment must be 5000 characters or fewer",
    });
  });

  it("accepts a comment exactly at the limit", () => {
    expect(
      postComment(db, base.user.id, lessonId, null, "a".repeat(5000))
    ).toMatchObject({ ok: true });
  });

  it("refuses a comment on a lesson that doesn't exist", () => {
    expect(postComment(db, base.user.id, 9999, null, "Hello")).toEqual({
      ok: false,
      error: "Lesson not found",
    });
  });

  it("refuses a reply to a comment that doesn't exist", () => {
    expect(postComment(db, base.user.id, lessonId, 9999, "Hello")).toEqual({
      ok: false,
      error: "Parent comment not found",
    });
  });

  it("refuses a reply to a comment on a different lesson", () => {
    const otherLessonId = addLesson(2);
    const question = post(base.user.id, null, "Why?", otherLessonId);

    expect(
      postComment(db, base.instructor.id, lessonId, question.id, "Because.")
    ).toEqual({
      ok: false,
      error: "Parent comment belongs to a different lesson",
    });
  });

  it("refuses a reply to a reply", () => {
    const question = post(base.user.id, null, "Why?");
    const reply = post(base.instructor.id, question.id, "Because.");

    expect(
      postComment(db, base.user.id, lessonId, reply.id, "Thanks!")
    ).toEqual({
      ok: false,
      error: "Replies can only be one level deep",
    });
  });
});
