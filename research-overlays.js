/* Research-only, point-in-time chart geometry. NOT Coach-issued signals or order instructions. */
'use strict';
(function (root, factory) {
  const api=factory();
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.FSAResearch=api;
})(typeof globalThis!=='undefined'?globalThis:this,function () {
  const PERIOD_MS=Object.freeze({'4h':14400000,'1h':3600000,'15m':900000});
  const clean=(p,tf) => {
    if(!Object.hasOwn(PERIOD_MS,tf)) return false;
    if(!p||!Array.isArray(p.rows)||p.rows.length<7||p.gaps!==0||!Array.isArray(p.issues)||p.issues.length>0||!Number.isSafeInteger(p.cutoffMs))return false;
    let prev=-1;
    for(const x of p.rows) {
      if(!x||!Number.isSafeInteger(x.closeTime)||!Number.isFinite(x.time)||x.time*1000<=prev||x.closeTime>=p.cutoffMs)return false;
      if(prev>=0 && x.time*1000-prev!==PERIOD_MS[tf])return false; // Verify continuity independently; never trust a supplied gaps=0 claim.
      if([x.open,x.high,x.low,x.close].some(v=>!Number.isFinite(v)||v<=0))return false;
      if(x.high<Math.max(x.open,x.close,x.low)||x.low>Math.min(x.open,x.close,x.high))return false;
      if(x.time*1000%PERIOD_MS[tf]!==0||x.closeTime!==x.time*1000+PERIOD_MS[tf]-1)return false;
      prev=x.time*1000;
    }
    return true;
  };
  function inspect(pack,tf){
    if(!clean(pack,tf))return {status:'INSUFFICIENT DATA',tf,reason:'Require complete, contiguous, unquarantined closed candles with a valid cutoff.',pivots:[],fvgs:[],breaks:[],sweeps:[],asOfMs:null};
    const a=pack.rows,pivots=[],fvgs=[],breaks=[],sweeps=[];
    let highPivot=null,lowPivot=null;
    const recentBreakFor=new Set();
    for(let i=0;i<a.length;i++){
      const r=a[i];
      if(i>=6){
        const k=i-3,pt=a[k],window=a.slice(k-3,k+4);
        const hi=window.every((v,j)=>j===3||pt.high>v.high);
        const lo=window.every((v,j)=>j===3||pt.low<v.low);
        if(hi){highPivot={kind:'swing-high',time:pt.time,price:pt.high,knownAtMs:r.closeTime};pivots.push(highPivot);recentBreakFor.delete('up');}
        if(lo){lowPivot={kind:'swing-low',time:pt.time,price:pt.low,knownAtMs:r.closeTime};pivots.push(lowPivot);recentBreakFor.delete('down');}
      }
      if(i>=2){
        const a0=a[i-2];
        if(a0.high<r.low)fvgs.push({kind:'bullish-gap',fromTime:a0.time,toTime:r.time,low:a0.high,high:r.low,knownAtMs:r.closeTime});
        if(a0.low>r.high)fvgs.push({kind:'bearish-gap',fromTime:a0.time,toTime:r.time,low:r.high,high:a0.low,knownAtMs:r.closeTime});
      }
      // Pivots are usable only after the third right-hand candle has CLOSED.
      if(i<1)continue;
      if(highPivot&&highPivot.knownAtMs<=r.closeTime){
        if(r.high>highPivot.price&&r.close<=highPivot.price)
          sweeps.push({kind:'upper-wick-sweep-candidate',time:r.time,level:highPivot.price,knownAtMs:r.closeTime,pivotTime:highPivot.time});
        if(r.close>highPivot.price&&a[i-1].close<=highPivot.price&&!recentBreakFor.has('up')){
          breaks.push({kind:'bullish-body-break-candidate',time:r.time,level:highPivot.price,knownAtMs:r.closeTime,pivotTime:highPivot.time});
          recentBreakFor.add('up');
        }
      }
      if(lowPivot&&lowPivot.knownAtMs<=r.closeTime){
        if(r.low<lowPivot.price&&r.close>=lowPivot.price)
          sweeps.push({kind:'lower-wick-sweep-candidate',time:r.time,level:lowPivot.price,knownAtMs:r.closeTime,pivotTime:lowPivot.time});
        if(r.close<lowPivot.price&&a[i-1].close>=lowPivot.price&&!recentBreakFor.has('down')){
          breaks.push({kind:'bearish-body-break-candidate',time:r.time,level:lowPivot.price,knownAtMs:r.closeTime,pivotTime:lowPivot.time});
          recentBreakFor.add('down');
        }
      }
    }
    return {status:'RESEARCH CANDIDATES',tf,asOfMs:a.at(-1).closeTime,reason:'FSA mechanical geometry; not Coach-confirmed structure, FVG validity or a trade.',pivots,fvgs,breaks,sweeps};
  }
  function stages(frames){
    const observations={};
    for(const tf of ['4h','1h','15m'])observations[tf]=frames?.[tf]?inspect(frames[tf],tf):{status:'MISSING',tf,reason:'This timeframe has not been independently fetched and validated.',pivots:[],fvgs:[],breaks:[],sweeps:[]};
    const complete=['4h','1h','15m'].every(tf=>observations[tf].status==='RESEARCH CANDIDATES' && frames[tf].rows.length>=150);
    return {decision:complete?'WAIT':'INSUFFICIENT DATA',reason:complete?'Geometry alone does not establish a qualified Coach confirmation, zone, entry, stop or target. Analyst review required.':'Fetch at least 150 complete clean bars per 4H, 1H and 15m timeframe before considering the sequence.',observations,
      stages:[{tf:'4h',role:'Context candidates',status:observations['4h'].status},
              {tf:'1h',role:'Location candidates (not certified OB or AOI)',status:observations['1h'].status},
              {tf:'15m',role:'Confirmation evidence candidates (not an entry)',status:observations['15m'].status},
              {tf:'risk',role:'Risk gate',status:'NOT EVALUATED'}],
      verifiedExecution:false,coachOfficial:false,entry:null,stop:null,targets:[]};
  }
  return Object.freeze({inspect,stages,PERIOD_MS});
});
