const REGISTRY_URL = "cases/registry.json";

export async function loadRegistry() {
  const res = await fetch(REGISTRY_URL);
  if (!res.ok) throw new Error(`Falha ao carregar registry: ${res.status}`);
  return res.json();
}

export async function loadCase(caseFile) {
  const res = await fetch(`cases/${caseFile}`);
  if (!res.ok) throw new Error(`Falha ao carregar caso: ${res.status}`);
  return res.json();
}

export function flattenDocuments(caso) {
  const out = [];
  const fases = Array.isArray(caso.fases) ? caso.fases : [];
  fases.forEach((fase, fi) => {
    const docs = Array.isArray(fase.documentos) ? fase.documentos : [];
    docs.forEach((d, di) => {
      const id = d.id || `f${fi}-d${di}`;
      out.push({
        ...d,
        id,
        faseNome: fase.nome || `Fase ${fi + 1}`,
        faseIndex: fi,
      });
    });
  });
  return out;
}
