require("dotenv").config();

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// ==========================
// 📂 public folder
app.use(express.static(path.join(__dirname, "public")));

// ==========================
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "super_secret_admin_123";

// ==========================
// 🔥 تحميل firebase
const serviceAccount = require("./firebase.json");

// 🔥 إصلاح private_key (مهم جداً)
if (serviceAccount.private_key) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ==========================
function normalize(channel) {
  return (channel || "").toLowerCase().trim();
}

// ==========================
// ✅ REGISTER
app.post("/register", async (req, res) => {
  try {
    const channel = normalize(req.body.channel);

    if (!channel) {
      return res.json({ ok: false });
    }

    // 🚫 check blacklist
    const blockedDoc = await db.collection("blacklist").doc(channel).get();
    if (blockedDoc.exists) {
      return res.json({ ok: false, blocked: true });
    }

    // 🔍 check existing
    const snapshot = await db
      .collection("requests")
      .where("channel", "==", channel)
      .get();

    if (!snapshot.empty) {
      return res.json({ ok: false, exists: true });
    }

    // ➕ add request
    await db.collection("requests").add({
      channel,
      status: "pending",
      createdAt: Date.now()
    });

    return res.json({ ok: true });

  } catch (err) {
    console.error("🔥 REGISTER ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ==========================
// 📊 ADMIN REQUESTS
app.get("/admin/requests", async (req, res) => {
  try {
    const key = req.headers["x-admin-key"];
    if (key !== ADMIN_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const snapshot = await db.collection("requests").get();

    const data = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(data);

  } catch (err) {
    console.error("🔥 ADMIN ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// 🔄 UPDATE STATUS
app.post("/admin/update", async (req, res) => {
  try {
    const key = req.headers["x-admin-key"];
    if (key !== ADMIN_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id, status } = req.body;

    await db.collection("requests").doc(id).update({ status });

    res.json({ ok: true });

  } catch (err) {
    console.error("🔥 UPDATE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// 🚫 BLOCK USER
app.post("/admin/block", async (req, res) => {
  try {
    const key = req.headers["x-admin-key"];
    if (key !== ADMIN_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { channel } = req.body;
    const name = normalize(channel);

    // ➕ add to blacklist
    await db.collection("blacklist").doc(name).set({
      channel: name,
      blockedAt: Date.now()
    });

    // ❌ حذف من requests
    const snapshot = await db
      .collection("requests")
      .where("channel", "==", name)
      .get();

    for (const doc of snapshot.docs) {
      await doc.ref.delete();
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("🔥 BLOCK ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// ✅ ROOT FIX (هذا اللي كان ناقص عندك)
app.get("/", (req, res) => {
  res.send("Server running ✅");
});

// ==========================
app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});