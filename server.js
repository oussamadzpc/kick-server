require("dotenv").config();

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// ==========================
app.use(express.static(path.join(__dirname, "public")));

// ==========================
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "super_secret_admin_123";

// ==========================
// 🔥 Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

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
// ✅ CHECK CHANNEL (جديد)
app.post("/check-channel", async (req, res) => {
  try {
    const channel = normalize(req.body.channel);

    if (!channel) {
      return res.json({ ok: false });
    }

    // 🚫 block check
    const blockedDoc = await db.collection("blacklist").doc(channel).get();
    if (blockedDoc.exists) {
      return res.json({ blocked: true });
    }

    // 🔍 request check
    const doc = await db.collection("requests").doc(channel).get();

    if (!doc.exists) {
      return res.json({ exists: false });
    }

    const data = doc.data();

    return res.json({
      exists: true,
      status: data.status || "pending"
    });

  } catch (err) {
    console.error("CHECK ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// ✅ REGISTER
app.post("/register", async (req, res) => {
  try {
    const channel = normalize(req.body.channel);

    if (!channel) {
      return res.json({ ok: false });
    }

    const blockedDoc = await db.collection("blacklist").doc(channel).get();
    if (blockedDoc.exists) {
      return res.json({ ok: false, blocked: true });
    }

    const doc = await db.collection("requests").doc(channel).get();

    if (doc.exists) {
      return res.json({ ok: false, exists: true });
    }

    await db.collection("requests").doc(channel).set({
      channel,
      status: "pending",
      createdAt: Date.now()
    });

    return res.json({ ok: true });

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ error: err.message });
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
    console.error("ADMIN ERROR:", err);
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
    console.error("UPDATE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// 🚫 BLOCK
app.post("/admin/block", async (req, res) => {
  try {
    const key = req.headers["x-admin-key"];
    if (key !== ADMIN_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { channel } = req.body;
    const name = normalize(channel);

    await db.collection("blacklist").doc(name).set({
      channel: name,
      blockedAt: Date.now()
    });

    await db.collection("requests").doc(name).delete();

    res.json({ ok: true });

  } catch (err) {
    console.error("BLOCK ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
app.get("/", (req, res) => {
  res.send("Server running ✅");
});

// ==========================
app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});
