(() => {
  const scenarioLabels = {
    basic: 'Basic: Sens + Event/Alarm',
    pasaban: 'Basic + Pasaban log',
    oee: 'Basic + OEE report',
    orders: 'Basic + Orders & tonnen',
    sluis: 'Basic + Sluis report',
    complete: 'Complete report: alles geladen',
  };

  const scenarioText = {
    basic: 'Toont de minimale analyse: snelheid, stilstand, reject/sluis-open tijd, event-oorzaken en verbeterpunten op basis van de twee verplichte bestanden.',
    pasaban: 'Voegt operatorgedrag en machine-interactie toe: resets, start/stop, alarmactivaties, format changes, pallet changes, splices en top Pasaban alarms.',
    oee: 'Voegt een OEE-laag toe: extra rijdata uit PROMs, availability/performance/quality context en een controlelaag naast de Sens-berekening.',
    orders: 'Voegt productiecontext toe: orders, meters, tonnen, ton/uur en hoeveel output aan de shift gekoppeld kan worden.',
    sluis: 'Voegt sluis/rejectgate-verdieping toe: sluisfactoren, sluisregels en extra bewijs voor rejectgate-open tijd.',
    complete: 'Combineert alles: de basisanalyse plus OEE, sluis, orders/tonnen en de volledige Pasaban log voor het meest complete beeld.',
  };

  function el(id) { return document.getElementById(id); }
  function dt(hour, minute) { const d = new Date('2026-04-15T00:00:00'); d.setHours(hour, minute, 0, 0); return d; }
  function rows(count, mapper) { return Array.from({ length: count }, (_, i) => mapper(i)); }

  function makeSpeed() {
    const speedRows = rows(1920, i => {
      const minute = i / 4;
      const inStop = (minute >= 72 && minute < 91) || (minute >= 214 && minute < 229) || (minute >= 388 && minute < 407);
      const inReject = (minute >= 118 && minute < 147) || (minute >= 302 && minute < 328);
      const inFormat = (minute >= 206 && minute < 232) || (minute >= 355 && minute < 377);
      const wave = Math.sin(i / 33) * 16;
      const spd = inStop ? 0 : Math.max(120, 266 + wave - (inReject ? 36 : 0) - (inFormat ? 48 : 0));
      return { spd, max: 350, reject: inReject ? 1 : 0, format: inFormat ? 1 : 0, len: minute < 210 ? 700 : minute < 360 ? 1020 : 840 };
    });
    const running = speedRows.filter(r => r.spd > 0);
    const interval = 0.25;
    return {
      rows: speedRows,
      totalMin: speedRows.length * interval,
      runningMin: running.length * interval,
      stopMin: speedRows.filter(r => r.spd <= 0).length * interval,
      avgSpeed: running.reduce((s, r) => s + r.spd, 0) / running.length,
      maxSpeed: 350,
      rejectMin: speedRows.filter(r => r.reject > 0).length * interval,
      formatMin: speedRows.filter(r => r.format > 0).length * interval,
      perf: (running.reduce((s, r) => s + r.spd, 0) / running.length) / 350 * 100,
      lengths: [700, 1020, 840],
    };
  }

  function makeEvents() {
    const events = [
      { time: '06:42', dur: 18.5, cat: 'Machine', desc: 'NIP pressure alarm after restart' },
      { time: '07:19', dur: 12.0, cat: 'Quality', desc: 'Rejectgate open: edge damage on reel' },
      { time: '08:55', dur: 21.0, cat: 'Operator', desc: 'Format change and speed ramp-up' },
      { time: '09:37', dur: 8.5, cat: 'Machine', desc: 'Photocell alarm on stacker' },
      { time: '10:18', dur: 14.0, cat: 'Quality', desc: 'Rejectgate open: splice check and sheet marks' },
      { time: '11:25', dur: 19.0, cat: 'Machine', desc: 'Hydraulic filter pressure alarm' },
      { time: '12:05', dur: 7.0, cat: 'Operator', desc: 'Pallet change and manual reset sequence' },
    ];
    return {
      events,
      causes: events,
      machine: events.filter(e => e.cat === 'Machine'),
      operator: events.filter(e => e.cat === 'Operator'),
      quality: events.filter(e => e.cat === 'Quality'),
    };
  }

  function makePasaban() {
    const bounds = typeof shiftBounds === 'function' ? shiftBounds(dt(5, 30)) : { s: dt(5, 30), e: dt(13, 30), totalMin: 480 };
    const stops = [
      { start: dt(6, 42), end: dt(7, 0), dur: 18 },
      { start: dt(9, 37), end: dt(9, 46), dur: 9 },
      { start: dt(11, 25), end: dt(11, 44), dur: 19 },
    ];
    const formats = [
      { start: dt(8, 55), end: dt(9, 18), dur: 23 },
      { start: dt(11, 8), end: dt(11, 27), dur: 19 },
    ];
    return {
      bounds,
      events: [
        ...stops.map(s => ({ time: s.start, type: 'STOP', desc: 'Machine stop' })),
        ...formats.map(f => ({ time: f.start, type: 'FORMAT_START', desc: 'Format change' })),
        { time: dt(7, 4), type: 'RESET', desc: 'Reset signal' },
        { time: dt(10, 11), type: 'SPEED_LIMIT', desc: 'Operator changed machine max speed' },
      ],
      stops,
      formats,
      pallet: 5,
      splices: 3,
      speedChanges: 4,
      alarmCount: 38,
      resets: 27,
      alarms: [
        { code: '85', level: 'S', desc: 'ALARM FILTER HYDRAULIC GROUP', cat: 'Machine', count: 11 },
        { code: '205', level: 'S', desc: 'PHOTOCELL STACKER NOT CLEAR', cat: 'Machine', count: 8 },
        { code: '144', level: 'W', desc: 'PUSH BUTTON RESET SEQUENCE', cat: 'Operator', count: 6 },
      ],
      wid: rows(42, i => ({ time: dt(5 + Math.floor(i / 8), (i * 7) % 60), index: i % 6, value: 700 + i })),
      seg: rows(36, i => ({ time: dt(5 + Math.floor(i / 8), (i * 6) % 60), index: i % 5, value: 1200 + i })),
    };
  }

  function makeOee() {
    return {
      rowsCount: 84,
      rows: [
        ['OEE', 'NT Rate', 'PL Rate', 'Handling Rate', 'Speed Factor'],
        [61.8, 87.4, 78.2, 93.1, 74.6],
        ['Not scheduled min', 0, 'Planned min', 22, 'Operational down min', 62],
      ],
      flat: 'OEE 61.8 NT Rate 87.4 PL Rate 78.2 Handling Rate 93.1 Speed Factor 74.6 not scheduled 0 planned 22 operational down 62',
      totalNumbers: 11,
    };
  }

  function makeSluis() {
    return {
      rowsCount: 47,
      rows: [
        ['RunFactor', 86.7, 'NoSluisFactor', 91.2],
        ['Rejectgate open format 1020', 24.5],
        ['Rejectgate open splice check', 12.0],
        ['Rejectgate open quality hold', 18.5],
      ],
      flat: 'RunFactor 86.7 NoSluisFactor 91.2 Rejectgate open format 1020 24.5 splice check 12.0 quality hold 18.5',
      totalNumbers: 8,
    };
  }

  function makeOrders() {
    return {
      rowsCount: 18,
      rows: [
        ['Order', 'Product', 'Meters', 'MT', 'Ton/u'],
        ['460112', 'Billerud 700', 18600, 7.8, 3.9],
        ['460118', 'Metsaboard 1020', 14200, 9.6, 4.4],
        ['460121', 'Sappi 840', 16750, 8.9, 4.1],
      ],
      flat: 'Order Product Meters MT Ton per uur 460112 18600 7.8 3.9 460118 14200 9.6 4.4 460121 16750 8.9 4.1',
      totalNumbers: 18,
      totalMT: 26.3,
      totalM: 49550,
    };
  }

  function dataFor(type) {
    const data = { speed: makeSpeed(), events: makeEvents(), oee: null, sluis: null, orders: null, pasaban: null };
    if (type === 'pasaban' || type === 'complete') data.pasaban = makePasaban();
    if (type === 'oee' || type === 'complete') data.oee = makeOee();
    if (type === 'orders' || type === 'complete') data.orders = makeOrders();
    if (type === 'sluis' || type === 'complete') data.sluis = makeSluis();
    return data;
  }

  function renderScenarioNote(type) {
    const report = el('report');
    if (!report) return;
    const note = document.createElement('div');
    note.className = 'demo-note';
    note.innerHTML = `<div class="title">Demo scenario</div><strong>${scenarioLabels[type]}</strong><p>${scenarioText[type]}</p>`;
    report.prepend(note);
  }

  function runScenario(type) {
    if (el('machine')) el('machine').value = 'Demo Sheeter JM';
    if (el('shift')) el('shift').value = '05:30-13:30';
    if (el('shift-start')) el('shift-start').value = '05:30';
    if (el('shift-end')) el('shift-end').value = '13:30';
    if (typeof build === 'function') {
      build(dataFor(type));
      renderScenarioNote(type);
      document.querySelectorAll('.demo-scenario').forEach(btn => btn.classList.toggle('active', btn.dataset.scenario === type));
      el('report')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function insertStyles() {
    const css = `.demo-panel{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:18px;margin:0 0 16px}.demo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.demo-scenario{border:1px solid var(--border);background:var(--bg3);color:var(--text);border-radius:8px;padding:10px 12px;text-align:left;font-weight:800;cursor:pointer}.demo-scenario span{display:block;color:var(--muted);font-size:11px;font-weight:600;margin-top:3px}.demo-scenario.active{border-color:var(--green);box-shadow:0 0 0 1px rgba(62,207,142,.25) inset}.demo-note{background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.28);border-radius:10px;padding:16px;margin-bottom:16px}.demo-note p{color:var(--muted);margin-top:5px}@media(max-width:960px){.demo-grid{grid-template-columns:1fr}}`;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function insertPanel() {
    const upload = document.querySelector('.upload');
    if (!upload || document.querySelector('.demo-panel')) return;
    const panel = document.createElement('section');
    panel.className = 'demo-panel';
    panel.innerHTML = `<div class="title">Demo rapporten</div><div class="demo-grid">
      <button class="demo-scenario" data-scenario="basic">Basic report<span>Sens + Event/Alarm</span></button>
      <button class="demo-scenario" data-scenario="pasaban">+ Pasaban log<span>resets, alarms, start/stop, operator acties</span></button>
      <button class="demo-scenario" data-scenario="oee">+ OEE report<span>OEE-context en PROMs controlelaag</span></button>
      <button class="demo-scenario" data-scenario="orders">+ Orders & tonnen<span>meters, MT, ton/uur en ordercontext</span></button>
      <button class="demo-scenario" data-scenario="sluis">+ Sluis report<span>sluisfactoren en rejectgate verdieping</span></button>
      <button class="demo-scenario" data-scenario="complete">Compleet report<span>alle databronnen samen</span></button>
    </div>`;
    upload.parentNode.insertBefore(panel, upload);
    panel.querySelectorAll('.demo-scenario').forEach(btn => btn.addEventListener('click', () => runScenario(btn.dataset.scenario)));
  }

  document.addEventListener('DOMContentLoaded', () => {
    insertStyles();
    insertPanel();
  });
  setTimeout(() => { insertStyles(); insertPanel(); }, 0);
})();
