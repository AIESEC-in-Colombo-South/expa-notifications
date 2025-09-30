import fetch from "node-fetch";

// ========================
// CONFIGURATION
// ========================
const EXPA_URL = "https://gis-api.aiesec.org/graphql";
const TOKEN = "CT2tvj5RfWFH_97s1wYm5-psKYhr_avH-OGHYPrWCzA";
const CHAT_WEBHOOK = "https://chat.googleapis.com/v1/spaces/AAQACcxWsdM/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=BZyCLvXxJFCjNd1EDUqU_7sD-Beh7MfedZZNjDGdabI"; // from step 1

let lastSeen = new Date("2000-01-01").toISOString();

// ========================
// FUNCTIONS
// ========================
async function checkSignups() {
  console.log("\n[INFO] Polling EXPA at", new Date().toISOString());

  const body = {
    operationName: "PeopleIndexQuery",
    variables: {
      page: 1,
      perPage: 10,
      filters: {},
      q: ""
    },
    query: `query PeopleIndexQuery($page: Int, $perPage: Int, $filters: PeopleFilter, $q: String) {
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
        paging {
          total_items
          current_page
          total_pages
        }
      }
    }`
  };

  let res;
  try {
    res = await fetch(EXPA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "authorization": TOKEN
      },
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error("[ERROR] Request to EXPA failed:", err);
    return;
  }

  console.log("[INFO] EXPA response status:", res.status);

  let data;
  try {
    data = await res.json();
  } catch (err) {
    const txt = await res.text();
    console.error("[ERROR] Failed to parse EXPA response. Raw:", txt);
    return;
  }

  const people = data?.data?.allPeople?.data || [];
  console.log(`[INFO] Records retrieved: ${people.length}`);

  for (const p of people) {
    if (new Date(p.created_at) > new Date(lastSeen)) {
      console.log(`[NEW SIGNUP] ${p.full_name} (${p.email || "no email"})`);
      await notifyChat(p);
    }
  }

  if (people.length > 0) {
    lastSeen = people[0].created_at;
    console.log("[INFO] Updated lastSeen to", lastSeen);
  }
}

async function notifyChat(person) {
  const message = {
    text: `New EXPA Signup\nName: ${person.full_name}\nPhone: ${person.contact_detail?.phone || "N/A"}\nSigned up: ${person.created_at}`
  };

  try {
    const res = await fetch(CHAT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });
    console.log("[INFO] Notification sent to Google Chat. Status:", res.status);
  } catch (err) {
    console.error("[ERROR] Failed to send to Google Chat:", err);
  }
}

async function testChat() {
  console.log("[INFO] Sending test message to Google Chat...");
  const message = { text: "Test message from EXPA signup notifier." };
  const res = await fetch(CHAT_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message)
  });
  console.log("[INFO] Test message sent. Status:", res.status);
}

// ========================
// STARTUP
// ========================
(async () => {
  await testChat();
  await checkSignups();
  setInterval(checkSignups, 60 * 1000);
})();
