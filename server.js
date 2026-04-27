require("dotenv").config();

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// ✅ مهم: ربط مجلد public
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
// 🔐 حماية الأدمن
// ==========================
function checkAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];

  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  next();
}

// ==========================
// 🏠 الصفحة الرئيسية (حل مشكلة Cannot GET /)
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
// ✏️ تحديث الحالة
// ==========================
app.post("/admin/update", checkAdmin, async (req, res) => {
  try {
    const { id, status } = req.body;

    if (!id || !status) {
      return res.json({ ok: false });
    }

    await db.collection("requests").doc(id).update({
      status: status
    });

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
app.listen(PORT, () => {
  console.log("🚀 Admin Panel Running on port " + PORT);
});