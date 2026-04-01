import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';
const SHOTS = '/Users/thamiresfernandesmendes/Desktop/jogo/tests/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

const bugs = [];
let browser, page;

function log(msg) { console.log(`[TEST] ${msg}`); }
function bug(msg) { console.error(`[BUG] ${msg}`); bugs.push(msg); }

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  log(`Screenshot: ${name}.png`);
}

async function run() {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  // ── 1. HOME ──────────────────────────────────────────────────────────
  log('=== HOME ===');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await shot('01-home');

  const cards = await page.$$('.case-card');
  if (cards.length === 0) bug('HOME: nenhum card de caso encontrado');
  else log(`HOME: ${cards.length} cards encontrados`);

  const heroImg = await page.$('.hero__bg--banner');
  if (!heroImg) bug('HOME: banner hero não encontrado');

  // ── 2. MODAL VER DETALHES ─────────────────────────────────────────────
  log('=== MODAL VER DETALHES ===');
  const btnDetails = await page.$('.case-card__actions .btn:last-child');
  if (btnDetails) {
    await btnDetails.click();
    await page.waitForTimeout(600);
    await shot('02-modal-detalhes');
    const modalTitle = await page.$('#detail-title');
    if (!modalTitle) bug('MODAL: título não encontrado');
    else log(`MODAL: título = "${await modalTitle.textContent()}"`);

    const closeBtn = await page.$('#detail-close');
    if (closeBtn) await closeBtn.click();
    await page.waitForTimeout(300);
  } else {
    bug('HOME: botão "Ver detalhes" não encontrado');
  }

  // ── 3. ABRIR CASO ────────────────────────────────────────────────────
  log('=== ABRINDO CASO ===');
  const btnInvestigar = await page.$('.case-card__actions .btn--primary');
  if (!btnInvestigar) { bug('HOME: botão Investigar não encontrado'); return; }
  await btnInvestigar.click();
  await page.waitForTimeout(800);
  await shot('03-intro-caso');

  const btnStart = await page.$('#btn-start-case');
  if (!btnStart) { bug('INTRO: botão Começar investigação não encontrado'); return; }
  await btnStart.click();
  await page.waitForTimeout(600);
  await shot('04-investigacao-documentos');

  // ── 4. TESTAR ABAS ───────────────────────────────────────────────────
  const abas = ['anotacoes', 'timeline', 'suspeitos', 'resolucao'];
  for (const aba of abas) {
    log(`=== ABA: ${aba} ===`);
    const btn = await page.$(`[data-panel="${aba}"]`);
    if (!btn) { bug(`ABA ${aba}: botão não encontrado`); continue; }

    await btn.click();
    await page.waitForTimeout(500);
    await shot(`05-aba-${aba}`);

    // Verifica se conteúdo mudou
    const center = await page.$('#case-col-center');
    if (center) {
      const content = await center.innerHTML();
      if (content.length < 50) bug(`ABA ${aba}: coluna central vazia após clique`);
      else log(`ABA ${aba}: conteúdo OK (${content.length} chars)`);
    } else {
      bug(`ABA ${aba}: #case-col-center não encontrado`);
    }
  }

  // ── 5. VOLTAR PARA DOCUMENTOS E CLICAR NUM DOC ───────────────────────
  log('=== DOCUMENTOS ===');
  const btnDocs = await page.$('[data-panel="documentos"]');
  if (btnDocs) await btnDocs.click();
  await page.waitForTimeout(400);

  const firstDoc = await page.$('.doc-item');
  if (firstDoc) {
    await firstDoc.click();
    await page.waitForTimeout(500);
    await shot('06-documento-aberto');
    const viewer = await page.$('#doc-viewer');
    if (viewer) {
      const html = await viewer.innerHTML();
      if (html.includes('doc-viewer__empty')) bug('DOCUMENTOS: viewer ainda mostra estado vazio após clicar');
      else log('DOCUMENTOS: documento aberto com sucesso');
    }
  } else {
    bug('DOCUMENTOS: nenhum item encontrado');
  }

  // ── 6. TESTAR ANOTAÇÃO ───────────────────────────────────────────────
  log('=== ANOTAÇÕES (funcionalidade) ===');
  const btnAno = await page.$('[data-panel="anotacoes"]');
  if (btnAno) await btnAno.click();
  await page.waitForTimeout(400);

  const textarea = await page.$('#note-text');
  if (textarea) {
    await textarea.fill('Teste de anotação automática');
    const submitBtn = await page.$('#note-form button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForTimeout(400);
      const notes = await page.$$('.note-card');
      if (notes.length > 0) log('ANOTAÇÕES: nota adicionada com sucesso');
      else bug('ANOTAÇÕES: nota não apareceu após submit');
    } else {
      bug('ANOTAÇÕES: botão submit não encontrado');
    }
  } else {
    bug('ANOTAÇÕES: textarea não encontrada');
  }
  await shot('07-anotacao-teste');

  // ── 7. RESUMO ────────────────────────────────────────────────────────
  await browser.close();

  console.log('\n=====================================');
  if (bugs.length === 0) {
    console.log('✅ TODOS OS TESTES PASSARAM — nenhum bug encontrado');
  } else {
    console.log(`❌ ${bugs.length} BUGS ENCONTRADOS:`);
    bugs.forEach((b, i) => console.log(`  ${i+1}. ${b}`));
  }
  console.log('Screenshots em:', SHOTS);
}

run().catch(e => { console.error('ERRO CRÍTICO:', e.message); process.exit(1); });
