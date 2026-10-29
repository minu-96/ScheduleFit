// 스케줄 핏 API (Cloudflare Pages Functions + D1)
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const err = (m, s = 400) => json({ error: m }, s);

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';
const rnd = (n) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((x) => ALPHA[x % 32]).join('');
};

const MAX_PEOPLE = 100;
function cleanWeeks(w) {
  if (!w || typeof w !== 'object' || Array.isArray(w)) return null;
  const keys = Object.keys(w);
  if (keys.length > 80) return null;
  const out = {};
  for (const k of keys) {
    const v = w[k];
    if (!/^\d{8}$/.test(k) || typeof v !== 'string' || v.length > 400 || !/^[A-Z0-9,\-\/]*$/.test(v)) return null;
    if (v) out[k] = v;
  }
  return out;
}


// ---------- 추가 테이블 / 잠금 / 확정 일정 ----------
let tablesReady = false;
async function ensureTables(DB) {
  if (tablesReady) return;
  await DB.batch([
    DB.prepare('CREATE TABLE IF NOT EXISTS fixes (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, note TEXT NOT NULL DEFAULT \'\', created_at INTEGER NOT NULL)'),
    DB.prepare('CREATE INDEX IF NOT EXISTS idx_fixes_room ON fixes (room_id)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS fails (k TEXT PRIMARY KEY, n INTEGER NOT NULL, ts INTEGER NOT NULL)'),
  ]);
  tablesReady = true;
}
// 비밀번호 대입 공격 방지: limit번 틀리면 lockMs 동안 잠금
async function lockedFor(DB, k, limit, lockMs) {
  const r = await DB.prepare('SELECT n,ts FROM fails WHERE k=?').bind(k).first();
  if (!r) return 0;
  const left = r.ts + lockMs - Date.now();
  if (left <= 0) { await DB.prepare('DELETE FROM fails WHERE k=?').bind(k).run(); return 0; }
  return r.n >= limit ? left : 0;
}
async function addFail(DB, k) {
  const now = Date.now();
  await DB.prepare('INSERT INTO fails (k,n,ts) VALUES (?,1,?) ON CONFLICT(k) DO UPDATE SET n=n+1, ts=?').bind(k, now, now).run();
}
const clearFail = (DB, k) => DB.prepare('DELETE FROM fails WHERE k=?').bind(k).run();

const MAX_FIXES = 200;
function validDate(s) {
  if (!/^\d{8}$/.test(s)) return false;
  const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
  const t = new Date(Date.UTC(y, m - 1, d));
  return y >= 2020 && y <= 2100 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
function cleanFix(b) {
  const title = String(b.title || '').trim().slice(0, 30) || '확정 일정';
  const note = String(b.note || '').trim().slice(0, 100);
  const date = String(b.date || '');
  const start = Number(b.start), end = Number(b.end);
  if (!validDate(date)) return null;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > 23 || end <= start || end > 24) return null;
  return { title, note, date, start, end };
}
async function fixOverlap(DB, id, f, selfId) {
  const r = await DB.prepare('SELECT title FROM fixes WHERE room_id=? AND date=? AND start<? AND end>? AND id<>? LIMIT 1').bind(id, f.date, f.end, f.start, selfId || '').first();
  return r ? r.title : null;
}
const fixView = (f) => ({ id: f.id, title: f.title, date: f.date, start: f.start, end: f.end, note: f.note });
async function roomFixes(DB, id) {
  const rows = (await DB.prepare('SELECT * FROM fixes WHERE room_id=? ORDER BY date,start').bind(id).all()).results || [];
  return rows.map(fixView);
}
const delRoomStmts = (DB, id) => [
  DB.prepare('DELETE FROM tokens WHERE person_id IN (SELECT id FROM people WHERE room_id=?)').bind(id),
  DB.prepare('DELETE FROM people WHERE room_id=?').bind(id),
  DB.prepare('DELETE FROM fixes WHERE room_id=?').bind(id),
  DB.prepare('DELETE FROM rooms WHERE id=?').bind(id),
];
const delPersonStmts = (DB, id, pid) => [
  DB.prepare('DELETE FROM tokens WHERE person_id IN (SELECT id FROM people WHERE id=? AND room_id=?)').bind(pid, id),
  DB.prepare('DELETE FROM people WHERE id=? AND room_id=?').bind(pid, id),
];
function hoursOf(weeksJson) {
  let n = 0;
  try {
    for (const v of Object.values(JSON.parse(weeksJson || '{}'))) {
      for (const seg of String(v).split('/')) {
        for (const r of (seg.slice(3) || '').split(',')) {
          const m = r.match(/^(\d+)-(\d+)$/);
          if (m) n += Math.max(0, +m[2] - +m[1]);
        }
      }
    }
  } catch {}
  return n;
}

// ---------- 운영자 ----------
async function handleOps({ request, env, seg, body, DB }) {
  const m = request.method;
  if (!env.OPS_ID || !env.OPS_PW) return err('운영자 계정이 아직 설정되지 않았어요', 503);
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  const lk = 'ops:' + ip;
  const left = await lockedFor(DB, lk, 5, 15 * 60 * 1000);
  if (left) return err(`로그인 시도가 너무 많아요. ${Math.ceil(left / 60000)}분 뒤에 다시 시도해 주세요`, 429);
  const okId = (await sha('ops-id:' + (request.headers.get('x-ops-id') || ''))) === (await sha('ops-id:' + env.OPS_ID));
  const okPw = (await sha('ops-pw:' + (request.headers.get('x-ops-pw') || ''))) === (await sha('ops-pw:' + env.OPS_PW));
  if (!(okId && okPw)) {
    await addFail(DB, lk);
    return err('아이디나 비밀번호가 맞지 않아요', 401);
  }
  await clearFail(DB, lk);

  if (seg[1] !== 'rooms') return err('없는 주소예요', 404);

  if (seg.length === 2 && m === 'GET') {
    const rows = (await DB.prepare(
      `SELECT r.id,r.name,r.show,r.created_at,
        (SELECT COUNT(*) FROM people p WHERE p.room_id=r.id) AS n,
        (SELECT MAX(updated_at) FROM people p WHERE p.room_id=r.id) AS last,
        (SELECT COUNT(*) FROM fixes f WHERE f.room_id=r.id) AS fx
       FROM rooms r ORDER BY r.created_at DESC LIMIT 500`).all()).results || [];
    return json({ rooms: rows.map((r) => ({ id: r.id, name: r.name, show: r.show, created: r.created_at, people: r.n || 0, last: r.last || null, fixes: r.fx || 0 })) });
  }

  const id = seg[2];
  if (!id || !/^[a-z0-9]{10}$/.test(id)) return err('방을 찾을 수 없어요', 404);
  const room = await DB.prepare('SELECT * FROM rooms WHERE id=?').bind(id).first();
  if (!room) return err('방을 찾을 수 없어요', 404);

  if (seg.length === 3 && m === 'GET') {
    const ppl = (await DB.prepare('SELECT id,name,pin_hash,weeks,updated_at FROM people WHERE room_id=? ORDER BY name').bind(id).all()).results || [];
    return json({
      room: { id, name: room.name, show: room.show, created: room.created_at },
      people: ppl.map((p) => ({ id: p.id, name: p.name, hours: hoursOf(p.weeks), at: p.updated_at, hasPin: !!p.pin_hash })),
      fixes: await roomFixes(DB, id),
    });
  }
  if (seg.length === 3 && m === 'PATCH') {
    const name = body.name === undefined ? room.name : String(body.name).trim().slice(0, 30);
    if (!name) return err('방 이름을 적어 주세요');
    const show = body.show === undefined ? room.show : body.show === 'admin' ? 'admin' : 'all';
    await DB.prepare('UPDATE rooms SET name=?, show=? WHERE id=?').bind(name, show, id).run();
    return json({ ok: true });
  }
  if (seg.length === 3 && m === 'DELETE') {
    await DB.batch(delRoomStmts(DB, id));
    return json({ ok: true });
  }
  if (seg[3] === 'people' && seg[4] && m === 'DELETE') {
    await DB.batch(delPersonStmts(DB, id, seg[4]));
    return json({ ok: true });
  }
  if (seg[3] === 'fixes' && seg[4] && m === 'DELETE') {
    await DB.prepare('DELETE FROM fixes WHERE id=? AND room_id=?').bind(seg[4], id).run();
    return json({ ok: true });
  }
  return err('지원하지 않는 요청이에요', 405);
}

async function handle({ request, env, params }) {
  const DB = env.DB;
  if (!DB) return err('데이터베이스가 연결되지 않았어요', 500);
  const seg = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const m = request.method;
  const token = request.headers.get('x-token') || '';
  const adminKey = request.headers.get('x-admin') || '';
  let body = {};
  if (m === 'POST' || m === 'PUT' || m === 'PATCH') {
    try { body = await request.json(); } catch { return err('요청 형식이 올바르지 않아요'); }
    if (!body || typeof body !== 'object') return err('요청 형식이 올바르지 않아요');
  }

  await ensureTables(DB);
  if (seg[0] === 'ops') return handleOps({ request, env, seg, body, DB });
  if (seg[0] !== 'rooms') return err('없는 주소예요', 404);

  // 방 만들기
  if (seg.length === 1 && m === 'POST') {
    const name = String(body.name || '').trim().slice(0, 30);
    if (!name) return err('방 이름을 적어 주세요');
    const show = body.show === 'admin' ? 'admin' : 'all';
    const id = rnd(10), admin = rnd(24);
    await DB.prepare('INSERT INTO rooms (id,name,show,admin_hash,created_at) VALUES (?,?,?,?,?)')
      .bind(id, name, show, await sha('admin:' + id + ':' + admin), Date.now()).run();
    return json({ id, adminKey: admin });
  }

  const id = seg[1];
  if (!id || !/^[a-z0-9]{10}$/.test(id)) return err('방을 찾을 수 없어요', 404);
  const room = await DB.prepare('SELECT * FROM rooms WHERE id=?').bind(id).first();
  if (!room) return err('방을 찾을 수 없어요', 404);
  const isAdmin = !!adminKey && (await sha('admin:' + id + ':' + adminKey)) === room.admin_hash;
  const me = token
    ? await DB.prepare('SELECT p.* FROM people p JOIN tokens t ON t.person_id=p.id WHERE p.room_id=? AND t.token_hash=?').bind(id, await sha('tok:' + token)).first()
    : null;

  // 방 보기
  if (seg.length === 2 && m === 'GET') {
    const rows = (await DB.prepare('SELECT id,name,weeks,updated_at FROM people WHERE room_id=? ORDER BY name').bind(id).all()).results || [];
    const view = (r) => ({ id: r.id, name: r.name, weeks: JSON.parse(r.weeks || '{}'), at: r.updated_at });
    const canSeeAll = room.show === 'all' || isAdmin;
    const people = canSeeAll ? rows.map(view) : rows.filter((r) => me && r.id === me.id).map(view);
    return json({
      room: { id, name: room.name, show: room.show, total: rows.length },
      isAdmin,
      fixes: await roomFixes(DB, id),
      me: me ? { id: me.id, name: me.name, weeks: JSON.parse(me.weeks || '{}') } : null,
      people,
    });
  }

  // 방 설정 바꾸기 / 방 삭제 (방장)
  if (seg.length === 2 && (m === 'PATCH' || m === 'DELETE')) {
    if (!isAdmin) return err('방장만 할 수 있어요', 403);
    if (m === 'DELETE') {
      await DB.batch(delRoomStmts(DB, id));
      return json({ ok: true });
    }
    const name = body.name === undefined ? room.name : String(body.name).trim().slice(0, 30);
    if (!name) return err('방 이름을 적어 주세요');
    const show = body.show === undefined ? room.show : body.show === 'admin' ? 'admin' : 'all';
    await DB.prepare('UPDATE rooms SET name=?, show=? WHERE id=?').bind(name, show, id).run();
    return json({ ok: true });
  }

  // 참여 (비밀번호 필수)
  if (seg[2] === 'join' && m === 'POST') {
    const name = String(body.name || '').trim().slice(0, 20);
    const pin = String(body.pin || '').trim().slice(0, 12);
    if (!name) return err('이름을 적어 주세요');
    if (pin.length < 4) return err('비밀번호를 4자 이상 적어 주세요');
    const ex = await DB.prepare('SELECT * FROM people WHERE room_id=? AND name=?').bind(id, name).first();
    const newToken = rnd(24);
    if (ex) {
      const lk = 'join:' + id + ':' + name;
      const left = await lockedFor(DB, lk, 8, 10 * 60 * 1000);
      if (left) return err(`비밀번호를 여러 번 틀렸어요. ${Math.ceil(left / 60000)}분 뒤에 다시 시도해 주세요`, 429);
      if (!ex.pin_hash) return err('비밀번호 없이 만들어진 예전 참여자예요. 방장에게 내보내기를 요청한 뒤 다시 들어와 주세요', 409);
      if ((await sha('pin:' + id + ':' + pin)) === ex.pin_hash) {
        await clearFail(DB, lk);
        await DB.prepare('INSERT INTO tokens (token_hash,person_id) VALUES (?,?)').bind(await sha('tok:' + newToken), ex.id).run();
        return json({ token: newToken, pid: ex.id, name });
      }
      await addFail(DB, lk);
      return err('이미 쓰는 이름이에요. 내 이름이라면 비밀번호를 확인해 주세요. 아니라면 다른 이름으로 들어가 주세요', 409);
    }
    const cnt = await DB.prepare('SELECT COUNT(*) AS n FROM people WHERE room_id=?').bind(id).first();
    if ((cnt?.n || 0) >= MAX_PEOPLE) return err('이 방은 가득 찼어요', 409);
    const pid = rnd(12);
    await DB.batch([
      DB.prepare('INSERT INTO people (id,room_id,name,pin_hash,weeks,updated_at) VALUES (?,?,?,?,?,?)')
        .bind(pid, id, name, await sha('pin:' + id + ':' + pin), '{}', Date.now()),
      DB.prepare('INSERT INTO tokens (token_hash,person_id) VALUES (?,?)').bind(await sha('tok:' + newToken), pid),
    ]);
    return json({ token: newToken, pid, name });
  }

  // 내 시간 저장
  if (seg[2] === 'me' && m === 'PUT') {
    if (!me) return err('다시 들어와 주세요', 401);
    const weeks = cleanWeeks(body.weeks);
    if (!weeks) return err('시간표 형식이 올바르지 않아요');
    await DB.prepare('UPDATE people SET weeks=?, updated_at=? WHERE id=?').bind(JSON.stringify(weeks), Date.now(), me.id).run();
    return json({ ok: true });
  }

  // 참여자 삭제 (방장)
  if (seg[2] === 'people' && seg[3] && m === 'DELETE') {
    if (!isAdmin) return err('방장만 할 수 있어요', 403);
    await DB.batch(delPersonStmts(DB, id, seg[3]));
    return json({ ok: true });
  }

  // 확정 일정 추가 / 삭제 (방장)
  if (seg[2] === 'fixes') {
    if (!isAdmin) return err('방장만 할 수 있어요', 403);
    if (seg.length === 3 && m === 'POST') {
      const f = cleanFix(body);
      if (!f) return err('날짜와 시간을 확인해 주세요');
      const clash = await fixOverlap(DB, id, f, '');
      if (clash) return err(`그 시간에 이미 “${clash}” 일정이 확정돼 있어요`, 409);
      const cnt = await DB.prepare('SELECT COUNT(*) AS n FROM fixes WHERE room_id=?').bind(id).first();
      if ((cnt?.n || 0) >= MAX_FIXES) return err('확정 일정은 방마다 200개까지 만들 수 있어요', 409);
      const fid = rnd(12);
      await DB.prepare('INSERT INTO fixes (id,room_id,title,date,start,end,note,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(fid, id, f.title, f.date, f.start, f.end, f.note, Date.now()).run();
      return json({ ok: true, fix: { id: fid, ...f } });
    }
    if (seg.length === 4 && m === 'PATCH') {
      const f = cleanFix(body);
      if (!f) return err('날짜와 시간을 확인해 주세요');
      const clash = await fixOverlap(DB, id, f, seg[3]);
      if (clash) return err(`그 시간에 이미 “${clash}” 일정이 확정돼 있어요`, 409);
      await DB.prepare('UPDATE fixes SET title=?,date=?,start=?,end=?,note=? WHERE id=? AND room_id=?')
        .bind(f.title, f.date, f.start, f.end, f.note, seg[3], id).run();
      return json({ ok: true });
    }
    if (seg.length === 4 && m === 'DELETE') {
      await DB.prepare('DELETE FROM fixes WHERE id=? AND room_id=?').bind(seg[3], id).run();
      return json({ ok: true });
    }
  }

  return err('지원하지 않는 요청이에요', 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const path = url.pathname.slice(5).split('/').filter(Boolean);
      return handle({ request, env, params: { path } });
    }
    if (/^\/r\/[^/]+\/?$/.test(url.pathname)) {
      return env.ASSETS.fetch(new Request(new URL('/room', url), request));
    }
    return env.ASSETS.fetch(request);
  },
};
