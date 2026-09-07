import { getStore } from "@netlify/blobs";

const HOLES = 36;
const DIVISIONS = ["Kids","Beginners","Amateur","Advanced","Women","Pro","Masters","Grandmaster"];
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" } });
const clean = (s, n = 40) => String(s ?? "").replace(/[<>]/g, "").trim().slice(0, n);
const id = () => Math.random().toString(36).slice(2, 10);

async function read(store, ev) {
  const d = (await store.get("event:" + ev, { type: "json" })) || {};
  d.players ||= [];   // {id,name,disc,division,groupId,createdAt}
  d.groups ||= [];    // {id,startHole,name,createdAt}
  d.status ||= "live"; // signup | live  (starts open for testing; admin can "Reopen sign-ups" to lock cards before the real round)
  d.updatedAt ||= 0;
  return d;
}
async function write(store, ev, d) { d.updatedAt = Date.now(); await store.setJSON("event:" + ev, d); return d; }

export default async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  const url = new URL(req.url);
  const ev = clean(url.searchParams.get("event") || "default", 40).toLowerCase().replace(/[^a-z0-9_-]/g, "") || "default";
  const store = getStore({ name: "onendone", consistency: "strong" });

  if (req.method === "GET") return json(await read(store, ev));

  let body = {}; try { body = await req.json(); } catch {}
  const act = body.action;
  const d = await read(store, ev);
  const adminOk = body.pin === "2727";

  if (act === "signup") {
    const name = clean(body.name, 40), disc = clean(body.disc, 40), division = DIVISIONS.includes(body.division) ? body.division : "";
    if (!name) return json({ error: "Name required" }, 400);
    const ex = d.players.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (ex) return json({ error: "taken", player: ex }, 409);
    const p = { id: id(), name, disc, division, groupId: null, createdAt: Date.now() };
    d.players.push(p); await write(store, ev, d); return json({ ok: true, player: p, data: d });
  }
  if (act === "update") {  // player edits own sign-up (name/disc/division only); admin edits anyone
    const p = d.players.find(x => x.id === body.playerId); if (!p) return json({ error: "no player" }, 404);
    if (body.name !== undefined) { const n = clean(body.name, 40); if (n && !d.players.some(x => x.id !== p.id && x.name.toLowerCase() === n.toLowerCase())) p.name = n; }
    if (body.disc !== undefined) p.disc = clean(body.disc, 40);
    if (body.division !== undefined && (DIVISIONS.includes(body.division) || body.division === "")) p.division = body.division;
    await write(store, ev, d); return json({ ok: true, player: p, data: d });
  }
  if (act === "remove") {
    if (!adminOk && !body.playerId) return json({ error: "no" }, 403);
    d.players = d.players.filter(x => x.id !== body.playerId); await write(store, ev, d); return json({ ok: true, data: d });
  }
  if (act === "createGroup") {
    if (!adminOk) return json({ error: "admin only" }, 403);
    const sh = Number(body.startHole);
    if (!(sh >= 0 && sh < HOLES)) return json({ error: "bad hole" }, 400);
    let g = d.groups.find(x => x.startHole === sh);
    if (g && !body.force) return json({ error: "hole taken", group: g }, 409);
    if (!g) { g = { id: id(), startHole: sh, name: clean(body.name, 40) || ("Start hole " + (sh + 1)), createdAt: Date.now() }; d.groups.push(g); }
    if (body.name) g.name = clean(body.name, 40);
    if (Array.isArray(body.playerIds)) { d.players.forEach(p => { if (p.groupId === g.id) p.groupId = null; }); body.playerIds.forEach(pid => { const p = d.players.find(x => x.id === pid); if (p) p.groupId = g.id; }); }
    if (body.playerId) { const p = d.players.find(x => x.id === body.playerId); if (p) p.groupId = g.id; }
    await write(store, ev, d); return json({ ok: true, group: g, data: d });
  }
  if (act === "setMembers") {
    if (!adminOk) return json({ error: "admin only" }, 403);
    const g = d.groups.find(x => x.id === body.groupId); if (!g) return json({ error: "no group" }, 404);
    d.players.forEach(p => { if (p.groupId === g.id) p.groupId = null; });
    (body.playerIds || []).forEach(pid => { const p = d.players.find(x => x.id === pid); if (p) p.groupId = g.id; });
    if (body.name !== undefined) g.name = clean(body.name, 40) || g.name;
    if (body.startHole !== undefined) { const sh = Number(body.startHole); if (sh >= 0 && sh < HOLES) g.startHole = sh; }
    await write(store, ev, d); return json({ ok: true, data: d });
  }
  if (act === "addPlayer") {  // admin adds a walk-up who never signed up
    if (!adminOk) return json({ error: "admin only" }, 403);
    const name = clean(body.name, 40); if (!name) return json({ error: "Name required" }, 400);
    let p = d.players.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!p) { p = { id: id(), name, disc: clean(body.disc, 40), division: DIVISIONS.includes(body.division) ? body.division : "", groupId: null, createdAt: Date.now() }; d.players.push(p); }
    await write(store, ev, d); return json({ ok: true, player: p, data: d });
  }
  if (act === "setHole") {
    if (!adminOk) return json({ error: "admin only" }, 403);
    const g = d.groups.find(x => x.id === body.groupId); const sh = Number(body.startHole);
    if (!g || !(sh >= 0 && sh < HOLES)) return json({ error: "bad" }, 400);
    g.startHole = sh; await write(store, ev, d); return json({ ok: true, data: d });
  }
  if (act === "deleteGroup") {
    if (!adminOk) return json({ error: "admin only" }, 403);
    d.groups = d.groups.filter(x => x.id !== body.groupId); d.players.forEach(p => { if (p.groupId === body.groupId) p.groupId = null; });
    await write(store, ev, d); return json({ ok: true, data: d });
  }
  if (act === "setStatus") {
    if (!adminOk) return json({ error: "admin only" }, 403);
    if (!["signup", "live"].includes(body.status)) return json({ error: "bad status" }, 400);
    d.status = body.status; d.startedAt = body.status === "live" ? Date.now() : null;
    await write(store, ev, d); return json({ ok: true, data: d });
  }
  if (act === "reset") {
    if (!adminOk) return json({ error: "admin only" }, 403);
    await write(store, ev, { players: [], groups: [], status: "signup" }); return json({ ok: true });
  }
  return json({ error: "unknown action" }, 400);
};

export const config = { path: "/api" };
