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
let vipChannels = new Set();

let verificationMode = {
active: false
};

// =======================
let cachedChannels = [];
let liveCache = {};
let commentPool = {};
let channelContext = {};

const POOL_SIZE = 30;
const REFILL_THRESHOLD = 10;
const AI_COOLDOWN = 10000;

// =======================
function safeParseComments(text) {
try {
const parsed = JSON.parse(text);

```
if (!Array.isArray(parsed)) return [];

return parsed
  .map(x => x.text)
  .filter(t =>
    typeof t === "string" &&
    t.length > 1 &&
    t.length < 80
  );
```

} catch {
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

```
const ctx = channelContext[channel] || {};
const title = ctx.title || "fun stream";
const chat = (ctx.chatSample || []).slice(0, 8);

const chatExamples = chat.length
  ? chat.map(x => "- " + x).join("\n")
  : "- gg\n- nice\n- lol 😂";

const prompt = `
```

You are a real viewer in a Kick live chat.

You ONLY write short chat messages.

Channel: ${channel}
Title: ${title}

Examples:
${chatExamples}

Return JSON:
[{"text":"..."}]
`;

```
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

const isJSON = text.trim().startsWith("[") && text.trim().endsWith("]");
if (!isJSON) return fallbackComments();

const parsed = safeParseComments(text);
return parsed.length ? parsed : fallbackComments();
```

} catch {
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
app.post("/context", (req, res) => {
try {
const { channel, title, chatSample } = req.body;

```
if (!channel) return res.json({ ok: false });

channelContext[channel] = {
  title: title || "",
  chatSample: Array.isArray(chatSample) ? chatSample : []
};

return res.json({ ok: true });
```

} catch {
return res.json({ ok: false });
}
});

// =======================
app.get("/get-comment", async (req, res) => {
try {
const channel = req.query.channel || "general";

```
if (!commentPool[channel]) {
  commentPool[channel] = {
    queue: [],
    lastFetch: 0
  };

  await refillPool(channel);
}

const pool = commentPool[channel];

if (pool.queue.length < REFILL_THRESHOLD) {
  refillPool(channel);
}

const comment = pool.queue.shift() || "nice 🔥";

return res.json({ comment });
```

} catch {
return res.json({ comment: "wow 😂" });
}
});

// =======================
async function refreshChannels() {
try {
const r = await fetch(`${SUPABASE_URL}/rest/v1/users?approved=eq.true&is_deleted=eq.false`, {
headers: { apikey: SUPABASE_KEY }
});

```
const data = await r.json();
cachedChannels = data.map(u => u.channel);

console.log("✅ Channels:", cachedChannels.length);
```

} catch {
console.log("❌ Channel fetch error");
}
}

// =======================
async function refreshLive() {
if (!cachedChannels.length) return;

console.log("🔄 Checking live...");

for (const channel of cachedChannels) {
try {
const res = await fetch(`https://kick.com/api/v2/channels/${channel}`);
const text = await res.text();

```
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    liveCache[channel] = false;
    continue;
  }

  const isLive = data?.livestream?.is_live === true;
  liveCache[channel] = isLive;

} catch {
  liveCache[channel] = false;
}
```

}

console.log("📡 Live updated");
}

// =======================
setInterval(refreshChannels, 30000);
setInterval(refreshLive, 10000);

refreshChannels();
refreshLive();

// =======================
app.post("/user/register", async (req, res) => {
try {
const { channel, password } = req.body;

```
if (!channel || !password) {
  return res.json({ ok: false, message: "Missing data" });
}

let existing = [];

try {
  const check = await fetch(`${SUPABASE_URL}/rest/v1/users?channel=eq.${channel}`, {
    headers: { apikey: SUPABASE_KEY }
  });

  existing = await check.json();
} catch {
  return res.json({ ok: false, message: "DB error" });
}

if (existing.length > 0) {
  const user = existing[0];

  if (user.is_deleted === true) {
    await fetch(`${SUPABASE_URL}/rest/v1/users?channel=eq.${channel}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        password,
        approved: false,
        is_deleted: false
      })
    });

    return res.json({ ok: true, message: "Re-registered" });
  }

  return res.json({ ok: false, message: "Already exists" });
}

await fetch(`${SUPABASE_URL}/rest/v1/users`, {
  method: "POST",
  headers: {
    apikey: SUPABASE_KEY,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    channel,
    password,
    approved: false,
    is_deleted: false
  })
});

return res.json({ ok: true });
```

} catch {
return res.json({ ok: false, message: "Server error" });
}
});

// =======================
// 🔥 NEW FIX (APPROVE USER)
app.post("/admin/approve-user", async (req, res) => {
const key = req.headers["x-admin-key"];
if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

try {
const { channel } = req.body;

```
if (!channel) {
  return res.json({ ok: false, message: "Missing channel" });
}

await fetch(`${SUPABASE_URL}/rest/v1/users?channel=eq.${channel}`, {
  method: "PATCH",
  headers: {
    apikey: SUPABASE_KEY,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    approved: true
  })
});

console.log("✅ Approved:", channel);

return res.json({ ok: true });


} catch (err) {
console.log("❌ Approve error", err);
return res.json({ ok: false });
}
});

// =======================
app.get("/sync", async (req, res) => {

if (verificationMode.active) {
return res.json({
status: "verification",
channels: [...vipChannels],
verificationActive: true,
vipChannels: [...vipChannels]
});
}

return res.json({
status: "active",
channels: cachedChannels,
vip: [...vipChannels],
verificationActive: false,
vipChannels: [...vipChannels]
});
});

// =======================
app.get("/status", (req, res) => {
res.json(liveCache);
});

app.post("/check-live", async (req, res) => {
try {
const { channel } = req.body;

```
return res.json({
  live: liveCache[channel] || false
});
```

} catch {
res.json({ live: false });
}
});

// =======================
app.post("/admin/set-vip", (req, res) => {
const key = req.headers["x-admin-key"];
if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

vipChannels = new Set(req.body.channels || []);
console.log("⭐ VIP:", [...vipChannels]);

res.json({ ok: true });
});

// =======================
app.post("/admin/start-verification", (req, res) => {
const key = req.headers["x-admin-key"];
if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

verificationMode.active = true;

console.log("🧪 Verification ON");

res.json({ ok: true });
});

app.post("/admin/stop-verification", (req, res) => {
const key = req.headers["x-admin-key"];
if (key !== ADMIN_KEY) return res.status(403).json({ ok: false });

verificationMode.active = false;

console.log("🛑 Verification OFF");

res.json({ ok: true });
});

// =======================
app.listen(PORT, () => {
console.log("🚀 Server running on port", PORT);
});
