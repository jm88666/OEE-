(() => {
  let lastData = null;
  let lastSignals = null;
  const $ = id => document.getElementById(id);
  const fmt = (n, d = 1) => Number.isFinite(Number(n)) ? Number(n).toFixed(d) : '-';
  const pct = n => `${fmt(n, 1)}%`;
  const min = n => `${fmt(n, 1)} min`;

  function countBy(items, keyFn) {
    return items.reduce((acc, item) => {
      const key = keyFn(item) || 'Onbekend';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }
  function topEntries(map, limit = 8) {
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({ name, count }));
  }
  function eventTimeValue(e) {
    if (!e?.time) return null;
    if (e.time instanceof Date) return e.time.getTime();
    const match = String(e.time).match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }
  function nearbyResets(pasaban) {
    const alarms = (pasaban?.events || []).filter(e => e.type === 'ALARM' || /alarm/i.test(e.desc || ''));
    const resets = (pasaban?.events || []).filter(e => e.type === 'RESET' || /reset/i.test(e.desc || ''));
    let count = 0;
    alarms.forEach(alarm => {
      const at = eventTimeValue(alarm);
      if (at == null) return;
      const found = resets.some(reset => {
        const rt = eventTimeValue(reset);
        return rt != null && rt >= at && rt - at <= 5;
      });
      if (found) count += 1;
    });
    return count;
  }
  function compactRows(rows, limit = 5) {
    return (rows || []).slice(0, limit).map(r => Array.isArray(r) ? r.slice(0, 6).join(' | ') : JSON.stringify(r)).join('\n');
  }

  function buildSignals(data) {
    const speed = data.speed || {};
    const events = data.events || { events: [], machine: [], operator: [], quality: [], causes: [] };
    const pasaban = data.pasaban;
    const total = pasaban?.bounds?.totalMin || speed.totalMin || 0;
    const performance = speed.perf || 0;
    const rejectMin = speed.rejectMin || 0;
    const stopMin = speed.stopMin || 0;
    const availability = total ? Math.max(0, total - stopMin) / total * 100 : 0;
    const knownReject = (events.causes || []).filter(e => /reject|damage|quality|reel|rts|sluis|splice/i.test(e.desc || '')).reduce((sum, e) => sum + (Number(e.dur) || 0), 0);
    const unknownReject = Math.max(0, rejectMin - knownReject);
    const categoryCounts = countBy(events.events || [], e => e.cat || 'Process');
    const topEventDurations = [...(events.causes || [])]
      .sort((a, b) => (Number(b.dur) || 0) - (Number(a.dur) || 0))
      .slice(0, 8)
      .map(e => ({ label: e.desc, durationMin: Number(e.dur) || 0, category: e.cat || 'Process' }));
    const topAlarms = (pasaban?.alarms || []).slice(0, 8).map(a => ({ code: a.code, desc: a.desc, count: a.count, category: a.cat }));
    const resetAfterAlarm = nearbyResets(pasaban);
    const formatMin = pasaban?.formats?.reduce((s, f) => s + (Number(f.dur) || 0), 0) || speed.formatMin || 0;
    const avgFormat = pasaban?.formats?.length ? formatMin / pasaban.formats.length : 0;

    const rules = [];
    if (performance > 0 && performance < 80) rules.push({ level: 'focus', title: 'Snelheidsverlies is hoofdthema', text: `Gemiddelde snelheid zit op ${pct(performance)} van max. Dit is geen AI-conclusie maar directe berekening uit Sens.` });
    if (rejectMin > 0 && unknownReject / rejectMin > 0.45) rules.push({ level: 'focus', title: 'Reject/sluis heeft te weinig oorzaakregistratie', text: `${min(unknownReject)} van de rejectgate-open tijd heeft geen duidelijke oorzaak in Event & Alarm.` });
    if ((pasaban?.resets || 0) > 20) rules.push({ level: 'warn', title: 'Veel resetgedrag zichtbaar', text: `${pasaban.resets} reset signals in de geselecteerde dienst. Dit wijst op veel herstelmomenten of herstartacties.` });
    if (resetAfterAlarm >= 3) rules.push({ level: 'warn', title: 'Resets volgen vaak kort na alarmen', text: `${resetAfterAlarm} alarmmomenten hebben binnen 5 minuten een reset. Dit is een sterk patroon voor operator/machine-interactie.` });
    if ((pasaban?.alarmCount || 0) > 25) rules.push({ level: 'warn', title: 'Hoge alarmdruk in Pasaban', text: `${pasaban.alarmCount} alarmactivaties gevonden. Gebruik top alarmcodes om de echte herhalers te isoleren.` });
    if (avgFormat > 18) rules.push({ level: 'warn', title: 'Format changes duren lang', text: `Gemiddelde format change duurt ${min(avgFormat)}. Dit is een stabiele regel op basis van start/eind tijden.` });
    if (availability >= 92 && performance < 85) rules.push({ level: 'ok', title: 'Uptime is ok, focus verschuift naar snelheid', text: `Availability is ${pct(availability)}, maar performance blijft ${pct(performance)}. Dan ligt winst vooral in snelheid en procesinstelling.` });
    if (!pasaban) rules.push({ level: 'info', title: 'Pasaban log niet geladen', text: 'Zonder Pasaban mist de analyse resetgedrag, start/stop correlaties en ruwe alarmdruk.' });

    return {
      context: {
        machine: $('machine')?.value || 'Machine',
        shift: `${$('shift-start')?.value || ''}-${$('shift-end')?.value || ''}`,
        sources: ['speed', 'events', 'oee', 'sluis', 'orders', 'pasaban'].filter(k => data[k]),
      },
      kpis: {
        totalMin: total,
        performancePct: performance,
        availabilityPct: availability,
        stopMin,
        rejectMin,
        knownRejectMin: knownReject,
        unknownRejectMin: unknownReject,
        avgSpeed: speed.avgSpeed,
        maxSpeed: speed.maxSpeed,
      },
      eventSummary: {
        totalEvents: events.events?.length || 0,
        categoryCounts,
        topEventDurations,
      },
      pasabanSummary: pasaban ? {
        resetSignals: pasaban.resets || 0,
        alarmActivations: pasaban.alarmCount || 0,
        machineStops: pasaban.stops?.length || 0,
        stopMinutes: pasaban.stops?.reduce((s, x) => s + (Number(x.dur) || 0), 0) || 0,
        formatChanges: pasaban.formats?.length || 0,
        averageFormatMin: avgFormat,
        palletChanges: pasaban.pallet || 0,
        reelSplices: pasaban.splices || 0,
        speedLimitChanges: pasaban.speedChanges || 0,
        alarmThenResetWithin5Min: resetAfterAlarm,
        topAlarms,
      } : null,
      optionalSummary: {
        oee: data.oee ? { rows: data.oee.rowsCount || 0, sample: compactRows(data.oee.rows) } : null,
        sluis: data.sluis ? { rows: data.sluis.rowsCount || 0, sample: compactRows(data.sluis.rows) } : null,
        orders: data.orders ? { rows: data.orders.rowsCount || 0, totalMT: data.orders.totalMT || 0, totalM: data.orders.totalM || 0, sample: compactRows(data.orders.rows) } : null,
      },
      deterministicRules: rules,
    };
  }

  function signalPanel(signals) {
    const rows = signals.deterministicRules.map(r => `<div class="signal ${r.level}"><strong>${r.title}</strong><p>${r.text}</p></div>`).join('');
    const alarmRows = (signals.pasabanSummary?.topAlarms || []).map(a => `<tr><td>${a.code}</td><td>${a.desc}</td><td>${a.count}</td><td>${a.category || '-'}</td></tr>`).join('');
    return `<section class="analysis-layer" id="analysis-layer"><div class="title">Deterministische analyse</div><div class="signal-kpis"><div><span>AI gebruikt</span><strong>Nee</strong></div><div><span>Performance</span><strong>${pct(signals.kpis.performancePct)}</strong></div><div><span>Unknown reject</span><strong>${min(signals.kpis.unknownRejectMin)}</strong></div><div><span>Regels geraakt</span><strong>${signals.deterministicRules.length}</strong></div></div><div class="grid2"><div class="card"><div class="title">Regel-engine conclusies</div>${rows || '<p class="muted">Geen opvallende regelhits.</p>'}</div><div class="card"><div class="title">Pasaban signalen</div>${signals.pasabanSummary ? `<table><tbody><tr><td>Resets</td><td>${signals.pasabanSummary.resetSignals}</td></tr><tr><td>Alarmactivaties</td><td>${signals.pasabanSummary.alarmActivations}</td></tr><tr><td>Stops</td><td>${signals.pasabanSummary.machineStops} / ${min(signals.pasabanSummary.stopMinutes)}</td></tr><tr><td>Format changes</td><td>${signals.pasabanSummary.formatChanges} / avg ${min(signals.pasabanSummary.averageFormatMin)}</td></tr><tr><td>Alarm -> reset binnen 5 min</td><td>${signals.pasabanSummary.alarmThenResetWithin5Min}</td></tr></tbody></table>` : '<p class="muted">Geen Pasaban log geladen.</p>'}</div></div>${alarmRows ? `<div class="card"><div class="title">Top Pasaban alarmen zonder AI</div><table><thead><tr><th>Code</th><th>Alarm</th><th>Aantal</th><th>Type</th></tr></thead><tbody>${alarmRows}</tbody></table></div>` : ''}<div class="card ai-card"><div><div class="title">Optionele AI conclusie</div><p class="muted">AI krijgt alleen deze compacte signalen, niet alle ruwe bestanden. Gebruik dit voor managementsamenvatting en prioriteitstelling.</p></div><button class="btn" id="ai-summary-btn">AI conclusie toevoegen</button><div id="ai-summary-result" class="ai-result muted"></div></div></section>`;
  }

  function aiPrompt(signals) {
    return `Maak een compacte productieanalyse in JSON op basis van deze berekende signalen. Gebruik geen ruwe aannames buiten de data. Retourneer exact JSON met: management_summary, top_3_priorities, likely_root_causes, operator_machine_quality_split, next_shift_actions.\n\nSIGNALS:\n${JSON.stringify(signals, null, 2)}`;
  }
  function renderAiResult(raw) {
    const target = $('ai-summary-result');
    if (!target) return;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) {}
    if (!parsed) {
      target.className = 'ai-result';
      target.innerHTML = `<pre>${escapeHtml(raw)}</pre>`;
      return;
    }
    target.className = 'ai-result';
    target.innerHTML = `<strong>Management summary</strong><p>${escapeHtml(parsed.management_summary || '')}</p><strong>Top prioriteiten</strong><ol>${(parsed.top_3_priorities || []).map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ol><strong>Volgende shift acties</strong><ol>${(parsed.next_shift_actions || []).map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ol>`;
  }
  async function runAi() {
    const btn = $('ai-summary-btn');
    const result = $('ai-summary-result');
    if (!lastSignals || !btn || !result) return;
    btn.disabled = true;
    result.textContent = 'AI analyse wordt gemaakt...';
    try {
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: aiPrompt(lastSignals) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'AI analyse mislukt.');
      renderAiResult(data.text || '');
    } catch (e) {
      result.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }
  function insertStyles() {
    if (document.getElementById('analysis-layer-style')) return;
    const style = document.createElement('style');
    style.id = 'analysis-layer-style';
    style.textContent = `.analysis-layer{margin-bottom:16px}.signal-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}.signal-kpis div{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px}.signal-kpis span{display:block;color:var(--dim);font-size:10px;text-transform:uppercase;font-weight:900;letter-spacing:.08em}.signal-kpis strong{display:block;font-size:22px;margin-top:4px}.signal{border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--bg3)}.signal p{color:var(--muted);margin-top:4px}.signal.focus{border-color:rgba(240,64,64,.35);background:rgba(240,64,64,.07)}.signal.warn{border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.07)}.signal.ok{border-color:rgba(62,207,142,.3);background:rgba(62,207,142,.06)}.signal.info{border-color:rgba(96,165,250,.3);background:rgba(96,165,250,.06)}.ai-card{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.ai-result{width:100%;margin-top:10px}.ai-result pre{white-space:pre-wrap;background:var(--bg3);border-radius:8px;padding:12px}.ai-result ol{margin:8px 0 0 18px;color:var(--muted)}@media(max-width:860px){.signal-kpis{grid-template-columns:1fr}.ai-card{display:block}.ai-card .btn{margin-top:12px}}`;
    document.head.appendChild(style);
  }
  function patchBuild() {
    if (typeof window.build !== 'function' || window.build.__analysisPatched) return;
    const original = window.build;
    window.build = function analysisBuild(data) {
      lastData = data;
      const result = original.apply(this, arguments);
      lastSignals = buildSignals(data);
      const report = $('report');
      if (report) report.insertAdjacentHTML('afterbegin', signalPanel(lastSignals));
      $('ai-summary-btn')?.addEventListener('click', runAi);
      document.dispatchEvent(new CustomEvent('jm:analysis-signals', { detail: { data, signals: lastSignals } }));
      return result;
    };
    window.build.__analysisPatched = true;
  }
  insertStyles();
  document.addEventListener('DOMContentLoaded', () => { insertStyles(); patchBuild(); });
  setTimeout(patchBuild, 0);
})();
