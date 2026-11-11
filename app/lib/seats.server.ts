import { and, eq } from "drizzle-orm";
import { coupons, courses, enrollments, purchases } from "~/db/schema";
import type { Db, Queryable } from "~/db/types";
import { getSeatAvailability } from "~/lib/refunds.server";
import { getUser, toPerson } from "~/lib/users.server";
import {
  seatClaimed,
  withRecipients,
  type Notification,
} from "~/lib/notifications";

// ─── Seats ───
// A Student claiming a Seat on a Team Licence. See GLOSSARY.md for the
// language. Takes the database first, so tests can hand in an in-memory one.

export const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";
export const SEAT_REFUNDED =
  "This seat is no longer available. Ask the person who shared it with you.";

const TEAM_PAGE_URL = "/team";

/**
 * Whether this person is a Team Admin: they bought a Team Licence, the
 * Purchase that granted Seats. The same person N4 (`seat-claimed`) goes to.
 */
export function isTeamAdmin(db: Queryable, userId: number): boolean {
  const seat = db
    .select({ id: coupons.id })
    .from(coupons)
    .innerJoin(purchases, eq(coupons.purchaseId, purchases.id))
    .where(eq(purchases.userId, userId))
    .get();
  return seat !== undefined;
}

export type ClaimSeatResult =
  | {
      ok: true;
      enrollment: typeof enrollments.$inferSelect;
      notifications: Notification[];
    }
  | { ok: false; error: string };

/**
 * Claims the Seat with this code for a Student, giving them an Enrollment.
 * `userCountry` is where the Student is now, or null if that isn't known; a
 * Seat bought with a country price can only be claimed from that country.
 */
export function claimSeat(
  db: Db,
  code: string,
  userId: number,
  userCountry: string | null,
  now: Date
): ClaimSeatResult {
  return db.transaction((tx): ClaimSeatResult => {
    const seat = tx.select().from(coupons).where(eq(coupons.code, code)).get();
    if (!seat) {
      return { ok: false, error: "Seat not found" };
    }

    if (seat.redeemedByUserId !== null) {
      return { ok: false, error: "This Seat has already been claimed" };
    }

    const availability = getSeatAvailability(tx, seat);
    if (availability === "on_hold") {
      return { ok: false, error: SEAT_ON_HOLD };
    }
    if (availability === "refunded") {
      return { ok: false, error: SEAT_REFUNDED };
    }

    const existingEnrollment = tx
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, userId),
          eq(enrollments.courseId, seat.courseId)
        )
      )
      .get();
    if (existingEnrollment) {
      return { ok: false, error: "You are already enrolled in this course" };
    }

    const purchase = tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, seat.purchaseId))
      .get();
    if (purchase?.country && purchase.country !== userCountry) {
      return {
        ok: false,
        error: "This Seat can only be claimed from the country it was bought in",
      };
    }

    tx.update(coupons)
      .set({ redeemedByUserId: userId, redeemedAt: now.toISOString() })
      .where(eq(coupons.id, seat.id))
      .run();

    const enrollment = tx
      .insert(enrollments)
      .values({ userId, courseId: seat.courseId })
      .returning()
      .get();

    // Counted after the claim, so the Team Admin reads "n of m" as it now is.
    const licenceSeats = tx
      .select({ redeemedByUserId: coupons.redeemedByUserId })
      .from(coupons)
      .where(eq(coupons.purchaseId, seat.purchaseId))
      .all();
    const student = getUser(tx, userId);
    const teamAdmin = purchase ? getUser(tx, purchase.userId) : undefined;
    const course = tx
      .select()
      .from(courses)
      .where(eq(courses.id, seat.courseId))
      .get();

    const notifications =
      student && teamAdmin && course
        ? withRecipients([
            seatClaimed(
              { id: seat.id, at: seat.createdAt },
              toPerson(student),
              toPerson(teamAdmin),
              {
                studentName: student.name,
                courseTitle: course.title,
                claimedSeats: licenceSeats.filter(
                  (s) => s.redeemedByUserId !== null
                ).length,
                totalSeats: licenceSeats.length,
                url: TEAM_PAGE_URL,
              }
            ),
          ])
        : [];

    return { ok: true, enrollment, notifications };
  });
}
