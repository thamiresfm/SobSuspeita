function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s) {
  return normalize(s)
    .split(/[^a-z0-9áàâãéêíóôõúç]+/iu)
    .filter((w) => w.length > 2);
}

export function matchCulpado(userChoice, expectedName) {
  const a = normalize(userChoice);
  const b = normalize(expectedName);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

export function keywordScore(text, keywords) {
  if (!keywords || keywords.length === 0) return { ratio: 1, matched: [], missing: [] };
  const t = normalize(text);
  const matched = [];
  const missing = [];
  keywords.forEach((kw) => {
    const n = normalize(kw);
    if (n.length < 2) return;
    if (t.includes(n)) matched.push(kw);
    else missing.push(kw);
  });
  const ratio = matched.length / keywords.length;
  return { ratio, matched, missing };
}

export function liesScore(selectedNames, expectedNames) {
  const sel = new Set((selectedNames || []).map(normalize).filter(Boolean));
  const exp = new Set((expectedNames || []).map(normalize).filter(Boolean));
  let hits = 0;
  exp.forEach((e) => {
    for (const s of sel) {
      if (s === e || s.includes(e) || e.includes(s)) {
        hits += 1;
        break;
      }
    }
  });
  const falsePositives = [...sel].filter((s) => {
    for (const e of exp) {
      if (s === e || s.includes(e) || e.includes(s)) return false;
    }
    return true;
  });
  const ratio = exp.size === 0 ? 1 : hits / exp.size;
  return { ratio, hits, expected: exp.size, falsePositives };
}

export function timelineBonus(order, eventos, maxPoints = 5) {
  if (!eventos || eventos.length < 2) return { points: 0, correct: true };
  const byId = new Map(eventos.map((e) => [e.id, e]));
  let correctPairs = 0;
  let totalPairs = 0;
  for (let i = 0; i < order.length - 1; i++) {
    const a = byId.get(order[i]);
    const b = byId.get(order[i + 1]);
    if (!a || !b) continue;
    if (typeof a.ordemCorreta !== "number" || typeof b.ordemCorreta !== "number") continue;
    totalPairs += 1;
    if (a.ordemCorreta < b.ordemCorreta) correctPairs += 1;
  }
  if (totalPairs === 0) return { points: 0, correct: true };
  const ratio = correctPairs / totalPairs;
  return { points: Math.round(maxPoints * ratio), ratio };
}

export function evaluateResolution(caso, answers, timelineOrder) {
  const weights = {
    culpado: 35,
    motivo: 25,
    metodo: 25,
    mentiras: 10,
    timeline: 5,
  };

  const sol = caso.solucao || {};
  const palavrasMotivo = sol.palavrasChaveMotivo || tokenize(sol.motivo || "");
  const palavrasMetodo = sol.palavrasChaveMetodo || tokenize(sol.metodo || "");

  const culpadoOk = matchCulpado(answers.culpado, sol.culpado);
  const motivoSc = keywordScore(answers.motivo, palavrasMotivo);
  const metodoSc = keywordScore(answers.metodo, palavrasMetodo);
  const liesSc = liesScore(answers.mentiras, sol.mentiras || []);
  const tBonus = timelineBonus(timelineOrder, caso.eventosLinhaDoTempo || [], weights.timeline);

  const motivoPts = Math.round(weights.motivo * motivoSc.ratio);
  const metodoPts = Math.round(weights.metodo * metodoSc.ratio);
  const mentirasPts = Math.round(weights.mentiras * liesSc.ratio);
  const culpadoPts = culpadoOk ? weights.culpado : 0;

  const total =
    culpadoPts + motivoPts + metodoPts + mentirasPts + tBonus.points;

  return {
    total,
    max: weights.culpado + weights.motivo + weights.metodo + weights.mentiras + weights.timeline,
    culpadoOk,
    motivoSc,
    metodoSc,
    liesSc,
    tBonus,
    weights,
    culpadoPts,
    motivoPts,
    metodoPts,
    mentirasPts,
    solucao: sol,
  };
}
