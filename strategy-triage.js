/* FSA 05B — bounded evidence triage, not Coach-issued signals or orders. */
'use strict';
(function (root,factory) {
  const R=(typeof module==='object'&&module.exports)
    ? require('./research-overlays.js') : root.FSAResearch;
  const C=(typeof module==='object'&&module.exports)
    ? require('./core.js') : root.FSA;
  const api=factory(R,C);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.FSAStrategyTriage=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(R,C){
  const FRAMES=['4h','1h','15m'];
  const PERIOD=Object.freeze({'4h':14400000,'1h':3600000,'15m':900000});
  const MARKET='BINANCE_USDM_PERPETUAL_TRADE_PRICE';
  const MISSING=Object.freeze([
    'Coach-qualified structural relevance is discretionary.',
    'Confirm actual 1H reaction location and whether price visited it after publication.',
    'Choose a source-supported 15m confirmation route after location contact.',
    'Specify actual executable entry, structural invalidation, targets, costs and aggregate risk.'
  ]);
  const numeric=(x)=>typeof x==='number'&&Number.isFinite(x);
  function overlap(parent,child,parentMs,childMs){
    const byOpen=new Map(parent.rows.map(x=>[x.time*1000,x]));
    let compared=0,full=0,conflicts=0;
    const groups=new Map();
    for(const c of child.rows){
      const ct=c.time*1000,pt=Math.floor(ct/parentMs)*parentMs,p=byOpen.get(pt);
      if(!p)continue;
      compared++;
      const tol=Math.max(1e-9,Math.abs(p.high)*1e-12);
      if(c.high>p.high+tol||c.low<p.low-tol)conflicts++;
      if(!groups.has(pt))groups.set(pt,[]);
      groups.get(pt).push(c);
    }
    for(const [pt,rows] of groups){
      if(rows.length!==parentMs/childMs||rows[0].time*1000!==pt||rows.at(-1).time*1000!==pt+parentMs-childMs)continue;
      full++;
      const p=byOpen.get(pt),tol=Math.max(1e-9,Math.abs(p.high)*1e-12);
      const h=Math.max(...rows.map(x=>x.high)),l=Math.min(...rows.map(x=>x.low));
      if(Math.abs(rows[0].open-p.open)>tol||Math.abs(rows.at(-1).close-p.close)>tol||
         Math.abs(h-p.high)>tol||Math.abs(l-p.low)>tol)conflicts++;
    }
    return {compared,full,conflicts};
  }
  function structure(markers){
    const highs=markers.pivots.filter(x=>x.kind==='swing-high'),lows=markers.pivots.filter(x=>x.kind==='swing-low');
    if(highs.length<2||lows.length<2)return {label:'UNDETERMINED',reason:'Fewer than two confirmed swing candidates on one or both sides.',highs:highs.slice(-2),lows:lows.slice(-2)};
    const [h0,h1]=highs.slice(-2),[l0,l1]=lows.slice(-2);
    const up=h1.price>h0.price&&l1.price>l0.price;
    const down=h1.price<h0.price&&l1.price<l0.price;
    return {label:up?'HEURISTIC_RISING':down?'HEURISTIC_FALLING':'MIXED_OR_RANGE_UNCONFIRMED',
      reason:'Comparison of two most recent confirmed 4H high/low candidates; significance and range validity not independently established.',
      highs:[h0,h1],lows:[l0,l1]};
  }
  // Per-level chronology, not a signal classifier. A pivot is usable only
  // AFTER its right-hand confirmation candle closes. A contact candle cannot
  // also prove the order of a break/sweep inside that same candle.
  function reviewLocation(level,rows,events){
    const eligible=rows.filter(r=>r.time*1000>level.knownAtMs);
    const contact=eligible.find(r=>r.low<=level.price&&r.high>=level.price);
    const fullWindow=!!rows.length&&rows[0].time*1000<=level.knownAtMs+1;
    const later=contact?events.filter(e=>e.time*1000>contact.closeTime&&e.knownAtMs<=rows.at(-1).closeTime):[];
    const beyond=eligible.find(r=>level.kind==='swing-high'?r.close>level.price:r.close<level.price);
    return {kind:level.kind,price:level.price,pivotTime:level.time,knownAtMs:level.knownAtMs,
      coverage:fullWindow?'FROM_LEVEL_CONFIRMATION':'PARTIAL_15M_WINDOW',
      status:contact?'CONTACT_OBSERVED_IN_WINDOW':fullWindow?'NO_CONTACT_IN_COVERED_WINDOW':'CONTACT_UNKNOWN_BEFORE_WINDOW',
      contact:contact?{openMs:contact.time*1000,closeMs:contact.closeTime}:null,
      // "First" always means first observed in the available window.
      laterEvents:later.slice(-3).map(e=>({kind:e.kind,level:e.level,openMs:e.time*1000,knownAtMs:e.knownAtMs})),
      closeBeyond:beyond?{closeMs:beyond.closeTime,close:beyond.close}:null,
      qualifiedZone:false,qualifiedConfirmation:false};
  }
  function explainSequence(packs,data,context){
    const rows=packs['15m'].rows,latest=rows.at(-1);
    const events=[...data['15m'].breaks,...data['15m'].sweeps].sort((a,b)=>a.knownAtMs-b.knownAtMs);
    const levels=data['1h'].pivots.filter(p=>p.knownAtMs<=latest.closeTime);
    const selected=[...levels.filter(p=>p.kind==='swing-high').slice(-2),...levels.filter(p=>p.kind==='swing-low').slice(-2)]
      .sort((a,b)=>b.knownAtMs-a.knownAtMs);
    const locations=selected.map(p=>reviewLocation(p,rows,events));
    const contacts=locations.filter(p=>p.contact).length;
    const sequenced=locations.filter(p=>p.laterEvents.length).length;
    const reference=context.label==='HEURISTIC_RISING'?context.lows.at(-1):context.label==='HEURISTIC_FALLING'?context.highs.at(-1):null;
    const next=sequenced?'Review the observed contact → later event sequence against the applicable source plan. Geometry alone does not qualify the zone or confirmation.':
      contacts?'A candidate level was contacted. Check subsequent completed 15m evidence and the applicable confirmation route.':
      locations.length?'No contact is established in the covered 15m window for these candidates. Inspect coverage and qualify the 1H location before interpreting confirmation.':
      'No confirmed 1H pivot candidates are available. A qualified location cannot be inferred from the candle count.';
    return {schema:'fredy.sequence-review.v1',status:'RESEARCH_REVIEW',
      latestCompleted15m:{close:latest.close,closeMs:latest.closeTime},
      locations,contactCount:contacts,sequencedLocationCount:sequenced,next,
      reference:reference?{kind:reference.kind,price:reference.price,knownAtMs:reference.knownAtMs,
        crossedByLatestClose:reference.kind==='swing-low'?latest.close<reference.price:latest.close>reference.price}:null,
      confirmation:{status:'SOURCE_PLAN_REVIEW_REQUIRED',
        routes:['Qualified location followed by the source-specific retest/reaction route.',
          'An explicitly documented no-retest route retains its own conditions; retest is not universal.',
          'The bullish strong-BOS + RSI > 60 example is conditional; no bearish RSI < 40 mirror is inferred.'],
        sameCandleOrder:'UNKNOWN: a contact and an event in one 15m candle do not establish their intrabar order.'},
      risk:{status:'NOT_EVALUATED',reason:'A structural reference is not a stop. Executable entry, invalidation, targets, sizing, costs and aggregate exposure require separate evidence.'},
      limitations:['1H pivots are FSA candidates, not authenticated Coach zones.',
        'A candle spanning a level proves geometric contact only, not reaction, retest validity or a fill.',
        'Contacts and events are limited to the fetched window; absence is not proof of no earlier event.']};
  }
  function assess(input){
    const symbol=String(input?.symbol||'').toUpperCase();
    const raw=input?.packs||{},freshness=input?.freshness||{};
    const data={},errors=[],lastClosedMs={};
    if(!/^[A-Z0-9]{4,18}$/.test(symbol))errors.push('Invalid requested instrument symbol.');
    for(const tf of FRAMES){
      const p=raw[tf],f=freshness[tf];
      const g=p&&R?.inspect?R.inspect(p,tf):null;
      data[tf]=g;
      if(!g||g.status!=='RESEARCH CANDIDATES'||p.rows.length<150){
        errors.push(tf+': require at least 150 complete, contiguous, unquarantined candles.');
        continue;
      }
      lastClosedMs[tf]=p.rows.at(-1).closeTime;
      const receipt=p.receipt;
      if(!receipt||receipt.market!==MARKET||
         !C?.supported?.(receipt.instrument)||
         receipt.instrument?.symbol!==symbol||
         receipt.cutoffMs!==p.cutoffMs||
         receipt.endTime!==Math.floor(p.cutoffMs/PERIOD[tf])*PERIOD[tf]-1)
        errors.push(tf+': Binance USD-M trade-price receipt/instrument not verified.');
      if(f?.state!=='CURRENT'||f.recheckDue!==false)
        errors.push(tf+': current, non-expired integrity receipt required.');
    }
    const cross={};
    for(const [a,b] of [['4h','1h'],['1h','15m']]){
      if(!data[a]||data[a].status!=='RESEARCH CANDIDATES'||!data[b]||data[b].status!=='RESEARCH CANDIDATES')continue;
      const k=a+'/'+b,v=overlap(raw[a],raw[b],PERIOD[a],PERIOD[b]);
      cross[k]=v;
      if(v.compared===0||v.full===0)errors.push(k+': no overlapping complete reference candles.');
      if(v.conflicts)errors.push(k+': '+v.conflicts+' native OHLC contradictions.');
    }
    const label=errors.length?'INSUFFICIENT DATA':'WAIT';
    const context=label==='WAIT'?structure(data['4h']):{label:'UNDETERMINED',reason:'Source or freshness integrity incomplete.'};
    const location=label==='WAIT'?{
      highs:data['1h'].pivots.filter(x=>x.kind==='swing-high').slice(-2),
      lows:data['1h'].pivots.filter(x=>x.kind==='swing-low').slice(-2),
      status:'UNQUALIFIED CANDIDATE LEVELS',
      warning:'Not an authenticated order block, support/resistance zone or executable entry.'
    }:{highs:[],lows:[],status:'UNDETERMINED'};
    const latestLocationKnown=Math.max(0,...[...location.highs,...location.lows].map(x=>x.knownAtMs));
    const afterLocation=label==='WAIT'?{
      breaks:data['15m'].breaks.filter(x=>x.knownAtMs>latestLocationKnown).slice(-5),
      sweeps:data['15m'].sweeps.filter(x=>x.knownAtMs>latestLocationKnown).slice(-5),
      warning:'These events followed a candidate pivot confirmation, NOT a verified visit/reaction at a Coach-qualified zone.'
    }:{breaks:[],sweeps:[],warning:'No valid temporal comparison.'};
    const branches=[
      {id:'S1',name:'Continuation pullback',relevance:context.label==='HEURISTIC_RISING'||context.label==='HEURISTIC_FALLING'?'CONTEXT CANDIDATE':'NOT ESTABLISHED',missing:['4H structural significance and directional context','1H zone relevance and actual reaction','15m completed post-zone confirmation through an admissible route','Feasible entry, stop, target and costs']},
      {id:'S2',name:'Breakout / retest',relevance:'NOT ESTABLISHED',missing:['Meaningful completed structural break','Source-specific route: qualified retest/reaction, bullish strong BOS + RSI > 60 example, or another explicitly documented no-retest path; retain that plan\'s conditions','Risk feasibility; no invented bearish RSI < 40 mirror; general upward/downward no-retest teaching does not supply that numeric threshold']},
      {id:'S3',name:'Range reversal',relevance:context.label==='MIXED_OR_RANGE_UNCONFIRMED'?'POSSIBLE RANGE CONTEXT':'NOT ESTABLISHED',missing:['Confirmed horizontal range boundaries','Boundary proximity and qualifying lower-timeframe reversal','Structural invalidation and opposing-range target']},
      {id:'S4',name:'Countertrend reaction',relevance:'NOT ESTABLISHED',missing:['Intact confirmed higher-timeframe trend','Meaningful opposing supply/demand and liquidity location','Qualified reversal/rejection, short-lived target and invalidation']}
    ].map(x=>({...x,status:'DISCRETIONARY REVIEW REQUIRED',qualified:false}));
    return {
      schema:'fredy.independent-triage.v1',symbol,market:MARKET,classification:label,
      asOfByTimeframeMs:lastClosedMs,errors,comparison:cross,
      methodology:'Project research categories S1–S4, not verified Coach-authored labels. Common documented routine: 4H context → 1H location → 15m confirmation → risk; source-specific daily, 5m and 3m variants remain distinct. Fibonacci/session overlays and personal execution remain separate.',
      researchProvenance:'All pivot, gap, sweep, range, and direction screening is independent FSA geometry, NOT mechanically certified Coach criteria.',
      structure:context,location,postLocationCandidates:afterLocation,branches,
      sequenceReview:label==='WAIT'?explainSequence(raw,data,context):{
        schema:'fredy.sequence-review.v1',status:'INSUFFICIENT DATA',locations:[],reference:null,
        next:'Refresh all three native timeframe histories and resolve the integrity errors before reviewing a sequence.'},
      remaining:MISSING.slice(),risk:{evaluated:false,entry:null,stop:null,targets:[],grossR:null,costsVerified:false},
      signalIssued:false,coachConfirmed:false,executedTrade:false
    };
  }
  return Object.freeze({assess,overlap,structure,reviewLocation,MARKET});
});
