const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(cors());
app.use(express.json());

// ==========================
// 🔐 Firebase
// ==========================
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ==========================
// 🧠 CACHE SYSTEM
// ==========================
let cachedChannels = [];
let lastFetch = 0;

async function refreshCache() {
  try {
    const reqSnap = await db.collection("requests").get();
    const blackSnap = await db.collection("blacklist").get();

    const blacklist = blackSnap.docs.map(d => d.id);

    let channels = [];

    reqSnap.forEach(doc => {
      const data = doc.data();

      if (!data.channel) return;
      if (data.status !== "ok") return;
      if (blacklist.includes(data.channel)) return;

      channels.push(data.channel);
    });

    cachedChannels = [...new Set(channels)];
    lastFetch = Date.now();

    console.log("✅ Cache updated:", cachedChannels.length);

  } catch (e) {
    console.log("CACHE ERROR:", e);
  }
}

// تحديث كل 30 ثانية فقط
setInterval(refreshCache, 30000);
refreshCache();

// ==========================
async function checkUser(userId) {
  const doc = await db.collection("users").doc(userId).get();

  if (!doc.exists) return { ok: false };

  const data = doc.data();

  if (data.plan !== "active") return { ok: false };
  if (Date.now() > data.expiresAt) return { ok: false };

  return { ok: true };
}

// ==========================
app.post("/check-channel", async (req, res) => {
  try {
    let { channel } = req.body;

    if (!channel) return res.json({ exists: false });

    channel = channel.trim().toLowerCase();

    const doc = await db.collection("requests").doc(channel).get();

    res.json({
      exists: doc.exists,
      status: doc.exists ? doc.data().status : null
    });

  } catch {
    res.json({ exists: false });
  }
});

// ==========================
// 🟢 SYNC FROM CACHE
// ==========================
app.post("/sync", async (req, res) => {
  res.json({
    status: "active",
    channels: cachedChannels
  });
});

app.get("/sync", async (req, res) => {
  res.json({
    status: "active",
    channels: cachedChannels
  });
});

// ==========================
app.post("/add-channel", async (req, res) => {
  try {
    let { channel } = req.body;

    if (!channel) return res.json({ ok: false });

    channel = channel.trim().toLowerCase();

    const docRef = await db.collection("requests").doc(channel).get();

    if (docRef.exists) {
      const data = docRef.data();

      return res.json({
        ok: true,
        exists: true,
        status: data.status
      });
    }

    await db.collection("requests").doc(channel).set({
      channel,
      status: "pending",
      createdAt: Date.now()
    });

    return res.json({
      ok: true,
      created: true
    });

  } catch (e) {
    console.log("ADD ERROR:", e);
    return res.json({ ok: false });
  }
});

// ==========================
app.post("/block", async (req, res) => {
  const { channel } = req.body;

  if (!channel) return res.json({ ok: false });

  await db.collection("blacklist").doc(channel).set({
    blockedAt: Date.now()
  });

  await db.collection("requests").doc(channel).delete();

  res.json({ ok: true });
});

// ==========================
app.post("/create-user", async (req, res) => {
  const { userId } = req.body;

  if (!userId) return res.json({ ok: false });

  await db.collection("users").doc(userId).set({
    plan: "active",
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
  });

  res.json({ ok: true });
});

// ==========================
// 🔴 CHECK LIVE (FIXED)
// ==========================
app.post("/check-live", async (req, res) => {
  try {
    let { channel } = req.body;
    if (!channel) return res.json({ live: false });

    channel = channel.trim().toLowerCase();

    const response = await fetch(`https://kick.com/api/v2/channels/${channel}`);

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.json({ live: false });
    }

    const isLive = data?.livestream?.is_live === true;

    return res.json({ live: isLive });

  } catch {
    return res.json({ live: false });
  }
});

// ==========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});