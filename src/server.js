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
let refreshLiveRunning = false;

// 🔥 NEW STATE MEMORY
let stateMemory = {};

let commentPool = {};
let channelContext = {};
// 🔥 COMMENT MEMORY (FIX)
let commentHistory = {};
// =======================
// 🧠 PRESENCE SYSTEM

let presenceMemory = {};

// شكل البيانات:
/*
presenceMemory[userId] = {

  userId,
  channel,

  verificationActive: false,

  joinedAt: 0,
  lastPing: 0,

  totalWatchMs: 0,
  lastWatchStart: 0,

  pingCount: 0,

  videoOk: false,

  suspicious: 0,

  disconnected: false,

  tabId: null
}
*/

// =======================
function ensurePresence(userId) {

  if (!presenceMemory[userId]) {

    presenceMemory[userId] = {

      userId,

      channel: null,

      verificationActive: false,

      joinedAt: 0,
      lastPing: 0,

      totalWatchMs: 0,
      lastWatchStart: 0,

      pingCount: 0,

      videoOk: false,

      suspicious: 0,

      disconnected: false,

      tabId: null
    };
  }

  return presenceMemory[userId];
}

// =======================
function getNow() {
  return Date.now();
}

// =======================
// 🧠 CLEAN DEAD USERS

setInterval(() => {
	
  const now = getNow();

  for (const userId in presenceMemory) {

    const p = presenceMemory[userId];

    // إذا اختفى أكثر من 2 دقيقة
    if (
      p.lastPing &&
      now - p.lastPing > 120000
    ) {

      p.disconnected = true;

      // وقف احتساب الوقت
      if (p.lastWatchStart) {

        p.totalWatchMs +=
          now - p.lastWatchStart;

        p.lastWatchStart = 0;
      }
    }
  }

}, 30000);
// =======================
// 🔔 GLOBAL ADMIN NOTICE
let globalNotice = {
  active: false,
  id: null,
  text: "",
  createdAt: null,
  version: 0
};

function isDuplicate(channel, text) {
  if (!commentHistory[channel]) {
    commentHistory[channel] = [];
  }

  const normalizedText = normalize(
    typeof text === "string" ? text : text?.text || ""
  );

  const history = commentHistory[channel];

  if (history.includes(normalizedText)) {
    return true;
  }

  history.push(normalizedText);

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
    .replace(/\s+/g, " ")
    .normalize("NFKC");
} 
// =======================
// 🔥 GET CHANNEL SETTINGS FROM SUPABASE (FIXED FINAL VERSION)
async function getChannelSettings(channel) {
  try {
    const clean = normalize(channel);

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/users?channel=eq.${clean}&select=preferred_style,preferred_arabic_type,preferred_country,preferred_persona`,
      { headers: getHeaders() }
    );

    const data = await r.json();

    if (!data || !data.length) return {};

    const user = data[0];

    return {
      language_mode: user.preferred_style || "mix",
      arabic_type: user.preferred_arabic_type || "darija",
      region: user.preferred_country || "me",
      persona: user.preferred_persona || "normal"
    };

  } catch (err) {
    console.log("❌ settings fetch error:", err.message);
    return {
      language_mode: "mix",
      arabic_type: "darija",
      region: "me",
      persona: "normal"
    };
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

function cleanText(text) {
  return String(text || "")
    .replace(/�/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// =======================

function safeParseComments(text) {
  try {
    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed)) return [];

    return parsed
  .map(x =>
  cleanText(typeof x === "string" ? x : x?.text)
)
      .filter(t => typeof t === "string" && t.length > 1 && t.length < 80);

  } catch (err) {
    console.log("❌ parse error:", err.message);
    return [];
  }
}

// =======================
function fallbackComments(channel = "") {
  return [
    "😂😂",
    "gg",
    "clean 🔥",
    "lol 😂",
    "nice 🔥",
    "bravo 🔥",
    "توب 🔥",
    "يعطيك الصحة 🔥",
    "هايل 😂",
    "واو 🔥"
  ];
}

// =======================
// 🔥 CHANNEL PERSONALITY DEFAULT (optional fallback system)
function getChannelProfile(channel) {
  return channelContext[channel] || {
    tone: "hype",
    audienceType: "gaming",
    intensity: "medium",
    chatSample: []
  };
}

// =======================
async function generateComments(channel) {
  console.log("🚨 generateComments CALLED for:", channel);

  try {
    if (!GROQ_API_KEY) return fallbackComments();

    const ctx = getChannelProfile(channel);

    const chat = (ctx.chatSample || []).slice(0, 8);

    const settings = await getChannelSettings(channel);

    if (!settings || !settings.language_mode) {
      console.log("⚠️ No settings found for channel:", channel);
      return fallbackComments();
    }

    const mode = settings.language_mode || "mix";
    const arabicType = settings.arabic_type || "darija";
    const region = settings.region || "me";
    const persona = settings.persona || "normal";

    // 🔥 NEW CHANNEL BEHAVIOR SETTINGS
    const tone = ctx.tone || "hype";
    const audienceType = ctx.audienceType || "gaming";
    const intensity = ctx.intensity || "medium";

    const chatExamples = chat.length
      ? chat.map(x => "- " + x).join("\n")
      : "- gg\n- nice\n- lol 😂";

const prompt = `
You are a REAL viewer inside a Kick livestream chat.

━━━━━━━━━━━━━━━━━━
CHANNEL BEHAVIOR PROFILE (IMPORTANT)
━━━━━━━━━━━━━━━━━━
Tone: ${tone}
Audience Type: ${audienceType}
Intensity: ${intensity}

━━━━━━━━━━━━━━━━━━
STREAM CONTEXT RULE (CRITICAL FIX)
━━━━━━━━━━━━━━━━━━
You are NOT allowed to talk randomly.

You MUST always:
- React to the STREAM / STREAMER / GAME / MOMENTS
- Show SUPPORT, HYPE, or ADMIRATION
- NEVER go off-topic
- NEVER generate unrelated sentences like greetings, life talk, or random words

Examples of valid focus:
- streamer performance
- gameplay moments
- hype moments
- kills / wins / skills
- funny moments in stream
- chat reactions

━━━━━━━━━━━━━━━━━━
STRICT CORE RULES
━━━━━━━━━━━━━━━━━━
- Follow ONLY the selected language_mode.
- NEVER mix languages unless mode = mix.
- Write SHORT comments ONLY (2 to 8 words max).
- Every comment must feel like a REAL LIVE CHAT MESSAGE.
- No generic filler like "thanks", "hello", "how are you".
- No random disconnected ideas.
- NEVER repeat same meaning or structure.

━━━━━━━━━━━━━━━━━━
LANGUAGE MODE
━━━━━━━━━━━━━━━━━━
Language Mode: ${mode}

If mode = english:
- Write ONLY English.

If mode = french:
- Write ONLY French.

If mode = mix:
- Mix English + French + light Arabic naturally.

If mode = arabic:
- Arabic Type: ${arabicType}
- Region: ${region}

━━━━━━━━━━━━━━━━━━
ARABIC RULES (VERY IMPORTANT)
━━━━━━━━━━━━━━━━━━
- franco → Arabic written in Latin letters ONLY
- darija → ONLY Arabic script (NO Latin letters)
- Saudi → Gulf/Saudi dialect ONLY, natural slang
- Region defines slang and tone

━━━━━━━━━━━━━━━━━━
SUPPORT & HYPE RULE (NEW IMPORTANT FIX)
━━━━━━━━━━━━━━━━━━
Every comment MUST be one of:
- hype for streamer
- admiration for skill
- emotional reaction
- encouragement
- reaction to moment (win / fail / clutch / funny)

Examples of valid intent:
- "this streamer is insane"
- "what a play"
- "bro is on fire"
- "no way that happened"
- "he's too good"

━━━━━━━━━━━━━━━━━━
CHANNEL NAME USAGE (OPTIONAL BUT POWERFUL)
━━━━━━━━━━━━━━━━━━
Sometimes include streamer/channel name naturally if available:
- "${channel} is insane"
- "keep going ${channel}"
- "${channel} on fire"

DO NOT overuse channel name.

━━━━━━━━━━━━━━━━━━
PERSONA RULE
━━━━━━━━━━━━━━━━━━
Persona: ${persona}

Act like DIFFERENT REAL VIEWERS:
- hype viewer
- funny viewer
- shocked viewer
- supportive viewer
- impressed viewer

Each comment = different person.

━━━━━━━━━━━━━━━━━━
DIVERSITY RULE (CRITICAL)
━━━━━━━━━━━━━━━━━━
Every comment MUST differ in:
- emotion
- structure
- meaning

Allowed emotions:
- hype
- admiration
- shock
- excitement
- respect
- laughter (only if relevant)

━━━━━━━━━━━━━━━━━━
ANTI-REPETITION RULE
━━━━━━━━━━━━━━━━━━
- Do NOT repeat same idea twice
- Do NOT reuse same sentence pattern
- Do NOT repeat words like:
  "gg", "nice", "شكرا", "مبروك"
  more than once total

━━━━━━━━━━━━━━━━━━
REALISM RULE
━━━━━━━━━━━━━━━━━━
- Act like fast live chat typing
- No formal sentences
- No AI-style structure
- Natural messy human reactions

━━━━━━━━━━━━━━━━━━
LENGTH RULE
━━━━━━━━━━━━━━━━━━
- 2 to 8 words max
- Short emotional reactions only

━━━━━━━━━━━━━━━━━━
EXAMPLES CONTEXT
━━━━━━━━━━━━━━━━━━
${chatExamples}

━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (STRICT)
━━━━━━━━━━━━━━━━━━
Return ONLY valid JSON:

[
  {"text":"..."},
  {"text":"..."},
  {"text":"..."}
]

No explanations.
No markdown.
No numbering.
No extra text.
Only pure JSON array.
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
        presence_penalty: 0.8,
        frequency_penalty: 1.1,
        max_tokens: 400
      })
    });

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || "";

    console.log("🧠 AI TEXT RAW:", text);

    let finalComments = [];

    const isJSON =
      text.trim().startsWith("[") &&
      text.trim().endsWith("]");

    if (isJSON) {
      const parsed = safeParseComments(text);

      if (parsed.length) {
        finalComments = parsed.map(t => ({
          text: cleanText(t)
        }));
      }
    }

    if (!finalComments.length) {
      finalComments = fallbackComments().map(t => ({
        text: cleanText(t)
      }));
    }

    console.log("🚀 FINAL COMMENTS:", finalComments);
    return finalComments;

  } catch (err) {
    console.log("❌ AI error:", err.message);
    return fallbackComments().map(t => ({ text: t }));
  }
}

// =======================
// 🔥 REFILL POOL
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

    console.log("📩 /get-comment called for:", channel);

    if (!commentPool[channel]) {
      commentPool[channel] = { queue: [], lastFetch: 0 };
    }

    const pool = commentPool[channel];

    // 🔥 أهم تعديل
    if (pool.queue.length === 0) {
      console.log("⚡ EMPTY → FORCE GENERATE");

      const newComments = await generateComments(channel);
      pool.queue.push(...newComments);
    }

    if (pool.queue.length < REFILL_THRESHOLD) {
      refillPool(channel);
    }

let commentObj = pool.queue.shift() || { text: "nice 🔥" };

let comment =
  typeof commentObj === "string"
    ? commentObj
    : commentObj.text;

let tries = 0;

while (isDuplicate(channel, comment) && tries < 5) {
  const nextObj =
    pool.queue.shift() || { text: fallbackComments()[0] };

  comment =
    typeof nextObj === "string"
      ? nextObj
      : nextObj.text;

  tries++;
}

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

  if (refreshLiveRunning) {
    console.log("⛔ refreshLive skipped (still running)");
    return;
  }

  refreshLiveRunning = true;

  if (!cachedChannels.length) {
  refreshLiveRunning = false;
  return;
}

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

  let htmlCheck = false;

  // 🔥 fallback فقط عند فشل API الحقيقي
  if (apiLive === false && isLiveNow === false) {
    htmlCheck = await checkLiveFromHTML(channel);
  }

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
refreshLiveRunning = false;
}

// =======================
setInterval(refreshChannels, 30000);
setInterval(refreshLive, 15000);

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
let lastStatusSend = 0;
let cachedStatusResponse = null;

app.get("/status", (req, res) => {

  const now = Date.now();

  // 🔥 نحدث الكاش كل 3 ثواني فقط
  if (!cachedStatusResponse || now - lastStatusSend > 3000) {
    cachedStatusResponse = { ...liveCache };
    lastStatusSend = now;
  }

  res.json(cachedStatusResponse);
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
// 🔔 SEND GLOBAL NOTICE
app.post("/admin/send-notice", (req, res) => {
  const key = req.headers["x-admin-key"];

  if (key !== ADMIN_KEY) {
    return res.status(403).json({ ok: false });
  }

  try {
    const { text } = req.body;

    if (!text || text.length < 2) {
      return res.json({ ok: false });
    }

  globalNotice = {
  active: true,
  id: Date.now(),
  version: Date.now(), // 🔥 مهم جداً
  text: String(text).trim(),
  createdAt: Date.now()
};
    console.log("📢 NOTICE SENT:", text);

    return res.json({ ok: true });

  } catch {
    return res.json({ ok: false });
  }
});

// =======================
// 🔔 END GLOBAL NOTICE
app.post("/admin/end-notice", (req, res) => {
  const key = req.headers["x-admin-key"];

  if (key !== ADMIN_KEY) {
    return res.status(403).json({ ok: false });
  }

  globalNotice = {
    active: false,
    id: null,
    text: "",
    createdAt: null
  };

  console.log("🛑 NOTICE ENDED");

  res.json({ ok: true });
});

// =======================
// 🔔 GET GLOBAL NOTICE
app.get("/notice", (req, res) => {
  res.json({
  ...globalNotice,
  serverTime: Date.now()
});
});
// =======================
// 🧠 START PRESENCE SESSION

app.post("/presence/start", (req, res) => {

  try {

    const {
      userId,
      channel,
      tabId
    } = req.body || {};

    if (!userId || !channel) {

      return res.json({
        ok: false
      });
    }

    const p =
      ensurePresence(userId);

    const now = getNow();

    // 🔥 حماية من spam restart
    const recentlyStarted =
      p.joinedAt &&
      now - p.joinedAt < 15000;

    if (recentlyStarted) {

      return res.json({
        ok: true,
        reused: true
      });
    }

    p.userId = userId;

    p.channel =
      normalize(channel);

    p.verificationActive = true;

    p.joinedAt = now;

    p.lastPing = now;

    p.lastWatchStart = now;

    p.pingCount = 0;

    p.videoOk = true;

    p.disconnected = false;

    p.tabId = tabId || null;

    console.log(
      "🟢 Presence START:",
      p.userId,
      p.channel
    );

    return res.json({
      ok: true
    });

  } catch (err) {

    console.log(
      "❌ presence/start error",
      err.message
    );

    return res.json({
      ok: false
    });
  }
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
