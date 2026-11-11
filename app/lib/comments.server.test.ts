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

describe("postComment's Notifications", () => {
  it("tells the course's Instructor about a Student's Discussion Question", () => {
    const result = postComment(db, base.user.id, lessonId, null, "Why?");
    if (!result.ok) throw new Error(result.error);

    expect(result.notifications).toEqual([
      {
        kind: "discussion-question-posted",
        recipients: [
          {
            id: base.instructor.id,
            name: "Test Instructor",
            email: "instructor@example.com",
            avatarUrl: null,
          },
        ],
        actor: {
          id: base.user.id,
          name: "Test User",
          email: "test@example.com",
          avatarUrl: null,
        },
        idempotencyKey: `discussion-question-posted:${result.comment.id}`,
        data: {
          studentName: "Test User",
          lessonTitle: "Lesson 1",
          courseTitle: "Test Course",
          url: `/courses/test-course/lessons/${lessonId}`,
        },
      },
    ]);
  });

  it("tells nobody about a top-level comment by the course's Instructor", () => {
    expect(notificationsFor(base.instructor.id, null)).toEqual([]);
  });

  it("tells nobody about a top-level comment by a Platform Admin", () => {
    expect(notificationsFor(addAdmin().id, null)).toEqual([]);
  });

  it("tells a Discussion Question's author about a Discussion Reply", () => {
    const question = post(base.user.id, null, "Why?");
    const classmate = addStudent();

    const result = postComment(db, classmate.id, lessonId, question.id, "Hm.");
    if (!result.ok) throw new Error(result.error);

    expect(result.notifications).toEqual([
      {
        kind: "discussion-reply-posted",
        recipients: [
          {
            id: base.user.id,
            name: "Test User",
            email: "test@example.com",
            avatarUrl: null,
          },
        ],
        actor: {
          id: classmate.id,
          name: "Classmate",
          email: "classmate@example.com",
          avatarUrl: null,
        },
        idempotencyKey: `discussion-reply-posted:${result.comment.id}`,
        data: {
          replierName: "Classmate",
          lessonTitle: "Lesson 1",
          courseTitle: "Test Course",
          answered: false,
          url: `/courses/test-course/lessons/${lessonId}`,
        },
      },
    ]);
  });

  it("says the course's Instructor answered the Discussion Question", () => {
    const question = post(base.user.id, null, "Why?");

    expect(notificationsFor(base.instructor.id, question.id)).toMatchObject([
      { kind: "discussion-reply-posted", data: { answered: true } },
    ]);
  });

  it("says a Platform Admin answered the Discussion Question", () => {
    const question = post(base.user.id, null, "Why?");

    expect(notificationsFor(addAdmin().id, question.id)).toMatchObject([
      { kind: "discussion-reply-posted", data: { answered: true } },
    ]);
  });

  it("tells nobody when you reply to your own Discussion Question", () => {
    const question = post(base.user.id, null, "Why?");

    expect(notificationsFor(base.user.id, question.id)).toEqual([]);
  });
});

function addStudent() {
  return db
    .insert(schema.users)
    .values({
      name: "Classmate",
      email: "classmate@example.com",
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

function addAdmin() {
  return db
    .insert(schema.users)
    .values({
      name: "Test Admin",
      email: "admin@example.com",
      role: schema.UserRole.Admin,
    })
    .returning()
    .get();
}

function notificationsFor(userId: number, parentId: number | null) {
  const result = postComment(db, userId, lessonId, parentId, "Hello");
  if (!result.ok) throw new Error(result.error);
  return result.notifications;
}
