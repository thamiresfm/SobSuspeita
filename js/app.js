import { loadRegistry, loadCase } from "./case-loader.js";
import { mergeDefaultState, saveCaseState, loadCaseState } from "./storage.js";
import { evaluateResolution } from "./resolution.js";
import { playClick, setSoundOn, isEnabled } from "./audio.js";

let registry = [];
let currentCase = null;
let currentCaseId = null;
let state = null;
let timerInterval = null;
let currentUtterance = null;
let currentDocForSpeech = null;

const el = (id) => document.getElementById(id);

function toast(msg, duration = 1600) {
  const t = el("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._tid);
  toast._tid = setTimeout(() => {
    t.hidden = true;
  }, duration);
}

function persist() {
  if (!currentCaseId || !state) return;
  saveCaseState(currentCaseId, state);
}

function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  const start = state.startedAt || Date.now();
  state.startedAt = start;
  const display = el("timer-display");
  const tick = () => {
    display.textContent = formatMs(Date.now() - start);
  };
  tick();
  timerInterval = setInterval(tick, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function showHome() {
  stopTimer();
  el("view-home").hidden = false;
  el("view-case").hidden = true;
  el("topbar-home").style.display = "";
  el("topbar-case").classList.remove("is-visible");
  currentCase = null;
  currentCaseId = null;
  state = null;
}

function setActivePanel(name) {
  // Marca aba ativa
  document.querySelectorAll(".case-nav__btn").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.panel === name);
  });

  // Coluna central: mostra o conteúdo certo para cada aba
  const center = el("case-col-center");
  if (!center) return;

  center.innerHTML = "";

  if (name === "documentos") {
    // Restaura o doc-viewer (pode estar vazio se nenhum doc selecionado)
    const viewer = document.createElement("div");
    viewer.id = "doc-viewer";
    viewer.className = "doc-viewer";
    viewer.innerHTML = `<div class="doc-viewer__empty"><p>Selecione um documento na lista à esquerda para ler.</p></div>`;
    center.appendChild(viewer);
    return;
  }

  if (name === "anotacoes") {
    center.innerHTML = `
      <div class="center-panel-wrap">
        <h2 class="center-panel__title">Anotações da Investigação</h2>
        <form id="note-form" class="note-form center-note-form">
          <div class="center-note-form__row">
            <label class="field" style="flex:1">
              <span class="field__label">Nova anotação</span>
              <textarea id="note-text" rows="3" placeholder="Ex.: o álibi de X conflita com o laudo…"></textarea>
            </label>
            <div class="center-note-form__actions">
              <label class="field">
                <span class="field__label">Marcação</span>
                <select id="note-tag">
                  <option value="fato">Fato confirmado</option>
                  <option value="suspeita">Suspeita</option>
                  <option value="duvida">Dúvida</option>
                </select>
              </label>
              <button type="submit" class="btn btn--primary">Adicionar</button>
            </div>
          </div>
        </form>
        <ul id="notes-list" class="notes-list center-notes-list"></ul>
        <div class="center-panel__section">
          <h3 class="center-panel__subtitle">Fatos do caso</h3>
          <ul id="facts-list" class="facts-list"></ul>
        </div>
        <div class="center-panel__section">
          <h3 class="center-panel__subtitle">Hipótese rascunho</h3>
          <label class="field">
            <span class="field__label">Síntese antes de enviar na aba Resolução</span>
            <textarea id="hypothesis-draft" rows="4" placeholder="Quem, como e por quê, em suas palavras…"></textarea>
          </label>
        </div>
      </div>`;

    // Re-renderiza notas e fatos
    if (currentCase && state) {
      renderNotes();
      renderFacts(currentCase);
      el("hypothesis-draft").value = state.hypothesisDraft || "";
      el("hypothesis-draft").oninput = (e) => {
        state.hypothesisDraft = e.target.value;
        persist();
        const prev = el("summary-hypothesis-preview");
        if (prev) prev.textContent = e.target.value.trim() || "Nenhuma hipótese registrada ainda.";
      };
      el("note-form").onsubmit = (e) => {
        e.preventDefault();
        const texto = el("note-text").value.trim();
        if (!texto) return;
        const tipo = el("note-tag").value;
        state.notes.push({ id: `n-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, texto, tipo });
        el("note-text").value = "";
        persist();
        renderNotes();
        playClick();
      };
    }
    return;
  }

  if (name === "timeline") {
    center.innerHTML = `
      <div class="center-panel-wrap">
        <h2 class="center-panel__title">Linha do Tempo</h2>
        <p class="hint">Arraste ou use ↑↓ para reordenar os eventos. A ordem correta expõe contradições nos depoimentos.</p>
        <ol id="timeline-list" class="timeline-list"></ol>
      </div>`;
    if (currentCase && state) {
      const ol = center.querySelector("#timeline-list");
      if (ol) renderTimelineInto(currentCase, ol);
    }
    return;
  }

  if (name === "suspeitos") {
    center.innerHTML = `
      <div class="center-panel-wrap">
        <h2 class="center-panel__title">Painel de Suspeitos</h2>
        <p class="hint">Classifique cada pessoa conforme sua análise das provas.</p>
        <div id="suspects-grid" class="suspects-grid center-suspects-grid"></div>
      </div>`;
    if (currentCase && state) {
      const grid = center.querySelector("#suspects-grid");
      if (grid) renderSuspectsInto(currentCase, grid);
    }
    return;
  }

  if (name === "resolucao") {
    center.innerHTML = `
      <div class="center-panel-wrap center-panel-wrap--resolucao">
        <h2 class="center-panel__title">Encerramento do Caso</h2>
        <p class="hint">Revise todas as evidências antes de submeter. Você só pode submeter uma vez por sessão.</p>
        <form id="resolution-form" class="resolution-form">
          <fieldset class="fieldset">
            <legend>Quem cometeu o crime?</legend>
            <label class="field">
              <span class="field__label">Culpado</span>
              <select id="res-culpado" required></select>
            </label>
          </fieldset>
          <fieldset class="fieldset">
            <legend>Como aconteceu?</legend>
            <label class="field">
              <span class="field__label">Método</span>
              <textarea id="res-metodo" rows="3" required placeholder="Instrumento, acesso, sequência…"></textarea>
            </label>
          </fieldset>
          <fieldset class="fieldset">
            <legend>Qual o motivo?</legend>
            <label class="field">
              <span class="field__label">Motivo</span>
              <textarea id="res-motivo" rows="3" required></textarea>
            </label>
          </fieldset>
          <fieldset class="fieldset">
            <legend>Quem mentiu?</legend>
            <p class="hint">Marque todos que tiveram declarações falsas ou omitiram fatos relevantes.</p>
            <div id="res-mentiras" class="checkbox-grid"></div>
          </fieldset>
          <button type="submit" class="btn btn--primary btn--block">Submeter hipótese</button>
        </form>
        <div id="resolution-result" class="resolution-result" hidden></div>
      </div>`;

    if (currentCase && state) {
      renderResolutionForm(currentCase);
      el("resolution-form").onsubmit = (e) => {
        e.preventDefault();
        const mentiras = [];
        el("res-mentiras").querySelectorAll('input[type="checkbox"]').forEach((cb) => {
          if (cb.checked) mentiras.push(cb.value);
        });
        const answers = {
          culpado: el("res-culpado").value,
          metodo: el("res-metodo").value,
          motivo: el("res-motivo").value,
          mentiras,
        };
        const evalRes = evaluateResolution(currentCase, answers, state.timelineOrder);
        const elapsed = Date.now() - (state.startedAt || Date.now());
        state.resolutionSubmitted = true;
        persist();
        showResolutionResult(evalRes, elapsed);
        playClick();
        toast("Hipótese registrada.");
      };
    }
  }
}

function tipoLabel(tipo) {
  const m = {
    laudo: "Laudo",
    foto: "Foto",
    noticia: "Notícia",
    depoimento: "Depoimento",
    video: "Vídeo",
  };
  return m[tipo] || tipo || "Doc";
}

function stopSpeech() {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  currentUtterance = null;
}

function speakText(text, heading) {
  if (!("speechSynthesis" in window)) {
    toast("Leitor de voz não é suportado neste navegador.");
    return;
  }
  const clean = String(text || "").trim();
  if (!clean) {
    toast("Nada para ler neste documento.");
    return;
  }
  stopSpeech();
  const utter = new SpeechSynthesisUtterance();
  utter.lang = "pt-BR";
  utter.rate = 1;
  utter.pitch = 1;
  utter.text = heading ? `${heading}. ${clean}` : clean;
  currentUtterance = utter;
  window.speechSynthesis.speak(utter);
}

function setDocForSpeech(doc) {
  currentDocForSpeech = doc || null;
  const btn = el("modal-tts-btn");
  if (!btn) return;
  const supported = "speechSynthesis" in window;
  const hasContent = !!(doc && doc.conteudo && String(doc.conteudo).trim());
  btn.hidden = !(supported && hasContent);
  btn.setAttribute("aria-pressed", "false");
  btn.textContent = "🔊 Ler";
}

function appendDocVisual(body, doc) {
  if (doc.imagem) {
    const fig = document.createElement("figure");
    fig.className = "doc-figure";
    const img = document.createElement("img");
    img.src = doc.imagem;
    img.alt = doc.titulo || "Evidência";
    img.className = "doc-figure__img";
    img.loading = "lazy";
    fig.appendChild(img);
    body.appendChild(fig);
  } else if (doc.tipo === "foto") {
    const ph = document.createElement("div");
    ph.className = "photo-placeholder";
    ph.textContent = doc.imagemPlaceholder || "Evidência fotográfica — arquivo selado";
    body.appendChild(ph);
  }
}

function openDocViewer(doc) {
  const viewer = el("doc-viewer");
  if (!viewer) return;
  if (doc.id) markDocRead(doc.id);

  // marca item ativo na lista
  document.querySelectorAll(".doc-item").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.docId === doc.id);
  });

  const imgHtml = doc.imagem
    ? `<img class="doc-viewer__image" src="${escapeHtml(doc.imagem)}" alt="${escapeHtml(doc.titulo || "Evidência")}" loading="lazy" />`
    : (doc.tipo === "foto" ? `<div class="photo-placeholder">${escapeHtml(doc.imagemPlaceholder || "Evidência fotográfica — arquivo selado")}</div>` : "");

  viewer.innerHTML = `
    <p class="doc-viewer__badge">${escapeHtml(tipoLabel(doc.tipo))}</p>
    <h2 class="doc-viewer__title">${escapeHtml(doc.titulo || "Documento")}</h2>
    ${imgHtml}
    <div class="doc-viewer__body">${escapeHtml(doc.conteudo || "")}</div>
    <div class="doc-viewer__actions">
      <button type="button" class="btn btn--ghost" id="doc-viewer-tts" aria-pressed="false">🔊 Ler</button>
    </div>
  `;

  setDocForSpeech({ titulo: doc.titulo || tipoLabel(doc.tipo), conteudo: doc.conteudo || "" });

  const ttsBtn = viewer.querySelector("#doc-viewer-tts");
  if (ttsBtn) {
    if (!("speechSynthesis" in window) || !(doc.conteudo || "").trim()) {
      ttsBtn.hidden = true;
    }
    ttsBtn.addEventListener("click", () => {
      const pressed = ttsBtn.getAttribute("aria-pressed") === "true";
      if (pressed) {
        stopSpeech();
        ttsBtn.setAttribute("aria-pressed", "false");
        ttsBtn.textContent = "🔊 Ler";
      } else {
        speakText(doc.conteudo, doc.titulo);
        ttsBtn.setAttribute("aria-pressed", "true");
        ttsBtn.textContent = "⏹ Parar";
      }
    });
  }
}

function openModal(doc) {
  openDocViewer(doc);
}

async function openRoteiroModal(url) {
  const modal = el("modal-root");
  const body = el("modal-body");
  body.innerHTML = "";
  body.classList.add("modal__body--roteiro");
  el("modal-type").textContent = "Roteiro";
  el("modal-title").textContent = "Roteiro do caso";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    body.textContent = text;
    setDocForSpeech({ titulo: "Roteiro do caso", conteudo: text });
  } catch (e) {
    body.textContent = "Não foi possível carregar o roteiro. Verifique o servidor local.";
    setDocForSpeech(null);
  }
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  playClick();
}

function closeModal() {
  stopSpeech();
  el("modal-root").hidden = true;
  document.body.style.overflow = "";
}

let activePhaseIndex = 0;

function renderDocuments(caso) {
  const fases = caso.fases || [];
  const tabs = el("phase-tabs");
  tabs.innerHTML = "";
  fases.forEach((f, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "phase-tab" + (i === activePhaseIndex ? " is-active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", i === activePhaseIndex ? "true" : "false");
    btn.dataset.phaseIndex = String(i);
    btn.innerHTML = `
      <span class="phase-tab__num">Fase ${i + 1}</span>
      <span>
        <span class="phase-tab__name">${escapeHtml(f.nome || `Fase ${i + 1}`)}</span>
        <span class="phase-tab__desc">${escapeHtml(f.resumo || "")}</span>
      </span>
    `;
    btn.addEventListener("click", () => {
      activePhaseIndex = i;
      renderDocuments(caso);
    });
    tabs.appendChild(btn);
  });

  const list = el("doc-list");
  list.innerHTML = "";
  const phase = fases[activePhaseIndex];
  const docs = phase && Array.isArray(phase.documentos) ? phase.documentos : [];
  docs.forEach((d, di) => {
    const doc = { ...d, id: d.id || `p${activePhaseIndex}-d${di}` };
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "doc-item";
    const icon = document.createElement("span");
    icon.className = "doc-item__icon";
    icon.textContent = tipoLabel(doc.tipo);
    const bodySpan = document.createElement("span");
    bodySpan.className = "doc-item__body";
    bodySpan.innerHTML = `<span class="doc-item__title">${escapeHtml(doc.titulo || "Sem título")}</span>`;
    b.appendChild(icon);
    b.appendChild(bodySpan);
    b.dataset.docId = doc.id || "";
    if (state && state.docsRead && state.docsRead.includes(doc.id)) {
      b.classList.add("is-read");
    }
    b.addEventListener("click", () => {
      playClick();
      openModal(doc);
    });
    li.appendChild(b);
    list.appendChild(li);
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function renderFacts(caso) {
  const center = el("case-col-center");
  const ul = (center && center.querySelector("#facts-list")) || el("facts-list");
  if (!ul) return;
  ul.innerHTML = "";
  const fatos = Array.isArray(caso.fatos) ? caso.fatos : [];
  if (fatos.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Nenhum fato pré-listado — extraia dos documentos acima.";
    ul.appendChild(li);
    return;
  }
  fatos.forEach((f) => {
    const li = document.createElement("li");
    li.textContent = f;
    ul.appendChild(li);
  });
}

function renderNotes() {
  const center = el("case-col-center");
  const ul = (center && center.querySelector("#notes-list")) || el("notes-list");
  if (!ul) return;
  ul.innerHTML = "";
  state.notes.forEach((n) => {
    const li = document.createElement("li");
    li.className = `note-card note-card--${n.tipo}`;
    li.innerHTML = `
      <span class="note-card__tag">${n.tipo}</span>
      <button type="button" class="note-card__del" data-id="${escapeHtml(n.id)}" aria-label="Remover">×</button>
      <p class="note-card__text">${escapeHtml(n.texto)}</p>
    `;
    li.querySelector(".note-card__del").addEventListener("click", () => {
      state.notes = state.notes.filter((x) => x.id !== n.id);
      persist();
      renderNotes();
      playClick();
    });
    ul.appendChild(li);
  });
  const summary = el("summary-notes-count");
  if (summary) summary.textContent = String(state.notes.length);
}

function renderTimelineInto(caso, ol) {
  if (!ol) return;
  ol.innerHTML = "";
  const events = caso.eventosLinhaDoTempo || [];
  const order = state.timelineOrder.filter((id) => events.some((e) => e.id === id));
  events.forEach((e) => { if (!order.includes(e.id)) order.push(e.id); });
  state.timelineOrder = order;
  persist();
  const countEl = el("summary-timeline-count");
  if (countEl) countEl.textContent = String(order.length);

  function moveEvent(id, dir) {
    const arr = [...state.timelineOrder];
    const i = arr.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    state.timelineOrder = arr;
    persist();
    renderTimelineInto(caso, ol);
    playClick();
  }

  order.forEach((id, idx) => {
    const ev = events.find((e) => e.id === id);
    if (!ev) return;
    const li = document.createElement("li");
    li.className = "timeline-item";
    li.draggable = true;
    li.dataset.id = id;
    li.innerHTML = `
      <span class="timeline-item__handle">${String(idx + 1).padStart(2, "0")}</span>
      <p class="timeline-item__text">${escapeHtml(ev.texto)}</p>
      <div class="timeline-controls">
        <button type="button" class="btn btn--ghost btn--sm" data-move="-1" aria-label="Mover para cima">↑</button>
        <button type="button" class="btn btn--ghost btn--sm" data-move="1" aria-label="Mover para baixo">↓</button>
      </div>
    `;
    li.querySelectorAll(".timeline-controls button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        moveEvent(id, Number(btn.dataset.move));
      });
    });
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", id);
      li.classList.add("is-dragging");
    });
    li.addEventListener("dragend", () => li.classList.remove("is-dragging"));
    li.addEventListener("dragover", (e) => e.preventDefault());
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = e.dataTransfer.getData("text/plain");
      const to = id;
      const arr = [...state.timelineOrder];
      const fi = arr.indexOf(from);
      const ti = arr.indexOf(to);
      if (fi < 0 || ti < 0) return;
      arr.splice(fi, 1);
      arr.splice(ti, 0, from);
      state.timelineOrder = arr;
      persist();
      renderTimelineInto(caso, ol);
      playClick();
    });
    ol.appendChild(li);
  });
}

function renderTimeline(caso) {
  const ol = el("timeline-list");
  if (ol) renderTimelineInto(caso, ol);
}

function renderSuspectsInto(caso, grid) {
  if (!grid) return;
  grid.innerHTML = "";
  (caso.suspeitos || []).forEach((s) => {
    const nome = s.nome;
    const card = document.createElement("article");
    card.className = "suspect-card";
    const st = state.suspectStatus[nome] || "neutro";
    const foto = s.retrato
      ? `<img class="suspect-card__photo" src="${escapeHtml(s.retrato)}" alt="" loading="lazy" />`
      : "";
    card.innerHTML = `
      ${foto}
      <h3 class="suspect-card__name">${escapeHtml(nome)}</h3>
      <dl>
        <dt>Motivo para suspeita</dt><dd>${escapeHtml(s.motivo || "—")}</dd>
        <dt>Álibi</dt><dd>${escapeHtml(s.alibi || "—")}</dd>
        <dt>Contradições</dt><dd>${escapeHtml(s.contradicoes || "—")}</dd>
      </dl>
      <div class="suspect-card__status">
        <label for="st-${hash(nome)}">Classificação</label>
        <select id="st-${hash(nome)}" data-nome="${escapeHtml(nome)}">
          <option value="neutro" ${st === "neutro" ? "selected" : ""}>Em análise</option>
          <option value="principal" ${st === "principal" ? "selected" : ""}>Principal</option>
          <option value="observacao" ${st === "observacao" ? "selected" : ""}>Sob observação</option>
          <option value="descartado" ${st === "descartado" ? "selected" : ""}>Descartado</option>
        </select>
      </div>
    `;
    card.querySelector("select").addEventListener("change", (e) => {
      state.suspectStatus[nome] = e.target.value;
      persist();
      playClick();
      updateTopSuspect();
    });
    grid.appendChild(card);
  });
}

function renderSuspects(caso) {
  const grid = el("suspects-grid");
  grid.innerHTML = "";
  (caso.suspeitos || []).forEach((s) => {
    const nome = s.nome;
    const card = document.createElement("article");
    card.className = "suspect-card";
    const st = state.suspectStatus[nome] || "neutro";
    const foto = s.retrato
      ? `<img class="suspect-card__photo" src="${escapeHtml(s.retrato)}" alt="" loading="lazy" />`
      : "";
    card.innerHTML = `
      ${foto}
      <h3 class="suspect-card__name">${escapeHtml(nome)}</h3>
      <dl>
        <dt>Motivo para suspeita</dt><dd>${escapeHtml(s.motivo || "—")}</dd>
        <dt>Álibi</dt><dd>${escapeHtml(s.alibi || "—")}</dd>
        <dt>Contradições</dt><dd>${escapeHtml(s.contradicoes || "—")}</dd>
      </dl>
      <div class="suspect-card__status">
        <label for="st-${hash(nome)}">Classificação</label>
        <select id="st-${hash(nome)}" data-nome="${escapeHtml(nome)}">
          <option value="neutro" ${st === "neutro" ? "selected" : ""}>Em análise</option>
          <option value="principal" ${st === "principal" ? "selected" : ""}>Principal</option>
          <option value="observacao" ${st === "observacao" ? "selected" : ""}>Sob observação</option>
          <option value="descartado" ${st === "descartado" ? "selected" : ""}>Descartado</option>
        </select>
      </div>
    `;
    card.querySelector("select").addEventListener("change", (e) => {
      state.suspectStatus[nome] = e.target.value;
      persist();
      playClick();
      updateTopSuspect();
    });
    grid.appendChild(card);
  });
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
  return Math.abs(h).toString(36);
}

function renderResolutionForm(caso) {
  const sel = el("res-culpado");
  sel.innerHTML = '<option value="">Selecione…</option>';
  (caso.suspeitos || []).forEach((s) => {
    const o = document.createElement("option");
    o.value = s.nome;
    o.textContent = s.nome;
    sel.appendChild(o);
  });
  const ment = el("res-mentiras");
  ment.innerHTML = "";
  (caso.suspeitos || []).forEach((s) => {
    const row = document.createElement("label");
    row.className = "checkbox-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = s.nome;
    cb.dataset.nome = s.nome;
    row.appendChild(cb);
    row.appendChild(document.createTextNode(` ${s.nome}`));
    ment.appendChild(row);
  });

  const result = el("resolution-result");
  result.hidden = true;
}

function showResolutionResult(evalRes, elapsedMs) {
  const box = el("resolution-result");
  box.hidden = false;
  const sol = evalRes.solucao;
  const erros = [];
  if (!evalRes.culpadoOk) erros.push(`Culpado: esperado "${sol.culpado}".`);
  if (evalRes.motivoSc.missing && evalRes.motivoSc.missing.length) {
    erros.push(`Motivo: faltaram ideias-chave: ${evalRes.motivoSc.missing.join(", ")}.`);
  }
  if (evalRes.metodoSc.missing && evalRes.metodoSc.missing.length) {
    erros.push(`Método: faltaram ideias-chave: ${evalRes.metodoSc.missing.join(", ")}.`);
  }
  if (evalRes.liesSc.expected > 0 && evalRes.liesSc.ratio < 1) {
    erros.push("Mentiras: revise quem omitiu ou distorceu fatos nos depoimentos.");
  }

  const pistas = Array.isArray(sol.pistasIgnoradas) ? sol.pistasIgnoradas : [];
  const tempoStr = formatMs(elapsedMs);

  state.lastScore = evalRes.total;
  state.lastMaxScore = evalRes.max;
  persist();
  renderStats();

  box.innerHTML = `
    <p class="resolution-result__score">Pontuação: ${evalRes.total} / ${evalRes.max}</p>
    <p class="hint">Tempo de investigação: ${tempoStr}</p>
    <p class="${evalRes.culpadoOk ? "resolution-result__ok" : "resolution-result__err"}">
      ${evalRes.culpadoOk ? "Culpado identificado corretamente." : "Culpado incorreto ou incompleto."}
    </p>
    <p><strong>Coerência do relatório</strong></p>
    <ul class="resolution-result__list">
      <li>Motivo (palavras-chave): ${evalRes.motivoPts} / ${evalRes.weights.motivo}</li>
      <li>Método (palavras-chave): ${evalRes.metodoPts} / ${evalRes.weights.metodo}</li>
      <li>Mentiras detectadas: ${evalRes.mentirasPts} / ${evalRes.weights.mentiras}</li>
      <li>Bônus linha do tempo: +${evalRes.tBonus.points} (ordem parcialmente correta)</li>
    </ul>
    ${erros.length ? `<p class="resolution-result__err"><strong>Pontos fracos</strong></p><ul class="resolution-result__list">${erros.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>` : ""}
    ${pistas.length ? `<p><strong>Pistas facilmente ignoradas</strong></p><ul class="resolution-result__list">${pistas.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : ""}
    <p class="hint"><strong>Gabarito resumido:</strong> ${escapeHtml(sol.culpado)} — ${escapeHtml(sol.metodo)} Motivo: ${escapeHtml(sol.motivo)}</p>
  `;
}

function computeStats() {
  const total = registry.length;
  let resolved = 0;
  let inProgress = 0;
  let topScore = 0;
  let topCaseTitle = "";

  registry.forEach((entry) => {
    const st = loadCaseState(entry.id);
    if (!st) return;
    if (st.resolutionSubmitted) {
      resolved += 1;
      if (typeof st.lastScore === "number" && st.lastScore > topScore) {
        topScore = st.lastScore;
        topCaseTitle = entry.titulo;
      }
    } else {
      inProgress += 1;
    }
  });

  return { total, resolved, inProgress, topScore, topCaseTitle };
}

function renderStats() {
  const totalEl = el("stats-total");
  if (!totalEl || !registry.length) return;
  const resolvedEl = el("stats-resolved");
  const inprogEl = el("stats-inprogress");
  const topScoreEl = el("stats-top-score");
  const topCaseEl = el("stats-top-case");
  const { total, resolved, inProgress, topScore, topCaseTitle } = computeStats();
  totalEl.textContent = String(total);
  if (resolvedEl) resolvedEl.textContent = String(resolved);
  if (inprogEl) inprogEl.textContent = String(inProgress);
  if (topScoreEl) topScoreEl.textContent = topScore > 0 ? `${topScore}%` : "--";
  if (topCaseEl) {
    topCaseEl.textContent = topScore > 0 ? topCaseTitle : "Nenhum caso resolvido ainda.";
  }
}

function updateDocsReadCount() {
  const countEl = el("summary-docs-read");
  if (!countEl || !state) return;
  const read = (state.docsRead || []).length;
  countEl.textContent = String(read);
}

function markDocRead(docId) {
  if (!state) return;
  if (!state.docsRead) state.docsRead = [];
  if (!state.docsRead.includes(docId)) {
    state.docsRead.push(docId);
    persist();
    updateDocsReadCount();
  }
}

function updateTopSuspect() {
  const section = el("sidebar-top-suspect");
  const content = el("sidebar-suspect-content");
  if (!section || !content || !currentCase) return;

  const top = Object.entries(state.suspectStatus || {})
    .find(([, v]) => v === "principal");

  if (!top) {
    section.hidden = true;
    return;
  }

  const [nome] = top;
  const susp = (currentCase.suspeitos || []).find((s) => s.nome === nome);
  if (!susp) { section.hidden = true; return; }

  section.hidden = false;
  const foto = susp.retrato
    ? `<img class="sidebar-suspect__photo" src="${escapeHtml(susp.retrato)}" alt="" loading="lazy" />`
    : `<div class="sidebar-suspect__photo" style="display:flex;align-items:center;justify-content:center;font-size:1.4rem">🔍</div>`;
  content.innerHTML = `
    ${foto}
    <div class="sidebar-suspect__info">
      <p class="sidebar-suspect__name">${escapeHtml(nome)}</p>
      <span class="sidebar-suspect__status sidebar-suspect__status--principal">Principal</span>
    </div>
  `;
}

function bindCaseUi(caso) {
  // Topbar
  el("topbar-home").style.display = "none";
  const topbarCase = el("topbar-case");
  topbarCase.classList.add("is-visible");

  // sidebar col-left: label e count
  const colId = el("case-col-id");
  if (colId) colId.textContent = (caso.titulo || "Caso").toUpperCase().slice(0, 18);

  // roteiro
  const roteiroBtn = el("btn-roteiro");
  if (roteiroBtn) {
    if (caso.roteiro) {
      roteiroBtn.hidden = false;
      roteiroBtn.onclick = () => {
        fetch(caso.roteiro).then(r => r.text()).then(text => {
          openDocViewer({ tipo: "roteiro", titulo: "Roteiro do caso", conteudo: text });
        });
      };
    } else {
      roteiroBtn.hidden = true;
    }
  }

  // Resetar viewer
  const viewer = el("doc-viewer");
  if (viewer) viewer.innerHTML = `<div class="doc-viewer__empty"><p>Selecione um documento na lista à esquerda para ler.</p></div>`;

  // Esconder helpers de outros painéis
  const noteArea = el("note-quick-area");
  const hintArea = el("panel-hint-area");
  if (noteArea) noteArea.hidden = true;
  if (hintArea) hintArea.hidden = true;

  activePhaseIndex = 0;
  renderDocuments(caso);
  updateTopSuspect();
  updateDocsReadCount();
}

const TUTORIAL_KEY = "sob-suspeita-tutorial-done";
const TUTORIAL_STEPS = [
  { panel: "documentos", msg: "📄 Comece lendo os Documentos — laudos, depoimentos e notícias escondem as pistas." },
  { panel: "anotacoes",  msg: "✏️ Use Anotações para marcar fatos, suspeitas e dúvidas enquanto lê." },
  { panel: "timeline",   msg: "🕐 Monte a Linha do Tempo ordenando os eventos — contradições ficam visíveis." },
  { panel: "suspeitos",  msg: "🔍 Classifique cada Suspeito conforme sua análise." },
  { panel: "resolucao",  msg: "⚖️ Quando estiver pronto, vá para Resolução e registre sua hipótese final." },
];

function runTutorial() {
  if (localStorage.getItem(TUTORIAL_KEY)) return;
  let step = 0;
  function showStep() {
    if (step >= TUTORIAL_STEPS.length) {
      localStorage.setItem(TUTORIAL_KEY, "1");
      return;
    }
    const { panel, msg } = TUTORIAL_STEPS[step];
    setActivePanel(panel);
    toast(msg, 3600);
    step++;
    if (step < TUTORIAL_STEPS.length) {
      setTimeout(showStep, 3800);
    } else {
      setTimeout(() => {
        localStorage.setItem(TUTORIAL_KEY, "1");
        setActivePanel("documentos");
      }, 3800);
    }
  }
  setTimeout(showStep, 600);
}

function showCaseIntro(entry, caso) {
  const intro = el("case-intro");
  if (!intro) return false;

  // Capa de fundo
  const cover = el("case-intro-cover");
  if (cover) {
    cover.style.backgroundImage = caso.imagemCapa
      ? `url("${caso.imagemCapa}")`
      : `url("assets/hero-sob-suspeita.png")`;
  }

  // Kicker
  const kicker = el("case-intro-kicker");
  if (kicker) kicker.textContent = `Caso ${entry.capitulo ? `#${entry.capitulo}` : ""} — ${entry.categoria || "Investigação"}`;

  // Título
  const titleEl = el("case-intro-title");
  if (titleEl) titleEl.textContent = caso.titulo || entry.titulo || "Caso";

  // Tags
  const tags = el("case-intro-tags");
  if (tags) {
    tags.innerHTML = `
      <span class="pill">${escapeHtml(caso.dificuldade || entry.dificuldade || "—")}</span>
      <span class="pill pill--muted">${escapeHtml(caso.duracaoEstimada || entry.duracaoEstimada || "—")}</span>
      ${entry.nivel ? `<span class="pill pill--muted">${escapeHtml(entry.nivel)}</span>` : ""}
    `;
  }

  // Descrição
  const desc = el("case-intro-desc");
  if (desc) desc.textContent = caso.descricao || entry.descricao || "";

  // Meta (suspeitos, documentos, fases)
  const metaEl = el("case-intro-meta");
  if (metaEl) {
    const totalDocs = (caso.fases || []).reduce((acc, f) => acc + (f.documentos || []).length, 0);
    const fases = (caso.fases || []).length;
    const suspeitos = (caso.suspeitos || []).length;
    metaEl.innerHTML = `
      <div class="case-intro__meta-item">
        <span class="case-intro__meta-label">Suspeitos</span>
        <span class="case-intro__meta-value">${suspeitos}</span>
      </div>
      <div class="case-intro__meta-item">
        <span class="case-intro__meta-label">Documentos</span>
        <span class="case-intro__meta-value">${totalDocs}</span>
      </div>
      <div class="case-intro__meta-item">
        <span class="case-intro__meta-label">Fases</span>
        <span class="case-intro__meta-value">${fases}</span>
      </div>
    `;
  }

  intro.hidden = false;
  return true;
}

async function openCase(entry) {
  try {
    const caso = await loadCase(entry.arquivo);
    currentCase = caso;
    currentCaseId = entry.id;
    const evs = caso.eventosLinhaDoTempo || [];
    const defaultOrder = evs.map((e) => e.id);
    const suspectStatus = {};
    (caso.suspeitos || []).forEach((s) => {
      suspectStatus[s.nome] = "neutro";
    });
    state = mergeDefaultState(entry.id, {
      notes: [],
      timelineOrder: defaultOrder,
      suspectStatus,
      hypothesisDraft: "",
      resolutionSubmitted: false,
      startedAt: Date.now(),
    });
    el("view-home").hidden = true;
    el("view-case").hidden = false;

    // Mostra intro antes de entrar no caso
    const hasIntro = showCaseIntro(entry, caso);
    if (!hasIntro) startInvestigation(caso);

  } catch (err) {
    console.error(err);
    toast("Erro ao abrir caso.");
  }
}

function startInvestigation(caso) {
  const intro = el("case-intro");
  if (intro) intro.hidden = true;

  bindCaseUi(caso);
  startTimer();
  runTutorial();
  setActivePanel("documentos");
}

function getCaseMeta(entry) {
  const saved = loadCaseState(entry.id);
  if (!saved) return { inProgress: false, resolved: false, lastStartedAt: null };
  const resolved = !!(saved.resolutionSubmitted);
  return {
    inProgress: !resolved,
    resolved,
    lastStartedAt: saved.startedAt || null,
  };
}

function renderHomeList() {
  const search = (el("case-search")?.value || "").trim().toLowerCase();
  const diffFilter = el("case-filter-difficulty")?.value || "";
  const activeTab = el("archive-tabs")?.querySelector(".archive-tab.is-active");
  const levelFilter = activeTab ? (activeTab.dataset.level || "") : "";

  const inProgressList = el("case-list-inprogress");
  const beginnerList = el("case-list-beginner");
  const intermediateList = el("case-list-intermediate");
  const advancedList = el("case-list-advanced");
  const specialList = el("case-list-special");
  const allList = el("case-list");
  const contBtn = el("btn-home-continue");
  const contSection = el("home-continue-section");
  const secBeginner = el("home-level-beginner");
  const secIntermediate = el("home-level-intermediate");
  const secAdvanced = el("home-level-advanced");
  const secSpecial = el("home-level-special");

  if (inProgressList) inProgressList.innerHTML = "";
  if (beginnerList) beginnerList.innerHTML = "";
  if (intermediateList) intermediateList.innerHTML = "";
  if (advancedList) advancedList.innerHTML = "";
  if (specialList) specialList.innerHTML = "";
  if (allList) allList.innerHTML = "";

  const withMeta = registry.map((c) => ({ entry: c, meta: getCaseMeta(c) }));

  const filtered = withMeta.filter(({ entry }) => {
    const text = `${entry.titulo} ${entry.descricao}`.toLowerCase();
    if (search && !text.includes(search)) return false;
    if (diffFilter && entry.dificuldade !== diffFilter) return false;
    return true;
  });

  const inProgress = filtered.filter((c) => c.meta.inProgress);
  const notStarted = filtered.filter((c) => !c.meta.inProgress);

  if (inProgress.length && contSection && contBtn && inProgressList) {
    contSection.hidden = false;
    const sorted = [...inProgress].sort((a, b) => (b.meta.lastStartedAt || 0) - (a.meta.lastStartedAt || 0));
    const last = sorted[0];
    contBtn.hidden = false;
    contBtn.onclick = () => {
      playClick();
      openCase(last.entry);
    };
    const largeCard = createCaseCard(last.entry, {
      showStatus: true,
      statusLabel: "Em andamento",
      variant: "large",
    });
    inProgressList.appendChild(largeCard);
  } else if (contSection && contBtn && inProgressList) {
    contSection.hidden = true;
    contBtn.hidden = true;
    inProgressList.innerHTML = "";
    contBtn.onclick = null;
  }

  if (allList) {
    const archiveFiltered = levelFilter
      ? filtered.filter(({ entry }) => {
          const n = (entry.nivel || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
          return n === levelFilter;
        })
      : filtered;
    if (archiveFiltered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.style.padding = "1rem 0";
      empty.textContent = "Nenhum caso encontrado com esses filtros.";
      allList.appendChild(empty);
    } else {
      archiveFiltered.forEach(({ entry, meta }) => {
        const label = meta.resolved ? "Concluído" : meta.inProgress ? "Em andamento" : "Novo caso";
        const card = createCaseCard(entry, { showStatus: true, statusLabel: label });
        allList.appendChild(card);
      });
    }
  }

  function pushToLevel(entry, meta) {
    const nivel = (entry.nivel || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const label = meta.resolved ? "Concluído" : meta.inProgress ? "Em andamento" : "Novo caso";
    const card = createCaseCard(entry, { showStatus: true, statusLabel: label });

    if (nivel === "iniciante" && beginnerList) {
      beginnerList.appendChild(card);
      if (secBeginner) secBeginner.hidden = false;
      return;
    }
    if (nivel === "intermediario" && intermediateList) {
      intermediateList.appendChild(card);
      if (secIntermediate) secIntermediate.hidden = false;
      return;
    }
    if (nivel === "avancado" && advancedList) {
      advancedList.appendChild(card);
      if (secAdvanced) secAdvanced.hidden = false;
      return;
    }
    if (nivel === "especial" && specialList) {
      specialList.appendChild(card);
      if (secSpecial) secSpecial.hidden = false;
    }
  }

  if (beginnerList && secBeginner) secBeginner.hidden = true;
  if (intermediateList && secIntermediate) secIntermediate.hidden = true;
  if (advancedList && secAdvanced) secAdvanced.hidden = true;
  if (specialList && secSpecial) secSpecial.hidden = true;

  filtered.forEach(({ entry, meta }) => {
    pushToLevel(entry, meta);
  });
}

function calcProgress(id) {
  const st = loadCaseState(id) || {};
  if (st.resolutionSubmitted) return 100;
  if (st.notes && st.notes.length) return 40;
  if (st.timelineOrder && st.timelineOrder.length) return 25;
  if (st.startedAt) return 10;
  return 0;
}

function createCaseCard(entry, opts = {}) {
  const li = document.createElement("div");
  li.className = "case-card";
  if (opts.variant === "large") li.classList.add("case-card--large");

  const progress = calcProgress(entry.id);
  const capa = entry.imagemCapa
    ? `<div class="case-card__thumb-wrap"><img class="case-card__thumb" src="${escapeHtml(entry.imagemCapa)}" alt="" loading="lazy" /></div>`
    : "";
  const statusPillClass = opts.statusLabel === "Concluído"
    ? "pill pill--resolved case-card__status"
    : opts.statusLabel === "Em andamento"
    ? "pill case-card__status"
    : "pill pill--muted case-card__status";
  const statusLabel = opts.showStatus && opts.statusLabel
    ? `<span class="${statusPillClass}">${escapeHtml(opts.statusLabel)}</span>`
    : "";

  const inner = document.createElement("div");
  inner.className = "case-card__inner";
  inner.innerHTML = `
    <div class="case-card__main">
      ${capa}
      <div class="case-card__content">
        <h2 class="case-card__title">${escapeHtml(entry.titulo)}</h2>
        <p class="case-card__desc">${escapeHtml(entry.descricao)}</p>
        <div class="case-card__row">
          <span class="pill">${escapeHtml(entry.dificuldade)}</span>
          <span class="pill pill--muted">${escapeHtml(entry.duracaoEstimada)}</span>
          ${statusLabel}
        </div>
      </div>
    </div>
    <div class="case-card__footer" aria-label="Progresso no caso">
      <div class="case-card__progress">
        <div class="case-card__progress-fill" style="width: ${progress}%;"></div>
      </div>
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "case-card__actions";

  const btnInvestigar = document.createElement("button");
  btnInvestigar.type = "button";
  btnInvestigar.className = "btn btn--primary";
  btnInvestigar.textContent = "Investigar";
  btnInvestigar.addEventListener("click", (e) => {
    e.stopPropagation();
    playClick();
    openCase(entry);
  });

  const btnDetails = document.createElement("button");
  btnDetails.type = "button";
  btnDetails.className = "btn";
  btnDetails.textContent = "Ver detalhes";
  btnDetails.addEventListener("click", (e) => {
    e.stopPropagation();
    playClick();
    openCaseDetails(entry);
  });

  actions.appendChild(btnInvestigar);
  actions.appendChild(btnDetails);
  inner.appendChild(actions);
  li.appendChild(inner);
  return li;
}

function openCaseDetails(entry) {
  const modal = el("modal-case-details");
  if (!modal) return;

  const progress = calcProgress(entry.id);
  const st = loadCaseState(entry.id) || {};
  const statusLabel = st.resolutionSubmitted
    ? "Concluído"
    : st.startedAt
    ? "Em andamento"
    : "Novo";
  const statusClass = st.resolutionSubmitted
    ? "detail-status--done"
    : st.startedAt
    ? "detail-status--inprogress"
    : "detail-status--new";

  el("detail-badge").textContent = entry.categoria || "";
  el("detail-title").textContent = entry.titulo || "Caso";

  const body = el("detail-body");
  body.innerHTML = `
    ${entry.imagemCapa ? `<img class="detail-cover" src="${escapeHtml(entry.imagemCapa)}" alt="${escapeHtml(entry.titulo)}" loading="lazy" />` : ""}
    <span class="detail-status ${statusClass}">${escapeHtml(statusLabel)}</span>
    <p class="detail-desc">${escapeHtml(entry.descricao || "")}</p>
    <div class="detail-meta">
      <div class="detail-meta__item">
        <span class="detail-meta__label">Nível</span>
        <span class="detail-meta__value">${escapeHtml(entry.nivel || "—")}</span>
      </div>
      <div class="detail-meta__item">
        <span class="detail-meta__label">Capítulo</span>
        <span class="detail-meta__value">${escapeHtml(String(entry.capitulo || "—"))}</span>
      </div>
      <div class="detail-meta__item">
        <span class="detail-meta__label">Categoria</span>
        <span class="detail-meta__value">${escapeHtml(entry.categoria || "—")}</span>
      </div>
      <div class="detail-meta__item">
        <span class="detail-meta__label">Dificuldade</span>
        <span class="detail-meta__value">${escapeHtml(entry.dificuldade || "—")}</span>
      </div>
      <div class="detail-meta__item">
        <span class="detail-meta__label">Duração</span>
        <span class="detail-meta__value">${escapeHtml(entry.duracaoEstimada || "—")}</span>
      </div>
    </div>
    ${progress > 0 ? `
    <div class="detail-progress-wrap">
      <p class="detail-progress-label">Progresso</p>
      <div class="detail-progress-bar">
        <div class="detail-progress-fill" style="width:${progress}%"></div>
      </div>
    </div>` : ""}
  `;

  const btnInvestigar = el("detail-btn-investigate");
  btnInvestigar.onclick = () => {
    closeDetailsModal();
    playClick();
    openCase(entry);
  };

  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeDetailsModal() {
  const modal = el("modal-case-details");
  if (modal) modal.hidden = true;
  document.body.style.overflow = "";
}

async function init() {
  try {
    const data = await loadRegistry();
    registry = data.casos || [];
    renderHomeList();
    renderStats();
  } catch (e) {
    console.error("Erro ao carregar registry:", e);
    const caseList = el("case-list");
    if (caseList) caseList.innerHTML = "<p style='padding:1rem;color:#c45c5c'>Não foi possível carregar os casos. Verifique a conexão ou use um servidor local.</p>";
  }

  el("btn-home").addEventListener("click", () => {
    playClick();
    showHome();
    renderHomeList();
    renderStats();
  });

  // Listeners da nav registrados via delegação no document (sempre funciona)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".case-nav__btn");
    if (btn && btn.dataset.panel) {
      setActivePanel(btn.dataset.panel);
      playClick();
    }
  });

  const btnHomeCase = el("btn-home-case");
  if (btnHomeCase) {
    btnHomeCase.addEventListener("click", () => {
      playClick();
      showHome();
      renderHomeList();
      renderStats();
    });
  }

  const btnSoundCase = el("btn-sound-case");
  if (btnSoundCase) {
    btnSoundCase.addEventListener("click", () => {
      const next = !isEnabled();
      setSoundOn(next);
      btnSoundCase.textContent = next ? "🔊" : "🔇";
      btnSoundCase.setAttribute("aria-pressed", next ? "true" : "false");
      el("btn-sound").textContent = next ? "🔊" : "🔇";
    });
  }

  const btnAddNote = el("btn-add-note-shortcut");
  if (btnAddNote) {
    btnAddNote.addEventListener("click", () => {
      setActivePanel("anotacoes");
      document.querySelectorAll(".case-nav__btn").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.panel === "anotacoes");
      });
      playClick();
    });
  }

  // Delegação global para formulários re-criados dinamicamente
  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (!form || !state || !currentCase) return;

    if (form.id === "note-form") {
      e.preventDefault();
      const texto = el("note-text")?.value.trim();
      if (!texto) return;
      const tipo = el("note-tag")?.value || "fato";
      state.notes.push({ id: `n-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, texto, tipo });
      el("note-text").value = "";
      persist();
      renderNotes();
      playClick();
    }

    if (form.id === "resolution-form") {
      e.preventDefault();
      const mentiras = [];
      el("res-mentiras")?.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        if (cb.checked) mentiras.push(cb.value);
      });
      const answers = {
        culpado: el("res-culpado")?.value || "",
        metodo: el("res-metodo")?.value || "",
        motivo: el("res-motivo")?.value || "",
        mentiras,
      };
      const evalRes = evaluateResolution(currentCase, answers, state.timelineOrder);
      const elapsed = Date.now() - (state.startedAt || Date.now());
      state.resolutionSubmitted = true;
      persist();
      showResolutionResult(evalRes, elapsed);
      playClick();
      toast("Hipótese registrada.");
    }
  });

  // Delegação global para hypothesis-draft e note-del re-criados
  document.addEventListener("input", (e) => {
    if (e.target?.id === "hypothesis-draft" && state) {
      state.hypothesisDraft = e.target.value;
      persist();
      const prev = el("summary-hypothesis-preview");
      if (prev) prev.textContent = e.target.value.trim() || "Nenhuma hipótese registrada ainda.";
    }
  });

  document.addEventListener("click", (e) => {
    const delBtn = e.target?.closest(".note-card__del");
    if (delBtn && state) {
      const id = delBtn.dataset.id;
      state.notes = state.notes.filter((n) => n.id !== id);
      persist();
      renderNotes();
      playClick();
    }
  });

  const btnStartCase = el("btn-start-case");
  if (btnStartCase) {
    btnStartCase.addEventListener("click", () => {
      playClick();
      if (currentCase) startInvestigation(currentCase);
    });
  }

  const btnBackHomeIntro = el("btn-back-home-intro");
  if (btnBackHomeIntro) {
    btnBackHomeIntro.addEventListener("click", () => {
      playClick();
      const intro = el("case-intro");
      if (intro) intro.hidden = true;
      showHome();
      renderHomeList();
      renderStats();
    });
  }

  const searchInput = el("case-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => renderHomeList());
  }

  const diffSelect = el("case-filter-difficulty");
  if (diffSelect) {
    diffSelect.addEventListener("change", () => {
      renderHomeList();
      playClick();
    });
  }

  // Tabs de nível no Arquivo completo
  const archiveTabs = el("archive-tabs");
  if (archiveTabs) {
    archiveTabs.addEventListener("click", (e) => {
      const tab = e.target.closest(".archive-tab");
      if (!tab) return;
      archiveTabs.querySelectorAll(".archive-tab").forEach((t) => {
        t.classList.remove("is-active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("is-active");
      tab.setAttribute("aria-selected", "true");
      playClick();
      renderHomeList();
    });
  }

  // Fechar modal de detalhes
  const detailClose = el("detail-close");
  if (detailClose) detailClose.addEventListener("click", closeDetailsModal);
  const detailBackdrop = el("detail-backdrop");
  if (detailBackdrop) detailBackdrop.addEventListener("click", closeDetailsModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeDetailsModal();
    }
  });

  const modalTtsBtn = el("modal-tts-btn");
  if (modalTtsBtn) {
    modalTtsBtn.addEventListener("click", () => {
      if (!currentDocForSpeech) {
        toast("Nada para ler neste documento.");
        return;
      }
      const pressed = modalTtsBtn.getAttribute("aria-pressed") === "true";
      if (pressed) {
        stopSpeech();
        modalTtsBtn.setAttribute("aria-pressed", "false");
        modalTtsBtn.textContent = "🔊 Ler";
      } else {
        const { titulo, conteudo } = currentDocForSpeech;
        speakText(conteudo, titulo);
        modalTtsBtn.setAttribute("aria-pressed", "true");
        modalTtsBtn.textContent = "⏹ Parar";
      }
    });
  }

  const btnSound = el("btn-sound");
  if (btnSound) {
    btnSound.addEventListener("click", () => {
      const next = !isEnabled();
      setSoundOn(next);
      btnSound.textContent = next ? "🔊" : "🔇";
      btnSound.setAttribute("aria-pressed", next ? "true" : "false");
    });
  }

  document.querySelectorAll("[data-close-modal]").forEach((n) => {
    n.addEventListener("click", closeModal);
  });
}

init();
