import { eq } from "drizzle-orm";
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundStatus, UserRole } from "~/db/schema";
import { claimSeat } from "./seats.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let teamAdmin: typeof schema.users.$inferSelect;
let student: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  teamAdmin = addUser("Tess");
  student = addUser("Sam");
});

function addUser(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

function buySeats(seats: number, country: string | null = null) {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId: teamAdmin.id,
      courseId: base.course.id,
      amountPaid: 7900 * seats,
      country,
    })
    .returning()
    .get();
  const seatRows = Array.from({ length: seats }, (_, i) =>
    db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );
  return { purchase, seats: seatRows };
}

function addRefundRequest(purchaseId: number, status: RefundStatus) {
  db.insert(schema.refunds)
    .values({
      purchaseId,
      status,
      reason: "Changed our plans.",
      requestedAt: NOW.toISOString(),
    })
    .run();
}

describe("claimSeat", () => {
  it("enrolls the Student in the course", () => {
    const { seats } = buySeats(2);

    const result = claimSeat(db, seats[0].code, student.id, "", NOW);

    expect(result).toMatchObject({
      ok: true,
      enrollment: { userId: student.id, courseId: base.course.id },
    });
  });

  it("refuses a code that isn't a Seat", () => {
    expect(claimSeat(db, "NO-SUCH-CODE", student.id, "", NOW)).toEqual({
      ok: false,
      error: "Coupon not found",
    });
  });

  it("refuses a Seat that is already claimed", () => {
    const { seats } = buySeats(2);
    const other = addUser("Olive");
    claimSeat(db, seats[0].code, other.id, "", NOW);

    expect(claimSeat(db, seats[0].code, student.id, "", NOW)).toEqual({
      ok: false,
      error: "Coupon has already been redeemed",
    });
  });

  it("refuses a Seat while its Team Licence has an Open Refund Request", () => {
    const { purchase, seats } = buySeats(2);
    addRefundRequest(purchase.id, RefundStatus.Open);

    expect(claimSeat(db, seats[0].code, student.id, "", NOW)).toEqual({
      ok: false,
      error:
        "This seat can't be claimed right now. Ask the person who shared it with you.",
    });
  });

  it("refuses a Seat once its Team Licence is refunded", () => {
    const { purchase, seats } = buySeats(2);
    addRefundRequest(purchase.id, RefundStatus.Approved);
    db.update(schema.coupons)
      .set({ refundedAt: NOW.toISOString() })
      .where(eq(schema.coupons.purchaseId, purchase.id))
      .run();

    expect(claimSeat(db, seats[0].code, student.id, "", NOW)).toEqual({
      ok: false,
      error:
        "This seat is no longer available. Ask the person who shared it with you.",
    });
  });

  it("refuses a Student who is already enrolled in the course", () => {
    const { seats } = buySeats(2);
    claimSeat(db, seats[0].code, student.id, "", NOW);

    expect(claimSeat(db, seats[1].code, student.id, "", NOW)).toEqual({
      ok: false,
      error: "You are already enrolled in this course",
    });
  });

  it("refuses a Student in a different country from the buyer", () => {
    const { seats } = buySeats(2, "IN");

    expect(claimSeat(db, seats[0].code, student.id, "US", NOW)).toEqual({
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    });
  });

  it("lets a Student in the buyer's country claim the Seat", () => {
    const { seats } = buySeats(2, "IN");

    expect(claimSeat(db, seats[0].code, student.id, "IN", NOW)).toMatchObject({
      ok: true,
    });
  });

  it("leaves the Seat unclaimed when the claim is refused", () => {
    const { seats } = buySeats(2, "IN");
    claimSeat(db, seats[0].code, student.id, "US", NOW);

    expect(claimSeat(db, seats[0].code, student.id, "IN", NOW)).toMatchObject({
      ok: true,
    });
  });
});

describe("claimSeat Notifications", () => {
  it("tells the Team Admin who claimed a Seat, with the Seats claimed after the claim", () => {
    const { seats } = buySeats(5);
    claimSeat(db, seats[0].code, addUser("Ann").id, "", NOW);
    claimSeat(db, seats[1].code, addUser("Ben").id, "", NOW);

    const result = claimSeat(db, seats[2].code, student.id, "", NOW);

    expect(result).toMatchObject({
      ok: true,
      notifications: [
        {
          kind: "seat-claimed",
          recipients: [{ id: teamAdmin.id, name: "Tess" }],
          actor: { id: student.id, name: "Sam" },
          idempotencyKey: `seat-claimed:${seats[2].id}`,
          data: {
            studentName: "Sam",
            courseTitle: base.course.title,
            claimedSeats: 3,
            totalSeats: 5,
            url: "/team",
          },
        },
      ],
    });
  });

  it("sends nothing when the Team Admin claims a Seat themselves", () => {
    const { seats } = buySeats(2);

    const result = claimSeat(db, seats[0].code, teamAdmin.id, "", NOW);

    expect(result).toMatchObject({ ok: true, notifications: [] });
  });

  it("sends nothing when the claim fails", () => {
    const { seats } = buySeats(1);
    claimSeat(db, seats[0].code, addUser("Ann").id, "", NOW);

    const result = claimSeat(db, seats[0].code, student.id, "", NOW);

    expect(result).toEqual({
      ok: false,
      error: "Coupon has already been redeemed",
    });
  });

  it("builds the same idempotency key for the same Seat", () => {
    const { seats } = buySeats(1);
    const first = claimSeat(db, seats[0].code, student.id, "", NOW);
    db.update(schema.coupons)
      .set({ redeemedByUserId: null, redeemedAt: null })
      .where(eq(schema.coupons.id, seats[0].id))
      .run();
    db.delete(schema.enrollments).run();

    const second = claimSeat(db, seats[0].code, student.id, "", NOW);

    expect(first.ok && first.notifications[0].idempotencyKey).toBe(
      `seat-claimed:${seats[0].id}`
    );
    expect(second.ok && second.notifications[0].idempotencyKey).toBe(
      `seat-claimed:${seats[0].id}`
    );
  });
});
