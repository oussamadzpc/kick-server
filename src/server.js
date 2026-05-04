import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = "https://pdgglivspfctmzbjpqjm.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
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

// 🔥 NEW: Settings Memory per Channel
let channelSettings = {};
// 🔥 Pool Settings to avoid mixing
let poolSettings = {};

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
    // 🔥 Improved JSON extraction for LLM
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1) return [];
    
    const jsonStr = text.substring(start, end + 1);
    const parsed = JSON.parse(jsonStr);

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

// ==========================
// 🔥 NEW: GENERATE COMMENTS WITH STYLE & PERSONA
async function generateComments(channel) {
  try {
    if (!GROQ_API_KEY) return fallbackComments();

    const ctx = channelContext[channel] || {};
    const title = ctx.title || "fun stream";
    const chat = (ctx.chatSample || []).slice(0, 8);
    
    // 🔥 Get EXACT settings used when this pool was requested
    const settings = poolSettings[channel] || channelSettings[channel] || { style: 'ar', arabicType: 'darija', country: 'dz', persona: 'normal' };

    const chatExamples = chat.length
      ? chat.map(x => "- " + x).join("\n")
      : "- gg\n- nice\n- lol 😂";

    // 🔥 Build the dynamic prompt based on user choice
    let languageInstruction = "";
    if (settings.style === 'ar') {
        if (settings.arabicType === 'darija') {
            const countryMap = {
                'dz': 'الجزائرية (Algerian Darija) - Use words like: وشراك، صحيت، واه',
                'ma': 'المغربية (Moroccan Darija) - Use words like: دبا، خاي، مزيان',
                'tn': 'التونسية (Tunisian Darija) - Use words like: شنية، باهي، عيشك',
                'eg': 'المصرية (Egyptian Arabic) - Use words like: يا باشا، منور، عامل ايه',
                'sa': 'السعودية (Saudi Arabic) - Use words like: يا هلا، ابشر، وش لونك',
                'jo': 'الأردنية (Jordanian Arabic) - Use words like: يا غالي، هلا والله',
                'ly': 'الليبية (Libyan Arabic) - Use words like: شن الجو، يا طيري',
                'me': 'دول الشرق الأوسط (Levantine) - Use words like: شو الأخبار، منور يا بطل',
                'gcc': 'دول الخليج (Khaleeji) - Use words like: يا خوي، كفو، ما قصرت'
            };
            languageInstruction = `CRITICAL: You MUST write ONLY in the ${countryMap[settings.country] || 'Algerian Darija'} dialect. DO NOT use Standard Arabic or other dialects.`;
        } else if (settings.arabicType === 'franco') {
            languageInstruction = "CRITICAL: Write ONLY in Franco-Arabic (Arabic using English letters and numbers, e.g., '3amel eh', '7abibi'). DO NOT use Arabic script.";
        } else {
            languageInstruction = "Write in Modern Standard Arabic (فصحى).";
        }
    } else if (settings.style === 'fr') {
        languageInstruction = "Write in French.";
    } else if (settings.style === 'en') {
        languageInstruction = "Write in English.";
    } else if (settings.style === 'mix') {
        languageInstruction = "Write in a mix of Arabic and English.";
    }

    // 🔥 Add Persona instruction
    let personaInstruction = "";
    if (settings.persona === 'excited') personaInstruction = "Persona: Extremely excited fan. Use lots of emojis (🔥, 🚀, ❤️) and hype words.";
    if (settings.persona === 'critical') personaInstruction = "Persona: Critical/Sarcastic gamer. Be slightly skeptical or mock the mistakes in a funny way.";
    if (settings.persona === 'funny') personaInstruction = "Persona: The Joker. Use jokes, funny reactions, and 'lol' style comments.";
    if (settings.persona === 'normal') personaInstruction = "Persona: Casual friendly viewer.";

    const prompt = `
You are a REAL human viewer in a Kick live chat.
STRICT LANGUAGE RULE: ${languageInstruction}
STRICT PERSONA: ${personaInstruction}

RULES:
1. Write ONLY short, natural chat messages (1-6 words).
2. NEVER repeat the same message.
3. NEVER say you are an AI or bot.
4. ONLY return a JSON array of objects.

Channel: ${channel}
Title: ${title}

Current Chat Vibe:
${chatExamples}

Output JSON:
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
        max_tokens: 600
      })
    });

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || "";

    // 🔥 Sanitize text from "GLOBAL" or other AI artifacts
    if (text.includes("GLOBAL")) {
        console.log("⚠️ AI returned GLOBAL, retrying or using fallback");
        return fallbackComments();
    }

    const parsed = safeParseComments(text);
    return parsed.length ? parsed : fallbackComments();

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
app.post("/context", async (req, res) => {
  try {
    const { channel, title, chatSample, settings } = req.body;

    if (!channel) return res.json({ ok: false });

    channelContext[channel] = {
      title: title || "",
      chatSample: Array.isArray(chatSample) ? chatSample : []
    };
    
    // 🔥 Update settings if provided from context
    if (settings) {
        channelSettings[channel] = settings;
    }

    // 🔥 NEW: If this is a new channel, add it to tracking IMMEDIATELY
    const cleanChannel = normalize(channel);
    if (!cachedChannels.includes(cleanChannel)) {
        console.log("🆕 New channel from context, adding to tracking:", cleanChannel);
        cachedChannels.push(cleanChannel);
        // Force an immediate live check for this specific channel
        await checkAndNotifySingleChannel(cleanChannel);
    }

    return res.json({ ok: true });

  } catch (err) {
    console.log("❌ context error:", err.message);
    return res.json({ ok: false });
  }
});

// 🔥 Helper for immediate single channel check
async function checkAndNotifySingleChannel(channel) {
    if (!stateMemory[channel]) {
        stateMemory[channel] = { live: false, success: 0, fail: 0 };
    }
    
    let isLiveNow = false;
    try {
        const res = await fetch(`https://kick.com/api/v2/channels/${channel}`);
        if (res.ok) {
            const data = await res.json();
            let apiLive = data?.livestream?.is_live === true;
            if (!apiLive) {
                isLiveNow = await checkLiveFromHTML(channel) === true;
            } else {
                isLiveNow = true;
            }
        }
    } catch {}

    stateMemory[channel].live = isLiveNow;
    liveCache[channel] = isLiveNow;
}

// =======================
app.get("/get-comment", async (req, res) => {
  try {
    const channel = req.query.channel || "general";
    
    // 🔥 Update and LOCK settings for this specific request
    if (req.query.style) {
        const currentReqSettings = {
            style: req.query.style,
            arabicType: req.query.arabicType,
            country: req.query.country,
            persona: req.query.persona
        };
        channelSettings[channel] = currentReqSettings;
        poolSettings[channel] = currentReqSettings; // Lock settings for the next AI generation
    }

    if (!commentPool[channel] || commentPool[channel].queue.length === 0) {
      commentPool[channel] = { queue: [], lastFetch: 0 };
      await refillPool(channel);
    }

    const pool = commentPool[channel];

    if (pool.queue.length < REFILL_THRESHOLD) {
      refillPool(channel);
    }

    const comment = pool.queue.shift() || "nice 🔥";

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
    Prefer: "representation"
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

        if (!res.ok) {
          isLiveNow = false;
          break;
        }

        const data = await res.json();
        
        // 🔥 HYBRID LIVE CHECK (API + HTML)
        let apiLive =
          data?.livestream &&
          data.livestream !== null &&
          data.livestream.is_live === true;

        if (!apiLive) {
          const htmlCheck = await checkLiveFromHTML(channel);
          isLiveNow = htmlCheck === true;
        } else {
          isLiveNow = apiLive;
        }

        break;

      } catch {}
    }

    const state = stateMemory[channel];

    if (isLiveNow === null) {
      state.fail++;
      state.success = 0;
      if (state.live && state.fail >= OFFLINE_CONFIRM) state.live = false;
      liveCache[channel] = state.live;
      continue;
    }

    if (isLiveNow) {
      state.success++;
      state.fail = 0;
      if (!state.live && state.success >= LIVE_CONFIRM) state.live = true;
    } else {
      state.fail++;
      state.success = 0;
      if (state.live && state.fail >= OFFLINE_CONFIRM) state.live = false;
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

app.get("/status", (req, res) => {
  res.json(liveCache);
});

app.post("/check-live", (req, res) => {
  try {
    const { channel } = req.body;
    return res.json({ live: liveCache[channel] || false });
  } catch {
    res.json({ live: false });
  }
});

// =======================
// 🔥 ADMIN VIP SYSTEM
app.post("/admin/set-vip", async (req, res) => {
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

  try {
    const channels = req.body.channels || [];

    await fetch(`${SUPABASE_URL}/rest/v1/users?is_vip=eq.true`, {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ is_vip: false })
    });

    for (const ch of channels) {
      await fetch(`${SUPABASE_URL}/rest/v1/users?channel=eq.${ch}`, {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ is_vip: true })
      });
    }

    console.log("⭐ VIP updated (DB):", channels);
    await refreshChannels();
    return res.json({ ok: true });
  } catch (err) {
    console.log("❌ VIP error:", err.message);
    return res.json({ ok: false });
  }
});

app.post("/admin/remove-vip", async (req, res) => {
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

  try {
    const channels = req.body.channels || [];
    for (const ch of channels) {
      await fetch(`${SUPABASE_URL}/rest/v1/users?channel=eq.${ch}`, {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ is_vip: false })
      });
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
  res.json({ ok: true });
});

app.post("/admin/stop-verification", (req, res) => {
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });
  verificationMode.active = false;
  verificationMode.channels = [];
  res.json({ ok: true });
});

app.post("/admin/update", async (req, res) => {
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

  try {
    const { channel } = req.body;
    if (!channel) return res.json({ ok: false });

    const r = await fetch(`${SUPABASE_URL}/rest/v1/users?is_deleted=eq.false`, { headers: getHeaders() });
    const users = await r.json();
    const cleanInput = normalize(channel);

    const user = users.find(u => normalize(u.channel) === cleanInput);
    if (!user) return res.json({ ok: false });

    await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${user.id}`, {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ approved: true })
    });

    await refreshChannels();
    return res.json({ ok: true });
  } catch {
    return res.json({ ok: false });
  }
});

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
