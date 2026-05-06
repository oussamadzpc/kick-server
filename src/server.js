console.log("🚨 generateComments CALLED for:", channel);
import fetch from "node-fetch";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = "https://pdgglivspfctmzbjpqjm.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
console.log("🔑 SUPABASE KEY:", SUPABASE_KEY ? "OK" : "MISSING");
const ADMIN_KEY = process.env.ADMIN_KEY || "2107";
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// =======================
if (!SUPABASE_KEY) {
  console.log("❌ Missing SUPABASE_KEY");
}

// =======================
let vipChannels = new Set();

let verificationMode = {
  active: false,
  channels: []
};

// =======================
let cachedChannels = [];
let liveCache = {};

// 🔥 NEW STATE MEMORY
let stateMemory = {};

let commentPool = {};
let channelContext = {};
// 🔥 COMMENT MEMORY (FIX)
let commentHistory = {};

function isDuplicate(channel, text) {
  if (!commentHistory[channel]) {
    commentHistory[channel] = [];
  }

  const history = commentHistory[channel];

  if (history.includes(text)) return true;

  history.push(text);

  if (history.length > 40) {
    history.shift();
  }

  return false;
}

const POOL_SIZE = 30;
const REFILL_THRESHOLD = 10;
const AI_COOLDOWN = 10000;

// 🔥 NEW THRESHOLDS
const LIVE_CONFIRM = 2;
const OFFLINE_CONFIRM = 5;

// =======================
function normalize(str) {
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .normalize("NFKC");
} 
// =======================
// 🔥 NEW: GET CHANNEL SETTINGS FROM SUPABASE
async function getChannelSettings(channel) {
  try {
    const clean = normalize(channel);

    const r = await fetch(
  `${SUPABASE_URL}/rest/v1/users?select=channel,language,dialect,persona`,
  { headers: getHeaders() }
);

    const data = await r.json();
console.log("📦 USERS FROM SUPABASE:", data);

    if (!data || !data.length) return {};

    const found = data.find(u => normalize(u.channel) === clean);

    if (!found) {
      console.log("❌ No match in DB for:", channel);
      return {};
    }

    return found;

  } catch (err) {
    console.log("❌ settings fetch error:", err.message);
    return {};
  }
}
// =======================
// 🔥 HTML LIVE CHECK (ULTRA FIX)
async function checkLiveFromHTML(channel) {
  try {
    const res = await fetch(`https://kick.com/${channel}`);
    const html = await res.text();

    if (
      html.includes('"isLive":true') ||
      html.includes('"is_live":true')
    ) {
      return true;
    }

    return false;

  } catch (err) {
    return null;
  }
}

// =======================
function safeParseComments(text) {
  try {
    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(x => x.text)
      .filter(t => typeof t === "string" && t.length > 1 && t.length < 80);

  } catch (err) {
    console.log("❌ parse error:", err.message);
    return [];
  }
}

// =======================
function fallbackComments() {
  return [
    "nice 🔥","gg","wow","clean",
    "lol 😂","crazy play","no way",
    "insane","🔥🔥🔥","!points","!shop"
  ];
}

// =======================
async function generateComments(channel) {
  try {
    if (!GROQ_API_KEY) return fallbackComments();

    const ctx = channelContext[channel] || {};
    const title = ctx.title || "fun stream";
    const chat = (ctx.chatSample || []).slice(0, 8);

    const settings = await getChannelSettings(channel);

if (!settings || !settings.language) {
  console.log("⚠️ No settings found for channel:", channel);
  return fallbackComments();
}
    const language = settings.language || "any";
    const dialect = settings.dialect || "none";
    const persona = settings.persona || "normal";

    const chatExamples = chat.length
      ? chat.map(x => "- " + x).join("\n")
      : "- gg\n- nice\n- lol 😂";

    const prompt = `
You are a real viewer in a Kick live chat.

You ONLY write short chat messages.

Channel: ${channel}
Title: ${title}

Language: ${language}
Dialect: ${dialect}
Persona: ${persona}

Examples:
${chatExamples}

Return JSON:
[{"text":"..."}]
`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + GROQ_API_KEY
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.9,
        max_tokens: 400
      })
    });

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || "";

    console.log("🧠 AI TEXT RAW:", text);

    let finalComments = [];

    const isJSON = text.trim().startsWith("[") && text.trim().endsWith("]");

    if (isJSON) {
      try {
        const parsed = safeParseComments(text);
        if (parsed.length) {
          finalComments = parsed;
        }
      } catch (e) {
        console.log("❌ JSON parse failed");
      }
    }

    if (!finalComments.length && text.trim()) {
      console.log("⚠️ Using RAW AI text");

      const lines = text
        .split("\n")
        .map(t => t.trim())
        .filter(t => t.length > 0 && t.length < 120);

      finalComments = lines.map(t => ({ text: t }));
    }

    if (!finalComments.length) {
      finalComments = fallbackComments();
    }

    console.log("🚀 FINAL COMMENTS:", finalComments);

    return finalComments;

  } catch (err) {
    console.log("❌ AI error:", err.message);
    return fallbackComments();
  }
}
// =======================
async function refillPool(channel) {
  if (!commentPool[channel]) {
    commentPool[channel] = {
      queue: [],
      lastFetch: 0
    };
  }

  const pool = commentPool[channel];

  if (Date.now() - pool.lastFetch < AI_COOLDOWN) return;

  pool.lastFetch = Date.now();

  const newComments = await generateComments(channel);
  pool.queue.push(...newComments);

  if (pool.queue.length > POOL_SIZE) {
    pool.queue = pool.queue.slice(0, POOL_SIZE);
  }
}

// =======================
app.get("/get-comment", async (req, res) => {
  try {
    const channel = req.query.channel || "general";

    if (!commentPool[channel]) {
      commentPool[channel] = { queue: [], lastFetch: 0 };
      await refillPool(channel);
    }

    const pool = commentPool[channel];

    if (pool.queue.length < REFILL_THRESHOLD) {
      refillPool(channel);
    }

    const item = pool.queue.shift();

    const comment =
      typeof item === "string"
        ? item
        : item?.text || "nice 🔥";

    return res.json({ comment });

  } catch (err) {
    console.log("❌ comment error:", err.message);
    return res.json({ comment: "wow 😂" });
  }
});

// =======================
function getHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };
}

// =======================
async function refreshChannels() {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/users?approved=eq.true&is_deleted=eq.false`,
      { headers: getHeaders() }
    );

    const data = await r.json();

    cachedChannels = data.map(u => u.channel);

    vipChannels = new Set(
      data
        .filter(u => u.is_vip === true)
        .map(u => u.channel)
    );

    console.log("✅ Channels:", cachedChannels.length);

  } catch (err) {
    console.log("❌ Channel fetch error:", err.message);
  }
}

// =======================
// 🔥 FIXED CORE
async function refreshLive() {
  if (!cachedChannels.length) return;

  console.log("🔄 Checking live...");

  for (const raw of cachedChannels) {
    const channel = normalize(raw);

    if (!stateMemory[channel]) {
      stateMemory[channel] = {
        live: false,
        success: 0,
        fail: 0
      };
    }

    let isLiveNow = null;

    for (let i = 0; i < 2; i++) {
      try {
        const res = await fetch(`https://kick.com/api/v2/channels/${channel}`);

        // ✅ handle 404 / invalid channel
        if (!res.ok) {
          isLiveNow = false;
          break;
        }

        const data = await res.json();
console.log("🔍", channel, data?.livestream?.is_live);

    // 🔥 HYBRID LIVE CHECK (API + HTML)
       // 🔥 API result
let apiLive =
  data?.livestream &&
  data.livestream !== null &&
  data.livestream.is_live === true;

// 🔥 HYBRID CHECK
if (!apiLive) {
  const htmlCheck = await checkLiveFromHTML(channel);

  if (htmlCheck === true) {
    isLiveNow = true;
  } else {
    isLiveNow = false;
  }

} else {
  isLiveNow = apiLive;
}

        break;

      } catch {}
    }

    const state = stateMemory[channel];

    // ✅ network fail → treat as fail (no skip)
    if (isLiveNow === null) {
      state.fail++;
      state.success = 0;

      if (state.live && state.fail >= OFFLINE_CONFIRM) {
        state.live = false;
      }

      liveCache[channel] = state.live;
      continue;
    }

    if (isLiveNow) {
      state.success++;
      state.fail = 0;

      if (!state.live && state.success >= LIVE_CONFIRM) {
        state.live = true;
      }

    } else {
      state.fail++;
      state.success = 0;

      if (state.live && state.fail >= OFFLINE_CONFIRM) {
        state.live = false;
      }
    }

    liveCache[channel] = state.live;
  }

  console.log("📡 Live stable updated");
}

// =======================
setInterval(refreshChannels, 30000);
setInterval(refreshLive, 10000);

refreshChannels();
refreshLive();

// =======================
app.get("/sync", (req, res) => {

  if (verificationMode.active) {
    return res.json({
      status: "verification",
      channels: [],
      vipChannels: verificationMode.channels,
      verificationActive: true
    });
  }

  return res.json({
    status: "active",
    channels: cachedChannels,
    vipChannels: [...vipChannels],
    verificationActive: false
  });

});

// =======================
app.get("/status", (req, res) => {
  res.json(liveCache);
});

app.post("/check-live", (req, res) => {
  try {
    const { channel } = req.body;

    return res.json({
      live: liveCache[channel] || false
    });

  } catch {
    res.json({ live: false });
  }
});

// =======================
// 🔥 UPDATED VIP SYSTEM
app.post("/admin/set-vip", async (req, res) => {
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

  try {
    const channels = req.body.channels || [];

    await fetch(
      `${SUPABASE_URL}/rest/v1/users?is_vip=eq.true`,
      {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ is_vip: false })
      }
    );

    for (const ch of channels) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/users?channel=eq.${ch}`,
        {
          method: "PATCH",
          headers: getHeaders(),
          body: JSON.stringify({ is_vip: true })
        }
      );
    }

    console.log("⭐ VIP updated (DB):", channels);

    return res.json({ ok: true });

  } catch (err) {
    console.log("❌ VIP error:", err.message);
    return res.json({ ok: false });
  }
});

// =======================
app.post("/admin/remove-vip", async (req, res) => {
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

  try {
    const channels = req.body.channels || [];

    for (const ch of channels) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/users?channel=eq.${ch}`,
        {
          method: "PATCH",
          headers: getHeaders(),
          body: JSON.stringify({ is_vip: false })
        }
      );
    }

    console.log("❌ VIP removed (DB):", channels);

    await refreshChannels();

    return res.json({ ok: true });

  } catch (err) {
    console.log("❌ remove VIP error:", err.message);
    return res.json({ ok: false });
  }
});

// =======================
app.post("/admin/start-verification", (req, res) => {
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

  verificationMode.active = true;
  verificationMode.channels = req.body.channels || [];

  console.log("🧪 Verification ON:", verificationMode.channels);

  res.json({ ok: true });
});

app.post("/admin/stop-verification", (req, res) => {
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

  verificationMode.active = false;
  verificationMode.channels = [];

  console.log("🛑 Verification OFF");

  res.json({ ok: true });
});

// =======================
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});

// =======================
app.post("/admin/update", async (req, res) => {
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

  try {
    const { channel } = req.body;

    if (!channel) return res.json({ ok: false });

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/users?is_deleted=eq.false`,
      { headers: getHeaders() }
    );

    const users = await r.json();
    const cleanInput = normalize(channel);

    const user = users.find(u => normalize(u.channel) === cleanInput);
    if (!user) return res.json({ ok: false });

    await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${user.id}`,
      {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ approved: true })
      }
    );

    return res.json({ ok: true });

  } catch {
    return res.json({ ok: false });
  }
});
