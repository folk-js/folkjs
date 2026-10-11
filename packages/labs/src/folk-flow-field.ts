import { ReactiveElement, css, property, type PropertyValues } from '@folkjs/dom/ReactiveElement';

declare global {
  interface HTMLElementTagNameMap {
    'folk-flow-field': FolkFlowField;
  }
}

/**
 * Geodesic flow field / Voronoi on a pixel grid, on the GPU.
 *
 * Draw walls and goals; every free pixel gets the shortest (any-angle, obstacle-respecting) distance to the nearest
 * goal, that goal's label (geodesic Voronoi) and a flow direction.
 *
 * Per pixel we store (distance, emitter, label). The emitter is the point the pixel measures a straight line from: a
 * goal, or the pixel where the shortest path last bends around a wall. A pixel improves itself from a neighbour q in
 * two ways:
 *  - inherit: take q's emitter E, value = (d(q) − |q − E|) + |p − E|, allowed only when the neighbours of p that the
 *    line p→E passes between are free and also see E (a local line-of-sight test), so distances are Euclidean in open
 *    space and do not leak around corners;
 *  - bend: take q itself as the emitter, value = d(q) + |p − q| (only when strictly better).
 * Every value is the length of a real path, so the field converges monotonically from above. The flow direction at p
 * is towards its emitter, and following emitters traces the shortest path.
 *
 * Solver: the image is split into 32×32 tiles. A tile is loaded into workgroup memory and relaxed with four directional
 * sweeps (→ ← ↓ ↑), one thread per row or column: each step updates one pixel per thread from the three pixels behind
 * it, which the previous step already finished, so updates are in place and race-free and information crosses the
 * tile in one sweep. Sweeps repeat until the tile is stable. Tiles are scheduled in a 2×2 checkerboard (4 dispatches
 * per round) so no tile is read while it is written, and information can cross several tiles per round. Tiles whose
 * neighbourhood did not change are skipped. Edits only invalidate what they can affect: a new wall resets pixels whose
 * distance is at least the smallest old distance under the new wall (no path through it can be shorter), an erased goal
 * resets its own label; adding goals and erasing walls need no reset.
 */

const TS = 32; // tile size; a 32-lane workgroup holds K = 32 / TS tiles (16 measured slower: twice the rounds)
const K = 32 / TS;
const MAX_ROUNDS = 64; // max rounds encoded per frame (4 dispatches each)
const UNI_STRIDE = 256;
const MAX_PATH = 2048;
const MAX_GOALS = 1000; // labels live in 10 bits
const MAX_SIZE = 1024; // emitter coordinates live in 11 bits each, in half pixels

const SCENE_WALL = 0xffffffff;

const common = /* wgsl */ `
const INF: f32 = 1e30;
const PK_NONE: u32 = 0xffffffffu;   // unreached
const PK_WALL: u32 = 0xfffffffeu;
const SCENE_WALL: u32 = 0xffffffffu;
// packed state: emitter x (11 bits) | emitter y (11 bits) | label (10 bits). Emitter coordinates are in half pixels, so
// an emitter is a pixel centre (odd) or a wall corner (even); positions are in a frame where pixel x spans [x, x + 1].
fn pk(x2: i32, y2: i32, label: u32) -> u32 { return u32(x2) | (u32(y2) << 11u) | (label << 22u); }
fn pkPix(x: i32, y: i32, label: u32) -> u32 { return pk(2 * x + 1, 2 * y + 1, label); }
fn epos(p: u32) -> vec2f { return vec2f(f32(p & 0x7ffu), f32((p >> 11u) & 0x7ffu)) * 0.5; }
fn pkE(p: u32) -> u32 { return p & 0x3fffffu; }
fn pkX(p: u32) -> i32 { return i32(p & 0x7ffu); }
fn pkY(p: u32) -> i32 { return i32((p >> 11u) & 0x7ffu); }
fn pkL(p: u32) -> u32 { return p >> 22u; }
fn valid(p: u32) -> bool { return p < PK_WALL; }
// packed distance + visibility: distance in 1/1024 px (26 bits, up to 65536 px) | visibility of the emitter (6 bits)
const DQ_INF: u32 = 0x3ffffffu;
const DV_INF: u32 = 0xffffffffu;
fn dvD(x: u32) -> f32 { let q = x >> 6u; return select(f32(q) * (1.0 / 1024.0), INF, q >= DQ_INF); }
fn dvV(x: u32) -> f32 { return f32(x & 63u) * (1.0 / 63.0); }
fn mkDV(d: f32, v: f32) -> u32 {
  // (clamp in float below 2^26 first: f32(DQ_INF - 1) rounds up to 2^26 and would wrap to 0)
  let q = min(u32(min(d * 1024.0 + 0.5, 6.7e7)), DQ_INF - 1u);
  return (q << 6u) | u32(clamp(v, 0.0, 1.0) * 63.0 + 0.5);
}
`;

// ── Tile relaxation by directional sweeps ──
const solveShader = (sg: boolean) => /* wgsl */ `
${sg ? 'enable subgroups;' : ''}
${common}
struct Dispatch { phase: u32, k: u32, _a: u32, _b: u32 }
struct Frame { base: u32, n: u32, tiles: u32, maxPass: u32 }
@group(0) @binding(0) var<uniform> pd: Dispatch;
@group(0) @binding(1) var<uniform> fr: Frame;
@group(0) @binding(2) var<storage, read_write> dv: array<u32>;
@group(0) @binding(3) var<storage, read_write> state: array<u32>;
@group(0) @binding(4) var<storage, read_write> stamp: array<u32>;
@group(0) @binding(5) var<storage, read_write> pend: array<u32>;
@group(0) @binding(6) var<storage, read_write> stats: array<atomic<u32>>;

const TS: i32 = ${TS};
const HS: i32 = ${TS + 2};
const HN: i32 = ${(TS + 2) * (TS + 2)};
const SQRT2: f32 = 1.41421356;
// improvement thresholds (px): a change must beat these, so waves of negligible improvements stop early
const EPS_INHERIT: f32 = 0.006;
const EPS_BEND: f32 = 0.012;
const EPS_TIE: f32 = 0.004;

// a workgroup is one 32-lane subgroup holding K = 32 / TS tiles side by side; lane = sub * TS + t
const K: i32 = ${K};
var<workgroup> sdv: array<u32, ${K * (TS + 2) * (TS + 2)}>; // packed distance + visibility, per tile with halo
var<workgroup> sp: array<u32, ${K * (TS + 2) * (TS + 2)}>;  // packed emitter + label
var<workgroup> walls: array<u32, ${K * (TS + 2) * 2}>;      // wall bits per halo row (2 words), constant during the solve
var<workgroup> wallsC: array<u32, ${K * (TS + 2) * 2}>;     // ... and per halo column
var<workgroup> colBits: array<u32, ${K * TS}>;              // changed pixels found by vertical sweeps, per column
var<workgroup> rowBits: array<u32, ${K * TS}>;              // all changed pixels, per row
var<workgroup> wact: array<u32, ${K}>;
var<workgroup> wany: u32;
var<workgroup> wch: array<u32, ${K}>;                       // a sweep changed this tile
var<workgroup> wneed: array<u32, ${K}>;                     // this tile needs full sweeps
var<workgroup> wdir: array<u32, 4>;                         // border checks: which directions found improvements
var<workgroup> wdone: u32;


// visibility of emitter E from the pixel at global (x, y) with packed state p / dv: 1 if it is E, its stored
// visibility if its own emitter is E, else 0
fn visOf(p: u32, d: u32, x: i32, y: i32, E: u32) -> f32 {
  if (!valid(p)) { return 0.0; }
  if (pkE(pkPix(x, y, 0u)) == E) { return 1.0; }
  if (pkE(p) == E) { return dvV(d); }
  return 0.0;
}

struct Px { d: u32, p: u32, improved: bool }

// Relax one pixel (global gx, gy; halo hx, hy; current packed cd / cp) from the three pixels behind it in a sweep
// with step direction u and lateral v: k = -1, 0, +1 along v, given as packed (dm, pm), (d0, p0), (dq1, pq1).
// wbits: walls beside p (bit 0: lateral -1, bit 1: lateral +1) and beside the pixel behind (bit 2: -1, bit 3: +1).
fn relax(wbits: u32, cd: u32, cp: u32, gx: i32, gy: i32, u: vec2i, v: vec2i,
         dm: u32, pm: u32, d0: u32, p0: u32, dq1: u32, pq1: u32) -> Px {
  var out = Px(cd, cp, false);
  if (cp == PK_WALL || (cd >> 6u) == 0u) { return out; }
  let P = vec2f(f32(gx), f32(gy)) + 0.5;
  let uf = vec2f(u); let vf = vec2f(v);
  var best = dvD(cd);
  var bp = cp;
  var bv = 1.0;
  var breach = select(0.0, length(epos(cp) - P), valid(cp));
  var straighter = false;
  let behindWall = p0 == PK_WALL;
  var seen0 = 0xffffffffu; var seen1 = 0xffffffffu; // emitters already evaluated for inheritance
  for (var kk = 0; kk < 3; kk++) {
    let k = kk - 1;
    var qd = d0; var qp = p0;
    if (k < 0) { qd = dm; qp = pm; }
    if (k > 0) { qd = dq1; qp = pq1; }
    if (!valid(qp)) { continue; }
    // diagonal moves may not squeeze between two walls
    if (k != 0 && behindWall && ((wbits >> select(1u, 0u, k < 0)) & 1u) != 0u) { continue; }
    let dq = dvD(qd);
    let qx = gx - u.x + v.x * k; let qy = gy - u.y + v.y * k;
    let Q = P - uf + vf * f32(k);
    // inherit q's emitter E if it lies behind p within 45°, with visibility carried upwind from the two pixels the
    // line p→E passes between (visibility-based marching, Ibrahim et al. 2024): visible when ≥ 0.5
    let E = pkE(qp);
    // the inherited value depends only on E, so neighbours sharing an emitter need one evaluation
    let fresh = E != seen0 && E != seen1;
    if (kk == 0) { seen0 = E; } else { seen1 = E; }
    if (fresh && (!valid(bp) || E != pkE(bp)) && E != pkE(pkPix(qx, qy, 0u))) {
      let Ep = epos(qp);
      let rel = Ep - P;
      let al = -dot(rel, uf);
      let la = dot(rel, vf);
      if (al > 0.0 && abs(la) <= al) {
        let f = abs(la) / al;
        var vis = 0.0;
        if (f < 1.0) { vis += (1.0 - f) * visOf(p0, d0, gx - u.x, gy - u.y, E); }
        if (f > 0.0) {
          if (la > 0.0) { vis += f * visOf(pq1, dq1, gx - u.x + v.x, gy - u.y + v.y, E); }
          else { vis += f * visOf(pm, dm, gx - u.x - v.x, gy - u.y - v.y, E); }
        }
        if (vis >= 0.5) {
          let reach = length(rel);
          let val = dq - length(Q - Ep) + reach;
          // equal distance but a farther emitter = a straighter path: take it, so a bend picked up before the true
          // emitter arrived does not stick (each such switch moves the emitter strictly farther, so it terminates)
          let tie = val < best + EPS_TIE && reach > breach + 0.5;
          if (val < best - EPS_INHERIT || tie) { best = min(val, best); bp = qp; bv = vis; breach = reach; straighter = straighter || tie; }
        }
      }
    }
    // bend at q's centre (fallback; strictly better only, so ties keep the straighter inherited emitter)
    let vb = dq + select(1.0, SQRT2, k != 0);
    if (vb < best - EPS_BEND) { best = vb; bp = pkPix(qx, qy, pkL(qp)); bv = 1.0; breach = select(1.0, SQRT2, k != 0); straighter = false; }
  }
  // bend at a wall corner: shortest paths turn at the corners of walls, not at pixel centres. Candidates are p's two
  // corners on the side it is swept from, when exactly one of the four cells around the corner is a wall. The corner
  // is reached straight from the emitter of a behind pixel touching it: w(C) = w(E_q) + |E_q - C|.
  for (var side = -1; side <= 1; side += 2) {
    let wl = ((wbits >> select(1u, 0u, side < 0)) & 1u) != 0u;  // lateral cell (beside p)
    let wbk = behindWall;                                    // behind cell
    let wd = ((wbits >> select(3u, 2u, side < 0)) & 1u) != 0u;  // diagonal behind cell
    if (u32(wl) + u32(wbk) + u32(wd) != 1u) { continue; }
    let C = P + (vf * f32(side) - uf) * 0.5;
    let Ck = pk(i32(round(C.x * 2.0)), i32(round(C.y * 2.0)), 0u);
    if (valid(bp) && pkE(bp) == Ck) { continue; } // already measuring from this corner
    // direction from C into the wall cell's quadrant
    var wq = -uf + vf * f32(side);                            // diagonal cell
    if (wl) { wq = vf * f32(side) + uf; }
    if (wbk) { wq = -uf - vf * f32(side); }
    var wC = INF; var lab = 0u;
    for (var t2 = 0; t2 < 2; t2++) {
      // behind pixels touching C: directly behind (k = 0) and diagonally behind (k = side)
      var qd = d0; var qp = p0;
      if (t2 == 1) { if (side < 0) { qd = dm; qp = pm; } else { qd = dq1; qp = pq1; } }
      if (!valid(qp)) { continue; }
      let Q = P - uf + vf * f32(select(0, side, t2 == 1));
      let Ep = epos(qp);
      let dE = Ep - C;
      if (dE.x * wq.x > 0.0 && dE.y * wq.y > 0.0) { continue; } // E would see C through the wall
      let w = dvD(qd) - length(Q - Ep) + length(dE);
      if (w < wC) { wC = w; lab = pkL(qp); }
    }
    if (wC >= INF) { continue; }
    let val = wC + length(C - P);
    let reach = length(C - P);
    if (val < best - EPS_INHERIT) {
      best = val; bp = Ck | (lab << 22u); bv = 1.0; breach = reach; straighter = false;
    }
  }
  if (best >= INF) { return out; }
  let nv = mkDV(best, bv);
  if ((nv >> 6u) < (cd >> 6u) || (straighter && (nv >> 6u) <= (cd >> 6u) && pkE(bp) != pkE(cp))) {
    out = Px(nv, bp, true);
  }
  return out;
}

fn sweepDir(s: i32) -> vec4i { // u.xy, v.xy
  if (s == 0) { return vec4i(1, 0, 0, 1); }
  if (s == 1) { return vec4i(-1, 0, 0, 1); }
  if (s == 2) { return vec4i(0, 1, 1, 0); }
  return vec4i(0, -1, 1, 0);
}
// halo index of the pixel at along position a and lateral position l (interior coordinates, -1..TS) in sweep s
fn hidx(sb: i32, s: i32, a: i32, l: i32) -> i32 { return sb + select((a + 1) * HS + l + 1, (l + 1) * HS + a + 1, s < 2); }
// wall bits of halo line l (a row for horizontal sweeps, a column for vertical ones) as two words
fn wline(wb: i32, s: i32, l: i32) -> vec2u {
  if (s < 2) { return vec2u(walls[wb + l * 2], walls[wb + l * 2 + 1]); }
  return vec2u(wallsC[wb + l * 2], wallsC[wb + l * 2 + 1]);
}
fn wbit(w: vec2u, i: i32) -> u32 { return (select(w.y, w.x, i < 32) >> u32(i & 31)) & 1u; }
// walls beside the pixel at halo along position a1 and beside the pixel behind it (ab), from lines lm / lp
fn sideWalls(lm: vec2u, lp: vec2u, a1: i32, ab: i32) -> u32 {
  return wbit(lm, a1) | (wbit(lp, a1) << 1u) | (wbit(lm, ab) << 2u) | (wbit(lp, ab) << 3u);
}
${sg ? `
// Sweep s (0 →, 1 ←, 2 ↓, 3 ↑) over the first nsteps positions; lane t of a tile owns row t (horizontal) or column t
// (vertical). The three pixels behind each step are the previous step's results of this lane and its two neighbours,
// exchanged by subgroup shuffles (tile edges read the halo): no barrier and no workgroup-memory reads between steps.
// Returns the along positions this lane changed.
fn runSweep(sb: i32, wb: i32, s: i32, nsteps: i32, t: i32, ox: i32, oy: i32) -> u32 {
  let dv4 = sweepDir(s);
  let u = dv4.xy; let v = dv4.zw;
  let dir = select(1, -1, s == 1 || s == 3);
  let a0 = select(0, TS - 1, dir < 0);
  var prevD = sdv[hidx(sb, s, a0 - dir, t)];
  var prevP = sp[hidx(sb, s, a0 - dir, t)];
  let lm = wline(wb, s, t); let lp = wline(wb, s, t + 2); // the lines beside this lane's line t + 1
  var mask = 0u;
  for (var step = 0; step < nsteps; step++) {
    let a = a0 + dir * step;
    var dm = subgroupShuffleUp(prevD, 1u); var pm = subgroupShuffleUp(prevP, 1u);
    var dq1 = subgroupShuffleDown(prevD, 1u); var pq1 = subgroupShuffleDown(prevP, 1u);
    if (t == 0) { let h = hidx(sb, s, a - dir, -1); dm = sdv[h]; pm = sp[h]; }
    if (t == TS - 1) { let h = hidx(sb, s, a - dir, TS); dq1 = sdv[h]; pq1 = sp[h]; }
    let h = hidx(sb, s, a, t);
    let lx = select(t, a, s < 2); let ly = select(a, t, s < 2);
    let r = relax(sideWalls(lm, lp, a + 1, a + 1 - dir), sdv[h], sp[h], ox + lx, oy + ly, u, v, dm, pm, prevD, prevP, dq1, pq1);
    if (r.improved) { sdv[h] = r.d; sp[h] = r.p; mask |= 1u << u32(a); }
    prevD = r.d; prevP = r.p;
  }
  return mask;
}
` : `
// Sweep s (0 →, 1 ←, 2 ↓, 3 ↑) over the first nsteps positions; lane t of a tile owns row t (horizontal) or column t
// (vertical). Each step reads the three pixels behind from workgroup memory, finished by the previous step.
// Returns the along positions this lane changed.
fn runSweep(sb: i32, wb: i32, s: i32, nsteps: i32, t: i32, ox: i32, oy: i32) -> u32 {
  let dv4 = sweepDir(s);
  let u = dv4.xy; let v = dv4.zw;
  let dir = select(1, -1, s == 1 || s == 3);
  let a0 = select(0, TS - 1, dir < 0);
  let lm = wline(wb, s, t); let lp = wline(wb, s, t + 2); // the lines beside this lane's line t + 1
  var mask = 0u;
  for (var step = 0; step < nsteps; step++) {
    let a = a0 + dir * step;
    let hm = hidx(sb, s, a - dir, t - 1); let h0 = hidx(sb, s, a - dir, t); let h1 = hidx(sb, s, a - dir, t + 1);
    let h = hidx(sb, s, a, t);
    let lx = select(t, a, s < 2); let ly = select(a, t, s < 2);
    let r = relax(sideWalls(lm, lp, a + 1, a + 1 - dir), sdv[h], sp[h], ox + lx, oy + ly, u, v, sdv[hm], sp[hm], sdv[h0], sp[h0], sdv[h1], sp[h1]);
    if (r.improved) { sdv[h] = r.d; sp[h] = r.p; mask |= 1u << u32(a); }
    workgroupBarrier();
  }
  return mask;
}
`}

@compute @workgroup_size(32)
fn main(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let T = i32(fr.tiles);
  let sub = i32(lid) / TS;
  let t = i32(lid) % TS;
  let tx = (i32(wid.x) * K + sub) * 2 + i32(pd.phase & 1u);
  let ty = i32(wid.y) * 2 + i32(pd.phase >> 1u);
  let idx = fr.base + pd.k;
  let tile = u32(ty * T + tx);
  let sb = sub * HN;          // this tile's base in sdv / sp
  let wb = sub * HS * 2;      // ... and in walls
  if (t == 0) {
    var act = 0u;
    if (tx < T && ty < T) {
      if (pend[tile] + 4u >= idx) { act = 2u; }
      // wake only if the neighbour's edge or corner facing this tile changed since our last turn
      // stamp slots: 0 top, 1 bottom, 2 left, 3 right, 4 TL, 5 TR, 6 BL, 7 BR
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          let nx = tx + dx; let ny = ty + dy;
          if ((dx != 0 || dy != 0) && nx >= 0 && ny >= 0 && nx < T && ny < T) {
            var side = 0u;
            if (dx == 0) { side = select(0u, 1u, dy < 0); }
            else if (dy == 0) { side = select(2u, 3u, dx < 0); }
            else { side = 4u + select(0u, 1u, dx < 0) + select(0u, 2u, dy < 0); }
            if (stamp[u32(ny * T + nx) * 8u + side] + 4u >= idx) { act = max(act, 1u); }
          }
        }
      }
    }
    wact[sub] = act; // 0 asleep, 1 check the border, 2 full run (after an edit or an unfinished run)
  }
  if (lid == 0u) { wany = 0u; }
  workgroupBarrier();
  if (t == 0 && wact[sub] != 0u) { wany = 1u; }
  if (workgroupUniformLoad(&wany) == 0u) { return; }
  let act = wact[sub];

  let N = i32(fr.n);
  let ox = tx * TS; let oy = ty * TS;
${sg ? `
  // one halo row per iteration, lane t loads column t of its tile (+ columns TS, TS+1 by lanes 0, 1); row wall masks by
  // ballot, column wall masks accumulated per lane
  var cm = vec2u(0u); var cm2 = vec2u(0u);
  for (var r = 0; r < HS; r++) {
    let gy = oy + r - 1;
    for (var c = t; c < HS; c += TS) {
      let gx = ox + c - 1;
      var d = DV_INF; var p = PK_WALL;
      if (act != 0u && gx >= 0 && gy >= 0 && gx < N && gy < N) { let g = u32(gy * N + gx); d = dv[g]; p = state[g]; }
      sdv[sb + r * HS + c] = d; sp[sb + r * HS + c] = p;
    }
    let isw = sp[sb + r * HS + t] == PK_WALL;
    let isw2 = t < 2 && sp[sb + r * HS + TS + min(t, 1)] == PK_WALL;
    let rb = 1u << u32(r & 31);
    if (isw) { if (r < 32) { cm.x |= rb; } else { cm.y |= rb; } }
    if (isw2) { if (r < 32) { cm2.x |= rb; } else { cm2.y |= rb; } }
    let b0 = subgroupBallot(isw).x;
    let b1 = subgroupBallot(isw2).x;
    if (t == 0) {
      let hi = (b1 >> u32(sub * TS)) & 3u;
      ${TS === 32
        ? 'walls[wb + r * 2] = b0; walls[wb + r * 2 + 1] = hi;'
        : `walls[wb + r * 2] = ((b0 >> u32(sub * TS)) & ${(1 << TS) - 1}u) | (hi << ${TS}u); walls[wb + r * 2 + 1] = 0u;`}
    }
  }
  wallsC[wb + t * 2] = cm.x; wallsC[wb + t * 2 + 1] = cm.y;
  if (t < 2) { wallsC[wb + (TS + t) * 2] = cm2.x; wallsC[wb + (TS + t) * 2 + 1] = cm2.y; }
  workgroupBarrier();
` : `
  for (var i = t; i < HN; i += TS) {
    let hx = i % HS; let hy = i / HS;
    let gx = ox + hx - 1; let gy = oy + hy - 1;
    var d = DV_INF; var p = PK_WALL;
    if (act != 0u && gx >= 0 && gy >= 0 && gx < N && gy < N) { let g = u32(gy * N + gx); d = dv[g]; p = state[g]; }
    sdv[sb + i] = d; sp[sb + i] = p;
  }
  workgroupBarrier();
  for (var r = t; r < HS; r += TS) {
    var w0 = 0u; var w1 = 0u;
    for (var c = 0; c < HS; c++) {
      if (sp[sb + r * HS + c] == PK_WALL) { if (c < 32) { w0 |= 1u << u32(c); } else { w1 |= 1u << u32(c - 32); } }
    }
    walls[wb + r * 2] = w0; walls[wb + r * 2 + 1] = w1;
  }
  workgroupBarrier();
  for (var c = t; c < HS; c += TS) {
    var m = vec2u(0u);
    for (var r = 0; r < HS; r++) {
      if (((walls[wb + r * 2 + (c >> 5)] >> u32(c & 31)) & 1u) != 0u) { if (r < 32) { m.x |= 1u << u32(r); } else { m.y |= 1u << u32(r - 32); } }
    }
    wallsC[wb + c * 2] = m.x; wallsC[wb + c * 2 + 1] = m.y;
  }
  workgroupBarrier();
`}

  var rowMask = 0u; // pixels of row t changed by horizontal sweeps
  var colMask = 0u; // pixels of column t changed by vertical sweeps
  // A tile that was stable keeps its interior consistent: only its border can see the new halo. Check the border
  // first (one step of each sweep) and skip the sweeps if nothing improves. (An asleep tile sharing the workgroup was
  // loaded as walls, so nothing changes in it.)
  if (lid < 4u) { wdir[lid] = 0u; }
  if (t == 0) { wch[sub] = 0u; }
  workgroupBarrier();
  for (var s = 0; s < 4; s++) {
    let m = runSweep(sb, wb, s, 1, t, ox, oy);
    if (m != 0u) { wch[sub] = 1u; wdir[s] = 1u; if (s < 2) { rowMask |= m; } else { colMask |= m; } }
    workgroupBarrier();
  }
  if (lid == 0u) {
    var any = 0u;
    for (var q = 0; q < K; q++) { wneed[q] = select(0u, 1u, wch[q] != 0u || wact[q] == 2u); any |= wneed[q]; }
    var first = 0u;
    for (var s = 3; s >= 0; s--) { if (wdir[s] != 0u) { first = u32(s); } }
    wdir[0] = first; // start with a direction in which new information arrived
    wdone = 1u - any;
  }
  let start = workgroupUniformLoad(&wdir[0]);
  var nsweep = 0u;
  var quiet = 0u;   // per tile (meaningful in lane 0 of each tile)
  let maxSweeps = fr.maxPass * 4u;
  var unfinished = false;
  if (workgroupUniformLoad(&wdone) == 0u) {
    if (t == 0 && wneed[sub] == 0u) { quiet = 3u; } // tiles that need nothing count as settled
    loop {
      if (t == 0) { wch[sub] = 0u; }
      workgroupBarrier();
      let s = i32((start + nsweep) % 4u);
      let m = runSweep(sb, wb, s, TS, t, ox, oy);
      if (m != 0u) { wch[sub] = 1u; if (s < 2) { rowMask |= m; } else { colMask |= m; } }
      workgroupBarrier();
      nsweep++;
      // a sweep cannot improve on itself, so after a change only the other three directions need re-checking
      if (t == 0) { if (wch[sub] != 0u) { quiet = 0u; } else { quiet++; } wact[sub] = select(0u, 1u, nsweep >= 4u && quiet >= 3u); }
      workgroupBarrier();
      if (lid == 0u) { var all = 1u; for (var q = 0; q < K; q++) { all &= wact[q]; } wdone = select(all, 1u, nsweep >= maxSweeps); }
      if (workgroupUniformLoad(&wdone) != 0u) { break; }
    }
    if (t == 0) { unfinished = quiet < 3u; }
  }

  // write back changed pixels (lane t owns row t of its tile)
  colBits[lid] = colMask;
  workgroupBarrier();
  var bits = rowMask;
  for (var x = 0; x < TS; x++) { bits |= ((colBits[sub * TS + x] >> u32(t)) & 1u) << u32(x); }
  rowBits[lid] = bits;
  if (bits != 0u) {
    for (var x = 0; x < TS; x++) {
      if (((bits >> u32(x)) & 1u) != 0u) {
        let hp = sb + (t + 1) * HS + x + 1;
        let g = u32((oy + t) * N + ox + x);
        dv[g] = sdv[hp]; state[g] = sp[hp];
      }
    }
  }
  workgroupBarrier();
  if (t == 0 && act != 0u) {
    atomicAdd(&stats[1], 1u);
    atomicAdd(&stats[2], nsweep);
    var anyRow = 0u; var left = 0u; var right = 0u;
    for (var r = 0; r < TS; r++) { let b = rowBits[sub * TS + r]; anyRow |= b; left |= b & 1u; right |= b >> u32(TS - 1); }
    if (anyRow != 0u) {
      atomicMax(&stats[0], idx);
      let top = rowBits[sub * TS]; let bot = rowBits[sub * TS + TS - 1];
      let st = tile * 8u;
      if (top != 0u) { stamp[st + 0u] = idx; }
      if (bot != 0u) { stamp[st + 1u] = idx; }
      if (left != 0u) { stamp[st + 2u] = idx; }
      if (right != 0u) { stamp[st + 3u] = idx; }
      if ((top & 1u) != 0u) { stamp[st + 4u] = idx; }
      if ((top >> u32(TS - 1)) != 0u) { stamp[st + 5u] = idx; }
      if ((bot & 1u) != 0u) { stamp[st + 6u] = idx; }
      if ((bot >> u32(TS - 1)) != 0u) { stamp[st + 7u] = idx; }
    }
    if (unfinished) { pend[tile] = idx; atomicMax(&stats[0], idx); }
  }
}
`;

// ── Edits: detect what changed, then reset only what can be affected ──
const editShader = /* wgsl */ `
${common}
struct Edit { n: u32, full: u32, base: u32, tiles: u32 }
@group(0) @binding(0) var<uniform> ed: Edit;
@group(0) @binding(1) var<storage, read> scene: array<u32>;
@group(0) @binding(2) var<storage, read_write> prev: array<u32>;
@group(0) @binding(3) var<storage, read_write> dv: array<u32>;
@group(0) @binding(4) var<storage, read_write> state: array<u32>;
// ctrl: [0] unused, [1 .. 1+M) erased-goal mask, [1+M ..) per-goal reset threshold (fixed-point distance)
@group(0) @binding(5) var<storage, read_write> ctrl: array<atomic<u32>>;
const THR: u32 = 1u + ${Math.ceil(MAX_GOALS / 32)}u;
@group(0) @binding(6) var<storage, read_write> pend: array<u32>; // tiles that must run in full

fn touch(id: vec3u) { pend[(id.y / ${TS}u) * ed.tiles + id.x / ${TS}u] = ed.base; }

@compute @workgroup_size(16, 16)
fn detect(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= ed.n || id.y >= ed.n) { return; }
  let i = id.y * ed.n + id.x;
  let s = scene[i]; let o = prev[i];
  if (s == o) { return; }
  // a new wall pixel s: paths through it end at s's goal and are at least as long as s's old distance
  if (s == SCENE_WALL && o != SCENE_WALL) {
    let p = state[i];
    if (valid(p)) { atomicMin(&ctrl[THR + pkL(p)], dv[i] >> 6u); }
  }
  if (o != 0u && o != SCENE_WALL) { let g = o - 1u; atomicOr(&ctrl[1u + (g >> 5u)], 1u << (g & 31u)); }
  prev[i] = s;
}

@compute @workgroup_size(16, 16)
fn reset(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= ed.n || id.y >= ed.n) { return; }
  let i = id.y * ed.n + id.x;
  let s = scene[i];
  let p = state[i];
  // only tiles with pixels that change here need a full run; the rest stays valid and wakes when a neighbour changes
  if (s == SCENE_WALL) {
    if (p != PK_WALL || ed.full != 0u) { dv[i] = DV_INF; state[i] = PK_WALL; touch(id); }
    return;
  }
  if (s != 0u) {
    let g = pkPix(i32(id.x), i32(id.y), s - 1u);
    if (p != g || (dv[i] >> 6u) != 0u || ed.full != 0u) { dv[i] = mkDV(0.0, 1.0); state[i] = g; touch(id); }
    return;
  }
  var clear = ed.full != 0u || p == PK_WALL;
  if (!clear && valid(p)) {
    let l = pkL(p);
    if ((atomicLoad(&ctrl[1u + (l >> 5u)]) & (1u << (l & 31u))) != 0u) { clear = true; }
    // margin: stored distances are near-geodesic, not exact
    let tq = atomicLoad(&ctrl[THR + l]);
    let thr = select(f32(tq) / 1024.0, INF, tq >= DQ_INF);
    if (dvD(dv[i]) >= thr * 0.9 - 2.0) { clear = true; }
  }
  if (clear) { dv[i] = DV_INF; state[i] = PK_NONE; touch(id); }
}
`;


// ── Experimental: long-range emitter propagation by jump flooding with visibility ──
// Wall distance field by jump flooding (seeds = wall pixels), then emitter passes at steps N/2 .. 1: a pixel takes a
// candidate's emitter E if that is shorter and E is visible, checked by sphere-tracing the wall distance field
// (conservative: lines that pass close to walls are rejected and left to the local sweeps).
const jfaSdfShader = /* wgsl */ `
struct J { n: u32, k: i32, base: u32, tiles: u32 }
@group(0) @binding(0) var<uniform> jp: J;
@group(0) @binding(1) var<storage, read> scene: array<u32>;
@group(0) @binding(2) var<storage, read> seedIn: array<u32>;
@group(0) @binding(3) var<storage, read_write> seedOut: array<u32>;
@group(0) @binding(4) var<storage, read_write> sdf: array<f32>;
const NONE: u32 = 0xffffffffu;
fn sxy(s: u32) -> vec2i { return vec2i(i32(s & 0xffffu), i32(s >> 16u)); }

@compute @workgroup_size(16, 16)
fn init(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= jp.n || id.y >= jp.n) { return; }
  let i = id.y * jp.n + id.x;
  seedOut[i] = select(NONE, id.x | (id.y << 16u), scene[i] == 0xffffffffu);
}

@compute @workgroup_size(16, 16)
fn step(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= jp.n || id.y >= jp.n) { return; }
  let n = i32(jp.n); let p = vec2i(id.xy);
  var best = seedIn[id.y * jp.n + id.x];
  var bd = 1e30;
  if (best != NONE) { let d = vec2f(sxy(best) - p); bd = dot(d, d); }
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = p + vec2i(dx, dy) * jp.k;
      if (q.x < 0 || q.y < 0 || q.x >= n || q.y >= n) { continue; }
      let s = seedIn[u32(q.y * n + q.x)];
      if (s == NONE) { continue; }
      let d = vec2f(sxy(s) - p); let dd = dot(d, d);
      if (dd < bd) { bd = dd; best = s; }
    }
  }
  seedOut[id.y * jp.n + id.x] = best;
}

// distance from a pixel centre to the nearest wall cell, conservatively (centre distance minus half a diagonal)
@compute @workgroup_size(16, 16)
fn finish(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= jp.n || id.y >= jp.n) { return; }
  let i = id.y * jp.n + id.x;
  let s = seedIn[i];
  var d = 1e9;
  if (s != NONE) { d = max(0.0, length(vec2f(sxy(s) - vec2i(id.xy))) - 0.71); }
  if (scene[i] == 0xffffffffu) { d = 0.0; }
  sdf[i] = d;
}
`;

const jfaEmitShader = /* wgsl */ `
${common}
struct J { n: u32, k: i32, base: u32, tiles: u32 }
@group(0) @binding(0) var<uniform> jp: J;
@group(0) @binding(1) var<storage, read> sdf: array<f32>;
@group(0) @binding(2) var<storage, read> dvIn: array<u32>;
@group(0) @binding(3) var<storage, read> stIn: array<u32>;
@group(0) @binding(4) var<storage, read_write> dvOut: array<u32>;
@group(0) @binding(5) var<storage, read_write> stOut: array<u32>;
@group(0) @binding(6) var<storage, read_write> pend: array<u32>;

fn sdfAt(q: vec2f) -> f32 {
  let n = i32(jp.n);
  let c = clamp(vec2i(floor(q)), vec2i(0), vec2i(n - 1));
  return sdf[u32(c.y * n + c.x)];
}
// sphere-trace P -> E through free space
fn visible(P: vec2f, E: vec2f) -> bool {
  let L = length(E - P);
  if (L < 1e-3) { return true; }
  let dir = (E - P) / L;
  var t = 0.0;
  for (var it = 0; it < 64; it++) {
    let s = sdfAt(P + dir * t);
    if (t + s + 1.0 >= L) { return true; }
    if (s < 0.25) { return false; }
    t += s;
  }
  return false;
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= jp.n || id.y >= jp.n) { return; }
  let n = i32(jp.n);
  let i = id.y * jp.n + id.x;
  var bd = dvIn[i]; var bp = stIn[i];
  if (bp != PK_WALL && (bd >> 6u) != 0u) {
    let P = vec2f(id.xy) + 0.5;
    var best = dvD(bd);
    var changed = false;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let q = vec2i(id.xy) + vec2i(dx, dy) * jp.k;
        if ((dx == 0 && dy == 0) || q.x < 0 || q.y < 0 || q.x >= n || q.y >= n) { continue; }
        let qi = u32(q.y * n + q.x);
        let qp = stIn[qi];
        if (!valid(qp)) { continue; }
        let E = epos(qp);
        let val = dvD(dvIn[qi]) - length(vec2f(q) + 0.5 - E) + length(P - E);
        // flood only real gains; sub-pixel ones are the sweeps' job (and would keep re-floods from settling)
        if (val < best - 0.5 && visible(P, E)) { best = val; bp = qp; bd = mkDV(val, 1.0); changed = true; }
      }
    }
    if (changed) { pend[(id.y / ${TS}u) * jp.tiles + id.x / ${TS}u] = jp.base; }
  }
  dvOut[i] = bd; stOut[i] = bp;
}
`;

// ── Path from a point: follow emitters to the goal ──
const traceShader = /* wgsl */ `
${common}
struct Trace { n: u32, x: i32, y: i32, _a: u32 }
@group(0) @binding(0) var<uniform> tr: Trace;
@group(0) @binding(1) var<storage, read> dvb: array<u32>;
@group(0) @binding(2) var<storage, read> state: array<u32>;
@group(0) @binding(3) var<storage, read_write> path: array<vec2f>; // [0].x = count
fn dist(i: u32) -> f32 { return dvD(dvb[i]); }

@compute @workgroup_size(1)
fn main() {
  var x = tr.x; var y = tr.y; var count = 0u;
  let n = i32(tr.n);
  if (x >= 0 && y >= 0 && x < n && y < n) {
    var at = vec2f(f32(x), f32(y)) + 0.5; // current path vertex
    for (var k = 0u; k < ${MAX_PATH - 1}u; k++) {
      let i = u32(y * n + x);
      let p = state[i];
      if (!valid(p) || dist(i) >= INF) { break; }
      path[1u + count] = at;
      count++;
      if (dist(i) <= 0.0) { break; }
      let E = epos(p);
      if (length(E - at) < 1e-3) { break; }
      // continue from the pixel containing E, nudged back toward where we came from (E may be a wall corner)
      let c = floor(E + normalize(at - E) * 0.25);
      at = E;
      x = i32(c.x); y = i32(c.y);
      if (x < 0 || y < 0 || x >= n || y >= n) { break; }
    }
  }
  path[0] = vec2f(f32(count), 0.0);
}
`;

// ── Display ──
const renderShader = /* wgsl */ `
${common}
struct View { n: u32, flags: u32, spacing: f32, arrowCell: f32 }
@group(0) @binding(0) var<uniform> vw: View;
@group(0) @binding(1) var<storage, read> dvb: array<u32>;
@group(0) @binding(2) var<storage, read> state: array<u32>;
@group(0) @binding(3) var<storage, read> scene: array<u32>;
fn dist(i: u32) -> f32 { return dvD(dvb[i]); }
struct Goal { color: vec4f, pos: vec4f } // pos: x, y, radius, alive
@group(0) @binding(4) var<storage, read> goals: array<Goal>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn at(x: i32, y: i32) -> u32 { return u32(y * i32(vw.n) + x); }
fn labelAt(i: u32) -> u32 { let p = state[i]; return select(0xffffffffu, pkL(p), valid(p)); }

fn segDist(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let n = i32(vw.n);
  let x = i32(pos.x); let y = i32(pos.y);
  let i = at(x, y);
  let s = scene[i];
  if (s == SCENE_WALL) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let p = state[i];
  let d = dist(i);
  if (!valid(p) || d >= INF) { return vec4f(0.10, 0.10, 0.11, 1.0); }
  let l = pkL(p);
  let goal = goals[l % ${MAX_GOALS}u];
  var c = goal.color.rgb;
  // goal marker
  let gd = length(vec2f(f32(x), f32(y)) + 0.5 - goal.pos.xy);
  if (goal.pos.w > 0.0 && gd <= goal.pos.z + 1.0) {
    if (gd > goal.pos.z) { return vec4f(0.0, 0.0, 0.0, 1.0); }
    return vec4f(mix(c, vec3f(1.0), 0.7), 1.0);
  }
  // gentle falloff with distance
  c *= 0.55 + 0.45 * exp(-d / (0.35 * f32(n)));
  // contours (1px, crisp)
  if ((vw.flags & 1u) != 0u) {
    let t = d / vw.spacing;
    let dn = dist(at(min(x + 1, n - 1), y)); let ds = dist(at(x, min(y + 1, n - 1)));
    let crossR = dn < INF && floor(dn / vw.spacing) != floor(t);
    let crossD = ds < INF && floor(ds / vw.spacing) != floor(t);
    if (crossR || crossD) { c *= 0.72; }
  }
  // Voronoi borders
  if ((vw.flags & 2u) != 0u) {
    let lr = labelAt(at(min(x + 1, n - 1), y)); let ld = labelAt(at(x, min(y + 1, n - 1)));
    if ((lr != l && lr != 0xffffffffu) || (ld != l && ld != 0xffffffffu)) { c = mix(c, vec3f(1.0), 0.65); }
  }
  // flow arrows: one per cell, pointing to the emitter
  if ((vw.flags & 4u) != 0u) {
    let cs = vw.arrowCell;
    let cell = floor(vec2f(f32(x), f32(y)) / cs);
    let ci = vec2i(cell * cs + vec2f(cs * 0.5));
    if (ci.x < n && ci.y < n) {
      let ii = at(ci.x, ci.y);
      let pp = state[ii];
      if (valid(pp) && dist(ii) > 0.0 && dist(ii) < INF && scene[ii] == 0u) {
        let e = epos(pp);
        let c0 = vec2f(ci) + 0.5;
        let u = normalize(e - c0 + vec2f(1e-6, 0.0));
        let q = vec2f(f32(x), f32(y)) + 0.5;
        let L = cs * 0.36;
        let a = c0 - u * L; let b = c0 + u * L;
        let w = vec2f(-u.y, u.x);
        let dd = min(segDist(q, a, b), min(segDist(q, b, b - u * L * 0.55 + w * L * 0.4), segDist(q, b, b - u * L * 0.55 - w * L * 0.4)));
        if (dd < 0.6) { c = mix(c, vec3f(0.0), 0.55); }
      }
    }
  }
  return vec4f(c, 1.0);
}
`;

const pathShader = /* wgsl */ `
struct View { n: u32, flags: u32, spacing: f32, arrowCell: f32 }
@group(0) @binding(0) var<uniform> vw: View;
@group(0) @binding(1) var<storage, read> path: array<vec2f>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let count = u32(path[0].x);
  let seg = i / 2u; let end = i % 2u;
  if (seg + 1u >= count) { return vec4f(2.0, 2.0, 0.0, 1.0); }
  let p = path[1u + seg + end] / f32(vw.n);
  return vec4f(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}
@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0, 1.0, 1.0, 1.0); }
`;

export type FlowFieldTool = 'wall' | 'goal' | 'erase';

export interface FlowFieldStats {
  /** GPU time of the last frame's solver passes (ms), if timestamps are available. */
  gpuMs: number;
  /** Accumulated GPU solver time since the last edit (ms). */
  solveMs: number;
  /** Rounds since the last edit (each round = 4 checkerboard dispatches). */
  rounds: number;
  /** Tile relaxations run since the last edit. */
  tileRuns: number;
  /** Mean sweeps (4 per full pass) per tile relaxation since the last edit. */
  meanSweeps: number;
  converged: boolean;
}

export interface FlowFieldBench {
  /** GPU time of the solver sweeps (ms). */
  ms: number;
  /** GPU time of the jump-flooding pre-pass (ms), when enabled. */
  jfaMs: number;
  rounds: number;
  tileRuns: number;
  meanSweeps: number;
}

export class FolkFlowField extends ReactiveElement {
  static override tagName = 'folk-flow-field';

  static override styles = css`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      touch-action: none;
    }
    canvas {
      position: absolute;
      image-rendering: pixelated;
      cursor: crosshair;
    }
  `;

  @property({ type: Number, reflect: true }) size = 1024;
  @property({ type: String, reflect: true }) tool: FlowFieldTool = 'wall';
  @property({ type: Number, reflect: true }) brush = 6;
  @property({ type: Boolean, reflect: true }) contours = true;
  @property({ type: Boolean, reflect: true }) borders = true;
  @property({ type: Boolean, reflect: true }) arrows = false;
  @property({ type: Boolean, reflect: true }) path = true;
  /** GPU time per frame the solver may use while the field is changing (ms); rounds per frame adapt to it. */
  @property({ type: Number, attribute: 'frame-budget' }) frameBudget = 8;
  /**
   * Long-range emitter propagation by jump flooding with visibility before the local sweeps (after full resets and
   * new goals): open space fills in log N passes instead of one tile per round.
   */
  @property({ type: Boolean, reflect: true }) jfa = true;

  stats: FlowFieldStats = { gpuMs: 0, solveMs: 0, rounds: 0, tileRuns: 0, meanSweeps: 0, converged: false };

  #canvas!: HTMLCanvasElement;
  #device!: GPUDevice;
  #context!: GPUCanvasContext;
  #format!: GPUTextureFormat;
  #ready = false;
  #raf = 0;
  #ro?: ResizeObserver;

  #n = 0;
  #tiles = 0;
  #scene!: Uint32Array;
  #goalData = new Float32Array(MAX_GOALS * 8); // per goal: colour rgba, position x y radius alive
  #goalCount = 0;
  #dirty: [number, number] | null = null; // dirty row range [y0, y1)
  #needFull = true;
  #paletteDirty = true;

  #buf: Record<string, GPUBuffer> = {};
  #solvePipe!: GPUComputePipeline;
  #detectPipe!: GPUComputePipeline;
  #resetPipe!: GPUComputePipeline;
  #tracePipe!: GPUComputePipeline;
  #sdfInit!: GPUComputePipeline;
  #sdfPass!: GPUComputePipeline;
  #sdfFinish!: GPUComputePipeline;
  #jfaEmit!: GPUComputePipeline;
  #jfaBG: GPUBindGroup[] = [];
  #renderPipe!: GPURenderPipeline;
  #pathPipe!: GPURenderPipeline;
  #solveBG!: GPUBindGroup;
  #editBG!: GPUBindGroup;
  #traceBG!: GPUBindGroup;
  #renderBG!: GPUBindGroup;
  #pathBG!: GPUBindGroup;

  #base = 8; // absolute dispatch counter (tile stamps compare against it)
  #active = true;
  #editBase = 8;
  #frameBase = 0;
  #msPerRound = 0.5;
  #readPending = false;
  #gen = 0;
  #querySet?: GPUQuerySet;
  #goalsAdded = false;
  #sdfDirty = true;
  #subgroups = false;
  #mouse: [number, number] = [-1, -1];
  #drawing = false;
  #drawKind: 'wall' | 'erase' = 'wall';
  #last: [number, number] | null = null;
  #onFrame: ((s: FlowFieldStats) => void) | null = null;

  /** Called every frame with fresh stats. */
  set onstats(fn: ((s: FlowFieldStats) => void) | null) {
    this.#onFrame = fn;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.#init().catch((e) => console.error(e));
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    cancelAnimationFrame(this.#raf);
    this.#ro?.disconnect();
    this.#destroyBuffers();
    this.#ready = false;
  }

  override update(changed: PropertyValues<this>) {
    super.update(changed);
    if (!this.#ready) return;
    if (changed.has('size') && changed.get('size') !== undefined) {
      this.#allocate();
      this.#layout();
    }
  }

  // ── public API ──

  /** Remove all walls and goals. */
  clear() {
    this.#scene.fill(0);
    this.#sdfDirty = true;
    this.#goalData.fill(0);
    this.#goalCount = 0;
    this.#paletteDirty = true;
    this.#markDirty(0, this.#n);
  }

  /** Paint a wall / erase stroke segment in canvas pixel coordinates. Erasing also removes goals it touches. */
  stroke(x0: number, y0: number, x1: number, y1: number, radius = this.brush, kind: 'wall' | 'erase' = 'wall') {
    const v = kind === 'wall' ? SCENE_WALL : 0;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len / Math.max(0.5, radius * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
      if (kind === 'erase') this.#eraseGoals(cx, cy, radius);
      this.#disc(cx, cy, radius, v);
    }
  }

  /** Place a goal: a single source pixel, drawn as a disc with a new random colour. Returns its label. */
  addGoal(x: number, y: number, radius = 3, color?: [number, number, number]) {
    const n = this.#n;
    const px = Math.min(n - 1, Math.max(0, Math.floor(x))), py = Math.min(n - 1, Math.max(0, Math.floor(y)));
    const id = this.#goalCount++ % MAX_GOALS;
    const c = color ?? randomColor();
    this.#goalData.set([c[0], c[1], c[2], 1, px + 0.5, py + 0.5, radius, 1], id * 8);
    this.#paletteDirty = true;
    this.#set(px, py, id + 1);
    this.#markDirty(py, py + 1);
    this.#goalsAdded = true;
    return id;
  }

  /** Replace the whole scene: walls (0/1 per pixel, row-major, resolution²) and goal points. */
  setScene(walls: Uint8Array | null, goals: { x: number; y: number; r?: number }[] = []) {
    const n = this.#n;
    this.#scene.fill(0);
    this.#goalData.fill(0);
    this.#goalCount = 0;
    if (walls) for (let i = 0; i < n * n; i++) if (walls[i]) this.#scene[i] = SCENE_WALL;
    this.#sdfDirty = true;
    for (const g of goals) this.addGoal(g.x, g.y, g.r ?? 3);
    this.#markDirty(0, n);
  }

  /** Whether the solver uses subgroup shuffles (one subgroup = one tile row/column of threads). */
  get usesSubgroups() {
    return this.#subgroups;
  }

  /** Canvas resolution (pixels per side). */
  get resolution() {
    return this.#n;
  }

  /**
   * Benchmark: solve the current scene from scratch (no rendering) and report GPU time of the solver passes.
   * `rounds` rounds are encoded (4 dispatches each); tiles with nothing to do exit immediately.
   */
  async bench(rounds = 128, maxPass = 8): Promise<FlowFieldBench> {
    const d = this.#device, q = d.queue, b = this.#buf, n = this.#n;
    const wasActive = this.#active;
    this.#active = false; // keep the frame loop from interleaving solver work
    await q.onSubmittedWorkDone();
    q.writeBuffer(b.scene, 0, this.#scene);
    this.#dirty = null;
    this.#encodeEdit(true);
    const base0 = this.#base;
    let done = 0;
    let ms = 0;
    let jfaMs = 0;
    if (this.jfa) {
      const enc = d.createCommandEncoder();
      this.#encodeJfa(enc);
      this.#sdfDirty = false;
      if (this.#querySet) {
        enc.resolveQuerySet(this.#querySet, 2, 2, b.tsJ, 0); // (resolve offsets must be 256-aligned)
        enc.copyBufferToBuffer(b.tsJ, 0, b.tsBench, 16, 16);
      }
      q.submit([enc.finish()]);
      if (this.#querySet) {
        await b.tsBench.mapAsync(GPUMapMode.READ);
        const t = new BigInt64Array(b.tsBench.getMappedRange().slice(0));
        b.tsBench.unmap();
        jfaMs = Number(t[3] - t[2]) / 1e6;
      }
    }
    while (done < rounds) {
      const r = Math.min(MAX_ROUNDS, rounds - done);
      const enc = d.createCommandEncoder();
      this.#encodeSolve(enc, r, maxPass);
      if (this.#querySet) {
        enc.resolveQuerySet(this.#querySet, 0, 2, b.ts, 0);
        enc.copyBufferToBuffer(b.ts, 0, b.tsBench, 0, 16);
      }
      q.submit([enc.finish()]);
      done += r;
      if (this.#querySet) {
        await b.tsBench.mapAsync(GPUMapMode.READ);
        const t = new BigInt64Array(b.tsBench.getMappedRange().slice(0, 16));
        b.tsBench.unmap();
        ms += Number(t[1] - t[0]) / 1e6;
      } else {
        await q.onSubmittedWorkDone();
      }
    }
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(b.stats, 0, b.statsRead, 0, 16);
    q.submit([enc.finish()]);
    await b.statsRead.mapAsync(GPUMapMode.READ);
    const st = new Uint32Array(b.statsRead.getMappedRange().slice(0));
    b.statsRead.unmap();
    this.#active = wasActive;
    return { ms, jfaMs, rounds: Math.ceil((st[0] - base0 + 1) / 4), tileRuns: st[1], meanSweeps: st[1] ? st[2] / st[1] : 0 };
  }

  /** Read back the solved field (for tests): distance, emitter position (x, y) and label per pixel (-1 = none). */
  async readField(): Promise<{ dist: Float32Array; ex: Float32Array; ey: Float32Array; label: Int32Array }> {
    const d = this.#device, n = this.#n, b = this.#buf;
    const rd = (src: GPUBuffer) => d.createBuffer({ size: src.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const rDist = rd(b.dv), rState = rd(b.state);
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(b.dv, 0, rDist, 0, b.dv.size);
    enc.copyBufferToBuffer(b.state, 0, rState, 0, b.state.size);
    d.queue.submit([enc.finish()]);
    await Promise.all([rDist.mapAsync(GPUMapMode.READ), rState.mapAsync(GPUMapMode.READ)]);
    const packed = new Uint32Array(rDist.getMappedRange().slice(0));
    const dist = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
      const q = packed[i] >>> 6;
      dist[i] = q >= 0x3ffffff ? Infinity : q / 1024;
    }
    const st = new Uint32Array(rState.getMappedRange().slice(0));
    rDist.destroy();
    rState.destroy();
    const ex = new Float32Array(n * n), ey = new Float32Array(n * n), label = new Int32Array(n * n);
    for (let i = 0; i < n * n; i++) {
      const p = st[i];
      if (p >= 0xfffffffe) {
        ex[i] = ey[i] = label[i] = -1;
      } else {
        ex[i] = (p & 0x7ff) / 2; // emitter position; pixel x spans [x, x + 1]
        ey[i] = ((p >>> 11) & 0x7ff) / 2;
        label[i] = p >>> 22;
      }
    }
    return { dist, ex, ey, label };
  }

  // ── internals ──

  #disc(cx: number, cy: number, r: number, v: number) {
    const n = this.#n;
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(n - 1, Math.ceil(cy + r));
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(n - 1, Math.ceil(cx + r));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2 + 0.25) this.#set(x, y, v);
      }
    }
    if (y1 >= y0) this.#markDirty(y0, y1 + 1);
  }

  /** Write one scene pixel; a goal pixel that gets overwritten is removed. */
  #set(x: number, y: number, v: number) {
    const i = y * this.#n + x;
    const old = this.#scene[i];
    if ((old === SCENE_WALL) !== (v === SCENE_WALL)) this.#sdfDirty = true;
    if (old !== 0 && old !== SCENE_WALL && old !== v) {
      this.#goalData[(old - 1) * 8 + 7] = 0;
      this.#paletteDirty = true;
    }
    this.#scene[i] = v;
  }

  #eraseGoals(cx: number, cy: number, r: number) {
    for (let id = 0; id < MAX_GOALS; id++) {
      const o = id * 8;
      if (!this.#goalData[o + 7]) continue;
      const gx = this.#goalData[o + 4], gy = this.#goalData[o + 5], gr = this.#goalData[o + 6];
      if (Math.hypot(gx - cx, gy - cy) <= r + gr) {
        const px = Math.floor(gx), py = Math.floor(gy);
        this.#set(px, py, 0);
        this.#goalData[o + 7] = 0;
        this.#paletteDirty = true;
        this.#markDirty(py, py + 1);
      }
    }
  }

  #markDirty(y0: number, y1: number) {
    this.#dirty = this.#dirty ? [Math.min(this.#dirty[0], y0), Math.max(this.#dirty[1], y1)] : [y0, y1];
  }

  async #init() {
    if (!navigator.gpu) throw new Error('WebGPU is not supported in this browser.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('Failed to get GPU adapter.');
    const canTimestamp = adapter.features.has('timestamp-query');
    // subgroup shuffles replace workgroup memory between sweep steps when a subgroup is exactly one workgroup (32 lanes)
    const info = adapter.info as GPUAdapterInfo & { subgroupMinSize?: number; subgroupMaxSize?: number };
    this.#subgroups = adapter.features.has('subgroups') && info.subgroupMinSize === 32 && info.subgroupMaxSize === 32 && !this.hasAttribute('no-subgroups');
    const features: GPUFeatureName[] = [];
    if (canTimestamp) features.push('timestamp-query' as GPUFeatureName);
    if (this.#subgroups) features.push('subgroups' as GPUFeatureName);
    this.#device = await adapter.requestDevice({ requiredFeatures: features });
    if (canTimestamp) this.#querySet = this.#device.createQuerySet({ type: 'timestamp', count: 4 });

    this.#canvas = document.createElement('canvas');
    this.renderRoot.prepend(this.#canvas);
    this.#context = this.#canvas.getContext('webgpu')!;
    this.#format = navigator.gpu.getPreferredCanvasFormat();

    const d = this.#device;
    const mod = (code: string) => {
      const m = d.createShaderModule({ code });
      m.getCompilationInfo().then((info) => {
        for (const msg of info.messages) if (msg.type === 'error') console.error(`folk-flow-field WGSL ${msg.lineNum}:${msg.linePos} ${msg.message}`);
      });
      return m;
    };
    const entry = (binding: number, type: GPUBufferBindingType = 'storage', hasDynamicOffset = false) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type, hasDynamicOffset },
    });
    // the solver reads its per-dispatch uniform through a dynamic offset
    const solveLayout = d.createBindGroupLayout({
      entries: [entry(0, 'uniform', true), entry(1, 'uniform'), ...[2, 3, 4, 5, 6].map((i) => entry(i))],
    });
    this.#solvePipe = d.createComputePipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [solveLayout] }),
      compute: { module: mod(solveShader(this.#subgroups)), entryPoint: 'main' },
    });
    const editLayout = d.createBindGroupLayout({
      entries: [entry(0, 'uniform'), entry(1, 'read-only-storage'), ...[2, 3, 4, 5, 6].map((i) => entry(i))],
    });
    const edit = mod(editShader);
    const editPL = d.createPipelineLayout({ bindGroupLayouts: [editLayout] });
    this.#detectPipe = d.createComputePipeline({ layout: editPL, compute: { module: edit, entryPoint: 'detect' } });
    this.#resetPipe = d.createComputePipeline({ layout: editPL, compute: { module: edit, entryPoint: 'reset' } });
    this.#tracePipe = d.createComputePipeline({ layout: 'auto', compute: { module: mod(traceShader), entryPoint: 'main' } });
    {
      const dyn = { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' as const, hasDynamicOffset: true } };
      const sdfLayout = d.createBindGroupLayout({
        entries: [dyn, entry(1, 'read-only-storage'), entry(2, 'read-only-storage'), entry(3), entry(4)],
      });
      const sm = mod(jfaSdfShader);
      const sl = d.createPipelineLayout({ bindGroupLayouts: [sdfLayout] });
      this.#sdfInit = d.createComputePipeline({ layout: sl, compute: { module: sm, entryPoint: 'init' } });
      this.#sdfPass = d.createComputePipeline({ layout: sl, compute: { module: sm, entryPoint: 'step' } });
      this.#sdfFinish = d.createComputePipeline({ layout: sl, compute: { module: sm, entryPoint: 'finish' } });
      const emitLayout = d.createBindGroupLayout({
        entries: [dyn, entry(1, 'read-only-storage'), entry(2, 'read-only-storage'), entry(3, 'read-only-storage'), entry(4), entry(5), entry(6)],
      });
      this.#jfaEmit = d.createComputePipeline({
        layout: d.createPipelineLayout({ bindGroupLayouts: [emitLayout] }),
        compute: { module: mod(jfaEmitShader), entryPoint: 'main' },
      });
    }
    const rmod = mod(renderShader);
    this.#renderPipe = d.createRenderPipeline({
      layout: 'auto',
      vertex: { module: rmod, entryPoint: 'vs' },
      fragment: { module: rmod, entryPoint: 'fs', targets: [{ format: this.#format }] },
      primitive: { topology: 'triangle-list' },
    });
    const pmod = mod(pathShader);
    this.#pathPipe = d.createRenderPipeline({
      layout: 'auto',
      vertex: { module: pmod, entryPoint: 'vs' },
      fragment: { module: pmod, entryPoint: 'fs', targets: [{ format: this.#format }] },
      primitive: { topology: 'line-list' },
    });

    this.#ready = true;
    this.#allocate();
    this.#layout();
    this.#ro = new ResizeObserver(() => this.#layout());
    this.#ro.observe(this);
    this.#bindPointer();
    const frame = () => {
      this.#frame();
      this.#raf = requestAnimationFrame(frame);
    };
    this.#raf = requestAnimationFrame(frame);
    this.dispatchEvent(new Event('ready'));
  }

  #destroyBuffers() {
    for (const b of Object.values(this.#buf)) b.destroy();
    this.#buf = {};
  }

  #allocate() {
    const n = Math.min(MAX_SIZE, Math.max(64, Math.round(this.size / 64) * 64));
    const d = this.#device;
    this.#destroyBuffers();
    this.#n = n;
    this.#tiles = n / TS;
    this.#canvas.width = n;
    this.#canvas.height = n;
    this.#context.configure({ device: d, format: this.#format, alphaMode: 'opaque' });
    const prevScene = this.#scene;
    this.#scene = new Uint32Array(n * n);
    if (prevScene && prevScene.length === n * n) this.#scene.set(prevScene);
    else {
      this.#goalCount = 0;
      this.#goalData.fill(0);
    }

    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const U = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    const mk = (name: string, size: number, usage: number) => (this.#buf[name] = d.createBuffer({ label: name, size, usage }));
    const T2 = this.#tiles * this.#tiles;
    mk('dv', n * n * 4, S);
    mk('state', n * n * 4, S);
    mk('scene', n * n * 4, S);
    mk('prev', n * n * 4, S);
    mk('stamp', T2 * 8 * 4, S);
    mk('pend', T2 * 4, S);
    mk('stats', 16, S);
    mk('statsRead', 16, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    mk('ctrl', (1 + Math.ceil(MAX_GOALS / 32) + MAX_GOALS) * 4, S);
    mk('goals', MAX_GOALS * 32, S);
    mk('path', MAX_PATH * 8, S);
    mk('dispatch', MAX_ROUNDS * 4 * UNI_STRIDE, U);
    mk('seedA', n * n * 4, S);
    mk('seedB', n * n * 4, S);
    mk('sdf', n * n * 4, S);
    mk('dvB', n * n * 4, S);
    mk('stateB', n * n * 4, S);
    mk('jfaParams', 64 * UNI_STRIDE, U);
    mk('frame', 16, U);
    mk('edit', 16, U);
    mk('trace', 16, U);
    mk('view', 16, U);
    if (this.#querySet) {
      mk('ts', 32, GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC);
      mk('tsRead', 32, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
      mk('tsJ', 16, GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC);
      mk('tsBench', 32, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ); // bench() reads here, not racing the frame loop
    }
    // static per-dispatch uniforms: checkerboard phase + index within the frame
    const disp = new Uint32Array((MAX_ROUNDS * 4 * UNI_STRIDE) / 4);
    for (let k = 0; k < MAX_ROUNDS * 4; k++) {
      disp[(k * UNI_STRIDE) / 4] = k & 3;
      disp[(k * UNI_STRIDE) / 4 + 1] = k;
    }
    d.queue.writeBuffer(this.#buf.dispatch, 0, disp);

    const b = this.#buf;
    const bg = (layout: GPUBindGroupLayout, buffers: (GPUBuffer | [GPUBuffer, number])[]) =>
      d.createBindGroup({
        layout,
        entries: buffers.map((x, binding) => ({
          binding,
          resource: Array.isArray(x) ? { buffer: x[0], size: x[1] } : { buffer: x },
        })),
      });
    this.#solveBG = bg(this.#solvePipe.getBindGroupLayout(0), [[b.dispatch, 16], b.frame, b.dv, b.state, b.stamp, b.pend, b.stats]);
    this.#editBG = bg(this.#detectPipe.getBindGroupLayout(0), [b.edit, b.scene, b.prev, b.dv, b.state, b.ctrl, b.pend]);
    this.#traceBG = bg(this.#tracePipe.getBindGroupLayout(0), [b.trace, b.dv, b.state, b.path]);
    {
      const sl = this.#sdfPass.getBindGroupLayout(0), el = this.#jfaEmit.getBindGroupLayout(0);
      const jp: [GPUBuffer, number] = [b.jfaParams, 16];
      this.#jfaBG = [
        bg(sl, [jp, b.scene, b.seedA, b.seedB, b.sdf]), // sdf: A -> B
        bg(sl, [jp, b.scene, b.seedB, b.seedA, b.sdf]), // sdf: B -> A
        bg(el, [jp, b.sdf, b.dv, b.state, b.dvB, b.stateB, b.pend]), // emitters: A -> B
        bg(el, [jp, b.sdf, b.dvB, b.stateB, b.dv, b.state, b.pend]), // emitters: B -> A
      ];
    }
    this.#renderBG = bg(this.#renderPipe.getBindGroupLayout(0), [b.view, b.dv, b.state, b.scene, b.goals]);
    this.#pathBG = bg(this.#pathPipe.getBindGroupLayout(0), [b.view, b.path]);

    this.#needFull = true;
    this.#sdfDirty = true;
    this.#paletteDirty = true;
    this.#markDirty(0, n);
  }

  #layout() {
    if (!this.#canvas) return;
    const w = this.clientWidth || 800;
    const h = this.clientHeight || 600;
    const disp = Math.max(64, Math.min(w, h) - 32);
    Object.assign(this.#canvas.style, {
      left: `${(w - disp) / 2}px`,
      top: `${(h - disp) / 2}px`,
      width: `${disp}px`,
      height: `${disp}px`,
    });
  }

  #toPixel(e: PointerEvent): [number, number] {
    const r = this.#canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * this.#n, ((e.clientY - r.top) / r.height) * this.#n];
  }

  #bindPointer() {
    const c = this.#canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      const p = this.#toPixel(e);
      const tool: FlowFieldTool = e.button === 2 || e.altKey ? 'erase' : e.shiftKey ? 'goal' : this.tool;
      if (tool === 'goal') {
        this.addGoal(p[0], p[1], Math.max(2, Math.min(8, this.brush / 2)));
        return;
      }
      c.setPointerCapture(e.pointerId);
      this.#drawing = true;
      this.#drawKind = tool;
      this.#last = p;
      this.stroke(p[0], p[1], p[0], p[1], this.brush, tool);
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.#toPixel(e);
      this.#mouse = p;
      if (!this.#drawing || !this.#last) return;
      this.stroke(this.#last[0], this.#last[1], p[0], p[1], this.brush, this.#drawKind);
      this.#last = p;
    });
    const up = () => {
      this.#drawing = false;
      this.#last = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => {
      if (!this.#drawing) this.#mouse = [-1, -1];
    });
  }

  /** Detect scene changes against the previous scene and reset only what they can affect. */
  #encodeEdit(full: boolean) {
    const d = this.#device, q = d.queue, b = this.#buf, n = this.#n;
    const ctrl = new Uint32Array(b.ctrl.size / 4);
    ctrl.fill(0xffffffff, 1 + Math.ceil(MAX_GOALS / 32)); // per-goal reset thresholds = +inf
    q.writeBuffer(b.ctrl, 0, ctrl);
    q.writeBuffer(b.edit, 0, new Uint32Array([n, full ? 1 : 0, this.#base, this.#tiles]));
    q.writeBuffer(b.stats, 0, new Uint32Array(4));
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, this.#editBG);
    const g = Math.ceil(n / 16);
    pass.setPipeline(this.#detectPipe);
    pass.dispatchWorkgroups(g, g);
    pass.setPipeline(this.#resetPipe);
    pass.dispatchWorkgroups(g, g);
    pass.end();
    q.submit([enc.finish()]);
    this.#editBase = this.#base;
    this.#gen++;
  }

  /** Experimental pre-pass: wall distance field, then emitter jump flooding with visibility (see jfaEmitShader). */
  #encodeJfa(enc: GPUCommandEncoder, withSdf = true) {
    const d = this.#device, n = this.#n;
    const ks: number[] = [];
    for (let k = n / 2; k >= 1; k /= 2) ks.push(k);
    const sdfKs = [...ks, 1]; // one extra unit pass helps jump flooding accuracy
    const emitKs = ks.length % 2 ? [...ks, 1] : ks; // even count: the result ends in the main buffers
    const params = new Uint32Array((64 * UNI_STRIDE) / 4);
    const all = [0, ...sdfKs, 0, ...emitKs];
    all.forEach((k, j) => params.set([n, k, this.#base, this.#tiles], (j * UNI_STRIDE) / 4));
    d.queue.writeBuffer(this.#buf.jfaParams, 0, params);
    const g = Math.ceil(n / 16);
    const pass = enc.beginComputePass(
      this.#querySet ? { timestampWrites: { querySet: this.#querySet, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 } } : {},
    );
    let j = 0;
    if (!withSdf) j = sdfKs.length + 2;
    // seeds start in B (init writes seedOut = B via the A -> B group)
    if (withSdf) {
    pass.setPipeline(this.#sdfInit);
    pass.setBindGroup(0, this.#jfaBG[0], [j++ * UNI_STRIDE]);
    pass.dispatchWorkgroups(g, g);
    let inB = true;
    pass.setPipeline(this.#sdfPass);
    for (const _ of sdfKs) {
      pass.setBindGroup(0, this.#jfaBG[inB ? 1 : 0], [j++ * UNI_STRIDE]);
      pass.dispatchWorkgroups(g, g);
      inB = !inB;
    }
    pass.setPipeline(this.#sdfFinish);
    pass.setBindGroup(0, this.#jfaBG[inB ? 1 : 0], [j++ * UNI_STRIDE]);
    pass.dispatchWorkgroups(g, g);
    }
    pass.setPipeline(this.#jfaEmit);
    emitKs.forEach((_, e) => {
      pass.setBindGroup(0, this.#jfaBG[2 + (e % 2)], [j++ * UNI_STRIDE]);
      pass.dispatchWorkgroups(g, g);
    });
    pass.end();
  }

  #encodeSolve(enc: GPUCommandEncoder, rounds: number, maxPass: number) {
    this.#device.queue.writeBuffer(this.#buf.frame, 0, new Uint32Array([this.#base, this.#n, this.#tiles, maxPass]));
    const pass = enc.beginComputePass(
      this.#querySet ? { timestampWrites: { querySet: this.#querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {},
    );
    pass.setPipeline(this.#solvePipe);
    const wgx = this.#tiles / 2 / K, wgy = this.#tiles / 2;
    for (let k = 0; k < rounds * 4; k++) {
      pass.setBindGroup(0, this.#solveBG, [k * UNI_STRIDE]);
      pass.dispatchWorkgroups(wgx, wgy);
    }
    pass.end();
    this.#frameBase = this.#base;
    this.#base += rounds * 4;
  }

  #frame() {
    if (!this.#ready) return;
    const d = this.#device;
    const q = d.queue;
    const b = this.#buf;
    const n = this.#n;

    if (this.#dirty) {
      const [y0, y1] = this.#dirty;
      q.writeBuffer(b.scene, y0 * n * 4, this.#scene, y0 * n, (y1 - y0) * n);
      this.#dirty = null;
      const full = this.#needFull;
      this.#encodeEdit(full);
      this.#needFull = false;
      if (this.jfa && (full || this.#goalsAdded)) {
        const enc = d.createCommandEncoder();
        this.#encodeJfa(enc, this.#sdfDirty);
        q.submit([enc.finish()]);
        this.#sdfDirty = false;
      }
      this.#goalsAdded = false;
      this.#active = true;
      Object.assign(this.stats, { solveMs: 0, rounds: 0, tileRuns: 0, meanSweeps: 0, converged: false });
    }
    if (this.#paletteDirty) {
      q.writeBuffer(b.goals, 0, this.#goalData);
      this.#paletteDirty = false;
    }

    const enc = d.createCommandEncoder();
    // as many rounds as fit the frame budget at the recently measured cost per round
    const rounds = Math.max(2, Math.min(MAX_ROUNDS, Math.floor(this.frameBudget / this.#msPerRound)));
    let solved = false;
    if (this.#active) {
      this.#encodeSolve(enc, rounds, 8);
      if (this.#querySet) enc.resolveQuerySet(this.#querySet, 0, 2, b.ts, 0);
      solved = true;
    }

    // path from the mouse
    const [mx, my] = this.#mouse;
    q.writeBuffer(b.trace, 0, new Int32Array([n, this.path ? Math.floor(mx) : -1, Math.floor(my), 0]));
    {
      const pass = enc.beginComputePass();
      pass.setPipeline(this.#tracePipe);
      pass.setBindGroup(0, this.#traceBG);
      pass.dispatchWorkgroups(1);
      pass.end();
    }

    const flags = (this.contours ? 1 : 0) | (this.borders ? 2 : 0) | (this.arrows ? 4 : 0);
    const view = new ArrayBuffer(16);
    new Uint32Array(view, 0, 2).set([n, flags]);
    new Float32Array(view, 8, 2).set([24, 16]);
    q.writeBuffer(b.view, 0, view);
    const rp = enc.beginRenderPass({
      colorAttachments: [
        { view: this.#context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
      ],
    });
    rp.setPipeline(this.#renderPipe);
    rp.setBindGroup(0, this.#renderBG);
    rp.draw(3);
    if (this.path) {
      rp.setPipeline(this.#pathPipe);
      rp.setBindGroup(0, this.#pathBG);
      rp.draw((MAX_PATH - 1) * 2);
    }
    rp.end();

    const canRead = solved && !this.#readPending;
    if (canRead) {
      enc.copyBufferToBuffer(b.stats, 0, b.statsRead, 0, 16);
      if (this.#querySet) enc.copyBufferToBuffer(b.ts, 0, b.tsRead, 0, 16);
    }
    q.submit([enc.finish()]);
    if (canRead) this.#readStats(this.#frameBase, rounds, this.#gen);
    this.#onFrame?.(this.stats);
  }

  async #readStats(frameBase: number, rounds: number, gen: number) {
    this.#readPending = true;
    const b = this.#buf;
    try {
      const reads: Promise<void>[] = [b.statsRead.mapAsync(GPUMapMode.READ)];
      if (this.#querySet) reads.push(b.tsRead.mapAsync(GPUMapMode.READ));
      await Promise.all(reads);
      const s = new Uint32Array(b.statsRead.getMappedRange().slice(0));
      b.statsRead.unmap();
      let ms = 0;
      if (this.#querySet) {
        const t = new BigInt64Array(b.tsRead.getMappedRange().slice(0));
        b.tsRead.unmap();
        ms = Number(t[1] - t[0]) / 1e6;
      }
      if (gen !== this.#gen) return; // an edit happened since: these numbers are stale
      const lastChange = s[0];
      const frameEnd = frameBase + rounds * 4;
      this.stats.gpuMs = ms;
      this.stats.solveMs += ms;
      if (ms > 0) this.#msPerRound = Math.max(0.02, 0.7 * this.#msPerRound + 0.3 * (ms / rounds));
      this.stats.tileRuns = s[1];
      this.stats.meanSweeps = s[1] ? s[2] / s[1] : 0;
      this.stats.rounds = Math.max(0, Math.ceil((lastChange - this.#editBase + 1) / 4));
      // converged when nothing changed in the last full round of that frame
      const converged = lastChange + 4 < frameEnd && !this.#dirty;
      this.stats.converged = converged;
      if (converged) this.#active = false;
    } catch {
      // device lost or buffers destroyed during a resize
    } finally {
      this.#readPending = false;
    }
  }
}

function randomColor(): [number, number, number] {
  const h = Math.random();
  const s = 0.55 + Math.random() * 0.3;
  const v = 0.8 + Math.random() * 0.2;
  const f = (k: number) => {
    const kk = (k + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(kk, 4 - kk, 1));
  };
  return [f(5), f(3), f(1)];
}
