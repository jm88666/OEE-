/* Runtime fixes for the inline OEE dashboard script. */
pNum = function pNum(s) {
  if (s === null || s === undefined) return 0;
  if (typeof s === 'number') return Number.isNaN(s) ? 0 : s;
  let str = String(s).replace(/\u00a0/g, ' ').replace('%', '').trim();
  if (!str) return 0;
  const hasComma = str.includes(',');
  const hasDot = str.includes('.');
  if (hasComma && hasDot) {
    str = str.lastIndexOf(',') > str.lastIndexOf('.')
      ? str.replace(/\./g, '').replace(',', '.')
      : str.replace(/,/g, '');
  } else if (hasComma) {
    str = str.replace(',', '.');
  }
  str = str.replace(/\s/g, '');
  return parseFloat(str) || 0;
};

function splitCsvLine(line, sep = ';') {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === sep && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(c => c.trim());
}

parseSense = async function parseSense(file) {
  const txt = await file.text();
  const lines = txt.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const headers = splitCsvLine(lines[0]).map(h => h.replace(/"/g, '').trim());
  const iSpd = findCol(headers, 'linespeed');
  const iMax = findCol(headers, 'maxspeed');
  const iRG = findCol(headers, 'rejectgateopen', 'rejectgate');
  const iFC = findCol(headers, 'formatchg', 'formaat');
  const iAl = findCol(headers, 'alarmgeneral', 'alarm');
  const iLen = findCol(headers, 'lenght', 'length');
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const c = splitCsvLine(lines[i]);
    rows.push({
      spd: iSpd >= 0 ? pNum(c[iSpd]) : 0,
      maxSpd: iMax >= 0 ? pNum(c[iMax]) : 0,
      rg: iRG >= 0 ? pNum(c[iRG]) : 0,
      fc: iFC >= 0 ? pNum(c[iFC]) : 0,
      al: iAl >= 0 ? pNum(c[iAl]) : 0,
      len: iLen >= 0 ? pNum(c[iLen]) : 0,
    });
  }
  const iM = 15 / 60;
  const running = rows.filter(r => r.spd > 0);
  const runMin = running.length * iM;
  const standMin = rows.filter(r => r.spd === 0).length * iM;
  const avgSpd = running.length ? running.reduce((s, r) => s + r.spd, 0) / running.length : 0;
  const maxSet = rows.find(r => r.maxSpd > 0)?.maxSpd || 350;
  const maxSeen = rows.reduce((m, r) => Math.max(m, r.spd), 0);
  const alMap = {};
  rows.forEach(r => { const a = Math.round(r.al); if (a > 0 && a < 99999) alMap[a] = (alMap[a] || 0) + iM; });
  const alarmMinutes = Object.entries(alMap).map(([code, min]) => ({ code: parseInt(code, 10), min: Math.round(min * 10) / 10 })).sort((a, b) => b.min - a.min);
  const rgMin = rows.filter(r => r.rg > 0).length * iM;
  const rgPct = rows.length ? rgMin / (rows.length * iM) * 100 : 0;
  const lens = rows.map(r => r.len).filter(l => l > 0);
  const cutM = lens.length > 1 ? lens[lens.length - 1] - lens[0] : 0;
  const fcMin = rows.filter(r => r.fc > 0).length * iM;
  const dist = { '0': 0, '1-100': 0, '101-200': 0, '201-280': 0, '281-350': 0 };
  rows.forEach(r => {
    if (r.spd === 0) dist['0'] += iM;
    else if (r.spd <= 100) dist['1-100'] += iM;
    else if (r.spd <= 200) dist['101-200'] += iM;
    else if (r.spd <= 280) dist['201-280'] += iM;
    else dist['281-350'] += iM;
  });
  return {
    totalPoints: rows.length,
    intervalSec: 15,
    runningMinutes: Math.round(runMin * 10) / 10,
    standstillMinutes: Math.round(standMin * 10) / 10,
    avgRunningSpeed: Math.round(avgSpd * 10) / 10,
    maxSpeedSetting: maxSet,
    maxSpeedSeen: maxSeen,
    alarmMinutes,
    rejectGateOpenMinutes: Math.round(rgMin * 10) / 10,
    rejectGatePct: Math.round(rgPct * 10) / 10,
    cutMeters: Math.round(cutM),
    formatchgActiveMinutes: Math.round(fcMin * 10) / 10,
    speedDistribution: dist,
  };
};

function fallbackAI(parsed, calc) {
  const events = parsed.events?.events || [];
  const byType = {
    machine: events.filter(e => /machine|alarm|sensor|belt|slowbelt/i.test(`${e.cat} ${e.comment}`)),
    operator: events.filter(e => /operator|wissel|wisseling|format|formaat|opstart|leeg/i.test(`${e.cat} ${e.comment}`)),
    kwaliteit: events.filter(e => /kwaliteit|quality|halve maan|hoek|scheur|defect/i.test(`${e.cat} ${e.comment}`)),
  };
  const top = items => Object.values(items.reduce((m, e) => {
    const name = (e.cat || 'Onbekend').split('>').map(s => s.trim()).filter(Boolean).pop() || 'Onbekend';
    m[name] ||= { naam: name, events: 0, min: 0 };
    m[name].events += 1;
    m[name].min += e.dur_min || 0;
    return m;
  }, {})).sort((a, b) => b.min - a.min).slice(0, 5).map(x => ({ ...x, min: Math.round(x.min * 10) / 10 }));
  const mk = (items, label) => ({
    events: items.slice(0, 20).map(e => ({ t: e.t, label: (e.cat || label).split('>').pop().trim(), dur_min: e.dur_min, oorzaak: e.comment || '' })),
    total_min: Math.round(items.reduce((s, e) => s + (e.dur_min || 0), 0) * 10) / 10,
    top_oorzaken: top(items),
    score: Math.max(0, Math.min(100, Math.round(100 - (items.reduce((s, e) => s + (e.dur_min || 0), 0) / (calc.apt || SHIFT_MIN)) * 100))),
    verdict: items.length ? `${label}: ${items.length} events gevonden in de ingelezen rapporten.` : `${label}: geen duidelijke events gevonden.`,
    verbeteringen: [],
  });
  const sluisEvents = parsed.sluis?.sluisEvents || [];
  return {
    machine: { ...mk(byType.machine, 'Machine'), alarm_analyse: (parsed.sense?.alarmMinutes || []).length ? 'Alarmcodes actief in SenSe-data gevonden.' : 'Geen alarmcodes in SenSe-data gevonden.' },
    operator: mk(byType.operator, 'Operator'),
    kwaliteit: { ...mk(byType.kwaliteit, 'Kwaliteit'), protocol: [] },
    gepland: { total_min: 0 },
    sluis: { analyse: sluisEvents.length ? 'Sluis-events uit het sluisrapport zijn ingelezen.' : 'Geen sluis-events gevonden.', top_events: sluisEvents.slice(0, 5).map(e => ({ label: e.pad, aantal: e.aantal, min: e.duur_min })), verbeteringen: [] },
    meta: { machine: 'DW08', locatie: 'Metsä NL Winschoten', shift_start: '07:00', shift_end: '15:30', totaal_events: events.length, ongepland_min: calc.opDownMin || 0, grootste_veroorzaker: 'onbekend' },
  };
}

startAnalysis = async function startAnalysis() {
  document.getElementById('upload-screen').style.display = 'none';
  document.getElementById('loading-screen').style.display = 'block';
  try {
    setStep(0, 'active'); STATE.parsed.oee = await parseOEE(STATE.files.oee); setStep(0, 'done');
    setStep(1, 'active'); STATE.parsed.sluis = await parseSluis(STATE.files.sluis); setStep(1, 'done');
    setStep(2, 'active'); STATE.parsed.sense = await parseSense(STATE.files.sense); setStep(2, 'done');
    setStep(3, 'active'); STATE.parsed.events = await parseEvents(STATE.files.events); setStep(3, 'done');
    setStep(4, 'active'); STATE.parsed.loadlist = STATE.files.loadlist ? await parseLoadList(STATE.files.loadlist) : null; setStep(4, 'done');
    setStep(5, 'active'); STATE.calc = calcOEE(STATE.parsed); STATE.pot = calcPotential(STATE.parsed, STATE.calc); STATE.orderPot = calcOrderPotentieel(STATE.parsed, STATE.calc); STATE.opstartAnalyse = calcOpstartAnalyse(STATE.orderPot, STATE.parsed); setStep(5, 'done');
    setStep(6, 'active');
    try { STATE.ai = await callAI(buildPrompt(STATE.parsed, STATE.calc)); } catch (e) { console.warn('AI:', e.message); STATE.ai = null; }
    if (!STATE.ai) STATE.ai = fallbackAI(STATE.parsed, STATE.calc);
    setStep(6, 'done');
    setStep(7, 'active');
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    switchTab(0); setStep(7, 'done');
  } catch (e) {
    console.error(e);
    alert(`Fout: ${e.message}`);
    showUpload();
  }
};
