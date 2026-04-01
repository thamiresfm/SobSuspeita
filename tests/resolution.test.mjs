import assert from "node:assert/strict";
import { matchCulpado, keywordScore, liesScore, evaluateResolution } from "../js/resolution.js";

// matchCulpado
assert.equal(matchCulpado("Helena Holden", "Helena Holden"), true, "culpado exato");
assert.equal(matchCulpado("helena", "Helena Holden"), true, "culpado case-insensitive");
assert.equal(matchCulpado("Raul", "Helena Holden"), false, "culpado errado");
assert.equal(matchCulpado("", "Helena Holden"), false, "culpado vazio");

// keywordScore — cobertura total
const ksFull = keywordScore("o motivo era o seguro de vida e o capataz raul estava envolvido", ["seguro", "capataz"]);
assert.equal(ksFull.ratio, 1, "keywordScore 100%");
assert.equal(ksFull.matched.length, 2, "encontrou 2 palavras-chave");

// keywordScore — cobertura parcial
const ksPartial = keywordScore("foi por causa do seguro", ["seguro", "capataz"]);
assert.ok(ksPartial.ratio >= 0.49 && ksPartial.ratio <= 0.51, "keywordScore 50%");
assert.deepEqual(ksPartial.missing, ["capataz"], "palavra faltando: capataz");

// keywordScore — zero cobertura
const ksZero = keywordScore("nenhuma pista aqui", ["seguro", "capataz"]);
assert.equal(ksZero.ratio, 0, "keywordScore 0%");

// liesScore — 100%
const lsFull = liesScore(["Lucas Holden", "Raul Prado"], ["Lucas Holden", "Raul Prado"]);
assert.equal(lsFull.ratio, 1, "mentiras 100%");

// liesScore — parcial
const lsPartial = liesScore(["Lucas Holden"], ["Lucas Holden", "Raul Prado"]);
assert.ok(lsPartial.ratio >= 0.49 && lsPartial.ratio <= 0.51, "mentiras 50%");

// liesScore — 0%
const lsZero = liesScore([], ["Lucas Holden", "Raul Prado"]);
assert.equal(lsZero.ratio, 0, "mentiras 0%");

// liesScore — sem mentiras esperadas (caso especial)
const lsNone = liesScore([], []);
assert.equal(lsNone.ratio, 1, "sem mentiras esperadas = score máximo");

// evaluateResolution — resposta perfeita
const casoMini = {
  eventosLinhaDoTempo: [
    { id: "a", ordemCorreta: 1 },
    { id: "b", ordemCorreta: 2 },
  ],
  solucao: {
    culpado: "X",
    motivo: "foi o seguro de vida",
    metodo: "ricina dissolvida no café",
    mentiras: ["A"],
    palavrasChaveMotivo: ["seguro"],
    palavrasChaveMetodo: ["ricina"],
  },
};

const evPerfeito = evaluateResolution(
  casoMini,
  { culpado: "X", motivo: "foi o seguro", metodo: "ricina no café", mentiras: ["A"] },
  ["a", "b"]
);
assert.ok(evPerfeito.total > 0, "pontuação > 0 na resposta perfeita");
assert.equal(evPerfeito.culpadoOk, true, "culpado correto");

// evaluateResolution — culpado errado
const evErrado = evaluateResolution(
  casoMini,
  { culpado: "Z", motivo: "foi o seguro", metodo: "ricina no café", mentiras: ["A"] },
  ["a", "b"]
);
assert.equal(evErrado.culpadoOk, false, "culpado incorreto detectado");
assert.ok(evErrado.total < evPerfeito.total, "score menor sem culpado correto");

// evaluateResolution — mentiras totalmente erradas
const evSemMentiras = evaluateResolution(
  casoMini,
  { culpado: "X", motivo: "foi o seguro", metodo: "ricina no café", mentiras: [] },
  ["a", "b"]
);
assert.ok(evSemMentiras.mentirasPts < evPerfeito.mentirasPts, "menos pontos sem mentiras");

// evaluateResolution — timeline fora de ordem
const evTimelineErrada = evaluateResolution(
  casoMini,
  { culpado: "X", motivo: "foi o seguro", metodo: "ricina no café", mentiras: ["A"] },
  ["b", "a"]
);
assert.ok(evTimelineErrada.total <= evPerfeito.total, "timeline errada não aumenta pontuação");

// evaluateResolution — max é sempre > 0
assert.ok(evPerfeito.max > 0, "pontuação máxima > 0");

console.log("resolution.test.mjs: todos os testes passaram ✓");
