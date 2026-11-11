import { useEffect, useRef, useState } from "react";
import Knock, { type PreferenceSet } from "@knocklabs/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import type { NotificationFeedConfig } from "~/lib/notifications";
import {
  isEmailOn,
  withEmail,
  type NotificationCategory,
} from "~/lib/notification-preferences";
import { cn } from "~/lib/utils";

// ─── Notification preferences in Settings ───
// Reads and writes the person's preferences straight from Knock with their
// signed user token. Knock being unreachable only breaks this card.

const CATEGORY_LABELS: Record<
  NotificationCategory,
  { title: string; description: string }
> = {
  refunds: {
    title: "Refunds",
    description: "When a buyer asks for a refund.",
  },
  team: {
    title: "Team",
    description: "When a Student claims a Seat on your Team Licence.",
  },
  discussions: {
    title: "Discussions",
    description: "New Discussion Questions and replies to yours.",
  },
};

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; preferences: PreferenceSet };

export function NotificationPreferencesCard({
  config,
  categories,
}: {
  config: NotificationFeedConfig;
  categories: NotificationCategory[];
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const knockRef = useRef<Knock | null>(null);
  const { publicApiKey, userId, userToken } = config;

  useEffect(() => {
    const knock = new Knock(publicApiKey);
    knock.authenticate({ id: userId }, userToken, {
      identificationStrategy: "skip",
    });
    knockRef.current = knock;
    let cancelled = false;
    setState({ status: "loading" });

    knock.user
      .getPreferences()
      .then((preferences) => {
        if (!cancelled) setState({ status: "ready", preferences });
      })
      .catch((error) => {
        console.error("[notifications] Could not load preferences", error);
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
      knockRef.current = null;
      knock.logout();
    };
  }, [publicApiKey, userId, userToken]);

  async function setEmail(category: NotificationCategory, on: boolean) {
    const knock = knockRef.current;
    if (!knock || state.status !== "ready") return;
    const previous = state.preferences;
    const update = withEmail(previous, category, on);
    // Show the new state straight away; roll back if Knock refuses it.
    setState({
      status: "ready",
      preferences: { ...previous, categories: update.categories ?? null },
    });
    try {
      const saved = await knock.user.setPreferences(update);
      setState({ status: "ready", preferences: saved });
    } catch (error) {
      console.error("[notifications] Could not save preferences", error);
      setState({ status: "ready", preferences: previous });
      toast.error("Couldn't save your notification settings. Try again.");
    }
  }

  return (
    <Card className="mt-8 max-w-md">
      <CardHeader>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Choose which Notifications we also email you. They always appear in
          your Notification Feed.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.status === "loading" && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {state.status === "error" && (
          <p className="text-sm text-destructive">
            We couldn't load your notification settings. Try again later.
          </p>
        )}
        {state.status === "ready" &&
          categories.map((category) => {
            const label = CATEGORY_LABELS[category];
            const on = isEmailOn(state.preferences, category);
            const id = `notification-email-${category}`;
            return (
              <div
                key={category}
                className="flex items-center justify-between gap-4"
              >
                <div>
                  <p id={id} className="text-sm font-medium">
                    {label.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {label.description}
                  </p>
                </div>
                <EmailSwitch
                  labelledBy={id}
                  on={on}
                  onChange={(next) => void setEmail(category, next)}
                />
              </div>
            );
          })}
      </CardContent>
    </Card>
  );
}

function EmailSwitch({
  labelledBy,
  on,
  onChange,
}: {
  labelledBy: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-xs text-muted-foreground">Email</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelledBy}
        onClick={() => onChange(!on)}
        className={cn(
          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          on ? "bg-primary" : "bg-input"
        )}
      >
        <span
          className={cn(
            "inline-block size-4 rounded-full bg-background shadow transition-transform",
            on ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}
