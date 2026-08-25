/* ST Tracker — landing page behaviour.
   Vanilla, no dependencies, no build step. Three jobs: language, scroll reveals, and sending
   a typed plate into the live app. */

const APP = 'https://tracker.shivrajsinh.in';

/* ------------------------------------------------------------------ language */

/**
 * What Google shows in the result, per language.
 *
 * Kept apart from the `data-i18n` pass over the body because <title> and the meta description
 * are not elements anyone sees on the page — but they are the two strings that decide whether a
 * search result gets clicked, and leaving the Gujarati URL under an English title would waste
 * the point of giving it a URL at all.
 */
const META = {
  en: {
    title: 'GSRTC Live Bus Tracking — Track Any Gujarat ST Bus on a Map | ST Tracker',
    description: 'Track any Gujarat ST (GSRTC) bus live on a map by its number plate. See where it is now, when it reaches your stop, full timetables between any two stations, and alerts before it arrives. Free, no ads, no account.',
  },
  gu: {
    title: 'GSRTC લાઈવ બસ ટ્રેકિંગ — કોઈપણ ગુજરાત ST બસ નકશા પર જુઓ | ST Tracker',
    description: 'નંબર પ્લેટથી કોઈપણ ગુજરાત ST (GSRTC) બસનું લાઈવ લોકેશન નકશા પર જુઓ. બસ અત્યારે ક્યાં છે, તમારા સ્ટોપ પર ક્યારે પહોંચશે, બે સ્ટેશન વચ્ચેનું ટાઈમ ટેબલ અને બસ નજીક આવે ત્યારે અલર્ટ. મફત, જાહેરાત વગર, લોગિન વગર.',
  },
};

const STRINGS = {
  en: {},   // English lives in the markup, so it needs no table and cannot drift from it.
  gu: {
    brandSub: 'ગુજરાત ST બસ, લાઈવ',
    navFeatures: 'સુવિધાઓ',
    navHow: 'કેવી રીતે વાપરવું',
    navRoutes: 'રૂટ',
    openApp: 'એપ ખોલો',
    openApp2: 'એપ ખોલો',
    openApp3: 'ST Tracker ખોલો',

    eyebrow: 'મફત · જાહેરાત વગર · લોગિન વગર',
    h1: 'કોઈપણ ગુજરાત ST બસ, નકશા પર લાઈવ',
    lede: 'નંબર પ્લેટ લખો અને બસને ચાલતી જુઓ. કયો સ્ટોપ હમણાં જ પસાર કર્યો, કેટલી ઝડપે જાય છે, અને તમારા સુધી ક્યારે પહોંચશે — બસ સ્ટોપ પર ઊભા રહેનારા લોકો માટે બનાવેલું.',
    plateLabel: 'બસ નંબર પ્લેટ',
    track: 'ટ્રેક કરો',
    plateHint: 'તે બસનો લાઈવ નકશો ખૂલશે. પ્લેટ ન હોય તો ઉદાહરણ અજમાવો.',
    miniNext: 'આગળનો સ્ટોપ',
    miniSpeed: 'ઝડપ',
    miniAway: 'તમારાથી',

    statBuses: 'બસ કાફલામાં',
    statStations: 'સ્ટેશન આવરી લેવાયાં',
    statLive: 'લાઈવ',
    statLiveSub: 'દર થોડી સેકંડે લોકેશન',
    statLang: 'ભાષા — અંગ્રેજી અને ગુજરાતી',

    featuresH: 'મુસાફરને ખરેખર જે જોઈએ તે બધું',
    featuresSub: 'ટાઈમ ટેબલનું બોર્ડ નહીં. તમારી બસ અત્યારે ક્યાં છે તેનું જીવંત ચિત્ર.',
    f1H: 'નંબર પ્લેટથી લાઈવ લોકેશન',
    f1P: 'બસ પર લખેલી પ્લેટ નાખો. નકશા પર તેનું સ્થાન, હમણાં પસાર કરેલો સ્ટોપ, આગળનો સ્ટોપ, ઝડપ અને તમારાથી અંતર મળશે.',
    f2H: 'આખો રૂટ, સ્ટોપ પ્રમાણે',
    f2P: 'લાઈન પરનો દરેક સ્ટોપ જુઓ — બસ ખરેખર કયા સમયે પહોંચી, કયા સ્ટોપ પાછળ રહી ગયા અને કયા હજી બાકી છે.',
    f3H: 'કોઈપણ બે સ્ટેશન વચ્ચેનું ટાઈમ ટેબલ',
    f3P: 'અમદાવાદથી રાજકોટ, રાજકોટથી મોરબી, કે 19,026 સ્ટેશનમાંથી કોઈપણ જોડી શોધો. સેવાના પ્રકાર પ્રમાણે ગાળો, ઉપડવાના સમય કે મુસાફરીના સમય પ્રમાણે ગોઠવો, અને ઉપડી ગયેલી બસ પણ જુઓ — આગળના સ્ટોપથી ચડવું હોય તો.',
    f4H: 'બસ પહોંચે તે પહેલાં અલર્ટ',
    f4P: 'તમે જે સ્ટોપ પર ઊભા છો તે પસંદ કરો. બસ નજીક આવે ત્યારે ફોન જણાવશે, જેથી બહાર નીકળવાનું યોગ્ય હોય ત્યાં સુધી અંદર રહી શકો.',
    f5H: 'બસમાં કેટલી ભીડ છે',
    f5P: 'મુસાફરો જણાવે છે કે બેઠક ખાલી છે, લોકો ઊભા છે, બસ આવી જ નહીં કે બદલાઈ ગઈ. કઈ બસની રાહ જોવી તે નક્કી કરતાં પહેલાં જ યાદીમાં દેખાય છે.',
    f6H: 'નેટવર્ક ન હોય ત્યારે પણ ચાલે',
    f6P: 'હોમ સ્ક્રીન પર ઇન્સ્ટોલ કરો — પૂરી સ્ક્રીનમાં ખૂલશે, તરત ચાલુ થશે, અને નેટવર્ક જાય ત્યારે છેલ્લે ખબર હતી તે લોકેશન બતાવશે.',

    howH: 'ત્રણ ટૅપ, સાઇન-અપ વગર',
    s1H: 'ખોલો',
    s1P: 'ખાતું નહીં, ઈમેલ નહીં, એપ સ્ટોર નહીં. બ્રાઉઝરમાં ચાલે છે અને ઇચ્છો તો હોમ સ્ક્રીન પર ઇન્સ્ટોલ થાય છે.',
    s2H: 'પ્લેટ લખો, અથવા રૂટ પસંદ કરો',
    s2P: 'નંબરથી એક બસ ટ્રેક કરો, અથવા બે સ્ટેશન વચ્ચે શોધીને ઉપડતી બસમાંથી પસંદ કરો.',
    s3H: 'આવતી જુઓ',
    s3P: 'નકશો બસની પાછળ ચાલે છે. તમારો સ્ટોપ પસંદ કરો અને ક્યારે નીકળવું તે એપ જણાવશે.',

    screensH: 'એપ કેવી દેખાય છે',
    screensSub: 'ત્રણ સ્ક્રીન લગભગ બધું કામ કરે છે. નીચે દેખાય છે તે ખરેખરનું ઇન્ટરફેસ છે, તમે જે થીમમાં વાંચી રહ્યા છો તેમાં.',
    shot1: 'ટ્રેક — બસ ક્યાં છે અને તમારા સુધી ક્યારે પહોંચશે',
    shot2: 'રૂટ — દરેક ઉપડતી બસ, અને દરેકમાં કેટલી ભીડ',
    shot3: 'નજીકમાં — તમારી આસપાસના સ્ટોપ, નકશા પર',
    routesH: 'લોકપ્રિય GSRTC રૂટ',
    routesSub: 'લાઈવ ઉપડતી બસ અને ટાઈમ ટેબલ, એક ટૅપ દૂર.',

    faqH: 'લોકો પૂછે છે તે પ્રશ્નો',
    q1: 'શું આ GSRTC ની સત્તાવાર એપ છે?',
    a1: 'ના. ST Tracker ગુજરાત ST ના મુસાફરો માટે બનાવેલું સ્વતંત્ર સાધન છે. ઓપરેટર જે લાઈવ લોકેશન આપે છે તે જ બતાવે છે, પણ બસ સ્ટોપ પર ઝડપથી વાંચી શકાય તે રીતે. તે GSRTC સાથે સંકળાયેલું નથી.',
    q2: 'લાઈવ લોકેશન કેટલું સચોટ છે?',
    a2: 'લોકેશન બસ પરના GPS માંથી જ આવે છે અને બસ ટ્રિપ પર હોય ત્યારે દર થોડી સેકંડે અપડેટ થાય છે. પહોંચવાનો સમય તે લોકેશન અને ટાઈમ ટેબલ પરથી ગણાય છે, અને પૂરતી માહિતી ન હોય તો એપ ખોટો આંકડો બતાવવાને બદલે ચૂપ રહે છે.',
    q3: 'મારી બસ કેમ મળતી નથી?',
    a3: 'બસ ખરેખર ટ્રિપ પર ચાલતી હોય ત્યારે જ ઓપરેટર તેનું લોકેશન આપે છે. ડેપોમાં ઊભેલી કે ટ્રિપ પૂરી કરી ચૂકેલી બસ ફરી ઉપડે ત્યાં સુધી દેખાશે નહીં.',
    q4: 'શું આઇફોન પર ચાલે છે?',
    a4: 'હા. Safari માં ખોલો, Share દબાવો, પછી Add to Home Screen પસંદ કરો. પછી તે ઇન્સ્ટોલ કરેલી એપની જેમ પૂરી સ્ક્રીનમાં ચાલશે. આઇફોન પર અલર્ટ માટે પહેલાં હોમ સ્ક્રીન પર ઇન્સ્ટોલ કરવું જરૂરી છે.',
    q5: 'શું તે મફત છે?',
    a5: 'હા, અને કોઈ જાહેરાત નથી, કોઈ સબસ્ક્રિપ્શન નથી અને ખાતું બનાવવાની જરૂર નથી. તે ગુજરાતના મુસાફરો માટે જાહેર સેવા તરીકે ચલાવાય છે.',
    q6: 'શું ગુજરાતીમાં ઉપલબ્ધ છે?',
    a6: 'હા. આખી એપ અને આ પાનું ગુજરાતીમાં ઉપલબ્ધ છે, અને ઓપરેટર આપે ત્યાં સ્ટેશન અને રૂટનાં નામ પણ ગુજરાતીમાં દેખાય છે.',

    closerH: 'બસ ક્યાં છે તેની અટકળ બંધ કરો',
    closerP: 'એક ટૅપ, અને કંઈ ખર્ચ નહીં.',

    footTag: 'ગુજરાત ST (GSRTC) બસ માટે લાઈવ ટ્રેકિંગ.',
    footApp: 'એપ ખોલો',
    footPrivacy: 'ગોપનીયતા',
    footCoffee: 'મને કોફી પીવડાવો',
    footFine: 'આ એક સ્વતંત્ર પ્રોજેક્ટ છે, GSRTC કે ગુજરાત સરકાર સાથે સંકળાયેલો કે તેમના દ્વારા માન્ય નથી.',
  },
};

/** The English text as authored, captured once so switching back is lossless. */
const ORIGINAL = new Map();

function setLanguage(lang, { push = true } = {}) {
  const table = STRINGS[lang] || {};

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (!ORIGINAL.has(el)) ORIGINAL.set(el, el.innerHTML);
    const next = lang === 'en' ? ORIGINAL.get(el) : table[key];
    if (next != null) el.innerHTML = next;
  });

  document.documentElement.lang = lang === 'gu' ? 'gu-IN' : 'en-IN';
  document.querySelectorAll('.lang button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  });

  const meta = META[lang] || META.en;
  document.title = meta.title;
  const set = (sel, val) => document.querySelector(sel)?.setAttribute('content', val);
  set('meta[name="description"]', meta.description);
  set('meta[property="og:title"]', meta.title);
  set('meta[property="og:description"]', meta.description);

  try { localStorage.setItem('st.landing.lang', lang); } catch { /* private mode */ }

  if (push) {
    // A real URL for the Gujarati edition. Without one the language lived only in
    // localStorage, which a crawler does not have — so half the page was unindexable, and it
    // could not be shared in the language it was being read in.
    const url = new URL(location.href);
    if (lang === 'gu') url.searchParams.set('lang', 'gu');
    else url.searchParams.delete('lang');
    history.replaceState(null, '', url);
  }
}

function initLanguage() {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  let stored = null;
  try { stored = localStorage.getItem('st.landing.lang'); } catch { /* private mode */ }
  // The URL wins: a shared link should open in the language it was shared in.
  const start = (fromUrl === 'gu' || fromUrl === 'en') ? fromUrl
    : (stored === 'gu' || stored === 'en') ? stored
      : (navigator.languages || []).some((l) => /^gu/i.test(l)) ? 'gu' : 'en';

  setLanguage(start, { push: start !== 'en' });
  document.querySelectorAll('.lang button').forEach((b) => {
    b.addEventListener('click', () => setLanguage(b.dataset.lang));
  });
}

/* ------------------------------------------------------------------ theme */

/**
 * Light, dark, or whatever the device says.
 *
 * Three states rather than two: someone who has never touched this should follow their phone
 * when it switches at dusk, and someone who has chosen should be obeyed on every visit. A
 * two-way toggle cannot express "follow the system" once it has been pressed.
 */
const THEMES = ['auto', 'light', 'dark'];

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);

  const dark = mode === 'dark'
    || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);

  // The <source media> in the markup follows the *system*, which is correct with no JavaScript
  // and wrong the moment someone uses the toggle: a light page would keep showing the dark
  // screenshots. Inside a <picture> a matching <source> always beats the <img src>, so the
  // source is what has to be rewritten — setting `img.src` alone changes nothing at all.
  const want = dark ? 'dark' : 'light';
  document.querySelectorAll('.shot picture').forEach((pic) => {
    const src = pic.querySelector('source');
    const img = pic.querySelector('img');
    if (src) src.srcset = src.srcset.replace(/-(light|dark)\.webp/, `-${want}.webp`);
    if (img) img.src = img.src.replace(/-(light|dark)\.webp/, `-${want}.webp`);
  });

  // Keeps the browser chrome in step with the page on mobile.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = dark ? '#0b1220' : '#f6f8fc';
  document.head.appendChild(meta);

  try { localStorage.setItem('st.landing.theme', mode); } catch { /* private mode */ }
}

function initTheme() {
  let mode = 'auto';
  try { mode = localStorage.getItem('st.landing.theme') || 'auto'; } catch { /* private mode */ }
  if (!THEMES.includes(mode)) mode = 'auto';
  applyTheme(mode);

  document.getElementById('theme-btn')?.addEventListener('click', () => {
    let current = 'auto';
    try { current = localStorage.getItem('st.landing.theme') || 'auto'; } catch { /* ignore */ }
    // From "auto", the first press should visibly change something — so it jumps to the
    // opposite of what is on screen, not to the next name in the list.
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const next = current === 'auto' ? (dark ? 'light' : 'dark')
      : current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });
}

/* ------------------------------------------------------------------ reveals */

function initReveals() {
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (!entry.isIntersecting) return;
      // Staggered within a batch so a row of cards arrives in sequence rather than as one
      // block. Capped, because a long list should not have its last item waiting a second.
      entry.target.style.transitionDelay = `${Math.min(i, 4) * 70}ms`;
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: .12 });
  items.forEach((el) => io.observe(el));
}

/* ------------------------------------------------------------------ counters */

function initCounters() {
  const nums = document.querySelectorAll('[data-count]');
  if (!nums.length || !('IntersectionObserver' in window)) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      io.unobserve(el);
      const target = Number(el.dataset.count);
      if (reduced || !Number.isFinite(target)) return;

      const started = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - started) / 1100);
        // Eased out, so it decelerates into the real figure instead of stopping dead.
        const eased = 1 - (1 - p) ** 3;
        el.textContent = Math.round(target * eased).toLocaleString('en-IN');
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { threshold: .6 });
  nums.forEach((n) => io.observe(n));
}

/* ------------------------------------------------------------------ faq */

/**
 * One answer open at a time.
 *
 * `<details name="faq">` does this natively in current browsers and keeps working with no
 * JavaScript at all, which is why the markup carries it. This closes the others for the
 * browsers that do not support the attribute yet — without it every answer stays open and the
 * section becomes a wall of text.
 */
function initFaq() {
  const items = [...document.querySelectorAll('.faq details')];
  if (!items.length) return;
  const supportsNative = 'name' in document.createElement('details');
  if (supportsNative) return;

  items.forEach((d) => {
    d.addEventListener('toggle', () => {
      if (!d.open) return;
      items.forEach((other) => { if (other !== d) other.open = false; });
    });
  });
}

/* ------------------------------------------------------------------ plate */

function initPlateForm() {
  const form = document.getElementById('plate-form');
  const input = document.getElementById('plate');
  if (!form || !input) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    // Falls back to the example rather than refusing: someone who presses Track with an empty
    // box wants to see what this does, and a validation error is a poor answer to that.
    const raw = input.value.trim().toUpperCase() || input.placeholder;
    const plate = raw.replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '');
    location.href = `${APP}/?plate=${encodeURIComponent(plate)}`;
  });
}

/* ------------------------------------------------------------------ header */

function initHeader() {
  const bar = document.querySelector('.bar');
  if (!bar) return;
  const onScroll = () => bar.classList.toggle('stuck', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ------------------------------------------------------------------ boot */

// Marks the document as scripted *before* anything else. The reveal styles hide their elements
// only under `.js`, so a page whose script fails to run still shows all of its content rather
// than a column of invisible sections.
document.documentElement.classList.add('js');

const boot = () => {
  initTheme();
  initLanguage();
  initHeader();
  initReveals();
  initCounters();
  initPlateForm();
  initFaq();
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
