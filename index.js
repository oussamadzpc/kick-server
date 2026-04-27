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
app.post("/sync", async (req, res) => {
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

    channels = [...new Set(channels)];

    res.json({
      status: "active",
      channels
    });

  } catch (e) {
    console.log("SYNC ERROR:", e);
    res.json({ error: e.toString() });
  }
});

app.get("/sync", async (req, res) => {
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

    channels = [...new Set(channels)];

    res.json({
      status: "active",
      channels
    });

  } catch (e) {
    res.json({ error: e.toString() });
  }
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
// 🔴 CHECK LIVE (ULTRA SAFE)
// ==========================
app.post("/check-live", async (req, res) => {
  try {
    let { channel } = req.body;
    if (!channel) return res.json({ live: false });

    channel = channel.trim().toLowerCase();

    // ⏱️ timeout حماية
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let response;
    try {
      response = await fetch(`https://kick.com/api/v2/channels/${channel}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timeout);
      console.log("❌ FETCH FAIL:", e.message);
      return res.json({ live: false });
    }

    clearTimeout(timeout);

    let data;
    try {
      data = await response.json();
    } catch {
      return res.json({ live: false });
    }

    // 🔥 تحقق دقيق جدًا
    const isLive =
      data &&
      typeof data === "object" &&
      data.livestream &&
      data.livestream.is_live === true;

    return res.json({ live: isLive });

  } catch (e) {
    console.log("LIVE ERROR:", e.message);
    return res.json({ live: false });
  }
});

// ==========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});