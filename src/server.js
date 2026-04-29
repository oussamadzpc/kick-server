import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = "https://pdgglivspfctmzbjpqjm.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || "2107";

// =======================
// 🧠 CACHE
// =======================
let cachedChannels = [];
let liveCache = {};

// =======================
// 🔄 FETCH CHANNELS
// =======================
async function refreshChannels() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/users?approved=eq.true&is_deleted=eq.false`, {
      headers: { apikey: SUPABASE_KEY }
    });

    const data = await r.json();
    cachedChannels = data.map(u => u.channel);

    console.log("✅ Channels:", cachedChannels.length);

  } catch (err) {
    console.log("❌ Channel fetch error");
  }
}

// =======================
// 🔥 LIVE LOOP
// =======================
async function refreshLive() {
  if (!cachedChannels.length) return;

  console.log("🔄 Checking live...");

  for (const channel of cachedChannels) {
    try {
      const res = await fetch(`https://kick.com/api/v2/channels/${channel}`);
      const text = await res.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        liveCache[channel] = false;
        continue;
      }

      const isLive = data?.livestream?.is_live === true;
      liveCache[channel] = isLive;

    } catch {
      liveCache[channel] = false;
    }
  }

  console.log("📡 Live updated");
}

// =======================
// 🔁 LOOPS
// =======================
setInterval(refreshChannels, 30000);
setInterval(refreshLive, 10000);

refreshChannels();
refreshLive();

// =======================
// REGISTER
// =======================
app.post("/user/register", async (req, res) => {
  try {
    const { channel, password } = req.body;

    if (!channel || !password) {
      return res.json({ ok: false, message: "Missing data" });
    }

    let existing = [];

    try {
      const check = await fetch(`${SUPABASE_URL}/rest/v1/users?channel=eq.${channel}`, {
        headers: { apikey: SUPABASE_KEY }
      });

      existing = await check.json();
    } catch (err) {
      return res.json({ ok: false, message: "DB error" });
    }

    if (existing.length > 0) {
      const user = existing[0];

      if (user.is_deleted === true) {
        await fetch(`${SUPABASE_URL}/rest/v1/users?channel=eq.${channel}`, {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            password,
            approved: false,
            is_deleted: false
          })
        });

        return res.json({ ok: true, message: "Re-registered" });
      }

      return res.json({ ok: false, message: "Already exists" });
    }

    await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        channel,
        password,
        approved: false,
        is_deleted: false
      })
    });

    return res.json({ ok: true });

  } catch (err) {
    return res.json({ ok: false, message: "Server error" });
  }
});

// =======================
// SYNC
// =======================
app.get("/sync", async (req, res) => {
  res.json({
    status: "active",
    channels: cachedChannels
  });
});

// =======================
// 🔥 NEW STATUS
// =======================
app.get("/status", (req, res) => {
  res.json(liveCache);
});

// =======================
// CHECK LIVE (SAFE)
// =======================
app.post("/check-live", async (req, res) => {
  try {
    const { channel } = req.body;

    return res.json({
      live: liveCache[channel] || false
    });

  } catch {
    res.json({ live: false });
  }
});

// =======================
// ADMIN (unchanged)
// =======================
app.post("/admin/delete-user", async (req, res) => {
  try {
    const key = req.headers["x-admin-key"];
    if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

    const { id } = req.body;

    await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        approved: false,
        is_deleted: true
      })
    });

    res.json({ ok: true });

  } catch {
    res.json({ ok: false });
  }
});

app.post("/admin/update", async (req, res) => {
  try {
    const key = req.headers["x-admin-key"];
    if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

    const { id, status } = req.body;

    await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        approved: status === "approved"
      })
    });

    res.json({ ok: true });

  } catch {
    res.json({ ok: false });
  }
});

app.post("/admin/block", async (req, res) => {
  try {
    const key = req.headers["x-admin-key"];
    if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

    const { id } = req.body;

    await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        approved: false,
        is_deleted: true
      })
    });

    res.json({ ok: true });

  } catch {
    res.json({ ok: false });
  }
});

// =======================
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
