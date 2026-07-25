const API = 'https://mine-a-mountain-roblox.fandom.com/api.php';
const UNIVERSE = '10187294555';
const PLACE = '125927821145949';
const PAGE = 'Template:Next event';
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
  if (!res.ok) throw new Error('Roblox API returned ' + res.status);
  const now = Date.now();
  return ((await res.json()).data || [])
    .filter(e => e.eventVisibility === 'public' && e.eventTime?.endUtc)
    .filter(e => new Date(e.eventTime.endUtc).getTime() > now)
    .sort((a, b) => new Date(a.eventTime.startUtc) - new Date(b.eventTime.startUtc))[0] || null;
}

const clean = s => String(s ?? '').replace(/\|/g, '&#124;').replace(/[\r\n]+/g, ' ').trim();

const fmt = d => new Date(d).toLocaleString('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false
}).replace(',', ',') + ' UTC';

const FOOTER = `<noinclude>
'''This page is maintained automatically.''' It is rewritten from Roblox's event data by a bot — do not edit it by hand, as changes will be overwritten.

Used by [[Admin Abuse]].
[[Category:Navigation templates]]
</noinclude>`;

function render(ev) {
  if (!ev) {
    return `<includeonly>''No event is currently scheduled. Check the [https://www.roblox.com/games/${PLACE}/Mine-a-Mountain Roblox page] for announcements.''</includeonly>${FOOTER}`;
  }
  const upcoming = new Date(ev.eventTime.startUtc).getTime() > Date.now();
  const rows = [
    `! Event\n| ${clean(ev.displayTitle || ev.title)}`,
    ev.displaySubtitle ? `! Details\n| ${clean(ev.displaySubtitle)}` : null,
    `! Starts\n| ${fmt(ev.eventTime.startUtc)}`,
    `! Ends\n| ${fmt(ev.eventTime.endUtc)}`
  ].filter(Boolean).join('\n|-\n');

  return `<includeonly>{| class="mam-table" style="width:100%;"
! colspan="2" | ${upcoming ? 'Upcoming event' : 'Event in progress'}
|-
${rows}
|}
''Times are shown in UTC. Announced on the [https://www.roblox.com/games/${PLACE}/Mine-a-Mountain Roblox page].''</includeonly>${FOOTER}`;
}

(async () => {
  const wikitext = render(await nextEvent());
  await login();

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
    token: t.query.tokens.csrftoken,
    bot: '1'
  }, 'POST');

  console.log('Page updated.');
})().catch(e => { console.error(e); process.exit(1); });