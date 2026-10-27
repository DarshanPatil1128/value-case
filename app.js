(() => {
  const { $, $$, fmt, esc } = Kit;

  // Illustrative presets — round, plausible numbers, not client data.
  const PRESETS = {
    ap: { label: 'Accounts payable — invoice processing', name: 'Invoice processing (AP)', volume: 120000, minutes: 9, rate: 48, errRate: 3, errCost: 55, auto: 70, residual: 15, errCut: 75, impl: 280000, run: 90000, ramp: 6, disc: 10, horizon: 3 },
    kyc: { label: 'Customer onboarding — KYC review', name: 'Customer onboarding & KYC', volume: 40000, minutes: 35, rate: 62, errRate: 5, errCost: 180, auto: 55, residual: 25, errCut: 60, impl: 450000, run: 140000, ramp: 9, disc: 10, horizon: 3 },
    itsm: { label: 'IT service desk — ticket triage', name: 'IT ticket triage & routing', volume: 180000, minutes: 6, rate: 45, errRate: 8, errCost: 25, auto: 60, residual: 20, errCut: 70, impl: 220000, run: 110000, ramp: 4, disc: 10, horizon: 3 },
    claims: { label: 'Insurance — claims intake', name: 'Claims intake (FNOL)', volume: 65000, minutes: 18, rate: 52, errRate: 4, errCost: 120, auto: 50, residual: 30, errCut: 65, impl: 380000, run: 120000, ramp: 8, disc: 10, horizon: 5 },
  };
  const KEYS = ['name', 'volume', 'minutes', 'rate', 'errRate', 'errCost', 'auto', 'residual', 'errCut', 'impl', 'run', 'ramp', 'disc'];
  let horizon = 3;

  $('#preset').innerHTML = '<option value="" disabled>Start from a preset…</option>' +
    Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('');

  Kit.bindOutputs(document, {
    errRate: (v) => v + '%', auto: (v) => v + '%', residual: (v) => v + '%', errCut: (v) => v + '%',
    ramp: (v) => (v ? v + ' mo' : 'Immediate'), disc: (v) => v + '%',
  });

  function load(p) {
    KEYS.forEach((k) => { if (p[k] != null) $('#' + k).value = p[k]; });
    setHorizon(Number(p.horizon) || 3);
    $$('input[type="range"]').forEach((i) => i.dispatchEvent(new Event('input')));
  }
  function read() {
    const v = { name: $('#name').value || 'Automation initiative' };
    KEYS.slice(1).forEach((k) => (v[k] = Number($('#' + k).value) || 0));
    v.horizon = horizon;
    return v;
  }
  function setHorizon(h) {
    horizon = h;
    $$('#horizon button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === h)));
  }

  // ───────── Model ─────────
  function model(v, tweak = {}) {
    const a = { ...v, ...tweak };
    const autoShare = Math.min(1, a.auto / 100);
    const autoVol = a.volume * autoShare;
    const hours = autoVol * (1 - a.residual / 100) * a.minutes / 60;
    const labor = hours * a.rate;
    const errors = autoVol * (a.errRate / 100) * (a.errCut / 100) * a.errCost;
    const benefit = labor + errors;
    const months = a.horizon * 12;
    const mRate = Math.pow(1 + a.disc / 100, 1 / 12) - 1;
    const flows = [-a.impl];
    for (let m = 1; m <= months; m++) {
      const ramp = a.ramp > 0 ? Math.min(1, m / a.ramp) : 1;
      flows.push((benefit / 12) * ramp - a.run / 12);
    }
    const npv = flows.reduce((s, f, i) => s + f / Math.pow(1 + mRate, i), 0);
    let cum = 0, payback = null;
    const cumulative = flows.map((f, i) => {
      const prev = cum;
      cum += f;
      if (payback == null && i > 0 && cum >= 0 && prev < 0) payback = i - 1 + (-prev / f);
      return { x: i, y: cum };
    });
    const totalIn = flows.slice(1).reduce((s, f) => s + Math.max(0, f + a.run / 12), 0);
    const totalCost = a.impl + a.run * a.horizon;
    return { a, labor, errors, benefit, hours, fte: hours / 1800, flows, npv, irr: irr(flows), payback, cumulative, roi: (totalIn - totalCost) / totalCost, net: cum };
  }

  function irr(flows) {
    const npvAt = (r) => flows.reduce((s, f, i) => s + f / Math.pow(1 + r, i), 0);
    let lo = -0.99, hi = 1;
    if (npvAt(lo) * npvAt(hi) > 0) return null;
    for (let k = 0; k < 100; k++) {
      const mid = (lo + hi) / 2;
      npvAt(lo) * npvAt(mid) <= 0 ? (hi = mid) : (lo = mid);
    }
    return Math.pow(1 + (lo + hi) / 2, 12) - 1;
  }

  const scenarios = (v) => ({
    conservative: model(v, { auto: v.auto * 0.8, ramp: v.ramp * 1.5, impl: v.impl * 1.15 }),
    expected: model(v),
    aggressive: model(v, { auto: Math.min(100, v.auto * 1.1), ramp: v.ramp * 0.75 }),
  });

  const payText = (p) => (p == null ? 'Not within horizon' : p < 1 ? '< 1 month' : `${p.toFixed(1)} months`);

  // ───────── Render ─────────
  function render() {
    const v = read();
    const S = scenarios(v), E = S.expected;

    $('#pTitle').textContent = v.name;
    $('#kNpv').textContent = fmt.compact(E.npv);
    $('#kNpvHint').textContent = `${v.horizon}-year, at ${v.disc}% discount rate`;
    $('#kPay').textContent = E.payback == null ? '—' : E.payback < 1 ? '<1 mo' : `${E.payback.toFixed(1)} mo`;
    $('#kIrr').textContent = E.irr == null ? '—' : E.irr > 10 ? '>1,000%' : fmt.pct(E.irr);
    $('#kIrrHint').textContent = E.irr != null && E.irr > v.disc / 100 ? `Clears the ${v.disc}% hurdle` : `Below the ${v.disc}% hurdle`;
    $('#kFte').textContent = E.fte.toFixed(1) + ' FTE';
    $('#kFteHint').textContent = `${fmt.num(E.hours)} hours / year`;

    Kit.mount('#cash', (w) => Kit.svg.lines({
      w, h: 290, xfmt: (m) => (m === 0 ? 'Go-live' : `M${m}`), yfmt: fmt.compact,
      xTicks: Array.from({ length: v.horizon * 2 + 1 }, (_, i) => i * 6),
      series: [
        { name: 'Conservative', color: 'var(--c5)', points: S.conservative.cumulative, dash: '5 5', width: 1.75 },
        { name: 'Aggressive', color: 'var(--c1)', points: S.aggressive.cumulative, dash: '5 5', width: 1.75 },
        { name: 'Expected', color: 'var(--c2)', points: E.cumulative, area: true, width: 2.75 },
      ].reverse(),
      markers: [{ y: 0, label: 'Break-even', color: 'var(--faint)' }].concat(
        E.payback != null ? [{ x: E.payback, y: 0, label: `Payback ${payText(E.payback)}`, color: 'var(--c2)' }] : []),
    }));

    $('#scen').innerHTML = `<thead><tr><th></th><th class="num">NPV</th><th class="num">Payback</th><th class="num">${v.horizon}-yr net</th></tr></thead><tbody>` +
      [['Conservative', S.conservative], ['Expected', E], ['Aggressive', S.aggressive]].map(([n, r]) =>
        `<tr class="${n === 'Expected' ? 'base' : ''}"><td>${n}</td><td class="num" style="color:${r.npv < 0 ? 'var(--bad)' : 'inherit'}">${fmt.compact(r.npv)}</td><td class="num">${r.payback == null ? '—' : r.payback.toFixed(1) + ' mo'}</td><td class="num">${fmt.compact(r.net)}</td></tr>`).join('') + '</tbody>';

    Kit.mount('#sources', (w) => Kit.svg.hbars({
      w, labelW: 120, fmt: fmt.compact, rowH: 36,
      items: [
        { label: 'Labor time', value: E.labor, color: 'var(--c2)' },
        { label: 'Fewer errors', value: E.errors, color: 'var(--c6)' },
        { label: 'Run cost', value: -v.run, color: 'var(--c5)' },
        { label: 'Net / year', value: E.benefit - v.run, color: 'var(--text)' },
      ],
    }));

    const drivers = [
      ['Volume', 'volume'], ['Minutes per item', 'minutes'], ['Loaded hourly rate', 'rate'], ['Share automated', 'auto'],
      ['One-time cost', 'impl'], ['Annual run cost', 'run'], ['Ramp time', 'ramp'], ['Cost per error', 'errCost'],
    ].map(([label, k]) => {
      const lo = model(v, { [k]: v[k] * 0.8 }).npv, hi = model(v, { [k]: Math.min(k === 'auto' ? 100 : Infinity, v[k] * 1.2) }).npv;
      return { label, low: lo, high: hi, lowLabel: '−20%', highLabel: '+20%', span: Math.abs(hi - lo) };
    }).sort((a, b) => b.span - a.span);
    Kit.mount('#tornado', (w) => Kit.svg.tornado({ w, items: drivers, base: E.npv, fmt: fmt.compact, labelW: w < 520 ? 120 : 150 }));

    const top = drivers[0];
    const positive = E.npv > 0;
    $('#summary').innerHTML = `
      <p><strong>Recommendation: ${positive ? 'proceed' : 'revisit the scope before proceeding'}.</strong>
      The <strong>${esc(v.name)}</strong> automation is expected to return <strong>${fmt.compact(E.npv)} in net present value</strong> over ${v.horizon} years
      on a ${fmt.compact(v.impl)} upfront investment, ${E.payback == null ? 'but does not pay back within the horizon' : `paying back in about <strong>${payText(E.payback)}</strong>`}.</p>
      <ul>
        <li>At full run-rate it saves <strong>${fmt.compact(E.benefit)} a year</strong> (${fmt.compact(E.labor)} in labor time, ${fmt.compact(E.errors)} from fewer errors) against ${fmt.compact(v.run)} in annual run cost.</li>
        <li>It frees about <strong>${E.fte.toFixed(1)} FTE</strong> of capacity (${fmt.num(E.hours)} hours a year) that can be redeployed to higher-value work.</li>
        <li>Even in the conservative case, NPV is <strong>${fmt.compact(S.conservative.npv)}</strong>${S.conservative.npv > 0 ? ', so the downside is limited' : ', so the downside case loses money'}.</li>
        <li>The result is most sensitive to <strong>${top.label.toLowerCase()}</strong>: a ±20% change moves NPV between ${fmt.compact(Math.min(top.low, top.high))} and ${fmt.compact(Math.max(top.low, top.high))}. Validate it first.</li>
      </ul>`;

    const params = new URLSearchParams();
    KEYS.forEach((k) => params.set(k, k === 'name' ? v.name : v[k]));
    params.set('horizon', v.horizon);
    history.replaceState(null, '', '#' + params.toString());
  }

  // ───────── Events ─────────
  const rerender = Kit.debounce(render, 60);
  $$('#inputs input').forEach((el) => el.addEventListener('input', rerender));
  $$('#horizon button').forEach((b) => b.addEventListener('click', () => { setHorizon(Number(b.dataset.v)); render(); }));
  $('#preset').addEventListener('change', (e) => { load(PRESETS[e.target.value]); render(); });
  $('#print').addEventListener('click', () => window.print());
  $('#share').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); Kit.toast('Link copied — it includes your inputs'); }
    catch { Kit.toast('Copy the address bar to share'); }
  });
  $('#copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#pTitle').textContent + '\n\n' + $('#summary').innerText); Kit.toast('Summary copied'); }
    catch { Kit.toast('Select the text to copy it'); }
  });

  // Initial state: from share link, else first preset
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.has('volume')) {
    const p = Object.fromEntries(KEYS.map((k) => [k, hash.get(k)]));
    p.horizon = hash.get('horizon');
    load(p);
    $('#preset').value = '';
  } else {
    load(PRESETS.ap);
    $('#preset').value = 'ap';
  }
  render();
})();
