require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// static
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY;

// 🔥 Supabase config
const SUPABASE_URL = "https://pdgglivspfctmzbjpqjm.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// ==========================
// 🔐 Admin حماية
// ==========================
function checkAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];

  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  next();
}

// ==========================
// 🏠 الصفحة الرئيسية (🔥 التعديل هنا فقط)
// ==========================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ==========================
// 📥 جلب الطلبات (users غير المقبولين)
// ==========================
app.get("/admin/requests", checkAdmin, async (req, res) => {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/users?approved=eq.false`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    const data = await response.json();
    res.json(data);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================
// 🆕 جلب جميع المستخدمين
// ==========================
app.get("/admin/all-users", checkAdmin, async (req, res) => {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/users`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    const data = await response.json();
    res.json(data);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================
// ✏️ تحديث الحالة
// ==========================
app.post("/admin/update", checkAdmin, async (req, res) => {
  try {
    const { id, status } = req.body;

    if (!id || !status) {
      return res.json({ ok: false });
    }

    if (status === "approved") {
      await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({ approved: true })
      });

    } else if (status === "rejected") {
      await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${id}`, {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      });
    }

    res.json({ ok: true });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================
// 🚫 بلوك
// ==========================
app.post("/admin/block", checkAdmin, async (req, res) => {
  try {
    const { id } = req.body;

    await fetch(`${SUPABASE_URL}/rest/v1/blacklist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({
        id,
        blockedAt: Date.now()
      })
    });

    await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${id}`, {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    });

    res.json({ ok: true });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================
// 🔥 USER REGISTER
// ==========================
app.post("/user/register", async (req, res) => {
  try {
    const { channel, password } = req.body;

    if (!channel || !password) {
      return res.json({ ok: false, message: "Missing data" });
    }

    const check = await fetch(
      `${SUPABASE_URL}/rest/v1/users?channel=eq.${channel}`,
      {
        headers: {
          apikey: SUPABASE_KEY
        }
      }
    );

    const existing = await check.json();

    if (existing.length) {
      return res.json({ ok: false, message: "Channel exists" });
    }

    await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({
        channel,
        password,
        approved: false
      })
    });

    res.json({ ok: true });

  } catch (e) {
    res.json({ ok: false, message: "Server error" });
  }
});

// ==========================
// 🔐 حفظ سؤال الأمان
// ==========================
app.post("/user/security", async (req, res) => {
  try {
    const { channel, question, answer } = req.body;

    if (!channel || !question || !answer) {
      return res.json({ ok: false });
    }

    await fetch(`${SUPABASE_URL}/rest/v1/users?channel=eq.${channel}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({
        security_question: question,
        security_answer: answer
      })
    });

    res.json({ ok: true });

  } catch (e) {
    res.json({ ok: false });
  }
});

// ==========================
app.listen(PORT, () => {
  console.log("🚀 Server Running on port " + PORT);
});
