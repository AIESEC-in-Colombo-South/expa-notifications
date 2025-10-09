import fetch from "node-fetch";
import { MongoClient } from "mongodb";
import 'dotenv/config';

const EXPA_URL = "https://gis-api.aiesec.org/graphql";
const TOKEN = process.env.EXPA_TOKEN;
const CHAT_WEBHOOK = process.env.CHAT_WEBHOOK_URL;
const iGT_WEBHOOK = process.env.iGT_CHAT_WEBHOOK;
const MONGO_URI = process.env.MONGO_URI;
const iGV_WEBHOOK = process.env.iGV_CHAT_WEBHOOK
const oGT_WEBHOOK = process.env.oGT_CHAT_WEBHOOK

const DB_NAME = "signup";
const SIGNUP_COLLECTION = "signupCollection";
const APPLICATION_COLLECTION = "applicationsCollection";
const TARGET_PROGRAMME = 7; // GV only
const oGT_PROGRAMME  = 8;

let db;
let signupCollection;
let applicationCollection;

// =============================
// MongoDB Initialization
// =============================
async function initMongo() {
  try {
    console.log("[INFO] Connecting to MongoDB...");
    const client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
    await client.connect();
    db = client.db(DB_NAME);

    signupCollection = db.collection(SIGNUP_COLLECTION);
    await signupCollection.createIndex({ id: 1 }, { unique: true });

    applicationCollection = db.collection(APPLICATION_COLLECTION);
    await applicationCollection.createIndex({ id: 1 }, { unique: true });

    console.log(`[INFO] Connected to MongoDB DB="${DB_NAME}" Collections: "${SIGNUP_COLLECTION}", "${APPLICATION_COLLECTION}"`);
  } catch (err) {
    console.error("[FATAL] Failed to connect to MongoDB:", err);
    process.exit(1);
  }
}

// =============================
// Signups Poller
// =============================
async function fetchSignups() {
  const body = {
    operationName: "PeopleIndexQuery",
    variables: {
      page: 1,
      perPage: 20,
      filters: {},
      q: ""
    },
    query: `
      query PeopleIndexQuery($page: Int, $perPage: Int, $filters: PeopleFilter, $q: String) {
        allPeople(page: $page, per_page: $perPage, filters: $filters, q: $q) {
          data {
            id
            full_name
            created_at
            person_profile { selected_programmes }
            contact_detail { phone country_code }
          }
        }
      }
    `
  };

  try {
    const res = await fetch(EXPA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "authorization": TOKEN
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.error("[ERROR] EXPA API returned status", res.status);
      return [];
    }

    const data = await res.json();
    return data?.data?.allPeople?.data || [];
  } catch (err) {
    console.error("[ERROR] Request to EXPA (Signups) failed:", err);
    return [];
  }
}

async function notifySignup(person) {
  const phone = person.contact_detail?.phone || "N/A";
  const dateTime = new Date(person.created_at).toLocaleString("en-GB", {
    timeZone: "Asia/Colombo"
  });

  const message = {
    text: `[EXPA UPDATE][SIGN UP]\nName: ${person.full_name}\nPhone: ${phone}\nSigned up: ${dateTime}`
  };

  try {
    const res = await fetch(CHAT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });
    console.log(`[INFO] Notified Google Chat for signup ${person.full_name}. Status:`, res.status);
  } catch (err) {
    console.error("[ERROR] Failed to send signup notification:", err);
  }
}

async function pollAndSaveSignups() {
  console.log("\n[INFO] Polling EXPA Signups at", new Date().toISOString());
  const signups = await fetchSignups();
  console.log(`[INFO] Retrieved ${signups.length} signups`);

  for (const p of signups) {
    const selected = p?.person_profile?.selected_programmes || [];
    const hasTarget = Array.isArray(selected) && selected.includes(TARGET_PROGRAMME);

    if (!hasTarget) continue; // Ignore non-GV

    try {
      await signupCollection.insertOne({
        ...p,
        fetched_at: new Date()
      });
      console.log(`[NEW GV SIGNUP] ${p.full_name}`);
      await notifySignup(p);
    } catch (err) {
      if (err.code === 11000) {
        continue; // duplicate
      } else {
        console.error("[ERROR] Failed to insert signup:", err);
      }
    }
  }
}

// =============================
// Applications Poller
// =============================
async function fetchApplications() {
  const body = {
    operationName: "ApplicationIndexQuery",
    variables: {
      page: 1,
      per_page: 30,
      filters: {},
      q: "",
      applicant_name: true,
      host_mc: true,
      host_lc: true,
      home_mc: false,
      home_lc: true,
      applied_at: true,   
      opportunity: true   
    },
    query: `
      query ApplicationIndexQuery(
        $applicant_name: Boolean!,
        $host_mc: Boolean!,
        $host_lc: Boolean!,
        $home_mc: Boolean!,
        $home_lc: Boolean!,
        $applied_at: Boolean!,
        $opportunity: Boolean!,
        $page: Int,
        $per_page: Int,
        $filters: ApplicationFilter,
        $q: String
      ) {
        allOpportunityApplication(
          page: $page,
          per_page: $per_page,
          q: $q,
          filters: $filters
        ) {
          data {
            id
            created_at @include(if: $applied_at)

            person {
              id
              full_name @include(if: $applicant_name)
              email
              home_lc @include(if: $home_lc) { name }
              home_mc @include(if: $home_mc) { name }
            }

            opportunity {
              id
              title @include(if: $opportunity)
              host_lc @include(if: $host_lc) { name }
              home_mc @include(if: $host_mc) { name }

              # 👇 NEW: Add programme + programmes
              programme {
                id
                short_name_display
              }
              programmes {
                id
                short_name_display
              }
            }
          }
        }
      }
    `
  };

  try {
    const res = await fetch(EXPA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "authorization": TOKEN
      },
      body: JSON.stringify(body)
    });

    const text = await res.text();
    console.log("[DEBUG][Applications] Raw response:", text);

    if (!res.ok) {
      console.error("[ERROR] EXPA Applications API returned status", res.status);
      return [];
    }

    const data = JSON.parse(text);
    return data?.data?.allOpportunityApplication?.data || [];
  } catch (err) {
    console.error("[ERROR] Request to EXPA Applications failed:", err);
    return [];
  }
}



async function notifyApplication(app) {
  const personName = app.person?.full_name || "Unknown";
  const oppTitle = app.opportunity?.title || "N/A";
  const oppFunc = app.opportunity?.programme?.short_name_display;
  const dateTime = new Date(app.created_at).toLocaleString("en-GB", { timeZone: "Asia/Colombo" });
  const host = app?.opportunity?.host_lc?.name;

  const message = {
    text: `[EXPA UPDATE][APPLICATION]\nName: ${personName}\nFunction: ${oppFunc}\nOppotunity: ${oppTitle}\nApplied at: ${dateTime}`
  };

  try {
    var res;
    if ((oppFunc == "GTe" || oppFunc == "GTa") && host == "COLOMBO SOUTH"){
           res = await fetch(iGT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });
    }
    if ((oppFunc == "GTe" || oppFunc == "GTa") && host != "COLOMBO SOUTH"){
      res = await fetch(oGT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });
    }
    if (oppFunc == "GV" && host != "COLOMBO SOUTH"){
           res = await fetch(CHAT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });
    }
    if (oppFunc == "GV" && host == "COLOMBO SOUTH"){
           res = await fetch(iGV_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });
    }
    console.log(`[INFO] Notified Google Chat for application ${personName}. Status:`, res.status);
  } catch (err) {
    console.error("[ERROR] Failed to send application notification:", err);
  }
}

async function pollAndSaveApplications() {
  console.log("\n[INFO] Polling EXPA Applications at", new Date().toISOString());
  const apps = await fetchApplications();
  console.log(`[INFO] Retrieved ${apps.length} applications`);

  for (const app of apps) {
    try {
      await applicationCollection.insertOne({
        ...app,
        fetched_at: new Date()
      });
      console.log(`[NEW APPLICATION] ${app.person?.full_name}`);
      await notifyApplication(app);
    } catch (err) {
      if (err.code === 11000) {
        continue; // already seen
      } else {
        console.error("[ERROR] Failed to insert application:", err);
      }
    }
  }
}

// =============================
// Main
// =============================
(async () => {
  if (!TOKEN || !CHAT_WEBHOOK || !MONGO_URI) {
    console.error("[FATAL] Missing environment variables. Check your .env file.");
    process.exit(1);
  }

  await initMongo();
  console.log("[INFO] Running one-time EXPA Poller (Signups + Applications)");

  await pollAndSaveSignups();
  await pollAndSaveApplications();

  console.log("[INFO] Poll complete. Exiting...");
  process.exit(0);
})();
