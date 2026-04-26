const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(cors());
app.use(express.json());

// ==========================
// 🔐 Firebase (FIXED SAFE)
// ==========================
let serviceAccount;

try {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is missing");
  }

  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  }

} catch (e) {
  console.error("🔥 Firebase ENV ERROR:", e.message);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ==========================
// 🔐 التحقق من الاشتراك
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
// 🔥 CHECK CHANNEL (FIXED LOGIN)
// ==========================
app.post("/check-channel", async (req, res) => {
  try {
    let { channel } = req.body;

    if (!channel) {
      return res.json({ ok: false });
    }

    channel = channel.trim().toLowerCase();

    // 🚫 blacklist
    const blocked = await db.collection("blacklist").doc(channel).get();
    if (blocked.exists) {
      return res.json({ ok: false, blocked: true });
    }

    const doc = await db.collection("requests").doc(channel).get();

    if (!doc.exists) {
      return res.json({ ok: false, exists: false });
    }

    const data = doc.data();

    if (data.status === "ok") {
      return res.json({ ok: true });
    }

    return res.json({
      ok: false,
      exists: true,
      status: data.status
    });

  } catch (e) {
    console.log("CHECK ERROR:", e);
    res.json({ ok: false });
  }
});

// ==========================
// 🔄 SYNC
// ==========================
app.post("/sync", async (req, res) => {
  try {
    const { userId } = req.body;

    const check = await checkUser(userId);

    if (!check.ok) {
      return res.json({
        status: "blocked",
        channels: []
      });
    }

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

// ==========================
// ➕ ADD CHANNEL
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
      channel: channel,
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
// 🗑 BLOCK
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
// 👤 CREATE USER
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
// ✅ ROOT
// ==========================
app.get("/", (req, res) => {
  res.send("Server working ✅");
});

// ==========================
// 🚀 SERVER START
// ==========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});