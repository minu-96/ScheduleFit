// 팀 스케쥴 매칭 API (Cloudflare Pages Functions + D1)
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
      me: me ? { id: me.id, name: me.name, weeks: JSON.parse(me.weeks || '{}') } : null,
      people,
    });
  }

  // 방 설정 바꾸기 / 방 삭제 (방장)
  if (seg.length === 2 && (m === 'PATCH' || m === 'DELETE')) {
    if (!isAdmin) return err('방장만 할 수 있어요', 403);
    if (m === 'DELETE') {
      await DB.batch([
        DB.prepare('DELETE FROM tokens WHERE person_id IN (SELECT id FROM people WHERE room_id=?)').bind(id),
        DB.prepare('DELETE FROM people WHERE room_id=?').bind(id),
        DB.prepare('DELETE FROM rooms WHERE id=?').bind(id),
      ]);
      return json({ ok: true });
    }
    const name = body.name === undefined ? room.name : String(body.name).trim().slice(0, 30);
    if (!name) return err('방 이름을 적어 주세요');
    const show = body.show === undefined ? room.show : body.show === 'admin' ? 'admin' : 'all';
    await DB.prepare('UPDATE rooms SET name=?, show=? WHERE id=?').bind(name, show, id).run();
    return json({ ok: true });
  }

  // 참여
  if (seg[2] === 'join' && m === 'POST') {
    const name = String(body.name || '').trim().slice(0, 20);
    const pin = String(body.pin || '').trim().slice(0, 12);
    if (!name) return err('이름을 적어 주세요');
    if (pin && pin.length < 4) return err('비밀번호는 4자 이상으로 적어 주세요');
    const ex = await DB.prepare('SELECT * FROM people WHERE room_id=? AND name=?').bind(id, name).first();
    const newToken = rnd(24);
    if (ex) {
      if (pin && ex.pin_hash && (await sha('pin:' + id + ':' + pin)) === ex.pin_hash) {
        await DB.prepare('INSERT INTO tokens (token_hash,person_id) VALUES (?,?)').bind(await sha('tok:' + newToken), ex.id).run();
        return json({ token: newToken, pid: ex.id, name });
      }
      return err(ex.pin_hash ? '이미 쓰는 이름이에요. 비밀번호가 맞는지 확인해 주세요' : '이미 쓰는 이름이에요. 다른 이름으로 들어가 주세요', 409);
    }
    const cnt = await DB.prepare('SELECT COUNT(*) AS n FROM people WHERE room_id=?').bind(id).first();
    if ((cnt?.n || 0) >= MAX_PEOPLE) return err('이 방은 가득 찼어요', 409);
    const pid = rnd(12);
    await DB.batch([
      DB.prepare('INSERT INTO people (id,room_id,name,pin_hash,weeks,updated_at) VALUES (?,?,?,?,?,?)')
        .bind(pid, id, name, pin ? await sha('pin:' + id + ':' + pin) : null, '{}', Date.now()),
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
    await DB.batch([
      DB.prepare('DELETE FROM tokens WHERE person_id IN (SELECT id FROM people WHERE id=? AND room_id=?)').bind(seg[3], id),
      DB.prepare('DELETE FROM people WHERE id=? AND room_id=?').bind(seg[3], id),
    ]);
    return json({ ok: true });
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
