// Aegis 谱系带宽实验（S2）—— 行使 m<κ：B1 带宽–松弛律与匹配下界的数值验证
//
// 论文对应：§4.4.1（覆盖网验证器上界）、§4.4.2（无结构匹配下界）、§4.4.3（B1 律：
//   结构化 Lipschitz 目标 s*(m)=Θ(L·r_m) + 填充/bump 下界）。
//
// 构造（严谨版）：
//   · 动作域 = 归一化立方 [0,1]^d；菜单 μ = 细网格（κ 点）。
//   · 带宽 m 的验证器：取 k^d 点规则格网 N（m=k^d），覆盖半径 r_m 实测（≈√d/(2(k-1))）。
//     接受 a ⟺ u(a) ≥ max_{q∈N} u(q) − 2L·r_m（§4.4.1）。
//   · 对抗下界（§4.4.3 的严谨形态）：基线 u0 ≡ c（常数，处处 0-最优 ⇒ a 必须被接受）；
//     p* = 离网最远的菜单点（距离 = r_m），u1 = u0 + φ，φ 为支撑半径 r_m、峰高 L·r_m 的
//     帐篷（斜率 L）。则 u1|_N = u0|_N（不可见）、验证器接受 a、而 a 的真实次优 gap = L·r_m。
//   · 无结构对照（§4.4.2）：去掉 Lipschitz 约束 → s*=1（m<κ），m=κ 时 0（阶跃）。
//
// 诚实边界：合成数值验证（B 级，与 §8.6 bond-check 同级）；验证的是率与不等式，
//   不是链上二维执行（真实路径仅 dμ=1 的 WMON wrap）。
//
// 运行：node scripts/spectrum-bandwidth.mjs [--out <path>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = argVal("--out", path.join(__dirname, "spectrum-rate.json"));

const L = 0.4;   // 目标类 𝒰_L 的 Lipschitz 常数
const C0 = 0.5;  // 基线常数（留值域余量：C0 + L·r ≤ 1）

function dist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }

/// d 维细网格菜单（每维 G 点，共 κ=G^d）
function buildGrid(d, G) {
  const pts = [];
  const rec = (i, c) => {
    if (i === d) { pts.push(c.slice()); return; }
    for (let j = 0; j < G; j++) { c.push(j / (G - 1)); rec(i + 1, c); c.pop(); }
  };
  rec(0, []);
  return pts;
}

/// k^d 点规则格网 N（每维 k 点，坐标 j/(k-1)；k=1 取中心）
function latticeNet(d, k) {
  const coords = [];
  const axis = Array.from({ length: k }, (_, j) => (j + 0.5) / k);  // 居中枢：间距 1/k，覆盖半径 √d/(2k)
  const rec = (i, c) => { if (i === d) { coords.push(c.slice()); return; } for (const v of axis) { c.push(v); rec(i + 1, c); c.pop(); } };
  rec(0, []);
  return coords;
}

/// 覆盖半径 r = max_{z∈menu} min_{n∈N} ||z-n||；返回 {r, pstar}
function coveringRadius(menu, net) {
  let r = 0, pstar = null;
  for (const z of menu) {
    let bd = Infinity;
    for (const n of net) { const dd = dist(z, n); if (dd < bd) bd = dd; }
    if (bd > r) { r = bd; pstar = z; }
  }
  return { r, pstar };
}

/// 数值验算对抗构造：u0≡C0，u1=u0+φ（帐篷，峰 L·r，支撑半径 r，斜率 L）
function verifyAdversary(menu, net, r, pstar) {
  const u0 = () => C0;
  const phi = (z) => Math.max(0, L * (r - dist(z, pstar)));  // 峰 L·r 在 p*，0 在距离 r
  const u1 = (z) => C0 + phi(z);

  let maxNetDiff = 0;
  for (const q of net) maxNetDiff = Math.max(maxNetDiff, Math.abs(u1(q) - u0(q)));
  const maxN = Math.max(...net.map(u1));
  const a = net[0];                          // 被执行动作 a（取网内一点）
  const accept = u1(a) >= maxN - 2 * L * r - 1e-12;
  let maxAll = -Infinity;
  for (const z of menu) maxAll = Math.max(maxAll, u1(z));
  const gap = accept ? maxAll - u1(a) : 0;
  return { accept, gap, netInvisible: maxNetDiff < 1e-12, a };
}

function fitLogLog(xs, ys) {
  const n = xs.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const lx = Math.log(xs[i]), ly = Math.log(ys[i]); sx += lx; sy += ly; sxx += lx * lx; sxy += lx * ly; }
  const p = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { slope: p, coef: Math.exp((sy - p * sx) / n), n };
}

function runDimension(d, G, kmax) {
  const menu = buildGrid(d, G);
  const kappa = menu.length;
  const points = [], checks = [];
  for (let k = 1; k <= kmax; k++) {
    const m = Math.pow(k, d);
    if (m > kappa) break;
    const net = latticeNet(d, k);
    const { r, pstar } = coveringRadius(menu, net);
    const sLower = L * r;
    const sUpper = 3 * L * r;
    const rTheory = Math.sqrt(d) / (2 * k);
    points.push({ m, k, r, rTheory, sLower, sUpper });
    if ([1, 2, 4, 8].includes(k) || k === kmax) {
      const v = verifyAdversary(menu, net, r, pstar);
      checks.push({ m, accept: v.accept, gap: v.gap, expect: sLower, netInvisible: v.netInvisible, gapMatches: Math.abs(v.gap - sLower) < 1e-9 });
    }
  }
  const fitPts = points.filter((p) => p.k >= 3 && p.k <= kmax);
  const fit = fitLogLog(fitPts.map((p) => p.m), fitPts.map((p) => p.sLower));
  return { d, G, kappa, kmax, theorySlope: -1 / d, fittedSlope: fit.slope, fittedCoef: fit.coef, checks, points };
}

function unstructuredControl(kappa) {
  const samples = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024].filter((m) => m <= kappa);
  if (samples[samples.length - 1] !== kappa) samples.push(kappa);
  return { kappa, points: samples.map((m) => ({ m, sStar: m < kappa ? 1.0 : 0.0 })) };
}

function systemGrounding() {
  return {
    policy: { perTxLimitMon: 0.05, maxSlippageBps: 100 },
    deployed: { dMu: 1, verifier: "analytic argmax + point epsilon-check", spectrumPosition: "m=κ exact (s*=0)", evidence: "SOA-lite / soa-demo 8/8" },
    hypothetical: { dMu: 2, domain: "amount∈[0,0.05]MON × slippage∈[0,100]bps (normalized)", rate: "s*(m)=Θ(L D m^{-1/2})", status: "assumed deployment; on-chain 2-D execution = future work" },
  };
}

// ---------- 主流程 ----------
console.log("=== Aegis S2 谱系带宽实验（m<κ）===");
console.log(`L=${L}, 基线 C0=${C0}；网 = k^d 规则格网；对抗 = §4.4.3 常数基线 + 帐篷 bump\n`);

const dims = [{ d: 1, G: 512, kmax: 64 }, { d: 2, G: 64, kmax: 24 }, { d: 3, G: 20, kmax: 10 }];
const results = [];
for (const cfg of dims) {
  const r = runDimension(cfg.d, cfg.G, cfg.kmax);
  const ok = r.checks.every((c) => c.accept && c.netInvisible && c.gapMatches);
  console.log(`d=${r.d}  G=${r.G}  κ=${r.kappa}  实测斜率=${r.fittedSlope.toFixed(4)}  理论=-1/d=${r.theorySlope.toFixed(4)}  对抗验算=${ok ? "全部通过" : "有失败"}`);
  for (const p of r.points) {
    if ([1, 2, 4, 16, 64].includes(p.k) || p.k === r.kmax) {
      console.log(`    m=${String(p.m).padStart(5)}  r_m=${p.r.toFixed(4)} (理论 ${p.rTheory.toFixed(4)})  s_lower=${p.sLower.toFixed(5)}  s_upper=${p.sUpper.toFixed(5)}`);
    }
  }
  console.log("");
  results.push(r);
}

const un = unstructuredControl(1 << Math.ceil(Math.log2(results[0].kappa)));
console.log("无结构对照（§4.4.2）：", un.points.map((p) => `m=${p.m}:s*=${p.sStar}`).join("  "));
const grounding = systemGrounding();
console.log("\n系统接地：部署 dμ=1 = 精确端（s*=0）；假设 dμ=2 = 中间档 s*~m^{-1/2}");

const payload = {
  meta: {
    experiment: "S2 spectrum-bandwidth (m<kappa)", date: new Date().toISOString(), L, C0,
    net: "regular k^d lattice over fine menu grid",
    adversary: "constant baseline + tent bump at farthest unqueried menu point (S4.4.3, rigorous form)",
    evidenceTier: "B (synthetic, offline, reproducible)",
    command: "node scripts/spectrum-bandwidth.mjs",
  },
  dimensions: results, unstructured: un, grounding,
};
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(`\n→ 写入 ${OUT}`);
