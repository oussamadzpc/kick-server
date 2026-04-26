require("dotenv").config();

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

// ==========================
// 🔥 Firebase
// ==========================
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
// ✅ CHECK CHANNEL (مهم)
// ==========================
app.post("/check-channel", async (req, res) => {
  try {
    const channel = normalize(req.body.channel);

    if (!channel) return res.json({ ok: false });

    const blocked = await db.collection("blacklist").doc(channel).get();
    if (blocked.exists) {
      return res.json({ blocked: true });
    }

    const snap = await db
      .collection("requests")
      .where("channel", "==", channel)
      .get();

    if (snap.empty) {
      return res.json({ exists: false });
    }

    const data = snap.docs[0].data();

    return res.json({
      exists: true,
      status: data.status
    });

  } catch (e) {
    console.log("CHECK ERROR:", e);
    res.json({ ok: false });
  }
});

// ==========================
// ✅ REGISTER
// ==========================
app.post("/register", async (req, res) => {
  try {
    const channel = normalize(req.body.channel);

    if (!channel) return res.json({ ok: false });

    const blocked = await db.collection("blacklist").doc(channel).get();
    if (blocked.exists) {
      return res.json({ ok: false, blocked: true });
    }

    const snap = await db
      .collection("requests")
      .where("channel", "==", channel)
      .get();

    if (!snap.empty) {
      return res.json({ ok: false, exists: true });
    }

    await db.collection("requests").add({
      channel,
      status: "pending",
      createdAt: Date.now()
    });

    res.json({ ok: true });

  } catch (e) {
    console.log("REGISTER ERROR:", e);
    res.json({ ok: false });
  }
});

// ==========================
// ✅ ROOT
// ==========================
app.get("/", (req, res) => {
  res.send("Server running ✅");
});

// ==========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});