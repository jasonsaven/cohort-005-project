# Knock workflows

Each Notification kind is one Knock workflow, kept as code in `knock/workflows/<workflow-key>/`. **The repo is the source of truth.** Don't edit workflows in the Knock dashboard. If someone did, run `npm run knock:pull` and commit the result.

## Adding or changing a workflow

1. Create or edit `knock/workflows/<workflow-key>/workflow.json`. The key is the Notification kind (e.g. `refund-request-raised`).
2. Run `npm run knock:validate` to check it against Knock without changing anything.
3. Run `npm run knock:push` to push and commit every workflow to the Development environment.
4. Commit the workflow files with the code that triggers them.

All three scripts need `KNOCK_SERVICE_TOKEN` in `.env`. It's for tooling only, and the app never reads it.

## Categories

Every workflow has exactly one category. People turn email on or off per category in Settings. A workflow can only name a category in Knock's preference category catalog; `npm run knock:push` creates the three below first (see `CATEGORIES` in `scripts/knock-workflows.sh`).

Each kind's category is also set in the `catalogue` in `app/lib/notifications.ts`. `app/lib/notifications.test.ts` checks that the workflows, the catalogue and `CATEGORIES` agree.

| Category      | Notifications                                       |
| ------------- | --------------------------------------------------- |
| `refunds`     | Refund Request raised, approved, declined, decided  |
| `team`        | Seat claimed                                        |
| `discussions` | Discussion Question posted, Discussion Reply posted |

## Channels (Development)

| Channel key   | What                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `in-app`      | The Notification Feed. Every workflow has this step.                                                                                       |
| `knock-email` | Knock's test email provider. It only delivers to members of the Knock account, 100 a month. Check Knock's message log instead of an inbox. |

## Environment variables

Email templates build absolute links from the Knock environment variable `app_url`, for example `<a href="{{ vars.app_url }}{{ data.url }}">`. Knock variables aren't kept as code. Set them by hand in the Knock dashboard's variables settings, once per environment:

| Environment | `app_url`                                                                  |
| ----------- | -------------------------------------------------------------------------- |
| Development | Set to `https://example.com` for now. Links in test emails don't resolve.  |
| Production  | **Must be set** to Cadence's public URL before launch, with no trailing slash. Otherwise every email link is broken. |

## Minimal workflow.json

```json
{
  "name": "Refund Request raised",
  "categories": ["refunds"],
  "steps": [
    {
      "ref": "in_app_feed_1",
      "type": "channel",
      "channel_key": "in-app",
      "template": {
        "markdown_body": "**{{ data.buyerName }}** asked for a refund on {{ data.courseTitle }}",
        "action_url": "{{ data.url }}"
      }
    }
  ]
}
```

Promoting workflows to Production isn't scripted yet.
