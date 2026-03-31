import assert from "node:assert/strict";
import { matchCulpado, keywordScore, liesScore, evaluateResolution } from "../js/resolution.js";

assert.equal(matchCulpado("Helena Holden", "Helena Holden"), true);
assert.equal(matchCulpado("helena", "Helena Holden"), true);

const ks = keywordScore("motivo era o seguro e o capataz raul", [
  "seguro",
  "capataz",
]);
assert.ok(ks.ratio >= 0.66);

const ls = liesScore(["Lucas Holden", "Raul Prado"], ["Lucas Holden", "Raul Prado"]);
assert.equal(ls.ratio, 1);

const casoMini = {
  eventosLinhaDoTempo: [
    { id: "a", ordemCorreta: 1 },
    { id: "b", ordemCorreta: 2 },
  ],
  solucao: {
    culpado: "X",
    motivo: "teste motivo seguro",
    metodo: "teste ricina café",
    mentiras: ["A"],
    palavrasChaveMotivo: ["seguro"],
    palavrasChaveMetodo: ["ricina"],
  },
};

const ev = evaluateResolution(
  casoMini,
  {
    culpado: "X",
    motivo: "foi o seguro",
    metodo: "ricina no café",
    mentiras: ["A"],
  },
  ["a", "b"],
);

assert.ok(ev.total > 0);
assert.equal(ev.culpadoOk, true);

console.log("resolution.test.mjs: ok");
