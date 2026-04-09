import express from "express";
import "dotenv/config";
import runOnce from "./index.js";

const app = express();
const PORT = process.env.PORT || 3000;
const FIVE_MINUTES = 5 * 60 * 1000;

async function triggerPoll() {
  try {
    await runOnce();
  } catch (err) {
    console.error("[ERROR] Scheduled run failed:", err);
  }
}

// Kick off immediately and then every five minutes
triggerPoll();
setInterval(triggerPoll, FIVE_MINUTES);

app.get("/", (req, res) => {
  res.send("EXPA Poller Running");
});

app.get("/health", (req, res) => {
  res.status(200).send("ok");
});


app.listen(PORT, () => {
  console.log(`[INFO] Server listening on port ${PORT}`);
});
