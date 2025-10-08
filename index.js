import fetch from "node-fetch";
import { MongoClient } from "mongodb";
import 'dotenv/config';


const EXPA_URL = "https://gis-api.aiesec.org/graphql";
const TOKEN = process.env.EXPA_TOKEN;
const CHAT_WEBHOOK = process.env.CHAT_WEBHOOK_URL;
const MONGO_URI = process.env.MONGO_URI;

const DB_NAME = "signup";
const COLLECTION_NAME = "signupCollection";
const TARGET_PROGRAMME = 7; //For GV only

let db;
let signupCollection;


async function initMongo() {
  try {
    console.log("[INFO] Connecting to MongoDB...");
    const client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
    await client.connect();
    db = client.db(DB_NAME);
    signupCollection = db.collection(COLLECTION_NAME);

    // Ensure "id" is unique to avoid duplicates
    await signupCollection.createIndex({ id: 1 }, { unique: true });

    console.log(`[INFO] Connected to MongoDB DB="${DB_NAME}" Collection="${COLLECTION_NAME}"`);
  } catch (err) {
    console.error("[FATAL] Failed to connect to MongoDB:", err);
    process.exit(1);
  }
}


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
            first_name
            last_name
            email
            created_at
            updated_at
            status
            is_aiesecer
            gender
            dob
            last_active_at
            contacted_at
            followed_up_at
            employee_created_via
            opportunity_applications_count

            home_mc { id name }
            home_lc { id name }
            organisation_type { id name }

            managers {
              id
              full_name
              email
              profile_photo
            }

            contact_detail {
              phone
              country_code
            }

            person_profile {
              backgrounds { name }
              languages { constant_name }
              skills { constant_name }
              selected_programmes
              nationalities { id name }
            }

            managed_opportunities_count
            managed_opportunities {
              edges {
                node {
                  id
                  title
                  status
                  programmes { short_name_display }
                  host_lc { name }
                  home_mc { name }
                }
              }
            }

            current_experiences { id }

            campaign { id campaign_tag }
            tag_lists { id name }
            follow_up { id name }
            lc_alignment { keywords }
            referral_type
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
    console.error("[ERROR] Request to EXPA failed:", err);
    return [];
  }
}


async function notifyChat(person) {
  const phone = person.contact_detail?.phone || "N/A";
  const dateTime = new Date(person.created_at).toLocaleString("en-GB", {
    timeZone: "Asia/Colombo"
  });

  const message = {
    text: `[EXPA UPDATE][SIGN UP] \n Name: ${person.full_name}\n Phone: ${phone}\n Signed up: ${dateTime}`
  };

  try {
    const res = await fetch(CHAT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });
    console.log(`[INFO] Notified Google Chat for ${person.full_name}. Status:`, res.status);
  } catch (err) {
    console.error("[ERROR] Failed to send to Google Chat:", err);
  }
}


async function pollAndSave() {
  console.log("\n[INFO] Polling EXPA at", new Date().toISOString());
  const signups = await fetchSignups();
  console.log(`[INFO] Retrieved ${signups.length} signups`);

  for (const p of signups) {
    const selected = p?.person_profile?.selected_programmes || [];
    const hasTarget = Array.isArray(selected) && selected.includes(TARGET_PROGRAMME);

    if (!hasTarget) {
      // ✅ Completely ignore
      continue;
    }

    try {
      await signupCollection.insertOne({
        ...p,
        fetched_at: new Date()
      });
      console.log(`[NEW GV SIGNUP] ${p.full_name}`);
      await notifyChat(p);
    } catch (err) {
      if (err.code === 11000) {
        // duplicate key error
        continue;
      } else {
        console.error("[ERROR] Failed to insert signup:", err);
      }
    }
  }
}


(async () => {
  if (!TOKEN || !CHAT_WEBHOOK || !MONGO_URI) {
    console.error("[FATAL] Missing environment variables. Check your .env file.");
    process.exit(1);
  }

  await initMongo();
  console.log("[INFO] Starting EXPA Poller (Programme ID 7 only)...");

  await pollAndSave();
  setInterval(pollAndSave, 28 * 1000);
})();
