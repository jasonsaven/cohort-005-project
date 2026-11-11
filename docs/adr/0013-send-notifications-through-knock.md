# Send Notifications through Knock

Cadence delivers its Notifications through one hosted vendor, Knock, and builds the Notification Feed UI itself on Knock's headless feed API. Knock is the only vendor whose free plan (10K messages a month) meets every requirement: signed RS256 user tokens our server issues for whichever user is in the session, so the DevUI switcher keeps working; vendor-stored preferences by category × channel; a mature headless feed API with unread/unseen counts and seen/read/archived state; and a Node SDK for triggering.

## Considered Options

- **Courier.** The runner-up. Scoped, expiring user tokens, topic × channel preferences, and pay-as-you-go pricing at $0.005 per send with no jump to a fixed paid plan. Rejected because Knock meets the brief as well and has the stronger feed API. Web push would need FCM or OneSignal here too.
- **MagicBell.** Handles web push natively (VAPID), with no Firebase. Rejected because its free plan allows only 1K deliveries a month and the next plan is $249/mo. Web push is an opt-in extra channel, so it should not decide the vendor.
- **Novu Cloud.** Has the cheapest paid plan. Rejected because its feed auth is a static HMAC of the subscriber id that never expires, and its preferences cover workflow × channel only, with no categories.
- **SuprSend.** Handles web push natively. Rejected because vendor-stored preferences aren't on its free plan, and category preferences need the $250/mo Business plan.
- **Self-hosting, or building our own delivery.** Ruled out of scope from the start.

## Consequences

- If web push is offered, it goes through Firebase Cloud Messaging. That means a Firebase project, the Firebase SDK and a service worker. We only take that on if web push is actually built.
- Above 10K messages a month, the cheapest plan is $250/mo plus $0.005 per message. Cadence's Notification volume is nowhere near that today.
- Knock's user tokens, preferences model and feed API run through the whole feature. Switching vendors later means rewriting the triggering, the Notification Feed's data layer and preference storage.
