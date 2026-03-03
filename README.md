# EXPA Notifications Poller

This project is a lightweight Node.js utility that connects AIESEC in Colombo South's EXPA workspace with the LC's Google Chat war rooms. It polls the EXPA GraphQL API for the most recent signups and opportunity applications, stores the payloads in MongoDB for auditing, and pushes channel-specific notifications to Google Chat via incoming webhooks.

## What it does
- **Signups monitor** – pulls the latest people records, filters for Global Volunteer (GV) and Global Talent (GT) programmes, and posts a formatted alert to the relevant Google Chat space.
- **Applications monitor** – fetches recent opportunity applications, categorises them by programme/function and host LC, and routes the alert to the correct chat webhook (oGT, iGT, oGV, iGV).
- **MongoDB persistence** – keeps a deduplicated record of every fetched signup (`signupCollection`) and application (`applicationsCollection`) using the `signup` database, so duplicates are skipped and history is preserved.

## Requirements
- Node.js 18+ (project uses ES modules and top-level await via `type: "module"`).
- Access tokens for the EXPA GraphQL API.
- Google Chat webhook URLs for each programme stream.
- A MongoDB cluster (Atlas or self-hosted).

Install dependencies after cloning:

```bash
npm install
```

## Environment variables
Create a `.env` file (not committed) with the following keys:

```
EXPA_TOKEN=<personal_access_token>
CHAT_WEBHOOK_URL=<google_chat_webhook_for_outgoing_gv>
iGT_CHAT_WEBHOOK=<google_chat_webhook_for_incoming_gt>
iGV_CHAT_WEBHOOK=<google_chat_webhook_for_incoming_gv>
oGT_CHAT_WEBHOOK=<google_chat_webhook_for_outgoing_gt>
MONGO_URI=<mongodb_connection_string>
```

All variables are mandatory; the script exits early if any are missing.

## Running the poller
The script executes a one-off polling cycle for both signups and applications:

```bash
node index.js
```

Expected flow:
1. Connects to MongoDB and ensures unique indexes for `id` on both collections.
2. Calls `PeopleIndexQuery` and `ApplicationIndexQuery` against `https://gis-api.aiesec.org/graphql`.
3. Inserts unseen documents into MongoDB with a `fetched_at` timestamp.
4. Sends programme-specific Google Chat messages containing name, programme, phone/host LC, and the Colombo time the action occurred.

To run this on a schedule (e.g., every 5 minutes), wrap the command with a cron/scheduler (GitHub Actions, Azure Functions, etc.).

## Troubleshooting
- **Mongo connection errors** – verify `MONGO_URI` and network rules; the script exits with `[FATAL]` logs when it cannot reach the cluster.
- **403/401 from EXPA** – refresh the `EXPA_TOKEN`. Tokens are sent via the `authorization` header.
- **Webhook failures** – confirm each Google Chat webhook URL still exists; HTTP status codes are logged for every notification request.

## Extending
- Adjust `GV_PROGRAMME` / `oGT_PROGRAMME` IDs if AIESEC updates programme codes.
- Add more Google Chat channels by expanding the routing logic inside `notifySignup()` or `notifyApplication()`.
- Replace the one-time run with a persistent worker or serverless schedule if near-real-time updates are needed.
