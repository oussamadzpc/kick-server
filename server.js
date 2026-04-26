require("dotenv").config();

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// ✅ public
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY;

// ==========================
// 🔥 Firebase
// ==========================
const serviceAccount = require("./firebase.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

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
// 🏠 الصفحة
// ==========================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ==========================
// 📥 جلب الطلبات
// ==========================
app.get("/admin/requests", checkAdmin, async (req, res) => {
  try {
    const snap = await db.collection("requests").get();

    const list = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================
// ✏️ تحديث الحالة (FIXED)
// ==========================
app.post("/admin/update", checkAdmin, async (req, res) => {
  try {
    let { id, status } = req.body;

    if (!id || !status) {
      return res.json({ ok: false });
    }

    // 🔥 تحويل الحالة لتناسب الإكستنشن
    if (status === "approve") status = "ok";
    if (status === "reject") status = "no";

    await db.collection("requests").doc(id).update({
      status: status
    });

    res.json({ ok: true });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================
// 🚫 BLOCK
// ==========================
app.post("/admin/block", checkAdmin, async (req, res) => {
  try {
    const { id } = req.body;

    await db.collection("blacklist").doc(id).set({
      blockedAt: Date.now()
    });

    await db.collection("requests").doc(id).delete();

    res.json({ ok: true });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================
// 🔍 CHECK CHANNEL (الإكستنشن)
// ==========================
app.post("/check-channel", async (req, res) => {
  try {
    let { channel } = req.body;

    if (!channel) return res.json({ ok: false });

    channel = channel.toLowerCase().trim();

    // blacklist
    const blocked = await db.collection("blacklist").doc(channel).get();
    if (blocked.exists) {
      return res.json({ blocked: true });
    }

    const doc = await db.collection("requests").doc(channel).get();

    if (!doc.exists) {
      return res.json({ exists: false });
    }

    const data = doc.data();

    if (data.status === "ok") {
      return res.json({ ok: true, exists: true });
    }

    return res.json({
      exists: true,
      status: data.status
    });

  } catch (e) {
    res.json({ ok: false });
  }
});

// ==========================
// ➕ ADD CHANNEL
// ==========================
app.post("/add-channel", async (req, res) => {
  try {
    let { channel } = req.body;

    if (!channel) return res.json({ ok: false });

    channel = channel.toLowerCase().trim();

    const doc = await db.collection("requests").doc(channel).get();

    if (doc.exists) {
      return res.json({ ok: true, exists: true });
    }

    await db.collection("requests").doc(channel).set({
      channel: channel,
      status: "pending",
      createdAt: Date.now()
    });

    res.json({ ok: true, created: true });

  } catch (e) {
    res.json({ ok: false });
  }
});

// ==========================
app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});
app.post("/register", async (req, res) => {
  try {
    let { channel } = req.body;

    if (!channel) return res.json({ ok: false });

    channel = channel.toLowerCase().trim();

    const doc = await db.collection("requests").doc(channel).get();

    if (doc.exists) {
      return res.json({ ok: true, exists: true });
    }

    await db.collection("requests").doc(channel).set({
      channel,
      status: "pending",
      createdAt: Date.now()
    });

    res.json({ ok: true, created: true });

  } catch (e) {
    res.json({ ok: false });
  }
});