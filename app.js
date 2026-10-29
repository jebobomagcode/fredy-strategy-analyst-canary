/* Fredy Strategy Analyst 03A local prototype. No trading, no auto-report generation. */
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const C = window.FSA, R = window.FSAResearch, S = window.FSAStrategyTriage, PERIOD_MS = C.PERIOD_MS;
  const snapshots = new C.SnapshotStore();
  let activeRequest = null, importToken = 0;
  const selected = new Map();
  const state = { pair: 'BTCUSDT', tf: '4h', view: 'market', token: 0, datasets: {}, snapshot: null, report: null, chart: null, series: null, chartResize: null, logicalEnd: null, metaCache: null, source: '—', retrieved: null, researchEnabled: false, overlayAllowed: false };
  // Previews are immutable and tab-only; never persisted or certified as analysis.

  function pht(ms, seconds = false) {
    if (!Number.isFinite(ms)) return '—';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: true
    }).format(new Date(ms));
  }
  function status(message, type = '') {
    $('status').textContent = message;
    $('status').className = 'status' + (type ? ' ' + type : '');
  }
  const normalize = C.normalize;
  function cancelPending() { ++state.token; ++importToken; activeRequest?.abort(); const run=$('runFullResearch'); if(run)run.disabled=false; }
  function clearChart() {
    if (state.chartResize) { state.chartResize.disconnect(); state.chartResize = null; }
    if (state.chart) { state.chart.remove(); state.chart = null; state.series = null; }
    $('chart').replaceChildren();
  }
  function blankChart(message) {
    clearChart(); const div = document.createElement('div');
    Object.assign(div.style, { display: 'grid', placeItems: 'center', height: '100%', padding: '22px', textAlign: 'center', color: '#9ab0ce', fontSize: '13px' });
    div.textContent = message; $('chart').append(div);
  }
  function applyUrl() {
    try {
      const url = new URL(location.href);
      url.searchParams.set('pair', state.pair); url.searchParams.set('tf', state.tf);
      url.searchParams.set('mode', state.view);
      url.searchParams.delete('report'); // Private report IDs never enter URLs/referrers.
      history.replaceState(null, '', url);
    } catch (_) { /* file:// or embedded host may prohibit history API */ }
  }
  function applyControls() {
    $('pair').value = state.pair;
    document.querySelectorAll('[data-tf]').forEach(el => { el.classList.toggle('active', el.dataset.tf === state.tf); el.setAttribute('aria-pressed', String(el.dataset.tf === state.tf)); });
    document.querySelectorAll('[data-view]').forEach(el => { el.classList.toggle('active', el.dataset.view === state.view); el.setAttribute('aria-pressed', String(el.dataset.view === state.view)); });
    $('chartName').replaceChildren(document.createTextNode(state.pair + ' '));
    const sp = document.createElement('span'); sp.textContent = '· ' + state.tf.toUpperCase(); $('chartName').append(sp);
    $('reportPair').textContent = state.pair;
    applyUrl();
  }
  function renderReport() {
    const r = snapshots.get(selected.get(state.pair)) || snapshots.latest(state.pair);
    state.report = r;
    const raw = r?.raw;
    $('decision').textContent = r ? 'UNVERIFIED PREVIEW' : 'NO REPORT';
    $('decision').className = 'decision neutral';
    $('analysisTime').textContent = r ? pht(raw.snapshot.as_of_ms, true) : 'No saved assessment';
    $('reportDate').textContent = r ? pht(raw.snapshot.as_of_ms, true) : '—';
    $('publishDate').textContent = r ? pht(raw.published_at_ms, true) : '—';
    $('reportState').textContent = r ? 'UNVERIFIED PREVIEW — not a qualifying Coach assessment. Source, methodology and dependencies are unauthenticated. Preserved in this tab only; reload clears previews. v0.3.13 remains canonical.' : 'No local preview for this pair. Current candles are NOT a new Fredy analysis.';
    $('claimedDecision').textContent = r ? 'Imported claim (unverified): '+raw.analysis.decision : '—';
    $('reportHash').textContent = r ? r.id : '—';
    $('reportWarnings').textContent = r ? r.warnings.join(' · ') : '—';
    $('coachText').textContent = raw?.analysis.coach_methodology || 'No imported methodology text.';
    $('independentText').textContent = raw?.analysis.independent_analysis || 'No new conclusion from market candles alone.';
    $('riskText').textContent = raw?.analysis.risk_invalidation || 'No verified entry, stop loss or target.';
    const list=$('snapshotHistory');list.replaceChildren();
    for(const item of snapshots.list(state.pair)) {
      const option=document.createElement('option');option.value=item.id;
      option.textContent=pht(item.raw.snapshot.as_of_ms,true)+' · '+item.sha256.slice(0,12)+' · UNVERIFIED';
      option.selected=item.id===r?.id;list.append(option);
    }
    list.disabled=!r;$('exportReport').disabled=!r;
  }
  function quarantined(pack, row) { return pack.issues.some(x=>x.open_ms===row.raw[0]); }
  function table(pack) {
    const tb = $('candleRows'); tb.replaceChildren();
    for (const r of pack.rows.slice().reverse()) {
      const tr = document.createElement('tr');
      const vals = [pht(r.time * 1000), ...r.raw.slice(1,6), quarantined(pack,r)?'QUARANTINED':'No flagged conflict'];
      for (const v of vals) { const cell = document.createElement('td'); cell.textContent = String(v); tr.appendChild(cell); }
      tb.append(tr);
    }
  }
  function safeSvgFallback(pack, format) {
    const rows=pack.rows;
    const W = Math.max(280, $('chart').clientWidth), H = Math.max(260, $('chart').clientHeight), L = 15, R = 65, T = 16, B = 31;
    const n = rows.length, width = W < 490 ? 34 : 65, end = Math.max(Math.min(width,n), Math.min(state.logicalEnd ?? n, n));
    const src = rows.slice(Math.max(0, end - width), end);
    const clean=src.filter(r=>!quarantined(pack,r));
    if(!clean.length){blankChart('Visible observations are quarantined. Use Older/Newer or inspect the integrity table.');return;}
    const lo = Math.min(...clean.map(x => x.low)), hi = Math.max(...clean.map(x => x.high));
    const range = Math.max(hi-lo,format.minMove,Math.abs(hi)*1e-6); const min = lo - .06 * range; const max = hi + .06 * range;
    const Y = v => T + (max - v) * (H - T - B) / (max - min);
    const X = i => L + i * (W - L - R) / Math.max(src.length, 1) + (W-L-R)/(Math.max(src.length,1)*2);
    const parts = [`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Candles with hourly or selected-timeframe intervals">`];
    for (let k=0;k<=4;k++) { const value=min+(max-min)*k/4, y=Y(value);parts.push(`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="#26344d"/><text x="${W-R+10}" y="${y+4}" fill="#98a9c1" font-size="12">${value.toFixed(format.precision)}</text>`); }
    const cw=Math.max(2,Math.min(9,(W-L-R)/Math.max(src.length,1)*.66));
    src.forEach((r,i) => {
      if(quarantined(pack,r))return; // Keep its time slot, never plot disputed prices.
      const x=X(i), color=r.close>=r.open?'#3ed5aa':'#f07881', top=Y(Math.max(r.open,r.close)), bottom=Y(Math.min(r.open,r.close));
      parts.push(`<line x1="${x}" x2="${x}" y1="${Y(r.high)}" y2="${Y(r.low)}" stroke="${color}" stroke-width="1.4"/><rect x="${x-cw/2}" y="${top}" width="${cw}" height="${Math.max(bottom-top,1.1)}" fill="${color}"><title>${pht(r.time*1000)} | O ${r.open} H ${r.high} L ${r.low} C ${r.close}</title></rect>`);
    });
    for(let j=0;j<5;j++){const index=Math.min(src.length-1,Math.floor(j*Math.max(src.length-1,1)/4));if(src[index])parts.push(`<text x="${X(index)}" y="${H-10}" fill="#8a9db9" text-anchor="middle" font-size="12">${new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(src[index].time*1000))}</text>`);}
    parts.push('</svg>');
    $('chart').innerHTML = parts.join(''); // Only numerically validated data and locally-generated SVG strings.
    const note = document.createElement('div'); note.className = 'fallback-info'; note.textContent = 'Offline fallback viewer · TradingView library not loaded'; $('chart').append(note);
  }
  // Annotations are transient candidate geometry, not historical positions or
  // source-confirmed signals. Fail closed unless the complete three-frame
  // research assessment has current receipts and consistent native candles.
  // The price chart itself remains available as explicitly dated market data.
  function overlayEligible() {
    if(state.view!=='market'||!state.researchEnabled||!R||!S)return false;
    const freshness={};
    for(const tf of ['4h','1h','15m']){
      const pack=state.datasets[tf];
      if(!pack?.receipt)return false;
      try {freshness[tf]=C.freshness(pack,tf,pack.receipt,Date.now());}
      catch (_) {return false;}
    }
    try {
      return S.assess({symbol:state.pair,packs:state.datasets,freshness}).classification==='WAIT';
    } catch (_) {return false;}
  }
  function renderResearchPanel() {
    const pane=$('researchPanel'),summary=$('researchStatus'),body=$('researchEvidence');
    const active=state.view==='market'&&state.researchEnabled;
    pane.hidden=state.view!=='market';
    $('toggleResearch').textContent=active?'Hide research annotations':'Show research annotations';
    body.replaceChildren();
    if(!R||!S){summary.textContent='Research modules unavailable; no assessment performed.';return;}
    if(!active){summary.textContent='RESEARCH LAYER OFF · No assessment generated.';return;}
    const frames=['4h','1h','15m'],freshness={};
    for(const tf of frames) {
      const p=state.datasets[tf];
      try {
        freshness[tf]=p?.receipt?C.freshness(p,tf,p.receipt,Date.now()):null;
      } catch(error) {
        freshness[tf]={state:'CAUTION',recheckDue:true};
      }
    }
    const a=S.assess({symbol:state.pair,packs:state.datasets,freshness});
    const available=frames.filter(tf=>a.asOfByTimeframeMs[tf]);
    summary.textContent='INDEPENDENT ANALYSIS · '+a.classification+' · '+available.length+
      '/3 clean candle histories; receipt freshness assessed separately. No Coach-issued or executable trade signal.'+
      (state.overlayAllowed?' Chart annotations permitted as research candidates.':' CHART ANNOTATIONS SUPPRESSED until all three timeframe receipts and native comparisons pass.');
    renderSequenceReview(a,body);
    const diagnostics=document.createElement('details'),diagnosticTitle=document.createElement('summary');
    diagnosticTitle.textContent='Geometry counts and S1–S4 review requirements';diagnostics.append(diagnosticTitle);
    for(const tf of frames) {
      const g=state.datasets[tf]?R.inspect(state.datasets[tf],tf):null;
      const p=document.createElement('p');
      p.textContent=tf.toUpperCase()+' — '+(g?.status||'MISSING')+
        ' · pivots '+(g?.pivots.length||0)+' · geometric FVGs '+(g?.fvgs.length||0)+
        ' · breaks '+(g?.breaks.length||0)+' · sweeps '+(g?.sweeps.length||0);
      diagnostics.append(p);
    }
    const context=document.createElement('p');
    context.textContent='4H structural screening: '+a.structure.label+' · '+a.structure.reason;
    diagnostics.append(context);
    for(const b of a.branches){
      const p=document.createElement('p');
      p.textContent=b.id+' — '+b.name+': '+b.relevance+
        '. '+b.status+'. Still requires: '+b.missing.join('; ')+'.';
      diagnostics.append(p);
    }
    body.append(diagnostics);
    for(const error of a.errors){
      const p=document.createElement('p');
      p.textContent='INTEGRITY / COVERAGE: '+error;body.append(p);
    }
    const note=document.createElement('p');
    note.textContent='Research-only screening: confirmed pivot markers are placed at their causal confirmation close. Price-only gaps, breaks and sweeps do not certify a Coach-qualified location or reaction. No entry, SL, TP, risk ratio, fill, Coach endorsement or profitability claim is produced.';
    body.append(note);
  }
  function renderSequenceReview(a,body){
    const review=a.sequenceReview,section=document.createElement('section');
    section.id='strategyReview';section.setAttribute('aria-label','Causal strategy research review');
    const title=document.createElement('h3');title.textContent='Strategy review · '+a.symbol;section.append(title);
    const next=document.createElement('p');next.className='review-next';next.textContent=review.next;section.append(next);
    if(review.status!=='RESEARCH_REVIEW'){body.append(section);return;}
    const price=v=>Number(v).toLocaleString('en-US',{maximumSignificantDigits:12});
    const line=(parent,text)=>{const p=document.createElement('p');p.textContent=text;parent.append(p);};
    line(section,'Latest completed 15m close: '+price(review.latestCompleted15m.close)+' · '+pht(review.latestCompleted15m.closeMs,true)+' PHT. This is a dated candle close, not a live quote.');
    const grid=document.createElement('div');grid.className='strategy-grid';
    const card=(heading)=>{const div=document.createElement('div');div.className='strategy-card';const h=document.createElement('h4');h.textContent=heading;div.append(h);grid.append(div);return div;};
    const context=card('1 · 4H context');
    line(context,a.structure.label.replaceAll('_',' '));
    for(const [name,points] of [['High candidates',a.structure.highs||[]],['Low candidates',a.structure.lows||[]]]){
      line(context,name+': '+(points.length?points.map(p=>price(p.price)+' (known '+pht(p.knownAtMs,true)+' PHT)').join(' → '):'Not enough confirmed candidates.'));
    }
    line(context,'Two pivot comparisons are an FSA heuristic. Trend significance and valid range boundaries still require review.');
    const locations=card('2 · 1H locations and 15m chronology');
    if(!review.locations.length)line(locations,'No confirmed 1H pivot candidates in this history.');
    for(const l of review.locations){
      const item=document.createElement('div');item.className='location-review';
      line(item,(l.kind==='swing-high'?'High':'Low')+' candidate '+price(l.price)+' · confirmed '+pht(l.knownAtMs,true)+' PHT');
      line(item,l.status.replaceAll('_',' ')+' · '+l.coverage.replaceAll('_',' '));
      if(l.contact)line(item,'First observed contact candle: '+pht(l.contact.openMs,true)+' → '+pht(l.contact.closeMs,true)+' PHT. Contact is not a qualified reaction.');
      for(const e of l.laterEvents)line(item,'Later '+e.kind+' at '+price(e.level)+' · known '+pht(e.knownAtMs,true)+' PHT');
      if(l.contact&&!l.laterEvents.length)line(item,'No subsequent break/sweep candidate observed in the covered window. Same-candle event order is unknown.');
      if(l.closeBeyond)line(item,'Completed close beyond this candidate: '+price(l.closeBeyond.close)+' · '+pht(l.closeBeyond.closeMs,true)+' PHT. Reassess its relevance.');
      locations.append(item);
    }
    const confirmation=card('3 · Confirmation routes');
    line(confirmation,'SOURCE PLAN REVIEW REQUIRED');
    for(const route of review.confirmation.routes)line(confirmation,route);
    line(confirmation,review.confirmation.sameCandleOrder);
    const risk=card('4 · Invalidation and risk');
    const ref=review.reference;
    line(risk,ref?'4H structural reference: '+price(ref.price)+' · '+ref.kind+' · known '+pht(ref.knownAtMs,true)+' PHT.'+
      (ref.crossedByLatestClose?' The latest completed close is already beyond this reference.':''):'No directional 4H structural reference established.');
    line(risk,review.risk.reason);
    section.append(grid);for(const limit of review.limitations)line(section,limit);body.append(section);
  }
  function drawResearchMarkers(lib,series,pack){
    if(!state.overlayAllowed||!state.researchEnabled||state.view!=='market'||!R)return;
    const inspected=R.inspect(pack,state.tf);
    if(inspected.status!=='RESEARCH CANDIDATES')return;
    const marks=[
      ...inspected.pivots.slice(-10).map(v=>({time:(v.knownAtMs+1-C.PERIOD_MS[state.tf])/1000,position:v.kind==='swing-high'?'aboveBar':'belowBar',color:'#82b9ff',shape:'circle',text:v.kind==='swing-high'?'FSA H (known)':'FSA L (known)'})),
      ...inspected.breaks.slice(-5).map(v=>({time:v.time,position:v.kind.startsWith('bullish')?'belowBar':'aboveBar',color:'#e9c16e',shape:'square',text:'FSA break'})),
      ...inspected.sweeps.slice(-5).map(v=>({time:v.time,position:v.kind.startsWith('lower')?'belowBar':'aboveBar',color:'#c8a6f6',shape:'circle',text:'FSA sweep'}))
    ].sort((a,b)=>a.time-b.time);
    if(marks.length&&typeof lib.createSeriesMarkers==='function')lib.createSeriesMarkers(series,marks);
    // Geometric FVG boundary lines, not tradeable AOIs or buy/sell orders.
    if(typeof series.createPriceLine==='function'){
      if(state.tf==='1h'){
        for(const pivot of [...inspected.pivots.filter(p=>p.kind==='swing-high').slice(-2),...inspected.pivots.filter(p=>p.kind==='swing-low').slice(-2)]){
          series.createPriceLine({price:pivot.price,color:'#82b9ff',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'FSA 1H candidate'});
        }
      }
      for(const gap of inspected.fvgs.slice(-2)){
        for(const price of [gap.low,gap.high]){
          series.createPriceLine({price,color:gap.kind==='bullish-gap'?'#538fbd':'#ab7293',lineWidth:1,lineStyle:2,axisLabelVisible:false,title:'FSA gap edge'});
        }
      }
    }
  }
  function renderCandles(pack, retainedLogicalRange=null) {
    clearChart();const rows=pack.rows, format=C.priceFormat(pack,pack.receipt?.instrument);
    if (!rows.length) { blankChart('No completed candles'); return; }
    const lib = window.LightweightCharts;
    if (lib?.createChart && lib?.CandlestickSeries) {
      try {
        const container = $('chart');
        const c = lib.createChart(container, {
          width:container.clientWidth,height:container.clientHeight,
          layout:{background:{type:lib.ColorType.Solid,color:'#0b1728'},textColor:'#91a8c3'},
          grid:{vertLines:{color:'#1c2b42'},horzLines:{color:'#1c2b42'}},
          rightPriceScale:{borderColor:'#32435b'},timeScale:{borderColor:'#32435b',timeVisible:true,secondsVisible:false,
          tickMarkFormatter:(sec)=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(Number(sec)*1000))},
          localization:{timeFormatter:(sec)=>pht(Number(sec)*1000)}
        });
        const series = c.addSeries(lib.CandlestickSeries, {upColor:'#3ed5aa',downColor:'#ed767f',wickUpColor:'#3ed5aa',wickDownColor:'#ed767f',borderVisible:false,priceFormat:{type:'price',...format}});
        series.setData(rows.map(x=>quarantined(pack,x)?{time:x.time}:{time:x.time,open:x.open,high:x.high,low:x.low,close:x.close}));
        drawResearchMarkers(lib,series,pack);
        const start=Math.max(0,rows.length-80);
        // Only the expiry-driven redraw may carry this viewport forward.
        // Explicit pair/timeframe changes and new market fetches always reset.
        const keep=retainedLogicalRange&&Number.isFinite(retainedLogicalRange.from)&&
          Number.isFinite(retainedLogicalRange.to)&&retainedLogicalRange.to>retainedLogicalRange.from;
        c.timeScale().setVisibleLogicalRange(keep
          ? {from:retainedLogicalRange.from,to:retainedLogicalRange.to}
          : {from:start,to:rows.length+2});
        state.chart = c; state.series = series;
        state.chartResize = new ResizeObserver(()=>{if (state.chart===c){c.applyOptions({width:container.clientWidth,height:container.clientHeight});}});
        state.chartResize.observe(container);
      } catch(err) { console.warn('Lightweight Charts unavailable:',err);clearChart();safeSvgFallback(pack,format); }
    } else safeSvgFallback(pack,format);
    table(pack);
  }
  function currentPack() {
    if (state.view === 'snapshot') return state.report?.frames?.[state.tf] ?? null;
    return state.datasets[state.tf] ?? null;
  }
  function view({preserveChartRange=false}={}) {
    // Capture before renderCandles removes the old chart. This is never used
    // for pair/timeframe changes: their explicit view() calls reset the chart.
    let retainedLogicalRange=null;
    if(preserveChartRange&&state.view==='market'&&state.chart){
      try {retainedLogicalRange=state.chart.timeScale().getVisibleLogicalRange();}
      catch (_) {retainedLogicalRange=null;}
    }
    state.overlayAllowed=overlayEligible();
    applyControls();renderReport();renderResearchPanel();
    const pack=currentPack();
    if (pack) { renderCandles(pack,retainedLogicalRange);$('source').textContent=state.view==='snapshot'?'UNVERIFIED imported snapshot evidence':(pack.source||state.source);
      $('marketTime').textContent=state.view==='snapshot'?'Frozen—not a live feed':(pack.retrieved ? pht(pack.retrieved,true) : 'Historical archive');
      $('lastClose').textContent=pht(pack.rows.at(-1).closeTime,true);
      $('dataPill').textContent=`${pack.rows.length} completed · ${pack.gaps} missing bars · ${pack.issues.length} quarantines`;
      updateIntegrity(pack);
      $('chartLegend').textContent=state.view==='snapshot'
        ? 'UNVERIFIED frozen preview. Original annotations are not rendered; v0.3.13 remains canonical.'
        : !state.researchEnabled
        ? 'Candles only. No BOS/CHoCH/FVG/OB qualification is calculated by this website.'
        : !state.overlayAllowed
        ? 'CANDLES ONLY · Research markers suppressed: incomplete, stale, or contradictory three-timeframe evidence.'
        : $('chart').querySelector('svg')
        ? 'SVG fallback · Candles only; research marker rendering unavailable. No Coach-certified setup.'
        : 'FSA research-only pivot/break/sweep markers and geometric FVG edges. No Coach-certified setup or trade.';
    } else { blankChart(state.view==='snapshot'?'No complete local snapshot for this pair':'No validated market candles loaded. Use Refresh market or open the September archive.');
      $('integrityState').textContent='No market evidence loaded.';$('integrityState').className='status';$('receiptDetails').textContent='—';$('source').textContent='—';$('marketTime').textContent='Not retrieved';$('lastClose').textContent='—';$('dataPill').textContent='No market data';$('candleRows').replaceChildren(); }
  }
  function updateIntegrity(pack=currentPack()) {
    if(!pack)return;
    const f=pack.receipt ? C.freshness(pack,state.tf,pack.receipt) : null;
    const retrievalLabel=f ? (f.state==='CURRENT'
      ? (f.recheckDue?'VALID AT RECEIPT · RECHECK DUE':'CURRENT AT RECEIPT')
      : f.reasons.join(' · ')) : '';
    const checkedLabel=f ? ` · last verified ${pht(f.lastVerifiedMs,true)} (${Math.floor(f.verificationAgeMs/1000)}s ago)` : '';
    $('integrityState').textContent = state.view==='snapshot' ? 'UNVERIFIED PREVIEW · '+state.report.warnings.join(' · ') : f ?
      `Structurally valid trading-price rows · ${retrievalLabel}${checkedLabel} · expected last close ${pht(f.expectedClose,true)}` :
      'HISTORICAL ARCHIVE — not current market data; source CSV digest not independently recovered.';
    $('integrityState').className='status'+(f?.state==='CURRENT'&&!f.recheckDue?' ok':'');
    $('receiptDetails').textContent=JSON.stringify({receipt:pack.receipt||null,missing:pack.missingIntervals,quarantined:pack.issues},null,2);
  }
  async function jsonGet(url,signal) {
    const startedMs=Date.now(),start=performance.now();
    const response=await fetch(url,{signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
    if(!response.ok)throw Error(`Binance HTTP ${response.status}`);
    const text=await response.text();if(text.length>5*1024*1024)throw Error('Oversized Binance response');
    return {data:JSON.parse(text),url:String(url),startedMs,finishedMs:Date.now(),durationMs:performance.now()-start,sha256:await C.hashBytes(new TextEncoder().encode(text)),text};
  }
  function populateSymbols(info) {
    if(!Array.isArray(info?.symbols))return;
    const list=$('pairlist');list.replaceChildren();
    for(const x of info.symbols.filter(C.supported).sort((a,b)=>a.symbol.localeCompare(b.symbol))) {
      const o=document.createElement('option');o.value=x.symbol;list.append(o);
    }
  }
  async function marketRefresh() {
    cancelPending();const token=state.token,controller=new AbortController();activeRequest=controller;
    const startedMs=Date.now(),start=performance.now(),timer=setTimeout(()=>controller.abort(),C.MAX_REQUEST_MS);
    state.view='market';const symbol=state.pair,tf=state.tf;
    delete state.datasets[tf];state.source='—';state.retrieved=null;view();status(`Checking Binance USD-M metadata and clock for ${symbol}…`);
    try {
      const [info,clock]=await Promise.all([jsonGet('https://fapi.binance.com/fapi/v1/exchangeInfo',controller.signal),jsonGet('https://fapi.binance.com/fapi/v1/time',controller.signal)]);
      if(token!==state.token)return;
      const instrument=C.instrument(info.data,symbol),cutoff=clock.data.serverTime;
      if(!Number.isSafeInteger(cutoff)||cutoff<=0)throw Error('Missing Binance server clock');
      populateSymbols(info.data);
      const endTime=Math.floor(cutoff/PERIOD_MS[tf])*PERIOD_MS[tf]-1;
      const url=new URL('https://fapi.binance.com/fapi/v1/klines');
      for(const [k,v] of Object.entries({symbol,interval:tf,limit:160,endTime}))url.searchParams.set(k,String(v));
      const data=await jsonGet(url.href,controller.signal);
      const endClock=await jsonGet('https://fapi.binance.com/fapi/v1/time',controller.signal);
      if(token!==state.token)return;
      if(!Number.isSafeInteger(endClock.data.serverTime)||endClock.data.serverTime<=0)throw Error('Missing final Binance clock');
      const pack=normalize(data.data,cutoff,tf,true);
      pack.source=`Binance USD-M TRADE_PRICE · ${instrument.contractType}`;pack.retrieved=Date.now();
      pack.receipt={market:C.MARKET,instrument,cutoffMs:cutoff,endTime,serverEndMs:endClock.data.serverTime,startedMs,finishedMs:pack.retrieved,durationMs:performance.now()-start,
        clientClockSkewMs:clock.data.serverTime-(clock.startedMs+clock.finishedMs)/2,
        requests:[info,clock,data,endClock].map(({text,data,...r})=>r),responseText:data.text};
      state.datasets[tf]=C.freeze(pack);state.logicalEnd=null;
      const f=C.freshness(pack,tf,pack.receipt);
      view();status(`${symbol} ${tf}: request completed. See the updating integrity status for freshness. Market candles do not qualify a new assessment.`);
    } catch(error) {
      if(token!==state.token)return;
      view();status(`Market retrieval unavailable: ${error.name==='AbortError'?'Request exceeded the bounded retrieval window':error.message}. No alternative market data was substituted.`,'error');
    } finally {clearTimeout(timer);if(activeRequest===controller)activeRequest=null;}
  }
  // One-click independent research review: three separately receipted native
  // market histories fetched within the original bounded request window.
  // Atomic commit: no partial/stale prior-pair histories or synthetic fallback.
  async function runFullResearch() {
    cancelPending();
    const token=state.token, controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),C.MAX_REQUEST_MS);
    activeRequest=controller;
    const symbol=state.pair;
    state.view='market';state.researchEnabled=true;state.datasets={};
    state.source='—';state.retrieved=null;state.logicalEnd=null;
    $('runFullResearch').disabled=true;
    view();status('Loading 4H, 1H and 15m from Binance USD-M for '+symbol+'…');
    try {
      const frames=['4h','1h','15m'];
      const fetchFrame=async tf=>{
        const startedMs=Date.now(),start=performance.now();
        const [info,clock]=await Promise.all([
          jsonGet('https://fapi.binance.com/fapi/v1/exchangeInfo',controller.signal),
          jsonGet('https://fapi.binance.com/fapi/v1/time',controller.signal)
        ]);
        if(token!==state.token)return null;
        const instrument=C.instrument(info.data,symbol),cutoff=clock.data.serverTime;
        if(!Number.isSafeInteger(cutoff)||cutoff<=0)throw Error(tf+': missing Binance server clock');
        const endTime=Math.floor(cutoff/PERIOD_MS[tf])*PERIOD_MS[tf]-1;
        const url=new URL('https://fapi.binance.com/fapi/v1/klines');
        for(const [k,v] of Object.entries({symbol,interval:tf,limit:160,endTime}))url.searchParams.set(k,String(v));
        const data=await jsonGet(url.href,controller.signal);
        const endClock=await jsonGet('https://fapi.binance.com/fapi/v1/time',controller.signal);
        if(token!==state.token)return null;
        if(!Number.isSafeInteger(endClock.data.serverTime)||endClock.data.serverTime<=0)
          throw Error(tf+': missing final Binance clock');
        const pack=normalize(data.data,cutoff,tf,true);
        pack.source='Binance USD-M TRADE_PRICE · '+instrument.contractType;
        pack.retrieved=Date.now();
        pack.receipt={market:C.MARKET,instrument,cutoffMs:cutoff,endTime,
          serverEndMs:endClock.data.serverTime,startedMs,finishedMs:pack.retrieved,
          durationMs:performance.now()-start,
          clientClockSkewMs:clock.data.serverTime-(clock.startedMs+clock.finishedMs)/2,
          requests:[info,clock,data,endClock].map(({text,data,...q})=>q),
          responseText:data.text};
        const freshness=C.freshness(pack,tf,pack.receipt,Date.now());
        if(freshness.state!=='CURRENT'||freshness.recheckDue)
          throw Error(tf+': incomplete, stale or contradictory provider receipt: '+
            (freshness.reasons?.join(', ')||'recheck due'));
        return {tf,pack,info:info.data};
      };
      const loaded=await Promise.all(frames.map(fetchFrame));
      if(token!==state.token)return;
      if(loaded.some(x=>!x))throw Error('Request was superseded');
      for(const {tf,pack} of loaded)state.datasets[tf]=C.freeze(pack);
      populateSymbols(loaded[0].info);
      const freshness=Object.fromEntries(frames.map(tf=>
        [tf,C.freshness(state.datasets[tf],tf,state.datasets[tf].receipt,Date.now())]));
      const assessment=S.assess({symbol,packs:state.datasets,freshness});
      view();
      if(assessment.classification==='WAIT'){
        status(symbol+': 4H / 1H / 15m loaded; three-frame independent research ready. WAIT means evidence-screening only, not a Coach-qualified signal.');
      }else{
        status(symbol+': independent research remains INSUFFICIENT DATA: '+
          assessment.errors.slice(0,3).join(' · ')+'. No trade signal issued.','error');
      }
    }catch(error){
      controller.abort(); // Stop other parallel timeframe requests on first failure.
      if(token!==state.token)return;
      state.datasets={};view();
      status('Three-timeframe research unavailable: '+
        (error.name==='AbortError'?'bounded request timeout':error.message)+
        '. No incomplete research or substitute candles were accepted.','error');
    }finally{
      clearTimeout(timer);
      if(activeRequest===controller)activeRequest=null;
      if(token===state.token)$('runFullResearch').disabled=false;
    }
  }
  function choosePair(value) {
    const next=String(value||'').trim().toUpperCase();
    if(!/^[A-Z0-9]{4,18}$/.test(next)){status('Invalid symbol. Use a Binance-style pair such as BTCUSDT.', 'error');return;}
    cancelPending();state.pair=next;state.datasets={};state.source='—';state.retrieved=null;state.logicalEnd=null;state.view='market';
    view();marketRefresh();
  }
  function archive() {
    const a=window.FSA_ARCHIVE;
    if(!a || a.rows.length!==720){status('Local fixture unavailable.','error');return;}
    cancelPending();state.pair='BTCUSDT';state.tf='1h';state.view='market';state.datasets={};
    state.datasets['1h']=normalize(a.rows,Date.UTC(2026,9,1), '1h',true);
    state.datasets['1h'].source='Uploaded Binance futures September 2026 archive · HISTORICAL';
    C.freeze(state.datasets['1h']);
    state.source='Uploaded Binance futures September 2026 archive · HISTORICAL';state.retrieved=null;state.logicalEnd=null;
    view();status(`Historical archive sample loaded: ${a.rows.length} structurally valid BTCUSDT 1H records, September 2026. NOT current market data.`);
  }
  async function importReport(bytes,token) {
    const record=await snapshots.add(bytes);
    // A slower file read/hash may preserve history, but cannot steal a newer pair/view.
    if(token!==importToken)return;
    cancelPending();selected.set(record.pair,record.id);state.pair=record.pair;
    state.view='snapshot';state.datasets={};state.logicalEnd=null;
    view();status('UNVERIFIED PREVIEW loaded in this tab only. Exact original bytes retained; no report was uploaded.');
  }
  function begin() {
    const params=new URLSearchParams(location.search);
    const q=(params.get('pair')||'BTCUSDT').toUpperCase();if(/^[A-Z0-9]{4,18}$/.test(q))state.pair=q;
    if(Object.hasOwn(PERIOD_MS,params.get('tf')))state.tf=params.get('tf');
    state.view='market'; // No stored report implies snapshot link cannot resolve yet.
    $('loadPair').addEventListener('click',()=>choosePair($('pair').value));
    $('pair').addEventListener('keydown',e=>{if(e.key==='Enter')choosePair(e.currentTarget.value);});
    document.querySelectorAll('[data-tf]').forEach(b=>b.addEventListener('click',()=>{cancelPending();state.tf=b.dataset.tf;state.logicalEnd=null;view();if(state.view==='market'&&!state.datasets[state.tf])marketRefresh();}));
    document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.view==='snapshot'&&!snapshots.latest(state.pair)){status('No local saved snapshot. Choose a report JSON file first.');return;}cancelPending();state.view=b.dataset.view;state.logicalEnd=null;view();}));
    $('refresh').addEventListener('click',marketRefresh);
    $('runFullResearch').addEventListener('click',runFullResearch);
    $('toggleResearch').addEventListener('click',()=>{state.researchEnabled=!state.researchEnabled;view();});
    $('archive').addEventListener('click',archive);
    function navigate(delta) {
      if(state.chart){const scale=state.chart.timeScale(),r=scale.getVisibleLogicalRange();if(r)scale.setVisibleLogicalRange({from:r.from+delta,to:r.to+delta});}
      else {const n=currentPack()?.rows.length||0,width=$('chart').clientWidth<490?34:65;state.logicalEnd=Math.max(Math.min(width,n),Math.min(n,(state.logicalEnd??n)+delta));view();}
    }
    $('older').addEventListener('click',()=>navigate(-30));
    $('newer').addEventListener('click',()=>navigate(30));
    $('snapshotHistory').addEventListener('change',e=>{const r=snapshots.get(e.target.value);if(r?.pair===state.pair){cancelPending();selected.set(state.pair,r.id);state.view='snapshot';state.logicalEnd=null;view();}});
    $('exportReport').addEventListener('click',()=>{if(!state.report)return;const url=URL.createObjectURL(new Blob([snapshots.bytes(state.report.id)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=state.pair+'_'+state.report.sha256+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    $('reportFile').addEventListener('change',async e=>{
      const file=e.currentTarget.files?.[0];if(!file)return;const token=++importToken;
      try {if(file.size>5*1024*1024)throw Error('Report exceeds 5 MiB preview limit');await importReport(new Uint8Array(await file.arrayBuffer()),token);}
      catch(err){if(token===importToken)status(`Cannot preview this report: ${err.message}`,'error');}
      finally {$('reportFile').value='';}
    });
    // Browsers can throttle timers in background tabs and BFCache restores.
    // Revalidate synchronously on foreground transitions, *before* a user
    // sees old research geometry as if it were still current. No network
    // request or source receipt is refreshed by these lifecycle events.
    const reconcileFreshness=()=>{
      if(state.overlayAllowed!==overlayEligible()){
        view({preserveChartRange:true});
        return;
      }
      updateIntegrity();
      if(state.researchEnabled)renderResearchPanel();
    };
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden)reconcileFreshness();
    });
    window.addEventListener('focus',reconcileFreshness);
    window.addEventListener('pageshow',reconcileFreshness);
    // Also detect expiration during uninterrupted visible sessions.
    setInterval(reconcileFreshness,5000);
    view();
    status('Prototype ready. Refresh market for current Binance candles, or choose the labeled September archive sample.');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',begin);else begin();
})();
