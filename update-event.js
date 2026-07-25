const { createHash } = require('node:crypto');

const API = 'https://mine-a-mountain-roblox.fandom.com/api.php';
const UNIVERSE = '10187294555';
const PLACE = '125927821145949';
const PAGE = 'Template:Next event';
const FILE = 'Current event.png';
const UA = 'MaMWikiEventBot/1.0 (wiki maintenance; contact via wiki talk page)';

let cookies = {};
const cookieHeader = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

function storeCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
}

async function api(params, method = 'GET') {
  const body = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const res = await fetch(method === 'GET' ? `${API}?${body}` : API, {
    method,
    headers: {
      'user-agent': UA,
      cookie: cookieHeader(),
      ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
    },
    body: method === 'POST' ? body : undefined
  });
  storeCookies(res);
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json;
}

async function login() {
  const t = await api({ action: 'query', meta: 'tokens', type: 'login' });
  const r = await api({
    action: 'login',
    lgname: process.env.WIKI_USER,
    lgpassword: process.env.WIKI_PASS,
    lgtoken: t.query.tokens.logintoken
  }, 'POST');
  if (r.login.result !== 'Success') throw new Error('Login failed: ' + r.login.result);
}

async function nextEvent() {
  const res = await fetch(
    `https://apis.roblox.com/virtual-events/v1/universes/${UNIVERSE}/virtual-events`,
    { headers: { 'accept-language': 'en-US', 'user-agent': UA } }
  );
  if (!res.ok) throw new Error('Roblox events API returned ' + res.status);
  const now = Date.now();
  return ((await res.json()).data || [])
    .filter(e => e.eventVisibility === 'public' && e.eventTime?.endUtc)
    .filter(e => new Date(e.eventTime.endUtc).getTime() > now)
    .sort((a, b) => new Date(a.eventTime.startUtc) - new Date(b.eventTime.startUtc))[0] || null;
}

async function thumbnailBytes(mediaId) {
  const meta = await fetch(
    `https://thumbnails.roblox.com/v1/assets?assetIds=${mediaId}&size=768x432&format=Png&isCircular=false`,
    { headers: { 'user-agent': UA } }
  ).then(r => r.json());
  const entry = meta.data?.[0];
  if (!entry || entry.state !== 'Completed' || !entry.imageUrl) return null;
  const img = await fetch(entry.imageUrl, { headers: { 'user-agent': UA } });
  if (!img.ok) return null;
  return Buffer.from(await img.arrayBuffer());
}

async function syncImage(bytes) {
  const sha1 = createHash('sha1').update(bytes).digest('hex');
  const info = await api({
    action: 'query', titles: 'File:' + FILE, prop: 'imageinfo', iiprop: 'sha1'
  });
  if (info.query.pages[0]?.imageinfo?.[0]?.sha1 === sha1) {
    console.log('Image unchanged.');
    return;
  }
  const t = await api({ action: 'query', meta: 'tokens' });
  const form = new FormData();
  form.set('action', 'upload');
  form.set('format', 'json');
  form.set('formatversion', '2');
  form.set('filename', FILE);
  form.set('comment', 'Updating event thumbnail from Roblox (automated)');
  form.set('text', "Event thumbnail from the game's Roblox page. Uploaded automatically; do not edit.\n\n[[Category:Miscellaneous]]");
  form.set('ignorewarnings', '1');
  form.set('token', t.query.tokens.csrftoken);
  form.set('file', new Blob([bytes]), FILE);

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'user-agent': UA, cookie: cookieHeader() },
    body: form
  });
  storeCookies(res);
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  console.log('Image uploaded.');
}

const esc = s => String(s ?? '')
  .replace(/[|{}\[\]]/g, c => '&#' + c.charCodeAt(0) + ';')
  .replace(/'{2,}/g, m => '&#39;'.repeat(m.length));

const clean = s => esc(s).replace(/[\r\n]+/g, ' ').trim();

const cleanBlock = s => esc(s).replace(/\r/g, '').split('\n')
  .map(l => l.trim()).filter(Boolean).join('<br>');

const fmtDate = d => new Date(d).toLocaleString('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric'
});
const fmtTime = d => new Date(d).toLocaleString('en-GB', {
  timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false
});

const label = c => {
  const s = String(c || '').replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const FOOTER = `<noinclude>
'''This page is maintained automatically.''' It is rewritten from Roblox's event data by a bot — do not edit it by hand, as changes will be overwritten.

Used by [[Admin Abuse]].
[[Category:Navigation templates]]
</noinclude>`;

function render(ev, hasImage) {
  if (!ev) {
    return `<includeonly>''No event is currently scheduled. Check the [https://www.roblox.com/games/${PLACE}/Mine-a-Mountain Roblox page] for announcements.''</includeonly>${FOOTER}`;
  }

  const tag = ev.eventCategories?.[0]?.category;
  const when = `${fmtDate(ev.eventTime.startUtc)}, ${fmtTime(ev.eventTime.startUtc)} &ndash; ${fmtTime(ev.eventTime.endUtc)} UTC`;

  const img = hasImage
    ? `<div class="mam-event-img">[[File:${FILE}|336px|link=]]</div>`
    : '';

  const desc = ev.displayDescription
    ? `<div class="mam-event-desc mw-collapsible mw-collapsed"><div class="mw-collapsible-content">${cleanBlock(ev.displayDescription)}</div></div>`
    : '';

  return `<includeonly><div class="mam-event">
<div class="mam-event-top">${img}
<div class="mam-event-info">
${tag ? `<div class="mam-event-tag">${clean(label(tag))}</div>` : ''}
<div class="mam-event-title">${clean(ev.displayTitle || ev.title)}</div>
${ev.displaySubtitle ? `<div class="mam-event-sub">${clean(ev.displaySubtitle)}</div>` : ''}
<div class="mam-event-time">${when}</div>
</div>
</div>${desc}
</div>
''Times are shown in UTC. Announced on the [https://www.roblox.com/games/${PLACE}/Mine-a-Mountain Roblox page].''</includeonly>${FOOTER}`;
}

(async () => {
  const ev = await nextEvent();
  await login();

  let hasImage = false;
  if (ev?.thumbnails?.[0]?.mediaId) {
    const bytes = await thumbnailBytes(ev.thumbnails[0].mediaId);
    if (bytes) {
      await syncImage(bytes);
      hasImage = true;
    } else {
      console.log('Thumbnail not available — rendering without image.');
    }
  }

  const wikitext = render(ev, hasImage);
  const cur = await api({ action: 'query', titles: PAGE, prop: 'revisions', rvprop: 'content', rvslots: 'main' });
  const page = cur.query.pages[0];
  const existing = page.missing ? '' : page.revisions[0].slots.main.content;

  if (existing.trim() === wikitext.trim()) {
    console.log('No change — skipping edit.');
    return;
  }

  const t = await api({ action: 'query', meta: 'tokens' });
  await api({
    action: 'edit',
    title: PAGE,
    text: wikitext,
    summary: 'Updating scheduled event from Roblox (automated)',
    token: t.query.tokens.csrftoken
  }, 'POST');

  console.log('Page updated.');
})().catch(e => { console.error(e); process.exit(1); });
