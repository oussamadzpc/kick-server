import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = "https://pdgglivspfctmzbjpqjm.supabase.co/rest/v1/users";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || "2107";

// =======================
// REGISTER (FIXED 🔥)
// =======================
app.post("/user/register", async (req, res) => {
  try {
    const { channel, password } = req.body;

    if (!channel || !password) {
      return res.json({ ok: false, message: "Missing data" });
    }

    console.log("🔥 Register:", channel);

    let existing = [];

    try {
      const check = await fetch(`${SUPABASE_URL}?channel=eq.${channel}`, {
        headers: { apikey: SUPABASE_KEY }
      });

      existing = await check.json();
    } catch (err) {
      console.log("❌ Fetch error:", err);
      return res.json({ ok: false, message: "DB error" });
    }

    // === EXIST ===
    if (existing.length > 0) {
      const user = existing[0];

      if (user.is_deleted === true) {
        try {
          await fetch(`${SUPABASE_URL}?channel=eq.${channel}`, {
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
        } catch (err) {
          return res.json({ ok: false, message: "Update failed" });
        }
      }

      return res.json({ ok: false, message: "Already exists" });
    }

    // === NEW USER ===
    try {
      await fetch(SUPABASE_URL, {
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
      return res.json({ ok: false, message: "Insert failed" });
    }

  } catch (err) {
    console.log("🔥 ERROR:", err);
    return res.json({ ok: false, message: "Server error" });
  }
});

// =======================
// SYNC (FIXED)
// =======================
app.post("/sync", async (req, res) => {
  try {
    const r = await fetch(`${SUPABASE_URL}?approved=eq.true&is_deleted=eq.false`, {
      headers: { apikey: SUPABASE_KEY }
    });

    const data = await r.json();
    const channels = data.map(u => u.channel);

    res.json({
      status: "active",
      channels
    });

  } catch (err) {
    console.log("❌ Sync error:", err);
    res.json({ status: "error", channels: [] });
  }
});

// =======================
// CHECK LIVE (مهم للإكستنشن)
// =======================
app.post("/check-live", async (req, res) => {
  try {
    const { channels } = req.body;

    if (!channels || !Array.isArray(channels)) {
      return res.json({ ok: false, live: [] });
    }

    // حالياً نرجعهم كما هم (تقدر تطور لاحقاً)
    res.json({
      ok: true,
      live: channels
    });

  } catch (err) {
    console.log("❌ check-live error:", err);
    res.json({ ok: false, live: [] });
  }
});

// =======================
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
