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
      const check = await fetch(`${SUPABASE_URL}?channel=eq.${channel}`, {
        headers: { apikey: SUPABASE_KEY }
      });

      existing = await check.json();
    } catch (err) {
      return res.json({ ok: false, message: "DB error" });
    }

    if (existing.length > 0) {
      const user = existing[0];

      // 🔥 إعادة تسجيل المحذوف
      if (user.is_deleted === true) {
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
      }

      return res.json({ ok: false, message: "Already exists" });
    }

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
    return res.json({ ok: false, message: "Server error" });
  }
});

// =======================
// SYNC
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
    res.json({ status: "error", channels: [] });
  }
});

// =======================
// CHECK LIVE
// =======================
app.post("/check-live", async (req, res) => {
  try {
    const { channels } = req.body;

    res.json({
      ok: true,
      live: channels || []
    });

  } catch {
    res.json({ ok: false, live: [] });
  }
});

// =======================
// 🔥 ADMIN: DELETE USER
// =======================
app.post("/admin/delete-user", async (req, res) => {
  try {
    const key = req.headers["x-admin-key"];
    if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

    const { id } = req.body;

    await fetch(`${SUPABASE_URL}?id=eq.${id}`, {
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
// 🔥 ADMIN: UPDATE (approve / reject)
// =======================
app.post("/admin/update", async (req, res) => {
  try {
    const key = req.headers["x-admin-key"];
    if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

    const { id, status } = req.body;

    await fetch(`${SUPABASE_URL}?id=eq.${id}`, {
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

// =======================
// 🔥 ADMIN: BLOCK
// =======================
app.post("/admin/block", async (req, res) => {
  try {
    const key = req.headers["x-admin-key"];
    if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

    const { id } = req.body;

    await fetch(`${SUPABASE_URL}?id=eq.${id}`, {
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
