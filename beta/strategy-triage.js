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
      {id:'S2',name:'Breakout / retest',relevance:'NOT ESTABLISHED',missing:['Meaningful completed structural break','Either qualified retest/reaction or Coach-documented bullish strong BOS + RSI > 60 exception','Risk feasibility; no invented bearish no-retest mirror']},
      {id:'S3',name:'Range reversal',relevance:context.label==='MIXED_OR_RANGE_UNCONFIRMED'?'POSSIBLE RANGE CONTEXT':'NOT ESTABLISHED',missing:['Confirmed horizontal range boundaries','Boundary proximity and qualifying lower-timeframe reversal','Structural invalidation and opposing-range target']},
      {id:'S4',name:'Countertrend reaction',relevance:'NOT ESTABLISHED',missing:['Intact confirmed higher-timeframe trend','Meaningful opposing supply/demand and liquidity location','Qualified reversal/rejection, short-lived target and invalidation']}
    ].map(x=>({...x,status:'DISCRETIONARY REVIEW REQUIRED',qualified:false}));
    return {
      schema:'fredy.independent-triage.v1',symbol,market:MARKET,classification:label,
      asOfByTimeframeMs:lastClosedMs,errors,comparison:cross,
      methodology:'Coach-derived sequence: 4H context → 1H location → 15m confirmation → risk. Source branches S1–S4; S5/S6 overlays, S7 personal execution distinct.',
      researchProvenance:'All pivot, gap, sweep, range, and direction screening is independent FSA geometry, NOT mechanically certified Coach criteria.',
      structure:context,location,postLocationCandidates:afterLocation,branches,
      remaining:MISSING.slice(),risk:{evaluated:false,entry:null,stop:null,targets:[],grossR:null,costsVerified:false},
      signalIssued:false,coachConfirmed:false,executedTrade:false
    };
  }
  return Object.freeze({assess,overlap,structure,MARKET});
});
