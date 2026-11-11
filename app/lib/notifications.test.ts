import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  describeNotification,
  NOTIFICATION_CATEGORIES,
  notificationCategoryOf,
  NOTIFICATION_KINDS,
} from "./notifications";

const lesson = {
  lessonTitle: "Lesson 1",
  courseTitle: "Test Course",
  url: "/courses/test-course/lessons/1",
};

describe("describeNotification", () => {
  it("says a Student asked a Discussion Question", () => {
    expect(
      describeNotification("discussion-question-posted", {
        studentName: "Sam",
        ...lesson,
      })
    ).toEqual({
      text: "Sam asked a Discussion Question on Lesson 1 in Test Course",
      url: "/courses/test-course/lessons/1",
    });
  });

  it("says the course's Instructor answered your Discussion Question", () => {
    expect(
      describeNotification("discussion-reply-posted", {
        replierName: "Ines",
        answered: true,
        ...lesson,
      })
    ).toMatchObject({
      text: "Ines answered your Discussion Question on Lesson 1",
    });
  });

  it("reads nothing from a workflow it doesn't know", () => {
    expect(describeNotification("triggered-by-hand", {})).toBeNull();
  });
});

// The workflows in knock/workflows/ are the other half of the catalogue.
describe("the Knock workflows", () => {
  const workflowsDir = join(process.cwd(), "knock", "workflows");
  const workflowKeys = readdirSync(workflowsDir);

  function categoriesOf(workflowKey: string): unknown {
    const workflow = JSON.parse(
      readFileSync(join(workflowsDir, workflowKey, "workflow.json"), "utf8")
    );
    return workflow.categories;
  }

  it("has one workflow for every Notification kind", () => {
    expect([...workflowKeys].sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });

  it.each(NOTIFICATION_KINDS)("puts %s in its catalogue category", (kind) => {
    expect(categoriesOf(kind)).toEqual([notificationCategoryOf(kind)]);
  });

  it("creates every category the catalogue uses before pushing", () => {
    const script = readFileSync(
      join(process.cwd(), "scripts", "knock-workflows.sh"),
      "utf8"
    );
    const listed = script.match(/^CATEGORIES=\(([^)]*)\)/m)?.[1].split(/\s+/);

    expect(listed?.filter(Boolean).sort()).toEqual(
      [...NOTIFICATION_CATEGORIES].sort()
    );
  });
});
