/* Pure validation and receipt rules. No network, storage, or trading. */
'use strict';
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FSA = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const PERIOD_MS = Object.freeze({'4h':14400000,'1h':3600000,'15m':900000});
  const DECISIONS = new Set(['WAIT','LONG SETUP','SHORT SETUP','NO TRADE','INSUFFICIENT DATA']);
  const MARKET = 'BINANCE_USDM_PERPETUAL_TRADE_PRICE';
  const MAX_REQUEST_MS = 12000, MAX_CLOCK_SKEW_MS = 60000, PROVIDER_LAG_MS = 10000, RECHECK_AFTER_MS = 60000;
  const clone = x => JSON.parse(JSON.stringify(x));
  function freeze(x) { if(x && typeof x === 'object' && !Object.isFrozen(x)) {Object.values(x).forEach(freeze);Object.freeze(x);}return x; }
  function integer(x,label) {
    if(typeof x !== 'number' || !Number.isSafeInteger(x) || x < 0) throw Error('Invalid integer: '+label);
    return x;
  }
  function decimal(x,label) {
    if(typeof x !== 'string' || x.length>100 || !/^\d+(?:\.\d+)?$/.test(x) || !Number.isFinite(Number(x)))
      throw Error('Invalid decimal source field: '+label);
    return Number(x);
  }
  function compare(a,b) {
    const parts=x=>x.split('.');const [ai,af='']=parts(a),[bi,bf='']=parts(b);const digits=Math.max(af.length,bf.length);
    const av=BigInt(ai+af.padEnd(digits,'0')),bv=BigInt(bi+bf.padEnd(digits,'0'));
    return av<bv?-1:av>bv?1:0;
  }
  function normalize(raw, cutoffMs, tf, requireComplete=true) {
    if(!Object.hasOwn(PERIOD_MS,tf))throw Error('Unsupported timeframe');
    integer(cutoffMs,'cutoff');if(!cutoffMs)throw Error('Invalid cutoff');
    if(!Array.isArray(raw) || raw.length>10000) throw Error('Missing or oversized candle array');
    const rows=[],issues=[],missingIntervals=[];let previous=-1,previousAccepted=-1,gaps=0,excluded=0;
    for(const native of raw) {
      if(!Array.isArray(native) || native.length!==12) throw Error('Expected exactly 12 original candle fields');
      const r=native.slice(),openTime=integer(r[0],'open time'),closeTime=integer(r[6],'close time');
      integer(r[8],'trade count');decimal(r[11],'unused');
      const vals=[1,2,3,4,5,7,9,10].map(i=>decimal(r[i],String(i)));
      const [open,high,low,close,volume,quoteVolume,takerBuyBase,takerBuyQuote]=vals;
      if(Math.min(open,high,low,close)<=0 || compare(r[2],r[1])<0 || compare(r[2],r[4])<0 || compare(r[2],r[3])<0 || compare(r[3],r[1])>0 || compare(r[3],r[4])>0)
        throw Error('Invalid positive OHLC prices or bounds');
      if(openTime%PERIOD_MS[tf]!==0 || closeTime!==openTime+PERIOD_MS[tf]-1)throw Error('Non-aligned interval');
      if(openTime<=previous)throw Error('Duplicate or unsorted candle');previous=openTime;
      if(closeTime>=cutoffMs) {if(requireComplete){excluded++;continue;}throw Error('Future or unfinished candle in report snapshot');}
      if(previousAccepted>=0 && openTime!==previousAccepted+PERIOD_MS[tf]) {
        const count=(openTime-previousAccepted)/PERIOD_MS[tf]-1;gaps+=count;
        missingIntervals.push({from_ms:previousAccepted+PERIOD_MS[tf],to_ms:openTime-1,count});
      }
      previousAccepted=openTime;
      const flag=code=>issues.push({tf,open_ms:openTime,close_ms:closeTime,code,quarantined:true});
      if(compare(r[9],r[5])>0 || compare(r[10],r[7])>0)flag('TAKER_EXCEEDS_TOTAL');
      if(volume===0 && (quoteVolume!==0 || r[8]!==0 || open!==high || open!==low || open!==close))flag('ZERO_VOLUME_CONFLICT');
      if(volume>0 && (quoteVolume===0 || r[8]===0))flag('VOLUME_TRADE_CONFLICT');
      // Binance trade-price quote/base volumes must imply a VWAP within the candle range.
      // The published source precision and floating-point multiplication require a conservative rounding allowance.
      const priceRangeConflict = (baseAmount,quoteAmount,quoteText,roundingAllowance=0) => {
        const decimals=(quoteText.split('.')[1]||'').length;
        const tolerance=Math.max(roundingAllowance,0.51*10**(-Math.min(15,decimals)),Math.abs(baseAmount*high)*1e-12);
        return quoteAmount<baseAmount*low-tolerance || quoteAmount>baseAmount*high+tolerance;
      };
      if(volume>0 && priceRangeConflict(volume,quoteVolume,r[7]))flag('QUOTE_VOLUME_PRICE_RANGE_CONFLICT');
      if(takerBuyBase>0 && priceRangeConflict(takerBuyBase,takerBuyQuote,r[10]))flag('TAKER_QUOTE_PRICE_RANGE_CONFLICT');
      if(takerBuyBase===0 && takerBuyQuote>0)flag('ZERO_TAKER_BASE_NONZERO_QUOTE');
      // The taker-sell remainder is independently constrained by the same candle price range.
      // Subtract source decimal strings exactly to avoid cancellation from floating-point arithmetic.
      if(compare(r[5],r[9])>=0 && compare(r[7],r[10])>=0) {
        const difference=(a,b)=>{
          const [ai,af='']=a.split('.'),[bi,bf='']=b.split('.');
          const n=Math.max(af.length,bf.length),scale=10n**BigInt(n);
          const d=BigInt(ai+af.padEnd(n,'0'))-BigInt(bi+bf.padEnd(n,'0'));
          return n ? String(d/scale)+'.'+String(d%scale).padStart(n,'0') : String(d);
        };
        const sellBaseText=difference(r[5],r[9]),sellQuoteText=difference(r[7],r[10]);
        const sellBase=Number(sellBaseText),sellQuote=Number(sellQuoteText);
        const unit=text=>10**(-Math.min(15,(text.split('.')[1]||'').length));
        const roundingAllowance=0.51*(unit(r[7])+unit(r[10]));
        if(sellBase===0 && sellQuote>0)flag('ZERO_TAKER_SELL_BASE_NONZERO_QUOTE');
        if(sellBase>0 && priceRangeConflict(sellBase,sellQuote,sellQuoteText,roundingAllowance))
          flag('TAKER_SELL_QUOTE_PRICE_RANGE_CONFLICT');
      }
      rows.push({time:openTime/1000,open,high,low,close,volume,quoteVolume,takerBuyBase,takerBuyQuote,closeTime,raw:r});
    }
    if(!rows.length)throw Error('No completed candles for selected timeframe');
    return {rows,gaps,missingIntervals,issues,excluded,cutoffMs};
  }
  function supported(x) {return x && typeof x.symbol==='string' && /^[A-Z0-9]{4,18}$/.test(x.symbol) && x.status==='TRADING' && x.quoteAsset==='USDT' && x.marginAsset==='USDT' && ['PERPETUAL','TRADIFI_PERPETUAL'].includes(x.contractType);}
  function instrument(info,symbol) {
    if(!info || !Array.isArray(info.symbols))throw Error('Missing exchange metadata');
    const matches=info.symbols.filter(x=>x.symbol===symbol);
    if(matches.length!==1 || !supported(matches[0]))throw Error('Exact instrument not supported by USD-M metadata');
    return clone(matches[0]);
  }
  function freshness(pack,tf,receipt,nowMs=Date.now()) {
    if(!Object.hasOwn(PERIOD_MS,tf) || !pack?.rows?.length || !receipt ||
       ['cutoffMs','endTime','serverEndMs','startedMs','finishedMs','durationMs','clientClockSkewMs'].some(k=>!Number.isFinite(receipt[k])) ||
       !Number.isFinite(nowMs))return {state:'CAUTION',reasons:['INVALID_RECEIPT']};
    const p=PERIOD_MS[tf],expectedClose=Math.floor(receipt.cutoffMs/p)*p-1;
    const actualClose=pack.rows.at(-1).closeTime,lagMs=expectedClose-actualClose,reasons=[];
    if(receipt.market!==MARKET || !supported(receipt.instrument) || receipt.endTime!==expectedClose || pack.cutoffMs!==receipt.cutoffMs)reasons.push('SOURCE_RECEIPT_MISMATCH');
    if(lagMs<0)reasons.push('AFTER_CUTOFF');
    else if(lagMs>0)reasons.push(lagMs===p && receipt.cutoffMs-expectedClose<=PROVIDER_LAG_MS?'PROVIDER_LAG':'STALE');
    if(receipt.durationMs<0 || receipt.durationMs>MAX_REQUEST_MS || receipt.finishedMs<receipt.startedMs)reasons.push('REQUEST_EXPIRED');
    if(nowMs<receipt.finishedMs)reasons.push('CLOCK_DISCREPANCY');
    const verificationAgeMs=Math.max(0,nowMs-receipt.finishedMs);
    const nextBarCloseMs=Math.floor(receipt.cutoffMs/p)*p+p-1;
    const recheckDue=verificationAgeMs>RECHECK_AFTER_MS || nowMs>nextBarCloseMs+PROVIDER_LAG_MS;
    const serverElapsed=receipt.serverEndMs-receipt.cutoffMs;
    if(serverElapsed<0 || serverElapsed>MAX_REQUEST_MS || Math.abs(serverElapsed-receipt.durationMs)>MAX_REQUEST_MS || Math.abs(receipt.clientClockSkewMs)>MAX_CLOCK_SKEW_MS || Math.abs(receipt.finishedMs-receipt.startedMs-receipt.durationMs)>1000)reasons.push('CLOCK_DISCREPANCY');
    if(Math.floor(receipt.serverEndMs/p)*p-1>expectedClose)reasons.push('INTERVAL_ROLLED_DURING_REQUEST');
    if(pack.rows.length<150)reasons.push('LIMITED_COVERAGE');
    if(pack.gaps)reasons.push('MISSING_INTERVALS');if(pack.issues.length)reasons.push('QUARANTINED_OBSERVATIONS');
    return {state:reasons.length?'CAUTION':'CURRENT',reasons,expectedClose,actualClose,lagMs,verificationAgeMs,lastVerifiedMs:receipt.finishedMs,nextBarCloseMs,recheckDue};
  }
  function inspectReport(raw,nowMs=Date.now()) {
    if(!raw || raw.schema!=='fredy.snapshot-preview.v0' || !raw.instrument || !raw.snapshot || !raw.analysis)throw Error('Unsupported report schema');
    const i=raw.instrument,pair=i.symbol;
    if(typeof pair!=='string' || !/^[A-Z0-9]{4,18}$/.test(pair) || i.venue!=='BINANCE' || i.market!=='USD-M' || !['PERPETUAL','TRADIFI_PERPETUAL'].includes(i.contract_type))throw Error('Unexpected contract identity');
    if(i.price_type!==undefined && i.price_type!=='TRADE_PRICE')throw Error('Unexpected price series');
    integer(raw.snapshot.as_of_ms,'report cutoff');integer(raw.published_at_ms,'publication');
    if(!raw.snapshot.as_of_ms || raw.snapshot.as_of_ms>nowMs || raw.published_at_ms<raw.snapshot.as_of_ms || raw.published_at_ms>nowMs)throw Error('Invalid publication time or report cutoff');
    if(!DECISIONS.has(raw.analysis.decision))throw Error('Unknown decision category');
    for(const f of ['coach_methodology','independent_analysis','risk_invalidation'])
      if(typeof raw.analysis[f]!=='string' || !raw.analysis[f].trim() || raw.analysis[f].length>20000)throw Error('Missing or oversized report field '+f);
    const frames={},warnings=['UNAUTHENTICATED_SOURCE','UNVERIFIED_METHODOLOGY','NO_TRUSTED_CONVERTER','NO_EVIDENCE_DEPENDENCY_VALIDATION','NO_GRADED_INTEGRITY_CERTIFICATION'];
    const min={'4h':16,'1h':12,'15m':12};
    for(const tf of Object.keys(PERIOD_MS)) {
      frames[tf]=normalize(raw.snapshot.timeframes?.[tf],raw.snapshot.as_of_ms,tf,false);
      if(frames[tf].rows.length<min[tf])warnings.push(tf+':INSUFFICIENT_COVERAGE');
      if(frames[tf].gaps)warnings.push(tf+':MISSING_INTERVALS');
      if(frames[tf].issues.length)warnings.push(tf+':QUARANTINED_OBSERVATIONS');
    }
    // Range contradictions taint both native observations. No invented aggregation or repair.
    for(const [parent,child] of [['4h','1h'],['1h','15m']]) {
      const parents=new Map(frames[parent].rows.map(r=>[r.raw[0],r]));
      for(const c of frames[child].rows) {
        const p=parents.get(Math.floor(c.raw[0]/PERIOD_MS[parent])*PERIOD_MS[parent]);
        if(p && (compare(c.raw[2],p.raw[2])>0 || compare(c.raw[3],p.raw[3])<0)) {
          warnings.push(parent+'/'+child+':RANGE_CONFLICT');
          for(const [tf,row] of [[parent,p],[child,c]])frames[tf].issues.push({tf,open_ms:row.raw[0],close_ms:row.closeTime,code:'CROSS_FRAME_RANGE_CONFLICT',quarantined:true});
        }
      }
    }
    return freeze({pair,raw:clone(raw),frames,warnings:[...new Set(warnings)],trusted:false});
  }
  async function hashBytes(bytes) {
    if(!globalThis.crypto?.subtle)throw Error('Secure SHA-256 unavailable; preview not imported');
    const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
  }
  // Tab-only, create-only records. No browser persistence, upload, or trusted-report path.
  class SnapshotStore {
    #records=new Map();#latest=new Map();#declared=new Map();
    async add(bytes,nowMs=Date.now()) {
      const original=new Uint8Array(bytes).slice();if(original.byteLength>5*1024*1024)throw Error('Report exceeds 5 MiB limit');
      const inspected=inspectReport(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original)),nowMs);
      const sha256=await hashBytes(original),id='sha256:'+sha256,declared=inspected.raw.report_id;
      if(declared!==undefined && (typeof declared!=='string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(declared)))throw Error('Invalid declared report ID');
      if(declared!==undefined && this.#declared.has(declared) && this.#declared.get(declared)!==id)throw Error('Report ID collision: different original bytes');
      if(this.#records.has(id))return this.#records.get(id).record;
      const record=freeze({...inspected,id,sha256,byteLength:original.byteLength});
      this.#records.set(id,{record,original});
      if(declared!==undefined)this.#declared.set(declared,id);
      const old=this.get(this.#latest.get(record.pair));
      if(!old || record.raw.snapshot.as_of_ms>=old.raw.snapshot.as_of_ms)this.#latest.set(record.pair,id);
      return record;
    }
    get(id){return this.#records.get(id)?.record || null;}
    latest(pair){return this.get(this.#latest.get(pair));}
    list(pair){return [...this.#records.values()].map(x=>x.record).filter(r=>r.pair===pair).sort((a,b)=>b.raw.snapshot.as_of_ms-a.raw.snapshot.as_of_ms || a.id.localeCompare(b.id));}
    bytes(id){const r=this.#records.get(id);if(!r)throw Error('Unknown snapshot ID');return r.original.slice();}
  }
  function priceFormat(pack,metadata) {
    const tick=metadata?.filters?.find(f=>f.filterType==='PRICE_FILTER')?.tickSize;
    const observed=Math.max(...pack.rows.flatMap(r=>r.raw.slice(1,5).map(x=>(x.split('.')[1]||'').length)));
    const valid=typeof tick==='string' && /^\d+(?:\.\d+)?$/.test(tick) && Number(tick)>0;
    const precision=Math.min(16,valid?(tick.includes('.')?tick.split('.')[1].replace(/0+$/,'').length:0):observed);
    return {precision,minMove:valid?Number(tick):10**-precision};
  }
  // Renderer-neutral contract only. No detector, converter or parity claim.
  function validateAnnotations(bundle,cutoffMs) {
    if(bundle?.schema!=='fredy.annotations.v1' || !Array.isArray(bundle.items))throw Error('Invalid annotation bundle');
    for(const a of bundle.items) {
      if(!Object.hasOwn(PERIOD_MS,a.tf) || !['pivot','break','sweep','fvg','zone','level','quarantine'].includes(a.kind))throw Error('Invalid annotation kind/timeframe');
      for(const k of ['from_ms','to_ms','known_at_ms'])integer(a[k],k);
      if(a.from_ms>a.to_ms || a.known_at_ms>=cutoffMs || a.known_at_ms<a.from_ms || !['candidate','discretionary','integrity'].includes(a.provenance))throw Error('Invalid annotation chronology/provenance');
      if(!Array.isArray(a.prices) || !a.prices.length || a.prices.some(p=>decimal(p,'annotation')<=0))throw Error('Invalid annotation price');
    }
    return freeze(clone(bundle));
  }
  return Object.freeze({PERIOD_MS,MARKET,MAX_REQUEST_MS,normalize,instrument,supported,freshness,inspectReport,hashBytes,SnapshotStore,priceFormat,validateAnnotations,freeze});
});
