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
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  console.log("⚠️ Warning: ADMIN_KEY not set in environment variables");
}
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
// 🔥 VERIFICATION PRESENCE SYSTEM

const VERIFICATION_TIMEOUT = 1000 * 60 * 5; // 5 minutes
const HEARTBEAT_LIMIT = 1000 * 25; // 25 sec
// =======================
let cachedChannels = [];
let liveCache = {};
let refreshLiveRunning = false;

// 🔥 NEW STATE MEMORY
let stateMemory = {};

let commentPool = {};
let channelContext = {};
let aiSceneMemory = {};
// 🔥 COMMENT MEMORY (FIX)
let commentHistory = {};
// =======================
// 🧠 PRESENCE SYSTEM

let presenceMemory = {};

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
    if (p.lastPing && now - p.lastPing > 120000) {
      p.disconnected = true;
      if (p.lastWatchStart) {
        p.totalWatchMs += now - p.lastWatchStart;
        p.lastWatchStart = 0;
      }
    }
  }
}, 30000);

// =======================
// ✅ ATTENDANCE MEMORY

let attendanceMemory = {};

// =======================
// 🔔 GLOBAL ADMIN NOTICE
let globalNotice = {
  active: false,
  id: null,
  text: "",
  createdAt: null,
  version: 0
};
// =======================
// ✅ ATTENDANCE SESSION

let attendanceSession = {
  active: false,
  id: null,
  text: "",
  startedAt: null,
  users: {}
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
// 🔥 DIALECT SYSTEM (NEW - FIXED)
// =======================

const DIALECT_PROFILES = {
  // 🇹🇳 Tunisian Darija
  tn: {
    name: "Tunisian Darija",
    script: "arabic",
    features: [
      "Use 'شنوة' not 'شنو' or 'ايش'",
      "Use 'هاذا/هاذي' not 'هذا/هذه'",
      "Use 'برشا' for 'very/much'",
      "Use 'يعيشك' for 'thank you'",
      "Use 'باهي' for 'good/ok'",
      "Use 'فاما' for 'understand'",
      "Use 'شبيك' for 'what's wrong'",
      "Use 'نحب' not 'أحب'",
      "Use 'نقدر' not 'أقدر'",
      "Use 'نحب نروح' not 'أريد أن أذهب'",
      "Use 'برشا' not 'كثير'",
      "Use 'شباب' for 'guys'",
      "Use 'يا ساتر' for shock",
      "Use 'والله يا عظمة' for amazement"
    ],
    examples: [
      "شنوة هاذا يا ساتر",
      "برافو عليك خويا",
      "هاذي قوية برشا",
      "والله يا عظمة",
      "يعيشك على اللعبة",
      "باهي باهي كيفاش",
      "شبيك خويا هاذي نار",
      "نحب الطريقة هاذي",
      "شنوة صار هنا يا ساتر",
      "برشا برشا قوية"
    ]
  },

  // 🇩🇿 Algerian Darija
  dz: {
    name: "Algerian Darija",
    script: "arabic",
    features: [
      "Use 'واش' not 'شنو' or 'ايش'",
      "Use 'هاذ/هاذي' not 'هذا/هذه'",
      "Use 'بزاف' for 'very/much'",
      "Use 'صحا' for 'thank you'",
      "Use 'واخا' for 'ok'",
      "Use 'فهمت' not 'فهمت' (MSA)",
      "Use 'كيفاه' for 'how'",
      "Use 'نحب' not 'أحب'",
      "Use 'نقدر' not 'أقدر'",
      "Use 'يا ربي' for shock",
      "Use 'هاذي نار' for hype",
      "Use 'برك الله' for praise"
    ],
    examples: [
      "واش هاذ يا ربي",
      "صحا عليك خويا",
      "هاذي نار بزاف",
      "برك الله فيك",
      "واخا واخا كيفاه",
      "بزاف بزاف قوية",
      "نحب الطريقة هاذي",
      "واش صار هنا يا ربي",
      "هاذي لعبة بزاف",
      "صحا خويا راه قوي"
    ]
  },

  // 🇲🇦 Moroccan Darija
  ma: {
    name: "Moroccan Darija",
    script: "arabic",
    features: [
      "Use 'شنو' or 'اش' for 'what'",
      "Use 'هادا/هادي' not 'هذا/هذه'",
      "Use 'بزاف' for 'very/much'",
      "Use 'الله يعطيك الصحة' for thanks",
      "Use 'واخا' for 'ok'",
      "Use 'صافي' for 'enough/done'",
      "Use 'بغيت' not 'أريد'",
      "Use 'قدرت' not 'أستطيع'",
      "Use 'يا سلام' for amazement",
      "Use 'هادي زوينة' for 'this is nice'",
      "Use 'واو' for wow",
      "Use 'عندي' not 'لدي'"
    ],
    examples: [
      "شنو هادا يا سلام",
      "الله يعطيك الصحة",
      "هادي زوينة بزاف",
      "واخا واخا كيفاش",
      "صافي صافي فهمت",
      "بغيت نلعب بحالك",
      "هادي لعبة قوية",
      "يا سلام على اللعبة",
      "بزاف بزاف زوينة",
      "شنو كاين هنا"
    ]
  },

  // 🇪🇬 Egyptian
  eg: {
    name: "Egyptian Arabic",
    script: "arabic",
    features: [
      "Use 'ايه' for 'what'",
      "Use 'ده/دي' not 'هذا/هذه'",
      "Use 'قوي/جامد' for 'strong'",
      "Use 'عاش' for hype",
      "Use 'يا جدع' for 'dude'",
      "Use 'يا ساتر' for shock",
      "Use 'ربنا يستر' for 'oh god'",
      "Use 'عظمة' for 'great'",
      "Use 'حلو' for 'nice'",
      "Use 'كده' for 'like this'",
      "Use 'طبعاً' for 'of course'",
      "Use 'بجد' for 'seriously'"
    ],
    examples: [
      "ايه ده يا ساتر",
      "عاش يا جدع",
      "ده جامد اوي",
      "يا ساتر على اللعبة",
      "عظمة عظمة بجد",
      "حلو قوي كده",
      "ربنا يستر عليك",
      "يا جدع انت مجنون",
      "ده فيلم مش لعبة",
      "عاش يا بطل"
    ]
  },

  // 🇸🇦 Saudi / Gulf
  sa: {
    name: "Saudi/Gulf Arabic",
    script: "arabic",
    features: [
      "Use 'وش' or 'ايش' for 'what'",
      "Use 'هذا/هذي' (gulf style)",
      "Use 'قوي' for 'strong'",
      "Use 'ما شاء الله' for praise",
      "Use 'يعطيك العافية' for thanks",
      "Use 'يا حبيبي' for 'dude'",
      "Use 'طيب' for 'ok/nice'",
      "Use 'هالحين' for 'now'",
      "Use 'يا سلام' for amazement",
      "Use 'شرايك' for 'what do you think'",
      "Use 'يا مرحبا' for welcome",
      "Use 'الله يعطيك' for praise"
    ],
    examples: [
      "وش هاللعب يا سلام",
      "ما شاء الله تبارك",
      "يعطيك العافية",
      "يا حبيبي هذا قوي",
      "طيب طيب شرايك",
      "هالحين صار شي",
      "الله يعطيك العافية",
      "ما شاء الله عليك",
      "وش فيه هالحركة",
      "يا مرحبا باللعبة"
    ]
  },

  // 🇯🇴 Jordanian
  jo: {
    name: "Jordanian Arabic",
    script: "arabic",
    features: [
      "Use 'ايش' for 'what'",
      "Use 'هاد/هاي' for 'this'",
      "Use 'زاكي' for 'smart/nice'",
      "Use 'يا ساتر' for shock",
      "Use 'عاش' for hype",
      "Use 'الله يعطيك' for thanks",
      "Use 'كيف' for 'how'",
      "Use 'منيح' for 'good'",
      "Use 'هاي' for 'this (fem)'",
      "Use 'يلا' for 'let's go'",
      "Use 'شو' for 'what'",
      "Use 'كتير' for 'very'"
    ],
    examples: [
      "ايش هاد يا ساتر",
      "عاش يا زلمة",
      "هاي زاكي كتير",
      "الله يعطيك الصحة",
      "منيح منيح كيف",
      "شو صار هون",
      "يلا يلا نلعب",
      "هاي لعبة كتير حلوة",
      "يا ساتر شو هاد",
      "زاكي زاكي عاش"
    ]
  },

  // 🇱🇾 Libyan
  ly: {
    name: "Libyan Arabic",
    script: "arabic",
    features: [
      "Use 'اش' or 'شنو' for 'what'",
      "Use 'هادا/هادي' for 'this'",
      "Use 'ناري' or 'نار' for 'fire'",
      "Use 'يا ربي' for shock",
      "Use 'برك الله' for praise",
      "Use 'صحيح' for 'true/right'",
      "Use 'والله' for emphasis",
      "Use 'شباب' for 'guys'",
      "Use 'هادي نار' for hype",
      "Use 'يا ساتر' for shock",
      "Use 'كيفاش' for 'how'",
      "Use 'بزاف' for 'very'"
    ],
    examples: [
      "اش هادا يا ربي",
      "ناري ناري على اللعبة",
      "برك الله فيك",
      "هادي نار بزاف",
      "صحيح صحيح كيفاش",
      "والله يا ربي",
      "شباب هادي قوية",
      "يا ساتر اش صار",
      "هادي لعبة نار",
      "برك الله عليك"
    ]
  },

  // 🇲🇷 Mauritanian / Hassaniya
  mr: {
    name: "Hassaniya / Mauritanian",
    script: "arabic",
    features: [
      "Use 'شنو' for 'what'",
      "Use 'هادا/هادي' for 'this'",
      "Use 'بارك الله' for praise",
      "Use 'يا ربي' for shock",
      "Use 'صح' for 'true'",
      "Use 'والله' for emphasis",
      "Use 'زين' for 'good'",
      "Use 'هايل' for 'great'",
      "Use 'شباب' for 'guys'",
      "Use 'نار' for 'fire'"
    ],
    examples: [
      "شنو هادا يا ربي",
      "بارك الله فيك",
      "هادي زين بزاف",
      "صح صح والله",
      "هايل هايل على اللعبة",
      "يا ربي شنو صار",
      "شباب هادي نار",
      "والله يا زين",
      "هادي لعبة قوية",
      "بارك الله عليك"
    ]
  },

  // 🇧🇭 Bahrain / GCC
  bh: {
    name: "Bahraini / GCC Arabic",
    script: "arabic",
    features: [
      "Use 'وش' or 'ايش' for 'what'",
      "Use 'هذا/هذي' for 'this'",
      "Use 'ما شاء الله' for praise",
      "Use 'يعطيك العافية' for thanks",
      "Use 'يا سلام' for amazement",
      "Use 'هالحين' for 'now'",
      "Use 'شرايك' for 'what do you think'",
      "Use 'طيب' for 'ok'",
      "Use 'الله يعطيك' for praise",
      "Use 'يا هلا' for welcome"
    ],
    examples: [
      "وش هاللعب يا سلام",
      "ما شاء الله تبارك",
      "يعطيك العافية",
      "يا هلا باللعبة",
      "طيب طيب شرايك",
      "هالحين صار شي",
      "الله يعطيك العافية",
      "ما شاء الله عليك",
      "وش فيه هالحركة",
      "يا سلام على اللعب"
    ]
  },

  // 🇸🇩 Sudanese
  sd: {
    name: "Sudanese Arabic",
    script: "arabic",
    features: [
      "Use 'شنو' for 'what'",
      "Use 'ده/دي' for 'this'",
      "Use 'جامد' for 'strong'",
      "Use 'عظمة' for 'great'",
      "Use 'يا ساتر' for shock",
      "Use 'الله يديك' for thanks",
      "Use 'كيف' for 'how'",
      "Use 'تمام' for 'ok'",
      "Use 'هاي' for 'this (fem)'",
      "Use 'يلا' for 'let's go'"
    ],
    examples: [
      "شنو ده يا ساتر",
      "جامد جامد عظمة",
      "الله يديك الصحة",
      "تمام تمام كيف",
      "هاي لعبة جامدة",
      "يلا يلا نكمل",
      "يا ساتر شنو صار",
      "عظمة عظمة بجد",
      "ده فيلم مش لعبة",
      "الله يديك يا بطل"
    ]
  },

  // 🇾🇪 Yemeni
  ye: {
    name: "Yemeni Arabic",
    script: "arabic",
    features: [
      "Use 'ايش' or 'وش' for 'what'",
      "Use 'هذا/هذي' for 'this'",
      "Use 'ما شاء الله' for praise",
      "Use 'الله يعطيك' for thanks",
      "Use 'يا سلام' for amazement",
      "Use 'طيب' for 'ok'",
      "Use 'كيف' for 'how'",
      "Use 'تمام' for 'ok'",
      "Use 'هالحين' for 'now'",
      "Use 'شرايك' for 'what do you think'"
    ],
    examples: [
      "ايش هاللعب يا سلام",
      "ما شاء الله تبارك",
      "الله يعطيك الصحة",
      "طيب طيب كيف",
      "هالحين صار شي",
      "تمام تمام شرايك",
      "ما شاء الله عليك",
      "ايش فيه هالحركة",
      "يا سلام على اللعب",
      "الله يعطيك يا بطل"
    ]
  },

  // 🇮🇶 Iraqi
  iq: {
    name: "Iraqi Arabic",
    script: "arabic",
    features: [
      "Use 'شنو' for 'what'",
      "Use 'هذا/هذي' for 'this'",
      "Use 'جامد' for 'strong'",
      "Use 'عاش' for hype",
      "Use 'يا ساتر' for shock",
      "Use 'الله يوفقك' for thanks",
      "Use 'كيف' for 'how'",
      "Use 'تمام' for 'ok'",
      "Use 'هاي' for 'this (fem)'",
      "Use 'يلا' for 'let's go'",
      "Use 'والله' for emphasis"
    ],
    examples: [
      "شنو هذا يا ساتر",
      "عاش يا بطل",
      "جامد جامد والله",
      "الله يوفقك",
      "تمام تمام كيف",
      "هاي لعبة جامدة",
      "يلا يلا نكمل",
      "يا ساتر شنو صار",
      "عاش عاش يا بطل",
      "والله جامد"
    ]
  },

  // 🇰🇼 Kuwaiti
  kw: {
    name: "Kuwaiti Arabic",
    script: "arabic",
    features: [
      "Use 'ايش' or 'وش' for 'what'",
      "Use 'هذا/هذي' for 'this'",
      "Use 'ما شاء الله' for praise",
      "Use 'يعطيك العافية' for thanks",
      "Use 'يا سلام' for amazement",
      "Use 'هالحين' for 'now'",
      "Use 'شرايك' for 'what do you think'",
      "Use 'طيب' for 'ok'",
      "Use 'الله يعطيك' for praise"
    ],
    examples: [
      "ايش هاللعب يا سلام",
      "ما شاء الله تبارك",
      "يعطيك العافية",
      "طيب طيب شرايك",
      "هالحين صار شي",
      "الله يعطيك العافية",
      "ما شاء الله عليك",
      "ايش فيه هالحركة",
      "يا سلام على اللعب",
      "الله يعطيك يا بطل"
    ]
  },

  // 🇦🇪 Emirati
  ae: {
    name: "Emirati Arabic",
    script: "arabic",
    features: [
      "Use 'ايش' or 'وش' for 'what'",
      "Use 'هذا/هذي' for 'this'",
      "Use 'ما شاء الله' for praise",
      "Use 'يعطيك العافية' for thanks",
      "Use 'يا سلام' for amazement",
      "Use 'هالحين' for 'now'",
      "Use 'شرايك' for 'what do you think'",
      "Use 'طيب' for 'ok'",
      "Use 'يا هلا' for welcome",
      "Use 'الله يعطيك' for praise"
    ],
    examples: [
      "ايش هاللعب يا سلام",
      "ما شاء الله تبارك",
      "يعطيك العافية",
      "يا هلا باللعبة",
      "طيب طيب شرايك",
      "هالحين صار شي",
      "الله يعطيك العافية",
      "ما شاء الله عليك",
      "ايش فيه هالحركة",
      "يا سلام على اللعب"
    ]
  },

  // 🇶🇦 Qatari
  qa: {
    name: "Qatari Arabic",
    script: "arabic",
    features: [
      "Use 'ايش' or 'وش' for 'what'",
      "Use 'هذا/هذي' for 'this'",
      "Use 'ما شاء الله' for praise",
      "Use 'يعطيك العافية' for thanks",
      "Use 'يا سلام' for amazement",
      "Use 'هالحين' for 'now'",
      "Use 'شرايك' for 'what do you think'",
      "Use 'طيب' for 'ok'",
      "Use 'الله يعطيك' for praise",
      "Use 'يا مرحبا' for welcome"
    ],
    examples: [
      "ايش هاللعب يا سلام",
      "ما شاء الله تبارك",
      "يعطيك العافية",
      "يا مرحبا باللعبة",
      "طيب طيب شرايك",
      "هالحين صار شي",
      "الله يعطيك العافية",
      "ما شاء الله عليك",
      "ايش فيه هالحركة",
      "يا سلام على اللعب"
    ]
  },

  // 🇴🇲 Omani
  om: {
    name: "Omani Arabic",
    script: "arabic",
    features: [
      "Use 'ايش' or 'وش' for 'what'",
      "Use 'هذا/هذي' for 'this'",
      "Use 'ما شاء الله' for praise",
      "Use 'يعطيك العافية' for thanks",
      "Use 'يا سلام' for amazement",
      "Use 'هالحين' for 'now'",
      "Use 'شرايك' for 'what do you think'",
      "Use 'طيب' for 'ok'",
      "Use 'الله يعطيك' for praise"
    ],
    examples: [
      "ايش هاللعب يا سلام",
      "ما شاء الله تبارك",
      "يعطيك العافية",
      "طيب طيب شرايك",
      "هالحين صار شي",
      "الله يعطيك العافية",
      "ما شاء الله عليك",
      "ايش فيه هالحركة",
      "يا سلام على اللعب",
      "الله يعطيك يا بطل"
    ]
  },

  // 🇵🇸 Palestinian
  ps: {
    name: "Palestinian Arabic",
    script: "arabic",
    features: [
      "Use 'ايش' for 'what'",
      "Use 'هاد/هاي' for 'this'",
      "Use 'زاكي' for 'smart/nice'",
      "Use 'يا ساتر' for shock",
      "Use 'عاش' for hype",
      "Use 'الله يعطيك' for thanks",
      "Use 'كيف' for 'how'",
      "Use 'منيح' for 'good'",
      "Use 'هاي' for 'this (fem)'",
      "Use 'يلا' for 'let's go'",
      "Use 'شو' for 'what'"
    ],
    examples: [
      "ايش هاد يا ساتر",
      "عاش يا زلمة",
      "هاي زاكي كتير",
      "الله يعطيك الصحة",
      "منيح منيح كيف",
      "شو صار هون",
      "يلا يلا نلعب",
      "هاي لعبة كتير حلوة",
      "يا ساتر شو هاد",
      "زاكي زاكي عاش"
    ]
  },

  // 🇱🇧 Lebanese
  lb: {
    name: "Lebanese Arabic",
    script: "arabic",
    features: [
      "Use 'شو' for 'what'",
      "Use 'هيدا/هيدي' for 'this'",
      "Use 'كتير' for 'very'",
      "Use 'يا ساتر' for shock",
      "Use 'عاش' for hype",
      "Use 'يسلمو' for thanks",
      "Use 'كيف' for 'how'",
      "Use 'منيح' for 'good'",
      "Use 'هيدي' for 'this (fem)'",
      "Use 'يلا' for 'let's go'",
      "Use 'حلو' for 'nice'"
    ],
    examples: [
      "شو هيدا يا ساتر",
      "عاش يا زلمة",
      "هيدي حلوة كتير",
      "يسلمو على اللعبة",
      "منيح منيح كيف",
      "شو صار هون",
      "يلا يلا نلعب",
      "هيدي لعبة كتير حلوة",
      "يا ساتر شو هيدا",
      "حلو حلو عاش"
    ]
  },

  // 🇸🇾 Syrian
  sy: {
    name: "Syrian Arabic",
    script: "arabic",
    features: [
      "Use 'شو' for 'what'",
      "Use 'هاد/هاي' for 'this'",
      "Use 'كتير' for 'very'",
      "Use 'يا ساتر' for shock",
      "Use 'عاش' for hype",
      "Use 'يسلمو' for thanks",
      "Use 'كيف' for 'how'",
      "Use 'منيح' for 'good'",
      "Use 'هاي' for 'this (fem)'",
      "Use 'يلا' for 'let's go'",
      "Use 'حلو' for 'nice'"
    ],
    examples: [
      "شو هاد يا ساتر",
      "عاش يا زلمة",
      "هاي حلوة كتير",
      "يسلمو على اللعبة",
      "منيح منيح كيف",
      "شو صار هون",
      "يلا يلا نلعب",
      "هاي لعبة كتير حلوة",
      "يا ساتر شو هاد",
      "حلو حلو عاش"
    ]
  },

  // 🇨🇴 Comorian
  km: {
    name: "Comorian Arabic (Shikomori)",
    script: "arabic",
    features: [
      "Use 'nini' or 'shino' for 'what'",
      "Use 'hiya' for 'this'",
      "Use 'mzuri' for 'good'",
      "Use 'karibu' for 'welcome'",
      "Use 'asante' for 'thanks'",
      "Use 'sana' for 'very'",
      "Use 'na' for 'and/with'",
      "Use 'ni' for 'is'",
      "Use 'mimi' for 'I'",
      "Use 'wewe' for 'you'"
    ],
    examples: [
      "nini hiya mzuri",
      "karibu sana",
      "asante sana",
      "hiya mzuri sana",
      "nini karibu",
      "wewe mzuri",
      "mimi na wewe",
      "hiya sana mzuri",
      "karibu karibu",
      "asante asante"
    ]
  },

  // 🇩🇯 Djiboutian
  dj: {
    name: "Djiboutian Arabic",
    script: "arabic",
    features: [
      "Mix of Arabic and Somali/Afar influences",
      "Use 'wa' for 'and'",
      "Use 'ma' for 'what'",
      "Use 'hadi' for 'this'",
      "Use 'wanagsan' for 'good'",
      "Use 'mahadsanid' for 'thanks'",
      "Use 'sare' for 'up/high'",
      "Use 'cusub' for 'new'",
      "Use 'fiican' for 'good/nice'"
    ],
    examples: [
      "ma hadi wanagsan",
      "mahadsanid sare",
      "hadi fiican",
      "wa wanagsan",
      "ma cusub hadi",
      "sare sare fiican",
      "wanagsan wanagsan",
      "mahadsanid fiican",
      "hadi cusub sare",
      "wa fiican hadi"
    ]
  },

  // 🇸🇴 Somali (Arabic script context)
  so: {
    name: "Somali Arabic Context",
    script: "arabic",
    features: [
      "Use 'ma' for 'what'",
      "Use 'kan' for 'this'",
      "Use 'wanagsan' for 'good'",
      "Use 'mahadsanid' for 'thanks'",
      "Use 'sare' for 'up/high'",
      "Use 'cusub' for 'new'",
      "Use 'fiican' for 'good/nice'",
      "Use 'wa' for 'and'",
      "Use 'hadi' for 'this'"
    ],
    examples: [
      "ma kan wanagsan",
      "mahadsanid sare",
      "kan fiican",
      "wa wanagsan",
      "ma cusub kan",
      "sare sare fiican",
      "wanagsan wanagsan",
      "mahadsanid fiican",
      "kan cusub sare",
      "wa fiican kan"
    ]
  },

  // 🇹🇩 Chadian
  td: {
    name: "Chadian Arabic",
    script: "arabic",
    features: [
      "Use 'shu' for 'what'",
      "Use 'hada/hadi' for 'this'",
      "Use 'tamam' for 'ok'",
      "Use 'zain' for 'good'",
      "Use 'allah yik' for thanks",
      "Use 'ya rabbi' for shock",
      "Use 'kifaya' for 'enough'",
      "Use 'mashi' for 'ok/walking'",
      "Use 'shwaya' for 'a little'",
      "Use 'kullu' for 'all'"
    ],
    examples: [
      "shu hada ya rabbi",
      "tamam tamam zain",
      "allah yik zain",
      "hadi zain shwaya",
      "ya rabbi shu hada",
      "kifaya kifaya",
      "mashi mashi zain",
      "kullu tamam",
      "shu hada zain",
      "allah yik kullu"
    ]
  }
};

// Franco (Latin script) variants
const FRANCO_PROFILES = {
  tn: {
    name: "Tunisian Franco",
    examples: [
      "chnouwa hedha ya sater",
      "bravo 3lik khuya",
      "hedhi 9awiya barcha",
      "wallah ya 3dham",
      "ye3ishik 3al le3ba",
      "behi behi kifesh",
      "shbeek khuya hedhi nar",
      "ne7eb el tare9a hedhi",
      "chnouwa sar houna ya sater",
      "barcha barcha 9awiya"
    ]
  },
  dz: {
    name: "Algerian Franco",
    examples: [
      "wach hed ya rabbi",
      "saha 3lik khuya",
      "hedhi nar bzaf",
      "berk allah fik",
      "wakha wakha kifah",
      "bzaf bzaf 9awiya",
      "ne7eb el tare9a hedhi",
      "wach sar houna ya rabbi",
      "hedhi le3ba bzaf",
      "saha khuya raho 9awi"
    ]
  },
  ma: {
    name: "Moroccan Franco",
    examples: [
      "chnou hada ya salam",
      "allah y3tik essa7a",
      "hadi zwin bzaf",
      "wakha wakha kifach",
      "safi safi fhemt",
      "bghit nel3eb bhalek",
      "hadi le3ba 9awiya",
      "ya salam 3al le3ba",
      "bzaf bzaf zwina",
      "chnou kayen hna"
    ]
  },
  eg: {
    name: "Egyptian Franco",
    examples: [
      "eih da ya sater",
      "3ash ya ged3",
      "da gamed awy",
      "ya sater 3al le3ba",
      "3azma 3azma bged",
      "7elo awy kda",
      "rabbena yestor 3alek",
      "ya ged3 enta magnoun",
      "da film mesh le3ba",
      "3ash ya batal"
    ]
  },
  sa: {
    name: "Saudi Franco",
    examples: [
      "eish hal le3b ya salam",
      "ma sha allah tabarak",
      "y3tik el 3afya",
      "ya 7abibi hatha 9awi",
      "tayeb tayeb shrayek",
      "hal7in sar she",
      "allah y3tik el 3afya",
      "ma sha allah 3alek",
      "eish feeh hal 7araka",
      "ya mar7aba bel le3ba"
    ]
  },
  jo: {
    name: "Jordanian Franco",
    examples: [
      "eish had ya sater",
      "3ash ya zalame",
      "hay zaki kteer",
      "allah y3tik essa7a",
      "mne7 mne7 keef",
      "sho sar houn",
      "yalla yalla nel3ab",
      "hay le3ba kteer 7elwa",
      "ya sater sho had",
      "zaki zaki 3ash"
    ]
  },
  ly: {
    name: "Libyan Franco",
    examples: [
      "ash hada ya rabbi",
      "nari nari 3al le3ba",
      "berk allah fik",
      "hadi nar bzaf",
      "sa7ee7 sa7ee7 kifash",
      "wallah ya rabbi",
      "shabab hadi 9awiya",
      "ya sater ash sar",
      "hadi le3ba nar",
      "berk allah 3alek"
    ]
  }
};

// MSA detection patterns
const MSA_PATTERNS = [
  /ما\s+هذا/, /ما\s+هذه/, /ما\s+هذا/, /ما\s+هذه/,
  /أحسنت/, /ممتاز/, /جيد/, /جميل/, /رائع/,
  /شكرا/, /شكراً/, /مبروك/, /تهانينا/, /فارغ/,
  /عادي/, /طبيعي/, /حسنا/, /حسنًا/, /نعم/,
  /لا/, /أجل/, /بلى/, /تفضل/, /أهلا/,
  /مرحبا/, /مرحباً/, /صباح/, /مساء/, /ليلة/,
  /كيف\s+حال/, /كيف\s+حالك/, /كيف\s+حالكم/,
  /ما\s+اسم/, /من\s+أين/, /كم\s+عمر/,
  /أريد/, /أحب/, /أحبك/, /أحبكم/,
  /أحب\s+أن/, /أريد\s+أن/, /أستطيع/,
  /أقدر/, /أستطيع\s+أن/, /أقدر\s+أن/,
  /يمكن/, /يمكنني/, /يمكن\s+أن/,
  /يجب/, /يجب\s+أن/, /لابد/, /لابد\s+من/,
  /من\s+فضلك/, /من\s+فضلكم/, /لو\s+سمحت/,
  /عفوا/, /عفواً/, /آسف/, /آسفة/,
  /هذا\s+جيد/, /هذه\s+جيدة/, /هذا\s+رائع/,
  /أنا\s+سعيد/, /أنا\s+فرح/, /أنا\s+حزين/,
  /أنا\s+متعب/, /أنا\s+مرتاح/, /أنا\s+مبسوط/,
  /أنت\s+جميل/, /أنت\s+جميلة/, /أنت\s+رائع/,
  /هو\s+ذكي/, /هي\s+ذكية/, /هم\s+أذكياء/,
  /الكتاب/, /القلم/, /المدرسة/, /الجامعة/,
  /السيارة/, /البيت/, /الغرفة/, /المطبخ/,
  /الطعام/, /الماء/, /الخبز/, /اللحم/,
  /الفاكهة/, /الخضار/, /التفاح/, /الموز/,
  /اليوم/, /الأمس/, /الغد/, /الصباح/,
  /المساء/, /الليل/, /الفجر/, /الظهر/,
  /العصر/, /المغرب/, /العشاء/,
  /الأحد/, /الاثنين/, /الثلاثاء/, /الأربعاء/,
  /الخميس/, /الجمعة/, /السبت/,
  /يناير/, /فبراير/, /مارس/, /أبريل/,
  /مايو/, /يونيو/, /يوليو/, /أغسطس/,
  /سبتمبر/, /أكتوبر/, /نوفمبر/, /ديسمبر/,
  /واحد/, /اثنان/, /ثلاثة/, /أربعة/,
  /خمسة/, /ستة/, /سبعة/, /ثمانية/,
  /تسعة/, /عشرة/, /مئة/, /ألف/,
  /مليون/, /مليار/
];

// Function to get dialect profile
function getDialectProfile(arabicType, region) {
  const key = region?.toLowerCase() || 'me';

  // If franco mode
  if (arabicType === 'franco') {
    return FRANCO_PROFILES[key] || FRANCO_PROFILES['ma'];
  }

  // If darija or other arabic types
  return DIALECT_PROFILES[key] || DIALECT_PROFILES['ma'];
}

// Function to validate dialect output
function validateDialect(text, arabicType, region) {
  if (!text || typeof text !== 'string') {
    return { valid: false, reason: 'empty text' };
  }

  const profile = getDialectProfile(arabicType, region);

  // Check for MSA patterns
  const msaMatches = MSA_PATTERNS.filter(p => p.test(text));

  if (msaMatches.length > 0 && arabicType === 'darija') {
    return {
      valid: false,
      reason: 'MSA detected',
      matches: msaMatches.map(p => p.source)
    };
  }

  // Check script compliance for franco
  if (arabicType === 'franco') {
    const arabicScript = /[\u0600-\u06FF]/.test(text);
    if (arabicScript) {
      return {
        valid: false,
        reason: 'Arabic script found in franco mode'
      };
    }
  }

  // Check script compliance for arabic script modes
  if (arabicType === 'darija') {
    // Allow some Latin (for mixed words like "gg", "nice")
    // But reject if mostly Latin
    const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
    const totalChars = text.replace(/\s/g, '').length;
    if (totalChars > 0 && latinChars / totalChars > 0.5) {
      return {
        valid: false,
        reason: 'Too much Latin script in darija mode'
      };
    }
  }

  return { valid: true };
}

// Function to build dialect prompt section
function buildDialectPrompt(arabicType, region) {
  const profile = getDialectProfile(arabicType, region);

  if (!profile) {
    return '';
  }

  const isFranco = arabicType === 'franco';
  const scriptRule = isFranco
    ? "CRITICAL: Write ONLY in Latin letters (a-z). NEVER use Arabic script (ا ب ت)."
    : "CRITICAL: Write ONLY in Arabic script (ا ب ت). NEVER use Latin letters (a-z).";

  const examplesText = profile.examples
    .slice(0, 8)
    .map((ex, i) => `${i + 1}. "${ex}"`)
    .join('\n');

  const featuresText = profile.features
    .slice(0, 10)
    .map(f => `- ${f}`)
    .join('\n');

  return `
━━━━━━━━━━━━━━━━━━
DIALECT PROFILE: ${profile.name}
━━━━━━━━━━━━━━━━━━
${scriptRule}

You MUST write in ${profile.name} ONLY.
NEVER use Modern Standard Arabic (فصحى).
NEVER use formal Arabic words.

KEY FEATURES:
${featuresText}

EXAMPLES OF CORRECT ${profile.name}:
${examplesText}

YOUR OUTPUT MUST sound exactly like these examples.
Use the same vocabulary, grammar, and style.
`;
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
      .map(x => cleanText(typeof x === "string" ? x : x?.text))
      .filter(t => typeof t === "string" && t.length > 1 && t.length < 80);

  } catch (err) {
    console.log("❌ parse error:", err.message);
    return [];
  }
}

// =======================
// 🔥 KICK EMOTES DATABASE
const KICK_EMOTES = [
  "pepe", "monkas", "EZ", "OMEGALUL", "LUL", "KEKW",
  "Pog", "PogChamp", "5Head", "PepeHands", "Sadge",
  "monkaS", "monkaW", "AYAYA", "WideHard", "Pepega",
  "Clap", "peepoClap", "peepoHappy", "peepoSad",
  "COPIUM", "HUH", "Aware", "OhNo", "O_o",
  "pepeJAM", "pepeD", "pepeLaugh", "monkaEyes",
  "EZ", "Clueless", "Sure", "YES", "NO",
  "peepoLeave", "peepoArrive", "BOOBA", "Bedge"
];

function getRandomEmote() {
  return KICK_EMOTES[Math.floor(Math.random() * KICK_EMOTES.length)];
}

function getEmoteComment() {
  const count = Math.random() < 0.3 ? 3 : 2; // 30% chance for 3 emotes
  const emotes = [];
  for (let i = 0; i < count; i++) {
    emotes.push(getRandomEmote());
  }
  return emotes.join(" ");
}

function fallbackComments(channel = "") {
  const comments = [
    "😂😂",
    "gg",
    "clean 🔥",
    "lol 😂",
    "nice 🔥",
    "bravo 🔥",
    "توب 🔥",
    "يعطيك الصحة 🔥",
    "هايل 😂",
    "واو 🔥",
    "👀👀",
    "🔥🔥🔥",
    "😂😂😂",
    "👍👍",
    "🎯🎯",
    "💯💯",
    "🚀🚀",
    "👑👑",
    "⚡⚡",
    "🎉🎉"
  ];

  // Add emote-only comments (30% chance)
  if (Math.random() < 0.3) {
    comments.push(getEmoteComment());
  }

  return comments;
}
function isGoodComment(text) {
  if (!text) return false;

  const t = text.toLowerCase().trim();

  // ❌ reject too short / too long
  if (t.length < 2 || t.length > 80) return false;

  // ❌ generic spam words
  const badWords = [
    "nice",
    "gg",
    "lol",
    "wow",
    "ok",
    "😂",
    "🔥"
  ];

  // إذا تعليق فقط رموز أو كلمة عامة
  if (badWords.includes(t)) return false;

  // ❌ repeated emojis only
  if (/^[\p{Emoji}\s]+$/u.test(t)) return false;

  // ❌ no meaning sentences
  if (!/[a-zA-Z\u0600-\u06FF]/.test(t)) return false;

  return true;
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
function buildAIScene(channel) {
  const ctx = channelContext[channel] || {};

  return {
    channel,
    tone: ctx.tone || "hype",
    audienceType: ctx.audienceType || "gaming",
    intensity: ctx.intensity || "medium",
    mood:
      ctx.intensity === "high" ? "HYPE"
      : ctx.intensity === "low" ? "calm"
      : "normal",
    topic: ctx.audienceType || "general",
    chatSamples: (ctx.chatSample || []).slice(0, 8),
    timestamp: Date.now()
  };
}

// =======================
async function generateComments(channel) {
  console.log("🚨 generateComments CALLED for:", channel);

  try {
    if (!GROQ_API_KEY) return fallbackComments();

    const ctx = buildAIScene(channel);
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

    const tone = ctx.tone || "hype";
    const audienceType = ctx.audienceType || "gaming";
    const intensity = ctx.intensity || "medium";

    const chatExamples = chat.length
      ? chat.map(x => "- " + x).join("\n")
      : "- gg\n- nice\n- lol 😂";

    // 🔥 BUILD DIALECT PROMPT
    const dialectPrompt = (mode === "arabic" || mode === "mix")
      ? buildDialectPrompt(arabicType, region)
      : "";

    const prompt = `
You are a REAL viewer inside a Kick livestream chat.

━━━━━━━━━━━━━━━━━━
CHANNEL BEHAVIOR PROFILE (IMPORTANT)
━━━━━━━━━━━━━━━━━━
Tone: ${tone}
Audience Type: ${audienceType}
Intensity: ${intensity}
━━━━━━━━━━━━━━━━━━
LIVE SCENE CONTEXT (NEW UPGRADE)
━━━━━━━━━━━━━━━━━━
Current Mood: ${ctx.mood}
Topic: ${ctx.topic}
Intensity Level: ${ctx.intensity}

Recent Chat:
${chat.length ? chat.map(x => "- " + x).join("\n") : "- no chat data"}

IMPORTANT:
Base your comments ONLY on this scene.
Do NOT generate random unrelated reactions.
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
- You MAY use Unicode emojis (🔥 😂 👀 🎯 💯) naturally in comments.
- You MAY use Kick emotes (pepe, monkas, EZ, OMEGALUL, Pog, KEKW, Sadge) in comments.
- Sometimes send ONLY emotes (2-3 emotes) as a reaction.
- Sometimes mix text + emotes (e.g., "nice play Pog", "lol 😂 EZ").
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
LANGUAGE HARD LOCK (NEW SYSTEM)
━━━━━━━━━━━━━━━━━━

You MUST obey language mode strictly:

IF mode = "english":
- Output ONLY English sentences
- ZERO Arabic, ZERO French

IF mode = "french":
- Output ONLY French sentences
- ZERO Arabic, ZERO English

IF mode = "arabic":
  ${dialectPrompt}

IF mode = "mix":
- Only then mix languages naturally (max 2 languages per comment)

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
HUMAN CHAT SPEED RULE (NEW)
━━━━━━━━━━━━━━━━━━

- Each comment must feel typed in real-time chat
- No long sentences
- No structured grammar
- Natural rhythm variation:

50% → 2–4 words
40% → 4–7 words
10% → 7–10 words (rare reactions)

No repetitive timing patterns
No formal writing
━━━━━━━━━━━━━━━━━━
STREAM BINDING RULE (CRITICAL FIX)
━━━━━━━━━━━━━━━━━━

Every comment MUST contain at least ONE:

- reaction to action
- reaction to emotion
- reaction to gameplay
- reaction to moment

NEVER:
- general statements
- life talk
- greetings
- disconnected words

If no stream context exists → fallback ONLY
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
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: `You are a livestream chat comment generator. You MUST follow dialect rules EXACTLY. NEVER output Modern Standard Arabic when dialect is requested. Use ONLY the specific dialect vocabulary and grammar shown in the examples.`
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.4,
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
        // 🔥 VALIDATE DIALECT
        finalComments = parsed
          .map(t => cleanText(t))
          .filter(t => {
            if (mode !== "arabic" && mode !== "mix") return isGoodComment(t);
            const validation = validateDialect(t, arabicType, region);
            if (!validation.valid) {
              console.log("⚠️ Dialect validation failed:", t, "→", validation.reason);
              return false;
            }
            return isGoodComment(t);
          })
          .map(t => ({ text: t }));
      }
    }

    if (!finalComments.length) {
      // 🔥 FALLBACK WITH DIALECT
      const profile = getDialectProfile(arabicType, region);
      if (profile && profile.examples && profile.examples.length > 0) {
        const dialectFallbacks = profile.examples
          .slice(0, 5)
          .map(ex => ({ text: ex }));
        finalComments = dialectFallbacks;
      } else {
        finalComments = fallbackComments().map(t => ({
          text: cleanText(t)
        }));
      }
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

        if (!res.ok) {
          isLiveNow = false;
          break;
        }

        const data = await res.json();
        console.log("🔍", channel, data?.livestream?.is_live);

        let apiLive =
          data?.livestream &&
          data.livestream !== null &&
          data.livestream.is_live === true;

        if (!apiLive) {
          let htmlCheck = false;
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
setInterval(() => {

  const now = Date.now();

  for (const channel in verificationSessions) {

    const s = verificationSessions[channel];

    if (now - s.lastHeartbeat > 15 * 60 * 1000) {
      s.expired = true;
      s.verified = false;
    }

    if (now - s.startedAt > 60 * 60 * 1000) {
      delete verificationSessions[channel];
    }
  }

}, 60000);

refreshChannels();
refreshLive();

// =======================
app.get("/sync", (req, res) => {

  if (verificationMode.active) {
    return res.json({
      status: "active",
      channels: cachedChannels,
      vipChannels: [...vipChannels],
      verificationActive: verificationMode.active
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
app.post("/admin/start-presence-monitoring", (req, res) => {

  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ ok: false });
  }

  const { channels } = req.body;

  for (const ch of channels) {
    const clean = normalize(ch);

    verificationSessions[clean] = {
      startedAt: Date.now(),
      lastHeartbeat: Date.now(),
      totalTime: 0,
      completed: false,
      expired: false
    };
  }

  console.log("🟢 Presence monitoring started");

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
    const { text, type } = req.body;

    if (!text || text.length < 2) {
      return res.json({ ok: false });
    }

    globalNotice = {
      active: true,
      id: Date.now(),
      version: Date.now(),
      text: String(text).trim(),
      type: req.body.type || "normal",
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
// 🧠 PRESENCE HEARTBEAT

app.post("/presence/ping", (req, res) => {

  try {

    const {
      userId,
      channel,
      videoPlaying,
      tabId
    } = req.body || {};

    if (!userId) {

      return res.json({
        ok: false
      });
    }

    const p =
      ensurePresence(userId);

    const now = getNow();

    if (
      channel &&
      p.channel &&
      normalize(channel) !== p.channel
    ) {

      p.suspicious++;

      console.log(
        "⚠️ channel mismatch:",
        userId
      );
    }

    if (
      tabId &&
      p.tabId &&
      tabId !== p.tabId
    ) {

      p.suspicious++;

      console.log(
        "⚠️ tab mismatch:",
        userId
      );
    }

    const diff =
      now - (p.lastPing || 0);

    if (
      p.lastPing &&
      diff < 5000
    ) {

      p.suspicious++;

      console.log(
        "⚠️ spam ping:",
        userId
      );
    }

    p.lastPing = now;

    p.disconnected = false;

    p.pingCount++;

    p.videoOk =
      videoPlaying === true;

    if (
      videoPlaying === true
    ) {

      if (!p.lastWatchStart) {
        p.lastWatchStart = now;
      }

    } else {

      if (p.lastWatchStart) {

        p.totalWatchMs +=
          now - p.lastWatchStart;

        p.lastWatchStart = 0;
      }
    }

    return res.json({

      ok: true,

      suspicious: p.suspicious,

      totalWatchMs:
        p.totalWatchMs
    });

  } catch (err) {

    console.log(
      "❌ presence/ping error",
      err.message
    );

    return res.json({
      ok: false
    });
  }
});
// =======================
// 🔥 START VERIFICATION SESSION

app.post("/verification/start", (req, res) => {

  try {

    const { channel } = req.body;

    if (!channel) {
      return res.json({
        ok: false
      });
    }

    const cleanChannel =
      normalize(channel);

    verificationSessions[cleanChannel] = {

      verified: false,

      startedAt: Date.now(),

      lastHeartbeat: Date.now(),

      totalTime: 0,

      completed: false,

      expired: false
    };

    console.log(
      "🟢 verification started:",
      cleanChannel
    );

    return res.json({
      ok: true
    });

  } catch (err) {

    console.log(
      "❌ verification start error",
      err.message
    );

    return res.json({
      ok: false
    });
  }
});

// =======================
let verificationSessions = {};

app.post("/verification/heartbeat", (req, res) => {

  try {

    const { channel } = req.body;

    if (!channel) return res.json({ ok: false });

    const clean = normalize(channel);

    const session = verificationSessions[clean];

    if (!session) {
      return res.json({ ok: false, reason: "no_session" });
    }

    const now = Date.now();

    session.lastHeartbeat = now;

    session.totalTime = now - session.startedAt;

    session.expired = false;

    return res.json({
      ok: true,
      time: session.totalTime
    });

  } catch (err) {
    return res.json({ ok: false });
  }
});

// =======================
// 🔥 ADMIN DASHBOARD STATUS API

app.get("/admin/dashboard-status", (req, res) => {

  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ ok: false });
  }

  const now = Date.now();
  const result = {};

  for (const channel in verificationSessions) {

    const session = verificationSessions[channel];

    const lastSeen = session.lastHeartbeat || session.startedAt;
    const firstSeen = session.startedAt;

    const diff = now - lastSeen;

    let status = "red";

    if (diff < 2 * 60 * 1000) {
      status = "green";
    } else if (diff < 10 * 60 * 1000) {
      status = "yellow";
    }

    const attendance = Object.values(attendanceMemory)
      .find(a => normalize(a.channel) === channel);

    result[channel] = {
      firstSeen,
      lastSeen,
      lastSeenAgo: diff,
      totalTime: session.totalTime || 0,
      status,
      completed: session.completed || false,
      expired: session.expired || false,

      attendance: attendance ? {
        confirmed: true,
        confirmedAt: attendance.confirmedAt
      } : {
        confirmed: false
      }
    };
  }

  return res.json(result);
});
// =======================
// 🔴 STOP VERIFICATION

app.post("/admin/stop-verification", (req, res) => {

  const key =
    req.headers["x-admin-key"];

  if (key !== ADMIN_KEY) {
    return res
      .status(403)
      .json({ ok: false });
  }

  verificationSessions = {};

  verificationMode.active = false;

  verificationMode.channels = [];

  console.log("🔴 Verification stopped");

  return res.json({
    ok: true
  });
});
app.post("/attendance/confirm", (req, res) => {
  try {

    const { userId, channel } = req.body;

    if (!userId || !channel) {
      return res.json({ ok: false });
    }

    console.log("📥 Attendance confirmed:", userId, channel);

    if (!presenceMemory[userId]) {
      presenceMemory[userId] = {};
    }

    presenceMemory[userId].attended = true;
    presenceMemory[userId].channel = channel;
    presenceMemory[userId].time = Date.now();

    return res.json({ ok: true });

  } catch (err) {
    console.log("attendance error:", err.message);
    return res.json({ ok: false });
  }
});
// =======================

// =======================
// 🔐 ADMIN AUTH VERIFICATION
// =======================
app.post("/admin/verify", (req, res) => {
  const { password } = req.body;

  if (!ADMIN_KEY) {
    return res.status(500).json({ ok: false, error: "ADMIN_KEY not configured" });
  }

  if (password === ADMIN_KEY) {
    return res.json({ ok: true, valid: true });
  }

  return res.status(403).json({ ok: false, valid: false });
});

// Serve static files (index.html)
app.use(express.static('public'));

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
