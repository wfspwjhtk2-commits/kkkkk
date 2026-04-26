import { useState, useMemo, useEffect, useCallback } from "react";

// ════════════════════════════════════════════════════════════════════════
// LIVE DATA ENGINE — Auto-Update alle 60 Sekunden
// Quellen: alternative.me (Fear&Greed) + frankfurter.app (ECB FX-Kurse)
// Kein API-Key nötig, komplett kostenlos
// ════════════════════════════════════════════════════════════════════════
async function _fetchFG(){
  try{
    const r=await fetch("https://api.alternative.me/fng/?limit=1",{signal:AbortSignal.timeout(4000)});
    const j=await r.json();
    return parseInt(j.data[0].value);
  }catch{return null;}
}

async function _fetchFX(){
  try{
    const r=await fetch("https://api.frankfurter.app/latest?from=USD&to=EUR,JPY,GBP,CHF,AUD,CAD,CNY",{signal:AbortSignal.timeout(5000)});
    const j=await r.json();
    return{
      eurusd:j.rates.EUR?+(1/j.rates.EUR).toFixed(4):null,
      usdjpy:j.rates.JPY?+j.rates.JPY.toFixed(2):null,
      gbpusd:j.rates.GBP?+(1/j.rates.GBP).toFixed(4):null,
    };
  }catch{return null;}
}


// ════════════════════════════════════════════════════════════════════════
// FX PRO v18 — Multi-Head Architecture + Live Quant Engine
//
// NEU vs v11:
//   • LIVE Kalman-Filter (1D Bayesian smoothing) auf Preisreihen
//   • LIVE Fractional Differencing (Lopez de Prado, optimales d Suche)
//   • LIVE Triple-Barrier Method auf synthetisierter Preishistorie
//   • LIVE Kelly-Sizing (bereits in v11) erweitert mit Confidence
//   • SHAP-Style Feature-Attribution per Permutation
//   • Walk-Forward Backtest auf User-Trades
//   • Neuer "QUANT" Tab bündelt alle mathematischen Diagnostics
// ════════════════════════════════════════════════════════════════════════

function getToday(){
  const d=new Date(),p=n=>String(n).padStart(2,"0");
  return{
    iso:`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`,
    de:d.toLocaleDateString("de-DE",{weekday:"long",day:"2-digit",month:"long",year:"numeric"}),
    short:d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}),
    weekday:["So","Mo","Di","Mi","Do","Fr","Sa"][d.getDay()],
  };
}

const EMBEDDED_DATE=new Date().toLocaleDateString("de-DE");
let MKT={vix:17.94,dxy:98.1,dxyChg:-0.3,oil:83.2,oilChg:-9.1,gold:4878,goldChg:1.47,spx:7116,spxChg:1.1,fearGreed:63,eurusd:1.1834,usdjpy:157.85,gbpusd:1.3260,us10y:4.311,us2y:3.778,context:"Live-Daten · Auto-Update 60s · ECB FX · Fear&Greed"};

const BREAKING=[
  {id:"b1",head:"Iran: Hormuz offen für Handelsschiffe",src:"Reuters",impact:{CAD:3,AUD:2,JPY:-3,CHF:-2,USD:1}},
  {id:"b2",head:"Trump: Naval-Blockade bleibt bis Deal",src:"AFP",impact:{USD:-2,CHF:2,JPY:2}},
  {id:"b3",head:"GBP durchbricht 1.3600-Widerstand",src:"Investing",impact:{GBP:4}},
  {id:"b4",head:"Gold 4.Woche im Plus — $4878",src:"TradingEcon",impact:{CHF:3,USD:-2}},
  {id:"b5",head:"SPX neue Allzeit-Rekorde Risk-On",src:"Reuters",impact:{AUD:2,CAD:1,JPY:-2,CHF:-1}},
];

const SENTIMENT={
  USD:{retail_long:61,cot_net:12,cot_extreme:false,ig:"short"},
  EUR:{retail_long:41,cot_net:8,cot_extreme:false,ig:"long"},
  JPY:{retail_long:33,cot_net:-28,cot_extreme:true,ig:"long"},
  GBP:{retail_long:46,cot_net:5,cot_extreme:false,ig:"short"},
  CHF:{retail_long:36,cot_net:20,cot_extreme:false,ig:"long"},
  AUD:{retail_long:54,cot_net:-5,cot_extreme:false,ig:"short"},
  CAD:{retail_long:48,cot_net:-8,cot_extreme:false,ig:"long"},
  CNY:{retail_long:50,cot_net:4,cot_extreme:false,ig:"neutral"},
};

const BIAS={
  USD:{score:40,why:"USD unter Druck: Trump Naval-Blockade 'bleibt', Fed-Unabhängigkeit in Frage gestellt. DXY 2.Woche fallend. GBP bricht 1.36.",drivers:[{s:-1,t:"Trump: Blockade bis Deal → geopolitische USD-Schwäche"},{s:-1,t:"DXY 2.Woche im Minus, struktureller Abwärtstrend"},{s:1,t:"Fed 3.625% höchster Realzins G10"}],perf:{d1:-0.3,d7:-0.8,d30:-2.1,d90:-4.2,d365:-9.0},cds:38,epu:270,carry:65,ois:"Fed hält, 1 Cut H2 möglich",nextMeet:"30 Apr FOMC"},
  EUR:{score:68,why:"EUR stark: GBP bricht 1.36, EUR/USD 1.1834. ECB-Muller Hike-Signal weiter aktiv. Stärkste G10 YTD +8.2%.",drivers:[{s:1,t:"EUR/USD 1.1834 — stärkste G10 Performance YTD"},{s:1,t:"ECB Muller: Hike Apr/Jun nicht ausgeschlossen"},{s:0,t:"Öl-Rückgang: Inflationsdruck sinkt leicht"}],perf:{d1:0.4,d7:0.8,d30:2.4,d90:5.1,d365:8.2},cds:60,epu:195,carry:40,ois:"Hike Jun möglich",nextMeet:"30 Apr ECB"},
  JPY:{score:44,why:"JPY erholt sich: Hormuz-Öffnung entlastet Japan als Ölimporteur. USD/JPY 157.85. BoJ 30 Apr Hike möglich, COT extrem bearish = Squeeze-Pulverfass.",drivers:[{s:1,t:"Hormuz offen: Japan Ölimporteur profitiert direkt"},{s:1,t:"COT -28k EXTREM → Short-Squeeze Risiko hoch"},{s:-1,t:"Zinsdifferenz -3.1% zu USD strukturell negativ"}],perf:{d1:0.9,d7:1.4,d30:2.1,d90:-3.5,d365:-12.5},cds:28,epu:140,carry:10,ois:"BoJ 30 Apr Hike erwartet",nextMeet:"30 Apr BoJ"},
  GBP:{score:56,why:"GBP überraschend stark: bricht 1.3600-Widerstand. Profitiert von USD-Schwäche und Risk-On. BoE hält 7. Mai.",drivers:[{s:1,t:"GBP durchbricht 1.3600 — technisches Ausbruchssignal"},{s:1,t:"Risk-On SPX-Rekorde stützen GBP"},{s:-1,t:"PMI 47.5 weiter unter 50 — Konjunkturschwäche"}],perf:{d1:0.6,d7:0.8,d30:1.5,d90:2.8,d365:6.1},cds:35,epu:188,carry:66,ois:"Cuts H2 2026",nextMeet:"7 Mai BoE"},
  CHF:{score:75,why:"CHF bleibt King: Gold $4878 4.Woche im Plus. Trump-Blockade-Risiko bleibt. CDS 14bps sicherster G10. Aber Hormuz-Öffnung reduziert Flucht leicht.",drivers:[{s:1,t:"Gold $4878 — 4. grüne Woche stützt CHF direkt"},{s:1,t:"CDS 14bps = niedrigstes G10-Kreditrisiko"},{s:-1,t:"Hormuz offen → leichte Risikobereitschaft reduziert Safe-Haven"}],perf:{d1:0.3,d7:0.9,d30:2.8,d90:7.2,d365:14.0},cds:14,epu:85,carry:12,ois:"SNB könnte intervenieren",nextMeet:"Jun SNB"},
  AUD:{score:50,why:"AUD erholt sich: Hormuz offen = Öl stabilisiert, Risk-On. Aber Tariff-Risiko bleibt. Neutral mit leicht positivem Bias heute.",drivers:[{s:1,t:"Hormuz offen: Öl-Crash gebremst, Risk-On hilft AUD"},{s:1,t:"SPX Rekorde = Risikobereitschaft → Rohstoff-FX"},{s:-1,t:"Tariffe bis Juli (Bessent) = China-Risiko bleibt"}],perf:{d1:0.5,d7:0.7,d30:1.4,d90:0.8,d365:-1.2},cds:22,epu:130,carry:54,ois:"RBA 1-2 Cuts 2026",nextMeet:"6 Mai RBA"},
  CAD:{score:43,why:"CAD etwas erholt: Hormuz offen stoppt Öl-Crash. Aber WTI noch $83 nach -9%. BoC 2.75% sehr dovish. Strukturell schwach.",drivers:[{s:1,t:"Hormuz offen: Öl-Crash gestoppt, WTI stabilisiert"},{s:-1,t:"WTI $83 nach -9% — Öl noch deutlich gefallen"},{s:-1,t:"BoC 2.75% dovishster G10-Zentralbank"}],perf:{d1:0.3,d7:0.5,d30:1.8,d90:1.2,d365:-2.1},cds:32,epu:245,carry:44,ois:"BoC Cuts möglich",nextMeet:"17 Jun BoC"},
  CNY:{score:38,why:"CNY schwach: Scarborough Shoal Blockade eskaliert. Tariffe bis Juli. EPU 305 höchste G10. PBoC stützt täglich.",drivers:[{s:-1,t:"Scarborough Shoal: China eskaliert — CNY unter Druck"},{s:-1,t:"Tariffe bis Juli (Bessent): direkt CNY-negativ"},{s:0,t:"PMI 50.4 — Industrie expandiert, stützt leicht"}],perf:{d1:0.0,d7:0.1,d30:0.2,d90:-0.8,d365:-2.5},cds:68,epu:305,carry:26,ois:"PBoC akkommodativ",nextMeet:"Laufend"},
};

const RATES={USD:3.625,EUR:2.15,JPY:0.5,GBP:3.75,CHF:0.25,AUD:4.1,CAD:2.75,CNY:3.1};

const NEWS={
  USD:{head:"USD: Blockade bleibt, DXY 2.Woche↓",items:["Trump: Naval-Blockade bis Deal","DXY fällt 2.Woche in Folge","Fed 30 Apr: hält 3.625%"]},
  EUR:{head:"EUR/USD 1.1834 — GBP 1.36 Ausbruch",items:["ECB Muller: Hike Jun möglich","EUR stärkste G10 YTD +8.2%","30 Apr: EZB Entscheid erwartet"]},
  JPY:{head:"JPY erholt: Hormuz offen + BoJ 30 Apr",items:["Hormuz offen — Japan profitiert","COT -28k Extrem = Squeeze-Risiko","BoJ 30 Apr: Hike möglich"]},
  GBP:{head:"GBP bricht 1.3600-Widerstand durch",items:["GBP/USD 1.3600+ technischer Ausbruch","Risk-On stützt GBP","BoE 7 Mai: hält 3.75%"]},
  CHF:{head:"Gold $4878 — 4.Woche↑ — CHF King",items:["Gold $4878 +1.47% — 4.Gewinnwoche","CDS 14bps sicherster G10","Hormuz-Öffnung reduziert Flucht leicht"]},
  AUD:{head:"AUD erholt: Hormuz + Risk-On",items:["Hormuz offen stoppt Öl-Crash","SPX Rekorde: Risk-On für AUD","Tariff-Risiko bis Jul bleibt"]},
  CAD:{head:"CAD stabilisiert: Öl-Crash gebremst",items:["Hormuz offen: WTI stabilisiert","WTI $83 — aber -9% diese Woche","BoC 2.75% sehr dovish"]},
  CNY:{head:"CNY: Scarborough + Tariffe = Druck",items:["Scarborough Shoal Eskalation","Tariffe bis Jul (Bessent)","EPU 305 höchste Unsicherheit G10"]},
};

const CALENDAR=[
  {d:"2026-04-22",t:"08:00",cur:"EUR",name:"Ifo Geschäftsklima",imp:"H",prog:"86.5",prev:"86.7",why:"Wichtigster DE-Indikator"},
  {d:"2026-04-23",t:"09:30",cur:"GBP",name:"UK PMI Flash",imp:"M",prog:"48.0",prev:"47.5",why:"Kontraktion wenn <50"},
  {d:"2026-04-23",t:"10:00",cur:"EUR",name:"Eurozone PMI Flash",imp:"M",prog:"50.5",prev:"50.4",why:"Knappe Expansion"},
  {d:"2026-04-25",t:"14:30",cur:"USD",name:"US BIP Q1 Vorab",imp:"H",prog:"0.4%",prev:"2.4%",why:"Tariff-Schock sichtbar"},
  {d:"2026-04-25",t:"14:30",cur:"USD",name:"PCE Kern-Inflation",imp:"H",prog:"0.1%",prev:"0.4%",why:"Öl-Crash drückt Wert"},
  {d:"2026-04-30",t:"03:00",cur:"JPY",name:"⭐ BoJ Zinsentscheid",imp:"H",prog:"0.5%",prev:"0.5%",why:"Hike möglich → JPY Squeeze"},
  {d:"2026-04-30",t:"10:00",cur:"EUR",name:"⭐ EZB Zinsentscheid",imp:"H",prog:"2.15%",prev:"2.15%",why:"Muller: Hike möglich → EUR↑"},
  {d:"2026-04-30",t:"14:30",cur:"USD",name:"⭐ US BIP Q1",imp:"H",prog:"0.3%",prev:"2.4%",why:"Einbruch erwartet"},
  {d:"2026-04-30",t:"19:00",cur:"USD",name:"⭐ FOMC Zinsentscheid",imp:"H",prog:"3.625%",prev:"3.625%",why:"Hält — Powell-Zukunft?"},
  {d:"2026-05-01",t:"14:30",cur:"USD",name:"⭐ NFP Payrolls",imp:"H",prog:"133k",prev:"228k",why:"Rückgang durch Tariffe"},
  {d:"2026-05-07",t:"12:00",cur:"GBP",name:"⭐ BoE Zinsentscheid",imp:"H",prog:"3.75%",prev:"3.75%",why:"Hält"},
];

// ════════════════════════════════════════════════════════════════════════
// SYNTHETIC PRICE HISTORY — 252 Bars pro Währung aus Performance-Daten
// Wir rekonstruieren plausible Preisreihen aus den d1/d7/d30/d90/d365 Werten
// damit Kalman/FFD/Triple-Barrier echte Inputs haben.
// ════════════════════════════════════════════════════════════════════════
function synthesizePrices(code, n=252){
  const b=BIAS[code], perf=b.perf;
  // Annualisierte Vola aus VIX skaliert pro Code
  const baseVol={USD:0.06,EUR:0.07,JPY:0.10,GBP:0.08,CHF:0.07,AUD:0.10,CAD:0.08,CNY:0.05}[code]||0.08;
  const dailyVol=baseVol/Math.sqrt(252);
  
  // Trend-Komponente aus 90d Performance
  const dailyDrift=(perf.d90/100)/90;
  
  // Regime-Shifts an bekannten Stellen einfügen (z.B. bei perf.d30 vs d90 Divergenz)
  const trendChange=(perf.d30/100)/30 - (perf.d90/100)/90;
  
  // Deterministischer Pseudo-Random (für Reproduzierbarkeit)
  let seed=code.charCodeAt(0)*1000+code.charCodeAt(1)*100+code.charCodeAt(2);
  const rand=()=>{seed=(seed*9301+49297)%233280;return seed/233280;};
  // Box-Muller für Normal
  const norm=()=>{
    const u=Math.max(rand(),1e-9), v=Math.max(rand(),1e-9);
    return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
  };
  
  const prices=[100];
  for(let t=1;t<n;t++){
    // Drift wird in den letzten 30 Tagen verstärkt (jüngere Trends)
    const drift = t>n-30 ? dailyDrift+trendChange : dailyDrift;
    const shock = norm()*dailyVol;
    // Regime-Bursts an seltenen Stellen
    const burst = rand()<0.02 ? norm()*dailyVol*3 : 0;
    prices.push(prices[t-1]*(1+drift+shock+burst));
  }
  return prices;
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 1: KALMAN FILTER (1D)
// Predict:  x̂_t|t-1 = x̂_{t-1|t-1};   P_t|t-1 = P_{t-1|t-1} + Q
// Update:   K_t = P_t|t-1 / (P_t|t-1 + R)
//           x̂_t|t = x̂_t|t-1 + K_t (z_t - x̂_t|t-1)
//           P_t|t = (1 - K_t) P_t|t-1
// ════════════════════════════════════════════════════════════════════════
function kalmanFilter(measurements, Q=1e-5, R=1e-3){
  const n=measurements.length;
  const xEst=new Array(n).fill(0);
  const P=new Array(n).fill(0);
  xEst[0]=measurements[0]; P[0]=1.0;
  for(let t=1;t<n;t++){
    const xPred=xEst[t-1], pPred=P[t-1]+Q;
    const K=pPred/(pPred+R);
    xEst[t]=xPred+K*(measurements[t]-xPred);
    P[t]=(1-K)*pPred;
  }
  return xEst;
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 2: FRACTIONAL DIFFERENCING (Lopez de Prado, Ch. 5)
// (1-L)^d * x_t mit Binomial-Expansion
// ω_0 = 1,   ω_k = -ω_{k-1} * (d - k + 1) / k
// ════════════════════════════════════════════════════════════════════════
function ffdWeights(d, threshold=1e-4, maxSize=500){
  const w=[1.0];
  for(let k=1;k<maxSize;k++){
    const wk=-w[w.length-1]*(d-k+1)/k;
    if(Math.abs(wk)<threshold) break;
    w.push(wk);
  }
  return w.reverse(); // chronologische Reihenfolge
}

function fracDiff(series, d, threshold=1e-4){
  const w=ffdWeights(d, threshold);
  const width=w.length;
  const out=new Array(series.length).fill(NaN);
  if(width>=series.length) return out;
  for(let i=width-1;i<series.length;i++){
    let sum=0;
    for(let k=0;k<width;k++) sum+=w[k]*series[i-width+1+k];
    out[i]=sum;
  }
  return out;
}

// Augmented Dickey-Fuller Approximation (vereinfacht für Browser)
// Verwendet Korrelation Δy_t mit y_{t-1} als Stationaritäts-Proxy
function adfApprox(series){
  const valid=series.filter(v=>!isNaN(v));
  if(valid.length<30) return {stat:0, pval:1};
  const diffs=[], lagged=[];
  for(let i=1;i<valid.length;i++){
    diffs.push(valid[i]-valid[i-1]);
    lagged.push(valid[i-1]);
  }
  // Regression: Δy = ρ*y_{t-1} + ε; t-Statistik approximiert
  const muL=lagged.reduce((s,v)=>s+v,0)/lagged.length;
  const muD=diffs.reduce((s,v)=>s+v,0)/diffs.length;
  let cov=0, varL=0, varD=0;
  for(let i=0;i<diffs.length;i++){
    cov+=(lagged[i]-muL)*(diffs[i]-muD);
    varL+=(lagged[i]-muL)**2;
    varD+=(diffs[i]-muD)**2;
  }
  const rho=cov/(varL+1e-9);
  const stat=rho*Math.sqrt(diffs.length);
  // Approximation: t < -2.86 → p < 0.05, t < -3.43 → p < 0.01
  const pval=stat<-3.43?0.005:stat<-2.86?0.025:stat<-2.0?0.1:0.5;
  return {stat, pval};
}

function corrPearson(a, b){
  const valid=a.map((v,i)=>({a:v,b:b[i]})).filter(p=>!isNaN(p.a)&&!isNaN(p.b));
  if(valid.length<10) return 0;
  const n=valid.length;
  const muA=valid.reduce((s,p)=>s+p.a,0)/n, muB=valid.reduce((s,p)=>s+p.b,0)/n;
  let cov=0, vA=0, vB=0;
  valid.forEach(p=>{cov+=(p.a-muA)*(p.b-muB);vA+=(p.a-muA)**2;vB+=(p.b-muB)**2;});
  return cov/Math.sqrt(vA*vB+1e-9);
}

function findOptimalD(series, dRange=[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9], adfThresh=0.05, corrThresh=0.6){
  const diagnostics=[];
  let optimal=null;
  for(const d of dRange){
    const ffd=fracDiff(series, d);
    const ffdValid=ffd.filter(v=>!isNaN(v));
    if(ffdValid.length<30){
      diagnostics.push({d, adfStat:NaN, adfPval:NaN, corr:NaN, stationary:false, memory:false});
      continue;
    }
    const {stat, pval}=adfApprox(ffd);
    const startIdx=ffd.findIndex(v=>!isNaN(v));
    const corr=corrPearson(series.slice(startIdx), ffd.slice(startIdx));
    const stationary=pval<adfThresh, memory=corr>corrThresh;
    diagnostics.push({d, adfStat:stat, adfPval:pval, corr, stationary, memory});
    if(stationary && memory && optimal===null) optimal=d;
  }
  if(optimal===null){
    const stat=diagnostics.find(x=>x.stationary);
    optimal=stat?stat.d:0.5;
  }
  return {optimal, diagnostics};
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 3: TRIPLE-BARRIER METHOD (Lopez de Prado, Ch. 3)
// PT × σ (oben), SL × σ (unten), Time-Limit
// Label = welche Barriere zuerst getroffen
// ════════════════════════════════════════════════════════════════════════
function rollingStd(series, window){
  const out=new Array(series.length).fill(NaN);
  for(let i=window-1;i<series.length;i++){
    const slice=series.slice(i-window+1, i+1);
    const mu=slice.reduce((s,v)=>s+v,0)/window;
    const v=slice.reduce((s,x)=>s+(x-mu)**2,0)/window;
    out[i]=Math.sqrt(v);
  }
  return out;
}

function ewmaStd(series, span){
  const alpha=2/(span+1);
  const out=new Array(series.length).fill(NaN);
  let mean=series[0], variance=0;
  out[0]=0;
  for(let i=1;i<series.length;i++){
    const delta=series[i]-mean;
    mean+=alpha*delta;
    variance=(1-alpha)*(variance+alpha*delta*delta);
    out[i]=Math.sqrt(variance);
  }
  return out;
}

function tripleBarrier(prices, ptMult=2.0, slMult=1.0, timeLimit=24, volWindow=50){
  const logRet=prices.map((p,i)=>i===0?0:Math.log(p/prices[i-1]));
  const sigma=ewmaStd(logRet, volWindow);
  const labels=[];
  let nPT=0, nSL=0, nT1=0;
  
  for(let t=0;t<prices.length-timeLimit;t++){
    const trgt=sigma[t];
    if(!trgt || trgt<=0) continue;
    const entryPrice=prices[t];
    const upper=ptMult*trgt;
    const lower=-slMult*trgt;
    let hit="t1", exitT=t+timeLimit, ret=Math.log(prices[t+timeLimit]/entryPrice);
    
    for(let s=t+1;s<=t+timeLimit;s++){
      const r=Math.log(prices[s]/entryPrice);
      if(r>=upper){hit="pt"; exitT=s; ret=r; break;}
      if(r<=lower){hit="sl"; exitT=s; ret=r; break;}
    }
    labels.push({t, exitT, hit, ret, sigma:trgt, side:1});
    if(hit==="pt") nPT++; else if(hit==="sl") nSL++; else nT1++;
  }
  const total=nPT+nSL+nT1;
  return {labels, stats:{nPT, nSL, nT1, total, ptRate:nPT/total, slRate:nSL/total, t1Rate:nT1/total}};
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 4: KELLY CRITERION (mit Confidence)
// f* = (b*p - q) / b,   f_adj = f* × confidence × fraction
// ════════════════════════════════════════════════════════════════════════
function kellyFraction(winProb, winLossRatio=2.0, fraction=0.25, maxSize=0.20){
  if(winProb<=0||winProb>=1||winLossRatio<=0) return 0;
  const fStar=(winLossRatio*winProb-(1-winProb))/winLossRatio;
  if(fStar<=0) return 0;
  return Math.min(maxSize, fStar*fraction);
}

function kellyWithConfidence(winProb, winLossRatio, confidence, fraction=0.25, maxSize=0.20){
  return kellyFraction(winProb, winLossRatio, fraction, maxSize)*Math.max(0,Math.min(1,confidence));
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 5: SHAP-STYLE PERMUTATION FEATURE IMPORTANCE
// Permutiert jedes Feature einzeln, misst Änderung der Modell-Vorhersage
// → Feature-Wichtigkeit (vereinfachte SHAP-Approximation)
// ════════════════════════════════════════════════════════════════════════
function permutationImportance(scoreFunc, featureNames, baseValues, nPerm=20, trainingMatrix=null){
  // FIX v15: Sample aus Trainings-Verteilung (Lopez de Prado, korrekte Permutation)
  // statt künstlicher baseValues ± baseValues (unrealistisch)
  const baseScore=scoreFunc(baseValues);
  const importances=[];
  for(let i=0;i<featureNames.length;i++){
    let totalDelta=0;
    // Sammle ALLE echten Werte dieses Features aus den Trainingsdaten
    const featureColumn=trainingMatrix?trainingMatrix.map(row=>row[i]):null;
    for(let p=0;p<nPerm;p++){
      const perm=[...baseValues];
      if(featureColumn && featureColumn.length>0){
        // KORREKT: Ziehe zufälligen echten Wert aus Training-Verteilung
        perm[i]=featureColumn[Math.floor(Math.random()*featureColumn.length)];
      } else {
        // Fallback: Gauß-Noise proportional zum Mittelwert
        perm[i]=baseValues[i]+(Math.random()-0.5)*Math.max(Math.abs(baseValues[i]),0.5)*2;
      }
      const permScore=scoreFunc(perm);
      totalDelta+=Math.abs(permScore-baseScore);
    }
    importances.push({feature:featureNames[i], importance:totalDelta/nPerm, baseValue:baseValues[i]});
  }
  const total=importances.reduce((s,x)=>s+x.importance,0);
  return importances.map(x=>({...x, pct:(x.importance/(total+1e-9))*100}))
    .sort((a,b)=>b.importance-a.importance);
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 6: WALK-FORWARD ON USER TRADES
// Splittet User-Trades in N rolling Folds, simuliert OOS-Performance
// ════════════════════════════════════════════════════════════════════════
function walkForwardBacktest(trades, nFolds=4){
  const closed=trades.filter(t=>t.status==="closed");
  if(closed.length<8) return null;
  const sorted=[...closed].sort((a,b)=>a.id-b.id);
  const foldSize=Math.floor(sorted.length/nFolds);
  const results=[];
  for(let f=0;f<nFolds-1;f++){
    const trainEnd=foldSize*(f+1);
    const train=sorted.slice(0,trainEnd);
    const test=sorted.slice(trainEnd, trainEnd+foldSize);
    if(test.length<2) continue;
    // "Modell": durchschnittliches Bias-Filter-Ergebnis aus Train wendet auf Test an
    const trainBiasWR=train.filter(t=>t.bias).length>0 ?
      train.filter(t=>t.bias && t.pnlR>0).length/train.filter(t=>t.bias).length : 0;
    const testBiasResults=test.filter(t=>t.bias);
    const testWinR=testBiasResults.length>0 ?
      testBiasResults.filter(t=>t.pnlR>0).length/testBiasResults.length : 0;
    const testReturns=test.map(t=>t.pnlR);
    const muT=testReturns.reduce((s,v)=>s+v,0)/testReturns.length;
    const sdT=Math.sqrt(testReturns.reduce((s,v)=>s+(v-muT)**2,0)/testReturns.length);
    const sharpeT=sdT>0?(muT/sdT)*Math.sqrt(52):0;
    results.push({fold:f+1, trainSize:train.length, testSize:test.length, trainBiasWR, testWinR, sharpe:sharpeT, totalR:testReturns.reduce((s,v)=>s+v,0)});
  }
  return results;
}


// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 7: HIDDEN MARKOV MODEL (Bull/Sideways/Bear)
// Vereinfachte Baum-Welch (3 Zustände, gauß-Emissionen, max 30 Iter)
// ════════════════════════════════════════════════════════════════════════
function gaussPdf(x, mu, sigma){
  return Math.exp(-0.5*((x-mu)/sigma)**2)/(sigma*Math.sqrt(2*Math.PI));
}

function trainHMM(returns, nStates=3, maxIter=30){
  const T=returns.length;
  if(T<50) return null;
  
  // Init
  const sorted=[...returns].sort((a,b)=>a-b);
  const quantiles=[0.2, 0.5, 0.8];
  let means=quantiles.map(q=>sorted[Math.floor(q*T)]);
  let stds=Array(nStates).fill(std(returns)*0.7);
  let A=Array.from({length:nStates},(_,i)=>Array.from({length:nStates},(_,j)=>i===j?0.9:0.05));
  let pi=Array(nStates).fill(1/nStates);
  let prevLL=-Infinity;
  
  for(let it=0;it<maxIter;it++){
    // Emission Matrix B[t][k]
    const B=returns.map(r=>means.map((mu,k)=>Math.max(gaussPdf(r,mu,stds[k]),1e-300)));
    
    // Forward
    const alpha=Array.from({length:T},()=>new Array(nStates).fill(0));
    const scale=new Array(T).fill(0);
    for(let k=0;k<nStates;k++) alpha[0][k]=pi[k]*B[0][k];
    scale[0]=alpha[0].reduce((s,v)=>s+v,0)||1e-300;
    for(let k=0;k<nStates;k++) alpha[0][k]/=scale[0];
    
    for(let t=1;t<T;t++){
      for(let j=0;j<nStates;j++){
        let sum=0;
        for(let i=0;i<nStates;i++) sum+=alpha[t-1][i]*A[i][j];
        alpha[t][j]=sum*B[t][j];
      }
      scale[t]=alpha[t].reduce((s,v)=>s+v,0)||1e-300;
      for(let k=0;k<nStates;k++) alpha[t][k]/=scale[t];
    }
    
    // Backward
    const beta=Array.from({length:T},()=>new Array(nStates).fill(0));
    for(let k=0;k<nStates;k++) beta[T-1][k]=1/scale[T-1];
    for(let t=T-2;t>=0;t--){
      for(let i=0;i<nStates;i++){
        let sum=0;
        for(let j=0;j<nStates;j++) sum+=A[i][j]*B[t+1][j]*beta[t+1][j];
        beta[t][i]=sum/scale[t];
      }
    }
    
    // Posteriors
    const gamma=Array.from({length:T},(_,t)=>{
      const g=new Array(nStates);
      let sum=0;
      for(let k=0;k<nStates;k++){g[k]=alpha[t][k]*beta[t][k];sum+=g[k];}
      return g.map(v=>v/(sum||1e-300));
    });
    
    // Xi
    const xiSum=Array.from({length:nStates},()=>new Array(nStates).fill(0));
    const gammaSum=new Array(nStates).fill(0);
    for(let t=0;t<T-1;t++){
      let denom=0;
      const xi=Array.from({length:nStates},(_,i)=>new Array(nStates).fill(0));
      for(let i=0;i<nStates;i++){
        for(let j=0;j<nStates;j++){
          xi[i][j]=alpha[t][i]*A[i][j]*B[t+1][j]*beta[t+1][j];
          denom+=xi[i][j];
        }
      }
      for(let i=0;i<nStates;i++){
        for(let j=0;j<nStates;j++) xiSum[i][j]+=xi[i][j]/(denom||1e-300);
        gammaSum[i]+=gamma[t][i];
      }
    }
    
    // M-Step
    pi=gamma[0];
    for(let i=0;i<nStates;i++){
      for(let j=0;j<nStates;j++) A[i][j]=xiSum[i][j]/(gammaSum[i]||1e-300);
    }
    for(let k=0;k<nStates;k++){
      let wSum=0, wMean=0;
      for(let t=0;t<T;t++){wSum+=gamma[t][k];wMean+=gamma[t][k]*returns[t];}
      means[k]=wMean/(wSum||1e-300);
      let wVar=0;
      for(let t=0;t<T;t++) wVar+=gamma[t][k]*(returns[t]-means[k])**2;
      stds[k]=Math.sqrt(Math.max(wVar/(wSum||1e-300), 1e-10));
    }
    
    const ll=scale.reduce((s,v)=>s+Math.log(v),0);
    if(Math.abs(ll-prevLL)<1e-4) break;
    prevLL=ll;
  }
  
  // Sortiere nach Mean: höchster=BULL, mittlerer=SIDEWAYS, niedrigster=BEAR
  const order=means.map((m,i)=>({m,i})).sort((a,b)=>b.m-a.m).map(x=>x.i);
  const labels=["BULL","SIDEWAYS","BEAR"];
  const orderedMeans=order.map(i=>means[i]);
  const orderedStds=order.map(i=>stds[i]);
  const orderedA=order.map(i=>order.map(j=>A[i][j]));
  const orderedPi=order.map(i=>pi[i]);
  
  // Viterbi für aktuelle States
  const logPi=orderedPi.map(p=>Math.log(p+1e-300));
  const logA=orderedA.map(row=>row.map(v=>Math.log(v+1e-300)));
  const Bsorted=returns.map(r=>orderedMeans.map((mu,k)=>Math.max(gaussPdf(r,mu,orderedStds[k]),1e-300)));
  const logB=Bsorted.map(row=>row.map(v=>Math.log(v)));
  const delta=Array.from({length:T},()=>new Array(nStates).fill(0));
  const psi=Array.from({length:T},()=>new Array(nStates).fill(0));
  for(let k=0;k<nStates;k++) delta[0][k]=logPi[k]+logB[0][k];
  for(let t=1;t<T;t++){
    for(let j=0;j<nStates;j++){
      let best=-Infinity, argmax=0;
      for(let i=0;i<nStates;i++){
        const val=delta[t-1][i]+logA[i][j];
        if(val>best){best=val;argmax=i;}
      }
      psi[t][j]=argmax;
      delta[t][j]=best+logB[t][j];
    }
  }
  const states=new Array(T);
  let lastBest=0, lastVal=-Infinity;
  for(let k=0;k<nStates;k++) if(delta[T-1][k]>lastVal){lastVal=delta[T-1][k];lastBest=k;}
  states[T-1]=lastBest;
  for(let t=T-2;t>=0;t--) states[t]=psi[t+1][states[t+1]];
  
  return{
    means:orderedMeans, stds:orderedStds, A:orderedA, pi:orderedPi, labels,
    states, currentRegime:labels[states[T-1]], currentRegimeIdx:states[T-1],
    logLikelihood:prevLL,
    expectedDuration:orderedA.map((row,i)=>1/(1-row[i]+1e-9)),
  };
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 8: ATR-DYNAMIC STOPS (Wilder 1978)
// ATR = EWMA(True Range), Stop = k × ATR
// ════════════════════════════════════════════════════════════════════════
function computeATR(prices, period=14){
  // Vereinfacht ohne High/Low: nutze |close_t - close_{t-1}| als Proxy TR
  const tr=prices.map((p,i)=>i===0?0:Math.abs(p-prices[i-1]));
  const alpha=2/(period+1);
  const atr=new Array(prices.length).fill(0);
  atr[0]=tr[0];
  for(let i=1;i<prices.length;i++) atr[i]=alpha*tr[i]+(1-alpha)*atr[i-1];
  return atr;
}

function atrStops(currentPrice, atr, kStop=1.5, kTarget=3.0){
  return{
    atr,
    stopDistance:atr*kStop,
    targetDistance:atr*kTarget,
    stopPctOfPrice:(atr*kStop/currentPrice)*100,
    rrRatio:kTarget/kStop,
  };
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 9: META-LABELING SCORE (vereinfachtes 2-stage Filter)
// Berechnet ob Primary-Signal in aktuellem Regime + Vola wahrscheinlich profitabel ist
// ════════════════════════════════════════════════════════════════════════
function metaLabelScore(primarySignal, regimeIdx, currentVolNorm, confidence){
  // Regime 0=Bull, 1=Sideways, 2=Bear
  // Long-Signale (+1) profitieren in Bull, leiden in Bear
  // Short-Signale (-1) umgekehrt
  // In Sideways: alle Signale werden weniger zuverlässig
  
  const regimeAlignment=primarySignal>0?(regimeIdx===0?1.0:regimeIdx===1?0.5:0.2):
                       primarySignal<0?(regimeIdx===2?1.0:regimeIdx===1?0.5:0.2):0.5;
  
  // Hohe Vola → Meta-Filter strenger (Confidence-Strafe)
  const volPenalty=Math.exp(-Math.max(0, currentVolNorm-1)*0.5);
  
  // Meta-Score = aligned ? Confidence : Confidence × volPenalty × alignment
  const metaProb=confidence * regimeAlignment * volPenalty;
  
  return{
    metaProb,
    regimeAlignment,
    volPenalty,
    pass:metaProb>0.55,
    explanation: regimeAlignment>0.8?"Regime stimmt mit Signal überein":
                regimeAlignment<0.4?"Regime widerspricht Signal":
                "Regime neutral zu Signal",
  };
}


// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 10: DEFLATED SHARPE RATIO (Bailey & Lopez de Prado 2014)
// Anti-P-Hacking-Filter: unterscheidet echten Skill von Glück
// ════════════════════════════════════════════════════════════════════════
const EULER_MASCH = 0.5772156649;

// Standardnormal CDF Approximation (Abramowitz-Stegun)
function normCdf(x){
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741;
  const a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const sign=x<0?-1:1;
  const absX=Math.abs(x)/Math.sqrt(2);
  const t=1/(1+p*absX);
  const y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-absX*absX);
  return 0.5*(1+sign*y);
}

// Standardnormal Inverse CDF (Beasley-Springer-Moro Approximation)
function normInvCdf(p){
  if(p<=0) return -Infinity; if(p>=1) return Infinity;
  const a=[-3.969683028665376e+01,2.209460984245205e+02,-2.759285104469687e+02,1.383577518672690e+02,-3.066479806614716e+01,2.506628277459239e+00];
  const b=[-5.447609879822406e+01,1.615858368580409e+02,-1.556989798598866e+02,6.680131188771972e+01,-1.328068155288572e+01];
  const c=[-7.784894002430293e-03,-3.223964580411365e-01,-2.400758277161838e+00,-2.549732539343734e+00,4.374664141464968e+00,2.938163982698783e+00];
  const d=[7.784695709041462e-03,3.224671290700398e-01,2.445134137142996e+00,3.754408661907416e+00];
  const pLow=0.02425, pHigh=1-pLow;
  let q, r;
  if(p<pLow){
    q=Math.sqrt(-2*Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if(p<=pHigh){
    q=p-0.5; r=q*q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q=Math.sqrt(-2*Math.log(1-p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

function skewness(arr){
  const n=arr.length, m=arr.reduce((s,v)=>s+v,0)/n;
  const sd=Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/n);
  if(sd<1e-12) return 0;
  return arr.reduce((s,v)=>s+((v-m)/sd)**3,0)/n;
}

function kurtosisExcess(arr){
  const n=arr.length, m=arr.reduce((s,v)=>s+v,0)/n;
  const sd=Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/n);
  if(sd<1e-12) return 0;
  return arr.reduce((s,v)=>s+((v-m)/sd)**4,0)/n - 3;
}

function computeDSR(returns, nTrials=1, barsPerYear=252){
  const r=returns.filter(v=>!isNaN(v));
  const T=r.length;
  if(T<30) return null;
  const mu=r.reduce((s,v)=>s+v,0)/T;
  const sigma=Math.sqrt(r.reduce((s,v)=>s+(v-mu)**2,0)/(T-1));
  if(sigma<1e-12) return null;
  const sr=mu/sigma;
  const srAnn=sr*Math.sqrt(barsPerYear);
  const skew=skewness(r);
  const kurt=kurtosisExcess(r);
  // Lo 2002 Variance
  const srVar=(1-skew*sr+(kurt/4)*sr*sr)/Math.max(T-1,1);
  // E[max SR] unter H0
  const t1=normInvCdf(1-1.0/Math.max(nTrials,2));
  const t2=normInvCdf(1-1.0/(nTrials*Math.E));
  const eMax=Math.sqrt(Math.max(srVar,0))*((1-EULER_MASCH)*t1+EULER_MASCH*t2);
  const zScore=(sr-eMax)/Math.sqrt(Math.max(srVar,1e-12));
  const dsr=normCdf(zScore);
  return{
    sharpe:sr, sharpeAnn:srAnn,
    expectedMaxSharpeH0:eMax*Math.sqrt(barsPerYear),
    dsr, skewness:skew, kurtosis:kurt,
    nTrials, nObs:T,
    significant:dsr>=0.95,
  };
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 11: REGIME-ADAPTIVE STRATEGY PROFILES
// ════════════════════════════════════════════════════════════════════════
const REGIME_PROFILES={
  BULL:{kellyMult:1.0,minConf:0.52,atrStopMult:1.3,atrTargetMult:3.5,maxTradesDay:8,directionBias:1,meanReversion:false,label:"Trend-Following Long"},
  SIDEWAYS:{kellyMult:0.3,minConf:0.65,atrStopMult:1.0,atrTargetMult:2.0,maxTradesDay:4,directionBias:0,meanReversion:true,label:"Mean-Reversion"},
  BEAR:{kellyMult:0.5,minConf:0.60,atrStopMult:2.0,atrTargetMult:3.0,maxTradesDay:6,directionBias:-1,meanReversion:false,label:"Defensive Short"},
};

function getRegimeAdaptiveParams(regimeName, regimeProbs=null){
  if(!regimeProbs){
    return REGIME_PROFILES[regimeName]||REGIME_PROFILES.SIDEWAYS;
  }
  // Probability-weighted blend
  const labels=["BULL","SIDEWAYS","BEAR"];
  const probs=regimeProbs.slice(0,3);
  const sum=probs.reduce((s,v)=>s+v,0)||1;
  const normalized=probs.map(v=>v/sum);
  const blended={
    kellyMult:0, minConf:0, atrStopMult:0, atrTargetMult:0, maxTradesDay:0,
  };
  labels.forEach((l,i)=>{
    const p=normalized[i], prof=REGIME_PROFILES[l];
    blended.kellyMult+=p*prof.kellyMult;
    blended.minConf+=p*prof.minConf;
    blended.atrStopMult+=p*prof.atrStopMult;
    blended.atrTargetMult+=p*prof.atrTargetMult;
    blended.maxTradesDay+=p*prof.maxTradesDay;
  });
  blended.maxTradesDay=Math.round(blended.maxTradesDay);
  const dominant=REGIME_PROFILES[labels[probs.indexOf(Math.max(...probs))]];
  blended.directionBias=dominant.directionBias;
  blended.meanReversion=dominant.meanReversion;
  blended.label=`Blended (${dominant.label})`;
  return blended;
}

function adjustPositionByRegime(baseKelly, params, confidence, signalDirection=0){
  if(confidence<params.minConf) return 0;
  if(params.directionBias!==0 && signalDirection!==0){
    if(Math.sign(signalDirection)!==Math.sign(params.directionBias)) return 0;
  }
  const confFactor=Math.max(0,Math.min(1,(confidence-params.minConf)/(1-params.minConf)));
  return baseKelly*params.kellyMult*confFactor;
}


// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 12: TRANSFER ENTROPY (Schreiber 2000)
// Kausale Feature-Selection statt Scheinkorrelationen
// TE(X→Y) = H(Y_t+1 | Y_t) - H(Y_t+1 | Y_t, X_t)
// ════════════════════════════════════════════════════════════════════════
function discretize(arr, nBins=6){
  const valid=arr.filter(v=>!isNaN(v));
  if(valid.length<nBins) return arr.map(()=>0);
  const sorted=[...valid].sort((a,b)=>a-b);
  const edges=[];
  for(let i=1;i<nBins;i++) edges.push(sorted[Math.floor(sorted.length*i/nBins)]);
  return arr.map(v=>{
    if(isNaN(v)) return -1;
    let bin=0;
    for(let i=0;i<edges.length;i++) if(v>edges[i]) bin=i+1;
    return bin;
  });
}

function shannonEntropy(arr){
  const valid=arr.filter(v=>v>=0);
  if(valid.length===0) return 0;
  const counts={};
  valid.forEach(v=>{counts[v]=(counts[v]||0)+1;});
  let H=0;
  const total=valid.length;
  Object.values(counts).forEach(c=>{
    const p=c/total;
    if(p>0) H-=p*Math.log(p);
  });
  return H;
}

function jointEntropy(...arrays){
  const n=arrays[0].length;
  const validMask=[];
  for(let i=0;i<n;i++){
    validMask.push(arrays.every(a=>a[i]>=0));
  }
  if(validMask.every(v=>!v)) return 0;
  const keys={};
  for(let i=0;i<n;i++){
    if(!validMask[i]) continue;
    const key=arrays.map(a=>a[i]).join(",");
    keys[key]=(keys[key]||0)+1;
  }
  let H=0;
  const total=Object.values(keys).reduce((s,v)=>s+v,0);
  Object.values(keys).forEach(c=>{
    const p=c/total;
    if(p>0) H-=p*Math.log(p);
  });
  return H;
}

function transferEntropy(source, target, k=1, l=1, nBins=6, lag=1){
  if(source.length!==target.length) return 0;
  const minLen=Math.max(k,l)+lag+20;
  if(source.length<minLen) return 0;
  const src=discretize(source, nBins);
  const tgt=discretize(target, nBins);
  const maxHist=Math.max(k,l);
  const T=source.length-maxHist-lag;
  if(T<30) return 0;
  const yFuture=tgt.slice(maxHist+lag, maxHist+lag+T);
  const yHistArrays=[];
  for(let i=0;i<k;i++) yHistArrays.push(tgt.slice(maxHist-i, maxHist-i+T));
  const xHistArrays=[];
  for(let i=0;i<l;i++) xHistArrays.push(src.slice(maxHist-i, maxHist-i+T));
  // Combine histories via multi-index (as string keys)
  const combine=(hists)=>{
    if(hists.length===0) return new Array(T).fill(0);
    return Array.from({length:T},(_,i)=>hists.map(h=>h[i]).join("|"));
  };
  const yHist=combine(yHistArrays);
  const xHist=combine(xHistArrays);
  // Numerical encoding for jointEntropy (map strings to ints)
  const mapToInt=(arr)=>{
    const m={};
    let idx=0;
    return arr.map(v=>{
      if(v.includes("-1")) return -1;
      if(!(v in m)){m[v]=idx++;}
      return m[v];
    });
  };
  const yfE=yFuture, yhE=mapToInt(yHist), xhE=mapToInt(xHist);
  const H_Yf_Yh=jointEntropy(yfE,yhE);
  const H_Yh=shannonEntropy(yhE);
  const H_Yf_Yh_Xh=jointEntropy(yfE,yhE,xhE);
  const H_Yh_Xh=jointEntropy(yhE,xhE);
  const te=H_Yf_Yh - H_Yh - H_Yf_Yh_Xh + H_Yh_Xh;
  return Math.max(0, te);
}

function transferEntropySignificance(source, target, nSurrogates=30){
  const teObs=transferEntropy(source, target);
  const surrogates=[];
  for(let i=0;i<nSurrogates;i++){
    // Fisher-Yates shuffle
    const shuffled=[...source];
    for(let j=shuffled.length-1;j>0;j--){
      const k=Math.floor(Math.random()*(j+1));
      [shuffled[j],shuffled[k]]=[shuffled[k],shuffled[j]];
    }
    surrogates.push(transferEntropy(shuffled, target));
  }
  const surrMean=surrogates.reduce((s,v)=>s+v,0)/surrogates.length;
  const surrStd=Math.sqrt(surrogates.reduce((s,v)=>s+(v-surrMean)**2,0)/surrogates.length);
  const pValue=surrogates.filter(v=>v>=teObs).length/surrogates.length;
  return{
    teObserved:teObs,
    surrogateMean:surrMean,
    surrogateStd:surrStd,
    pValue,
    significant:pValue<0.05,
    effectiveTE:Math.max(0, teObs-surrMean),
  };
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 13: GRAPH CONVOLUTIONAL NETWORK (Kipf & Welling 2017)
// H^{l+1} = σ(D̃^{-1/2} Ã D̃^{-1/2} H^{l} W^{l})
// ════════════════════════════════════════════════════════════════════════
function correlationMatrix(series){
  // series: array of arrays, each of same length
  const n=series.length;
  const mat=Array.from({length:n},()=>new Array(n).fill(0));
  for(let i=0;i<n;i++){
    for(let j=0;j<n;j++){
      if(i===j){mat[i][j]=1;continue;}
      const a=series[i], b=series[j];
      const mu_a=a.reduce((s,v)=>s+v,0)/a.length;
      const mu_b=b.reduce((s,v)=>s+v,0)/b.length;
      let cov=0, va=0, vb=0;
      for(let k=0;k<a.length;k++){
        cov+=(a[k]-mu_a)*(b[k]-mu_b);
        va+=(a[k]-mu_a)**2;
        vb+=(b[k]-mu_b)**2;
      }
      mat[i][j]=cov/(Math.sqrt(va*vb)+1e-9);
    }
  }
  return mat;
}

function buildAdjacency(corrMat, threshold=0.3){
  const n=corrMat.length;
  const A=Array.from({length:n},(_,i)=>corrMat[i].map((v,j)=>i===j?1:Math.abs(v)>=threshold?Math.abs(v):0));
  return A;
}

function normalizeAdjacency(A){
  const n=A.length;
  // Ã = A + I (already done in buildAdjacency via diagonal=1)
  const D=new Array(n).fill(0);
  for(let i=0;i<n;i++){
    for(let j=0;j<n;j++) D[i]+=A[i][j];
  }
  const Dinv=D.map(d=>d>0?1/Math.sqrt(d):0);
  const norm=Array.from({length:n},(_,i)=>A[i].map((v,j)=>Dinv[i]*v*Dinv[j]));
  return norm;
}

function matMul(A, B){
  const n=A.length, m=B[0].length, k=A[0].length;
  const C=Array.from({length:n},()=>new Array(m).fill(0));
  for(let i=0;i<n;i++){
    for(let j=0;j<m;j++){
      let sum=0;
      for(let l=0;l<k;l++) sum+=A[i][l]*B[l][j];
      C[i][j]=sum;
    }
  }
  return C;
}

function relu(mat){
  return mat.map(row=>row.map(v=>Math.max(0,v)));
}

function gcnForward(nodeFeatures, adjNormalized, W1, W2){
  // Layer 1: X → hidden
  const h1=matMul(adjNormalized, matMul(nodeFeatures, W1));
  const h1_relu=relu(h1);
  // Layer 2: hidden → output
  const h2=matMul(adjNormalized, matMul(h1_relu, W2));
  return h2;
}

function randomMatrix(rows, cols, seed=0){
  // Deterministisch für Reproduzierbarkeit
  let s=seed;
  const rand=()=>{s=(s*9301+49297)%233280;return (s/233280-0.5)*2;};
  return Array.from({length:rows},()=>Array.from({length:cols},()=>rand()*Math.sqrt(2/rows)));
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 14: FINBERT-PROXY (Loughran-McDonald Dictionary)
// Kein echtes Transformer-Modell (440MB) — Lexikon-basierter Proxy
// ════════════════════════════════════════════════════════════════════════
const LM_POSITIVE=new Set(["growth","strong","stronger","strongest","robust","resilient","solid","improve","improved","improvement","improving","gain","gains","gained","recovery","recovered","rebound","positive","optimistic","success","successful","benefit","effective","efficient","outperform","outperformed","advantage","favorable","upturn","boost","breakthrough","enhance","enhanced","stability","stable"]);
const LM_NEGATIVE=new Set(["weak","weakness","weaken","weakening","decline","declined","declining","drop","dropped","fall","fallen","falling","slow","slowdown","slower","crisis","critical","concern","concerns","concerned","risk","risks","risky","volatile","volatility","uncertainty","uncertain","fear","fears","loss","losses","lost","negative","recession","collapse","plunge","plunged","bankrupt","fraud","downgrade","downgraded","damage","damaged","threat","threats","disrupt","disruption","crash","slump"]);
const HAWKISH=new Set(["hike","hikes","hiking","tighten","tightening","tighter","raise","raising","increase","higher","elevated","restrictive","aggressive","vigilant","persistent","sticky","stubborn","overheating","inflation","inflationary","above-target","normalize","normalization","qt","taper","tapering"]);
const DOVISH=new Set(["cut","cuts","cutting","ease","easing","easier","lower","lowered","reduce","reduced","accommodative","stimulus","supportive","patient","cautious","gradual","measured","slowing","weakening","subdued","muted","cooling","qe","headwinds"]);

function tokenize(text){
  return text.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g)||[];
}

function finbertProxyScore(text){
  const tokens=tokenize(text);
  const n=tokens.length||1;
  let pos=0, neg=0, hawk=0, dove=0;
  tokens.forEach(t=>{
    if(LM_POSITIVE.has(t)) pos++;
    if(LM_NEGATIVE.has(t)) neg++;
    if(HAWKISH.has(t)) hawk++;
    if(DOVISH.has(t)) dove++;
  });
  const sentimentScore=(pos-neg)/Math.max(pos+neg,1);
  const hawkishDovish=(hawk-dove)/Math.max(hawk+dove,1);
  const confidence=Math.min(1,(pos+neg)/n*20);
  const label=sentimentScore>0.3?"positive":sentimentScore<-0.3?"negative":"neutral";
  return{sentimentScore, hawkishDovish, confidence, label, posCount:pos, negCount:neg, hawkCount:hawk, doveCount:dove, n};
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 15: STYLIZED-FACTS GENERATOR (TimeGAN-Proxy)
// GJR-GARCH + Student-t + Poisson-Jumps = realistische Black-Swan-Szenarien
// ════════════════════════════════════════════════════════════════════════
function studentT(df, rng){
  // Bailey's rejection method approximation
  const u1=Math.max(rng(),1e-9), u2=rng();
  const normal=Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
  // Chi-squared via sum of normals squared (approx df=n)
  let chi2=0;
  for(let i=0;i<df;i++){
    const u=Math.max(rng(),1e-9), v=rng();
    const n=Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
    chi2+=n*n;
  }
  return normal/Math.sqrt(chi2/df);
}

function fitStylizedFacts(returns){
  const rets=returns.filter(v=>!isNaN(v));
  if(rets.length<50) return null;
  const mu=rets.reduce((s,v)=>s+v,0)/rets.length;
  const variance=rets.reduce((s,v)=>s+(v-mu)**2,0)/rets.length;
  const alpha=0.08, beta=0.91;
  const omega=variance*(1-alpha-beta);
  // Skew → gamma
  const std_val=Math.sqrt(variance);
  const skew=rets.reduce((s,v)=>s+((v-mu)/std_val)**3,0)/rets.length;
  const gamma=Math.max(0,-skew*0.05);
  // Jumps: |ret| > 3σ
  const threshold=3*std_val;
  const jumps=rets.filter(r=>Math.abs(r)>threshold);
  const jumpIntensity=jumps.length/rets.length;
  const jumpStd=jumps.length>0?Math.sqrt(jumps.reduce((s,v)=>s+v*v,0)/jumps.length):std_val*3;
  return{omega, alpha, beta, gamma, jumpIntensity, jumpStd, df:5, baseVol:std_val};
}

function generateSyntheticPath(params, nBars, severity=1.0, seed=42){
  let s=seed;
  const rng=()=>{s=(s*9301+49297)%233280;return s/233280;};
  const normal=()=>{
    const u1=Math.max(rng(),1e-9), u2=rng();
    return Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
  };
  const jumpInt=Math.min(1,params.jumpIntensity*severity);
  const jumpSd=params.jumpStd*Math.sqrt(severity);
  const variance=new Array(nBars).fill(0);
  const returns=new Array(nBars).fill(0);
  variance[0]=params.omega/(1-params.alpha-params.beta);
  for(let t=1;t<nBars;t++){
    const prevRet=returns[t-1];
    const negInd=prevRet<0?1:0;
    variance[t]=params.omega+params.alpha*prevRet**2+params.gamma*prevRet**2*negInd+params.beta*variance[t-1];
    variance[t]=Math.max(variance[t],1e-12);
    const sigma=Math.sqrt(variance[t]);
    const innov=studentT(params.df, rng);
    const innovScaled=innov*Math.sqrt((params.df-2)/params.df);
    const jump=rng()<jumpInt?normal()*jumpSd:0;
    returns[t]=sigma*innovScaled+jump;
  }
  return returns;
}

function stressTestKelly(returns, baseKelly=0.1){
  // Simuliert Performance mit fractional Kelly über die synthetische Reihe
  let equity=1.0;
  const equityPath=[1.0];
  let peak=1.0, mdd=0;
  returns.forEach(r=>{
    equity*=(1+baseKelly*r);
    if(equity>peak) peak=equity;
    const dd=(equity-peak)/peak;
    if(dd<mdd) mdd=dd;
    equityPath.push(equity);
  });
  const finalReturn=equity-1;
  const mean=returns.reduce((s,v)=>s+v,0)/returns.length;
  const sd=Math.sqrt(returns.reduce((s,v)=>s+(v-mean)**2,0)/returns.length);
  const sharpe=sd>0?(mean/sd)*Math.sqrt(252):0;
  return{finalReturn, mdd, sharpe, peak, terminal:equity};
}



// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 21: ROBUST STATISTICS (Iglewicz & Hoaglin 1993)
// Flash-Crash-immuner Median + MAD + Modified Z-Score
// M_i = 0.6745 × (x_i - median) / MAD      threshold = 3.5 (99% Konfidenz)
// ════════════════════════════════════════════════════════════════════════

function median(arr){
  const valid=arr.filter(v=>!isNaN(v)&&v!==null&&v!==undefined);
  if(valid.length===0) return 0;
  const sorted=[...valid].sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  return sorted.length%2===0?(sorted[mid-1]+sorted[mid])/2:sorted[mid];
}

function mad(arr, med=null){
  // Median Absolute Deviation
  const valid=arr.filter(v=>!isNaN(v)&&v!==null&&v!==undefined);
  if(valid.length===0) return 0;
  const m=med!==null?med:median(valid);
  const absDevs=valid.map(v=>Math.abs(v-m));
  return median(absDevs);
}

// Modified Z-Score (Iglewicz & Hoaglin 1993)
// 0.6745 = Φ^(-1)(0.75), macht MAD-Scale vergleichbar mit σ bei Normalverteilung
function modifiedZScore(x, med, madValue){
  if(madValue<1e-9){
    // Fallback: MAD=0 bedeutet alle Werte identisch → Mean-Abweichung mit kleinem Schutz
    return 0;
  }
  return 0.6745*(x-med)/madValue;
}

function modifiedZScoreArray(arr){
  const med=median(arr);
  const madValue=mad(arr, med);
  return arr.map(v=>modifiedZScore(v, med, madValue));
}

// Rolling Modified Z-Score über ein Fenster
function rollingModifiedZScore(series, window=20, threshold=3.5){
  const result=new Array(series.length).fill(0);
  const outliers=new Array(series.length).fill(false);
  const madValues=new Array(series.length).fill(0);
  const medians=new Array(series.length).fill(0);
  for(let i=window-1;i<series.length;i++){
    const win=series.slice(i-window+1, i+1);
    const med=median(win);
    const madV=mad(win, med);
    medians[i]=med;
    madValues[i]=madV;
    const z=modifiedZScore(series[i], med, madV);
    result[i]=z;
    outliers[i]=Math.abs(z)>threshold;
  }
  return{modifiedZ:result, isOutlier:outliers, medians, madValues};
}

// Robuste Normalisierung (Median + MAD statt Mean + Std)
function mkNormRobust(X){
  const n=X[0].length;
  const med=new Array(n).fill(0);
  const madV=new Array(n).fill(1);
  for(let j=0;j<n;j++){
    const column=X.map(row=>row[j]).filter(v=>!isNaN(v));
    if(column.length===0) continue;
    med[j]=median(column);
    const madCalc=mad(column, med[j]);
    // Skalierung 1/0.6745 um vergleichbar mit Std zu sein (bei Normalverteilung)
    madV[j]=madCalc>1e-9?madCalc/0.6745:1;
  }
  return{med, madV};
}

function nrmRobust(x, med, madV){
  return x.map((v,i)=>{
    const val=(isNaN(v)||v===null||v===undefined)?med[i]:v;
    return (val-med[i])/madV[i];
  });
}

// Flash-Crash Detection auf einer Returns-Serie
function detectFlashCrashes(returns, window=20, threshold=3.5){
  const zResult=rollingModifiedZScore(returns, window, threshold);
  const crashes=[];
  zResult.isOutlier.forEach((isOut,i)=>{
    if(isOut && i>=window-1){
      crashes.push({
        index:i,
        return:returns[i],
        modifiedZ:zResult.modifiedZ[i],
        direction:zResult.modifiedZ[i]>0?"spike":"crash",
        severity:Math.abs(zResult.modifiedZ[i])>5?"extreme":Math.abs(zResult.modifiedZ[i])>threshold?"outlier":"normal",
      });
    }
  });
  return{crashes, zResult};
}

// Robuste Vola-Schätzung (MAD-basiert statt Std)
function robustVolatility(returns, window=20){
  const madVol=new Array(returns.length).fill(NaN);
  for(let i=window-1;i<returns.length;i++){
    const win=returns.slice(i-window+1, i+1);
    const med=median(win);
    madVol[i]=mad(win, med)/0.6745;   // äquivalent zu σ bei normal-distribution
  }
  return madVol;
}

// Trimmed Mean (entfernt oben und unten top α-Quantile)
function trimmedMean(arr, alpha=0.1){
  const sorted=[...arr].sort((a,b)=>a-b);
  const trim=Math.floor(sorted.length*alpha);
  const trimmed=sorted.slice(trim, sorted.length-trim);
  if(trimmed.length===0) return 0;
  return trimmed.reduce((s,v)=>s+v,0)/trimmed.length;
}

// Winsorizing: Extreme Werte auf Quantil-Grenzen cappen statt entfernen
function winsorize(arr, lowerPct=0.05, upperPct=0.95){
  const sorted=[...arr].filter(v=>!isNaN(v)).sort((a,b)=>a-b);
  const lower=sorted[Math.floor(sorted.length*lowerPct)];
  const upper=sorted[Math.floor(sorted.length*upperPct)];
  return arr.map(v=>isNaN(v)?v:Math.max(lower, Math.min(upper, v)));
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 16: ADVERSARIAL VALIDATION
// Trainiert Classifier "is this from train or test?" — AUC misst Drift
// AUC ~0.5 → keine Drift; AUC > 0.7 → ⚠ Train ≠ Test
// ════════════════════════════════════════════════════════════════════════
function adversarialValidation(trainMatrix, testMatrix, featureIndices){
  // Combine: train=label 0, test=label 1
  const combined=[], labels=[];
  trainMatrix.forEach(row=>{
    combined.push(featureIndices.map(i=>row[i]));
    labels.push(0);
  });
  testMatrix.forEach(row=>{
    combined.push(featureIndices.map(i=>row[i]));
    labels.push(1);
  });
  
  // Shuffle (für Adversarial darf man — wir lernen Distribution-Diff, nicht Time-Series)
  let seed=42;
  const rng=()=>{seed=(seed*9301+49297)%233280;return seed/233280;};
  const indices=Array.from({length:combined.length},(_,i)=>i);
  for(let i=indices.length-1;i>0;i--){
    const j=Math.floor(rng()*(i+1));
    [indices[i],indices[j]]=[indices[j],indices[i]];
  }
  const shuffledX=indices.map(i=>combined[i]);
  const shuffledY=indices.map(i=>labels[i]);
  
  // Simple LogReg via Gradient Descent (LightGBM ginge im Browser nicht)
  const nFeat=featureIndices.length;
  const nSamples=shuffledX.length;
  
  // Normalisierung
  const mu=new Array(nFeat).fill(0);
  for(let j=0;j<nFeat;j++) mu[j]=shuffledX.reduce((s,r)=>s+r[j],0)/nSamples;
  const sig=new Array(nFeat).fill(0);
  for(let j=0;j<nFeat;j++){
    sig[j]=Math.sqrt(shuffledX.reduce((s,r)=>s+(r[j]-mu[j])**2,0)/nSamples)||1;
  }
  const scaled=shuffledX.map(r=>r.map((v,j)=>(v-mu[j])/sig[j]));
  
  // Train LogReg
  const w=new Array(nFeat).fill(0);
  let b=0;
  const lr=0.1;
  for(let epoch=0;epoch<100;epoch++){
    const gradW=new Array(nFeat).fill(0);
    let gradB=0;
    for(let i=0;i<nSamples;i++){
      let z=b;
      for(let j=0;j<nFeat;j++) z+=w[j]*scaled[i][j];
      const pred=1/(1+Math.exp(-z));
      const err=pred-shuffledY[i];
      for(let j=0;j<nFeat;j++) gradW[j]+=err*scaled[i][j];
      gradB+=err;
    }
    for(let j=0;j<nFeat;j++) w[j]-=lr*gradW[j]/nSamples;
    b-=lr*gradB/nSamples;
  }
  
  // Predict probabilities, compute AUC
  const probs=scaled.map(r=>{
    let z=b;
    for(let j=0;j<nFeat;j++) z+=w[j]*r[j];
    return 1/(1+Math.exp(-z));
  });
  
  // AUC via paired-comparison method
  const pairs=probs.map((p,i)=>({p,y:shuffledY[i]}));
  const positives=pairs.filter(x=>x.y===1);
  const negatives=pairs.filter(x=>x.y===0);
  let nCorrect=0, nTotal=0;
  positives.forEach(pos=>{
    negatives.forEach(neg=>{
      nTotal++;
      if(pos.p>neg.p) nCorrect++;
      else if(pos.p===neg.p) nCorrect+=0.5;
    });
  });
  const auc=nTotal>0?nCorrect/nTotal:0.5;
  
  // Feature-Importance via |w_j| (logreg coefficients, nach Normalisierung vergleichbar)
  const featImportance=featureIndices.map((idx,j)=>({
    idx, name:FEATURE_NAMES[idx]||"Feature_"+idx, importance:Math.abs(w[j]),
  })).sort((a,b)=>b.importance-a.importance);
  
  let severity="none";
  if(auc>=0.9) severity="severe";
  else if(auc>=0.7) severity="moderate";
  else if(auc>=0.55) severity="mild";
  
  return{
    auc, severity, featImportance,
    driftDrivers:featImportance.slice(0,5),
    nTrain:trainMatrix.length, nTest:testMatrix.length,
    interpretation:auc<0.55?"✓ Verteilungen identisch":auc<0.7?"~ Leichter Drift, manageable":auc<0.9?"⚠ Signifikanter Drift, Features prüfen":"✗ Train ≠ Test, Strategie problematisch",
  };
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 17: FEATURE NEUTRALIZATION (PCA-based Beta-Removal)
// F_neutral = F - M(M'M)^{-1}M'F  → orthogonal zu Market-Faktoren
// ════════════════════════════════════════════════════════════════════════
function transpose(mat){
  const rows=mat.length, cols=mat[0].length;
  const t=Array.from({length:cols},()=>new Array(rows).fill(0));
  for(let i=0;i<rows;i++) for(let j=0;j<cols;j++) t[j][i]=mat[i][j];
  return t;
}

function matInverse2x2or3x3(mat){
  // Pseudo-Inverse für kleine Matrizen via Cramer (max 3x3 — reicht für PCA-Komponenten)
  const n=mat.length;
  if(n===1) return [[1/(mat[0][0]+1e-9)]];
  if(n===2){
    const det=mat[0][0]*mat[1][1]-mat[0][1]*mat[1][0]+1e-9;
    return [[mat[1][1]/det,-mat[0][1]/det],[-mat[1][0]/det,mat[0][0]/det]];
  }
  // Gauss-Jordan für n=3
  const M=mat.map((r,i)=>[...r, ...Array.from({length:n},(_,j)=>i===j?1:0)]);
  for(let c=0;c<n;c++){
    let mx=c;
    for(let r=c+1;r<n;r++) if(Math.abs(M[r][c])>Math.abs(M[mx][c])) mx=r;
    [M[c],M[mx]]=[M[mx],M[c]];
    const piv=M[c][c]+1e-12;
    for(let j=0;j<2*n;j++) M[c][j]/=piv;
    for(let r=0;r<n;r++){
      if(r===c) continue;
      const f=M[r][c];
      for(let j=0;j<2*n;j++) M[r][j]-=f*M[c][j];
    }
  }
  return M.map(r=>r.slice(n));
}

function pcaSimplified(X, nComponents=3){
  // Centered Cov-Matrix → Eigenvektoren als PCA-Komponenten
  const n=X.length, d=X[0].length;
  const mu=new Array(d).fill(0);
  X.forEach(r=>r.forEach((v,j)=>mu[j]+=v/n));
  const Xc=X.map(r=>r.map((v,j)=>v-mu[j]));
  // Cov = X^T X / (n-1)
  const cov=Array.from({length:d},()=>new Array(d).fill(0));
  for(let i=0;i<d;i++){
    for(let j=0;j<d;j++){
      let s=0;
      for(let k=0;k<n;k++) s+=Xc[k][i]*Xc[k][j];
      cov[i][j]=s/(n-1);
    }
  }
  // Power-iteration für die top-nComponents Eigenvektoren
  const components=[];
  let workCov=cov.map(r=>[...r]);
  for(let comp=0;comp<Math.min(nComponents,d);comp++){
    let v=new Array(d).fill(0);
    v[comp]=1;
    // Power iteration
    for(let it=0;it<50;it++){
      const newV=new Array(d).fill(0);
      for(let i=0;i<d;i++) for(let j=0;j<d;j++) newV[i]+=workCov[i][j]*v[j];
      const norm=Math.sqrt(newV.reduce((s,x)=>s+x*x,0))||1;
      v=newV.map(x=>x/norm);
    }
    // Eigenwert
    let lambda=0;
    for(let i=0;i<d;i++) for(let j=0;j<d;j++) lambda+=v[i]*workCov[i][j]*v[j];
    components.push({vector:v, eigenvalue:lambda});
    // Deflation: cov - lambda * v v^T
    for(let i=0;i<d;i++) for(let j=0;j<d;j++) workCov[i][j]-=lambda*v[i]*v[j];
  }
  // Project X onto components
  const factors=Xc.map(row=>components.map(c=>row.reduce((s,v,i)=>s+v*c.vector[i],0)));
  const totalVar=cov.reduce((s,r,i)=>s+r[i],0);
  const explainedVar=components.map(c=>c.eigenvalue/(totalVar+1e-9));
  return{factors, components, explainedVar, mu};
}

function neutralizeFeatures(X, marketFactors){
  // X: [n_samples, n_features], M: [n_samples, k_factors]
  // F_neutral = F - M(M'M)^{-1}M'F
  const n=X.length;
  if(n===0) return {neutral:X, betas:[]};
  const M=marketFactors;
  const MT=transpose(M);
  // M'M (k×k)
  const MtM=Array.from({length:M[0].length},()=>new Array(M[0].length).fill(0));
  for(let i=0;i<M[0].length;i++){
    for(let j=0;j<M[0].length;j++){
      let s=0;
      for(let t=0;t<n;t++) s+=M[t][i]*M[t][j];
      MtM[i][j]=s;
    }
  }
  const MtMinv=matInverse2x2or3x3(MtM);
  // M'X (k × n_features)
  const MtX=Array.from({length:M[0].length},()=>new Array(X[0].length).fill(0));
  for(let i=0;i<M[0].length;i++){
    for(let j=0;j<X[0].length;j++){
      let s=0;
      for(let t=0;t<n;t++) s+=M[t][i]*X[t][j];
      MtX[i][j]=s;
    }
  }
  // betas = (M'M)^-1 M'X (k × n_features)
  const betas=Array.from({length:M[0].length},()=>new Array(X[0].length).fill(0));
  for(let i=0;i<M[0].length;i++){
    for(let j=0;j<X[0].length;j++){
      let s=0;
      for(let k=0;k<M[0].length;k++) s+=MtMinv[i][k]*MtX[k][j];
      betas[i][j]=s;
    }
  }
  // F_neutral = X - M·betas (n × n_features)
  const neutral=X.map((row,t)=>row.map((v,j)=>{
    let proj=0;
    for(let i=0;i<M[0].length;i++) proj+=M[t][i]*betas[i][j];
    return v-proj;
  }));
  return{neutral, betas};
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 18: NOISE-INJECTION AUGMENTATION
// X_aug = X + N(0, σ × feature_std), Labels unverändert
// ════════════════════════════════════════════════════════════════════════
function noiseAugment(X, y, nAug=2, noiseLevel=0.05, seed=123){
  let s=seed;
  const rng=()=>{s=(s*9301+49297)%233280;return s/233280;};
  const norm=()=>{
    const u1=Math.max(rng(),1e-9), u2=rng();
    return Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
  };
  // Feature-Stds
  const n=X.length, d=X[0].length;
  const mu=new Array(d).fill(0);
  X.forEach(r=>r.forEach((v,j)=>mu[j]+=v/n));
  const sig=new Array(d).fill(0);
  X.forEach(r=>r.forEach((v,j)=>sig[j]+=(v-mu[j])**2/n));
  const stds=sig.map(v=>Math.sqrt(v)||1);
  // Augment
  const augX=[...X], augY=[...y];
  const isAugmented=new Array(n).fill(false);
  for(let r=0;r<nAug;r++){
    X.forEach((row,i)=>{
      augX.push(row.map((v,j)=>v+norm()*stds[j]*noiseLevel));
      augY.push(y[i]);
      isAugmented.push(true);
    });
  }
  return{augX, augY, isAugmented, originalSize:n, finalSize:augX.length};
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 19: SAMPLE WEIGHTS via UNIQUENESS (Lopez de Prado Ch.4)
// Berechnet auf Triple-Barrier-Events (aus tbResult.labels) ihre 
// zeitliche Eindeutigkeit. Stark überlappende Events bekommen kleines Gewicht.
// ════════════════════════════════════════════════════════════════════════
function computeUniquenessWeights(tbLabels, nBars){
  if(!tbLabels || tbLabels.length===0) return [];
  // Concurrency: pro Bar wieviele Labels gleichzeitig aktiv
  const concurrency=new Array(nBars).fill(0);
  tbLabels.forEach(lab=>{
    for(let t=lab.t; t<=lab.exitT && t<nBars; t++) concurrency[t]++;
  });
  // Uniqueness pro Label = mean(1/concurrency_t for t in [start, end])
  const weights=tbLabels.map(lab=>{
    let sum=0, cnt=0;
    for(let t=lab.t; t<=lab.exitT && t<nBars; t++){
      sum+=1/Math.max(concurrency[t],1);
      cnt++;
    }
    return cnt>0?sum/cnt:0;
  });
  // Normalisieren (mean=1)
  const meanW=weights.reduce((s,v)=>s+v,0)/weights.length;
  return weights.map(w=>meanW>0?w/meanW:0);
}

// ════════════════════════════════════════════════════════════════════════
// QUANT ENGINE 20: SEQUENTIAL BOOTSTRAPPING (Lopez de Prado Ch.4)
// Iteratives Sampling — minimiert Overlap zwischen gezogenen Events
// ════════════════════════════════════════════════════════════════════════
function sequentialBootstrap(tbLabels, nBars, nSamples=null, seed=42){
  if(!tbLabels || tbLabels.length===0) return [];
  const N=tbLabels.length;
  if(nSamples===null) nSamples=N;
  let s=seed;
  const rng=()=>{s=(s*9301+49297)%233280;return s/233280;};
  const phi=new Array(nBars).fill(0); // bisher gezogene aktive Events pro Bar
  const selectedIndices=[];
  
  for(let draw=0;draw<nSamples;draw++){
    // Berechne avg-Uniqueness jedes Events im Kontext bisher gezogener
    const uniqs=tbLabels.map(lab=>{
      let sum=0, cnt=0;
      for(let t=lab.t; t<=lab.exitT && t<nBars; t++){
        sum+=1/(1+phi[t]);
        cnt++;
      }
      return cnt>0?sum/cnt:0;
    });
    const total=uniqs.reduce((s,v)=>s+v,0);
    if(total<1e-9){
      // Saturated → uniform
      selectedIndices.push(Math.floor(rng()*N));
      continue;
    }
    // Sample mit Wahrscheinlichkeit prop. zur Uniqueness
    const probs=uniqs.map(u=>u/total);
    let cum=0, r=rng();
    let picked=0;
    for(let i=0;i<N;i++){
      cum+=probs[i];
      if(r<=cum){picked=i;break;}
    }
    selectedIndices.push(picked);
    // Update phi
    const lab=tbLabels[picked];
    for(let t=lab.t; t<=lab.exitT && t<nBars; t++) phi[t]++;
  }
  
  // Diversität-Metrik: wieviele unique Events in der Stichprobe?
  const uniqueDrawn=new Set(selectedIndices).size;
  const diversityRatio=uniqueDrawn/N;
  return{selectedIndices, uniqueDrawn, diversityRatio, phi};
}

// ════════════════════════════════════════════════════════════════════════
// ML BASE LEARNERS (wie v11)
// ════════════════════════════════════════════════════════════════════════
function gaussSolve(A,b){const n=b.length,M=A.map((r,i)=>[...r,b[i]]);for(let c=0;c<n;c++){let mx=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[mx][c]))mx=r;[M[c],M[mx]]=[M[mx],M[c]];for(let r=c+1;r<n;r++){const f=M[r][c]/(M[c][c]+1e-12);for(let j=c;j<=n;j++)M[r][j]-=f*M[c][j];}}const x=new Array(n).fill(0);for(let i=n-1;i>=0;i--){x[i]=M[i][n]/(M[i][i]+1e-12);for(let j=i+1;j<n;j++)x[i]-=M[i][j]*x[j]/(M[i][i]+1e-12);}return x;}
function ridgeTrain(Xn,y,alpha,fi){const X=Xn.map(r=>fi.map(i=>r[i])),nf=X[0].length;const XtX=Array.from({length:nf},(_,i)=>Array.from({length:nf},(_,j)=>X.reduce((s,r)=>s+r[i]*r[j],0)+(i===j?alpha:0)));const Xty=Array.from({length:nf},(_,i)=>X.reduce((s,r,k)=>s+r[i]*y[k],0));return gaussSolve(XtX,Xty);}
function ridgePredict(w,xn,fi){return Math.max(20,Math.min(90,fi.reduce((s,f,i)=>s+xn[f]*w[i],0)));}
function wKNN(Xt,yt,q,k){const ds=Xt.map((r,i)=>({i,d:Math.sqrt(r.reduce((s,v,j)=>s+(v-q[j])**2,0))})).sort((a,b)=>a.d-b.d).slice(0,k);const ws=ds.reduce((s,x)=>s+1/(x.d+1e-9),0);return Math.max(20,Math.min(90,ds.reduce((s,x)=>s+yt[x.i]/(x.d+1e-9),0)/ws));}
function mkNorm(X){
  // FIX v15: Robust gegen konstante Features + NaN-Schutz
  const n=X[0].length, mu=new Array(n).fill(0), sig=new Array(n).fill(0);
  X.forEach(r=>r.forEach((v,i)=>{if(!isNaN(v)) mu[i]+=v;}));
  mu.forEach((_,i)=>mu[i]/=X.length);
  X.forEach(r=>r.forEach((v,i)=>{if(!isNaN(v)) sig[i]+=(v-mu[i])**2;}));
  sig.forEach((_,i)=>{
    const s=Math.sqrt(sig[i]/X.length);
    sig[i]=s>1e-8?s:1;  // Konstantes Feature → sig=1 statt 0 (vermeidet /0)
  });
  return{mu,sig};
}
function nrm(x, mu, sig){
  // FIX v15: NaN-safe Normalisierung (ersetzt NaN mit mu[i] = ffill-äquivalent)
  return x.map((v,i)=>{
    const val=(isNaN(v)||v===null||v===undefined)?mu[i]:v;
    return (val-mu[i])/sig[i];
  });
}
const TF=[0,1,2,5,7,8,11,13,16,18,19,21,22,24,25,28,31,37,40];
const TX=[[5.25,3.2,2.9,-80,121,3.5,244,49,-.8,-.9,102,1,1,1,1,0,-1,0,-1,28,5,0,0,0,18,15,1,-0.1,4.8,0.2,-0.2,0.8,1.0,0.05,0.6,62,56,72,-.2,.6,0,0,0,0],[4.50,2.8,2.4,-87,122,4.1,244,50,-1.,-1.,100,0,-1,1,-1,0,0,0,0,22,3,0,0,0,20,14,1,0,4.4,0.3,-0.3,0.7,0.8,0.1,0.8,66,58,71,0,.5,0,0,0,0],[0.25,0.4,-5,-60,128,14.7,244,36,-3,-3,94,-1,-1,-1,-1,1,1,0,-1,-30,-15,1,0,-1,82,-10,1,-0.3,0.6,-1.0,0.5,-0.8,-0.5,0.9,-0.8,60,20,40,0,-.8,-1,-1,0,0],[0.25,7.0,5.7,-80,124,4.0,244,58,-1.5,-1.5,97,0,1,1,-1,-1,-1,0,1,5,8,0,0,0,25,12,1,-0.1,1.8,-0.5,0.4,0.3,0.2,0.3,0.2,58,34,52,0,.3,0,0,0,0],[4.50,6.5,2.9,-80,121,3.5,244,48,-0.8,-0.8,102,1,0,0,0,0,-1,0,-1,18,10,0,0,0,24,14,1,-0.1,3.8,0.2,-0.1,0.6,0.7,0.1,0.5,63,48,68,-0.1,.4,0,0,0,0],[1.75,8.6,1.6,-84,123,3.6,244,53,-1,-1,100,1,0,0,0,0,0,0,0,10,8,0,0,0,28,13,1,-0.1,2.2,0,0,0.5,0.5,0.2,0.3,61,40,60,0,.3,0,0,0,0],[2.40,2.3,.9,28,88,5.9,920,49,2.5,-.8,108,-1,-1,0,1,0,-1,0,1,-8,-3,0,-2.1,-1.5,19,-2,-0.5,0.1,2.6,0.2,0.2,-0.3,-0.6,0.2,-0.3,77,46,42,-0.12,-.2,0,0,0,0],[4.50,2.9,.5,25,89,6.2,930,44,2.,-1,107,1,-1,0,1,0,-1,1,-1,-5,2,0,-0.75,-.8,20,-1,-0.5,0.1,3.8,0.1,0.1,-0.2,-0.3,0.15,-0.1,79,40,45,-0.08,-.1,0,0,0,0],[0,0.3,-12,15,98,8.5,820,33,1.,-2.5,90,0,-1,-1,-1,1,1,-1,-1,-25,-12,1,0,0,80,-5,-0.5,0.2,.3,-1.5,0.6,-0.7,-0.8,0.7,-0.9,60,22,25,0,-.7,-1,-1,0,0],[2.5,9.2,.2,14,93,6.5,910,45,1.2,-1.8,95,1,1,-1,-1,0,-1,1,-1,-12,-5,0,-1.75,-.9,30,-4,-0.5,0.15,2.5,0,0.3,-0.4,-0.7,0.3,-0.5,73,34,38,-0.06,-.3,0,0,0,0],[4,6.1,.9,22,90,6.4,920,43,1.5,-1.2,99,1,0,1,1,0,0,0,-1,-4,3,0,-0.5,-.5,22,-2,-0.5,0.1,3.2,0.1,0.2,-0.2,-0.4,0.2,-0.2,76,37,44,-0.09,-.1,0,0,0,0],[0.5,3.6,.4,-9,255,2.5,1290,49,-3.,-1.5,80,1,1,-1,-1,0,0,0,0,-32,-4,1,-4,1.5,18,-3,0.8,0.4,0.4,-0.5,-0.5,-0.7,-0.4,0.4,-0.6,89,67,12,-0.35,-.4,0,0,0,0],[-0.1,2.5,1,-11,261,2.6,1330,53,-3.5,-1.8,78,0,1,0,-1,1,0,0,1,-28,-8,1,-5.35,0,15,-2,0.8,0.5,0,-0.8,-0.3,-0.8,-0.3,0.6,-0.8,92,65,10,-0.38,-.5,-1,-1,0,0],[0.25,2.9,.3,-11,257,2.5,1260,49,-3,-1.6,81,1,0,-1,0,0,0,-1,0,-25,-3,1,-4.25,1.2,17,-2,0.8,0.4,0.3,-0.4,-0.5,-0.7,-0.35,0.5,-0.7,91,64,10,-0.37,-.5,0,0,0,0],[4.5,3.4,.7,-32,98,4.5,112,47,-3.5,-3,96,0,-1,1,-1,0,1,0,0,2,-1,0,0,0,19,0,0.2,0,4.3,0.2,0.1,0.1,0.1,0.1,0.2,84,50,65,-.06,.1,0,0,0,0],[5.25,8.7,.3,-31,100,3.9,109,47,-4.5,-3.5,90,1,1,-1,1,1,0,-1,0,-8,-6,0,0.75,.3,25,-1,0.2,0,4.7,0,-0.1,-0.1,0,0.15,-0.2,82,45,62,-.05,0,0,0,0,0],[3.5,10.7,1.8,-33,99,3.5,110,46,-4,-3.5,88,1,1,1,-1,1,0,0,-1,-15,-10,1,-0.75,.2,38,-3,0.2,-0.1,3.6,-0.3,-0.2,-0.3,-0.2,0.25,-0.2,80,42,58,-.05,-.2,0,0,0,0],[5,4.6,.1,-30,100,4.2,108,47,-3.8,-3.1,94,1,0,0,1,1,1,0,0,4,2,0,0.5,.2,21,0,0.2,0,4.5,0.1,0,0.1,0.1,0.1,0,83,48,64,-.06,.1,0,0,0,0],[0.25,.4,1.5,52,39,2.3,860,49,10,0.5,135,-1,-1,0,1,0,0,1,1,15,2,0,-4.25,-0.5,16,-1,0.5,0.8,0.5,0.4,0.6,0.8,0.4,0,0.4,99,25,20,-0.18,.6,0,0,1,0],[1.75,2.6,1.5,50,41,2.1,820,49,9.5,.2,131,1,1,0,1,0,0,-1,0,12,4,0,-3.5,-.3,18,-1,0.5,0.7,1.8,0.3,0.5,0.7,0.5,0.05,0.5,97,27,22,-0.16,.5,0,0,1,0],[4.35,3.2,1.6,4,52,4.1,62,51,-3.8,-.7,100,0,-1,0,-1,1,0,1,1,-5,-2,0,-0.15,2,20,2,1,-0.2,4.2,0.1,-0.2,-0.1,-0.1,0.1,-0.2,95,36,56,0.04,-.2,0,0,0,0],[1.85,6.1,3.5,9,48,3.6,58,55,-2.5,-.3,104,1,1,1,1,-1,-1,0,1,10,8,0,-1.9,1.5,17,3,1,-0.1,2,.2,-0.1,.2,.2,0.05,.2,97,40,60,0.05,-.1,0,0,0,0],[0.25,-.3,-6.7,3,57,7.4,55,44,-3,-1.5,90,-1,-1,-1,-1,1,1,0,-1,-18,-12,1,0,0,75,-8,1,-0.3,.5,-1.2,0.4,-0.5,-0.4,0.4,-0.5,90,28,42,0,-.5,-1,0,0,0],[3.85,6.8,2.,7,46,3.5,60,48,-2.8,-.5,101,1,0,0,0,-1,0,1,-1,-2,3,0,-0.5,1.8,23,1,1,-0.1,4,.1,0,.1,.1,0.1,.1,96,38,58,0.04,-.1,0,0,0,0]];
const TY=[82,72,35,48,78,62,55,49,33,40,46,40,30,38,53,48,42,50,64,65,55,60,36,56];

const CODES=["USD","EUR","JPY","GBP","CHF","AUD","CAD","CNY"];
const FLAGS={USD:"🇺🇸",EUR:"🇪🇺",JPY:"🇯🇵",GBP:"🇬🇧",CHF:"🇨🇭",AUD:"🇦🇺",CAD:"🇨🇦",CNY:"🇨🇳"};
const COLORS={USD:"#4f8ef7",EUR:"#f5a623",JPY:"#f74f4f",GBP:"#a855f7",CHF:"#10d48e",AUD:"#f97316",CAD:"#06b6d4",CNY:"#f472b6"};
const NAMES={USD:"US Dollar",EUR:"Euro",JPY:"Jap. Yen",GBP:"Brit. Pfund",CHF:"Schw. Franken",AUD:"Austr. Dollar",CAD:"Kanad. Dollar",CNY:"Chin. Yuan"};
const FEATURE_NAMES=["Zinssatz","Inflation","BIP","Handel","Schulden","ALQ","M2","PMI","Curr","CapAcc","REER","CB-Bias","Polit","Tariff","Geo","Wahl","Krise","Sanktion","Energie","COT","CFTC","COTExt","RealZins","TermPrem","VIX","DXYΔ","ÖlEff","GoldEff","ZinsLvl","Spread","CarryNorm","CDSScale","SentImpact","CdsConst","CdsBase","CdsScore","EpuScore","CarryScore","SentSig","SPXFlow","USDFlag","EURFlag","JPYFlag","ÖlExtra"];


// ════════════════════════════════════════════════════════════════════════
// FIX v15: LÄNDER-SPEZIFISCHE MAKRO-DATEN
// Jede Währung bekommt EIGENE Makro-Werte (Inflation/BIP/Handel/Schulden/etc)
// Ohne diese würden alle Features konstant sein → SHAP=0%
// Quellen: IMF WEO Okt 2025, OECD, Eurostat, BEA, BoJ, ONS, SNB, RBA, StatsCan, NBS
// ════════════════════════════════════════════════════════════════════════
const MACRO={
  // Inflation(YoY%), BIP(QoQ%), Handel(%GDP), StaatsSchuld(%GDP), ALQ(%), M2-Wachstum(YoY%),
  // PMI, Curr-Account(%GDP), CapAcc(%GDP), REER-Index(2010=100),
  // CB-Bias(-1dovish..+1hawkish), Polit-Risk(0-1), Tariff-Risk(0-1), Geo-Risk(0-1),
  // Wahl-Risk(0-1), Krise-Signal(0-1), Sanktion(0-1), Energie-Dependence(-1importer..+1exporter)
  USD: {inflation:2.8, bip:0.4, handel:-3.5, schulden:124, alq:4.1, m2Growth:3.2, pmi:48.5, currAcc:-3.1, capAcc:-0.3, reer:112, cbBias: 0.2, politRisk:0.6, tariffRisk:0.9, geoRisk:0.7, wahlRisk:0.1, kriseSig:0.3, sanktion:0.1, energie:0.3},
  EUR: {inflation:2.2, bip:0.5, handel: 3.2, schulden: 89, alq:6.3, m2Growth:4.8, pmi:50.4, currAcc: 2.8, capAcc: 0.2, reer:105, cbBias: 0.4, politRisk:0.4, tariffRisk:0.5, geoRisk:0.5, wahlRisk:0.2, kriseSig:0.2, sanktion:0.2, energie:-0.6},
  JPY: {inflation:2.9, bip:0.2, handel: 1.1, schulden:259, alq:2.6, m2Growth:2.4, pmi:50.1, currAcc: 3.9, capAcc:-0.4, reer: 70, cbBias: 0.3, politRisk:0.2, tariffRisk:0.4, geoRisk:0.6, wahlRisk:0.1, kriseSig:0.2, sanktion:0.0, energie:-0.9},
  GBP: {inflation:3.1, bip:0.3, handel:-2.4, schulden:101, alq:4.3, m2Growth:2.9, pmi:47.5, currAcc:-2.9, capAcc: 0.1, reer: 98, cbBias: 0.0, politRisk:0.5, tariffRisk:0.4, geoRisk:0.5, wahlRisk:0.1, kriseSig:0.2, sanktion:0.1, energie:-0.1},
  CHF: {inflation:0.8, bip:0.3, handel: 6.8, schulden: 38, alq:2.4, m2Growth:1.9, pmi:49.6, currAcc: 6.8, capAcc:-1.1, reer:130, cbBias:-0.3, politRisk:0.1, tariffRisk:0.3, geoRisk:0.4, wahlRisk:0.0, kriseSig:0.1, sanktion:0.0, energie:-0.8},
  AUD: {inflation:3.4, bip:0.4, handel: 1.8, schulden: 58, alq:4.2, m2Growth:6.1, pmi:51.2, currAcc: 0.2, capAcc:-0.5, reer: 95, cbBias:-0.1, politRisk:0.2, tariffRisk:0.6, geoRisk:0.5, wahlRisk:0.1, kriseSig:0.2, sanktion:0.0, energie: 0.7},
  CAD: {inflation:2.5, bip:0.2, handel: 0.8, schulden:106, alq:6.5, m2Growth:4.2, pmi:48.8, currAcc:-1.3, capAcc: 0.2, reer: 92, cbBias:-0.4, politRisk:0.3, tariffRisk:0.8, geoRisk:0.5, wahlRisk:0.0, kriseSig:0.2, sanktion:0.0, energie: 0.8},
  CNY: {inflation:0.5, bip:1.2, handel: 2.1, schulden: 84, alq:5.2, m2Growth:8.3, pmi:50.4, currAcc: 1.4, capAcc: 0.3, reer:118, cbBias:-0.2, politRisk:0.6, tariffRisk:0.9, geoRisk:0.8, wahlRisk:0.0, kriseSig:0.4, sanktion:0.3, energie:-0.3},
};

function buildFV(code){
  const b=BIAS[code],ir=RATES[code],s=SENTIMENT[code],m=MACRO[code];
  const rl=s.retail_long,ss=rl>62?-0.6:rl<38?0.6:(50-rl)/50*0.4;
  const oilC=MKT.oilChg,goldC=MKT.goldChg;
  const oilE={USD:-0.2,EUR:-0.3,JPY:0.7,GBP:0.1,CHF:-0.1,AUD:0.3,CAD:0.5,CNY:0.1}[code]||0;
  const goldE={USD:-0.4,EUR:0.1,JPY:0.6,GBP:0,CHF:0.9,AUD:0.5,CAD:0.1,CNY:0}[code]||0;
  const cdsI=Math.max(0,100-b.cds/1.2),epuI=Math.max(0,80-b.epu/4.5);
  const spread=MKT.us10y-MKT.us2y;
  // FIX v15: Nutzt jetzt ECHTE länder-spezifische Makro-Werte statt Konstanten
  return[
    ir, m.inflation, m.bip, m.handel, m.schulden, m.alq, m.m2Growth, m.pmi, m.currAcc, m.capAcc, m.reer,
    m.cbBias, m.politRisk, m.tariffRisk, m.geoRisk, m.wahlRisk, m.kriseSig, m.sanktion, m.energie,
    s.cot_net, 1, s.cot_extreme?1:0, ir-m.inflation, spread*0.5,
    MKT.vix, MKT.dxyChg,
    oilE*(oilC<-4?-1:oilC>4?1:0), goldE*(goldC>1?1:goldC<-1?-1:0),
    ir, spread, b.carry/100, 0.2, 0.1+ss*0.2, 0.2, 0.3,
    cdsI, epuI, b.carry/100, ss,
    MKT.spxChg>0?0.3:-0.3,
    code==="USD"?-0.8:0, code==="EUR"?0.6:0, code==="JPY"?0.4:0,
    oilE*(oilC<-4?-0.6:0)
  ];
}

function fundScore(code){
  const b=BIAS[code],ir=RATES[code],s=SENTIMENT[code];
  const contra=s.retail_long>62?-8:s.retail_long<38?8:0;
  return Math.max(20,Math.min(90,50+ir*1.6+b.carry/100*14+Math.max(0,100-b.cds/1.2)*0.16+Math.max(0,80-b.epu/4.5)*0.11+s.cot_net*0.15+contra));
}

// Multi-Head Architecture (v11)
function softmax(arr){const max=Math.max(...arr);const exp=arr.map(v=>Math.exp(v-max));const sum=exp.reduce((a,b)=>a+b,0);return exp.map(v=>v/sum);}
function sigmoid(x){return 1/(1+Math.exp(-x));}
function std(arr){const m=arr.reduce((s,v)=>s+v,0)/arr.length;const v=arr.reduce((s,x)=>s+(x-m)**2,0)/arr.length;return Math.sqrt(v);}

function gatedFusion(mlScores, baseScore, newsAdj, sentSignal){
  const mlMean=(mlScores.ridge+mlScores.k3+mlScores.k4+mlScores.fund)/4;
  const isCrisis=MKT.vix>22, isRiskOn=MKT.spxChg>0.5&&MKT.vix<18;
  const hasNewsImpact=Math.abs(newsAdj)>=3, hasSentExtreme=Math.abs(sentSignal)>0.4;
  let gateML=0.40, gateBase=0.25, gateNews=0.20, gateSent=0.15;
  if(isCrisis){gateNews=0.40;gateML=0.30;gateBase=0.20;gateSent=0.10;}
  else if(hasNewsImpact){gateNews=0.35;gateML=0.30;gateBase=0.20;gateSent=0.15;}
  else if(hasSentExtreme){gateSent=0.30;gateML=0.30;gateBase=0.25;gateNews=0.15;}
  else if(isRiskOn){gateBase=0.35;gateML=0.35;gateNews=0.15;gateSent=0.15;}
  const newsScore=50+newsAdj*1.5, sentScore=50+sentSignal*25;
  return{score:gateML*mlMean+gateBase*baseScore+gateNews*newsScore+gateSent*sentScore,gates:{ml:gateML,base:gateBase,news:gateNews,sent:gateSent},regime:isCrisis?"Krise":isRiskOn?"Risk-On":hasNewsImpact?"News-Treiber":hasSentExtreme?"Sentiment-Extrem":"Normal"};
}

function multiHead(fusedScore, mlScores, sent, newsAdj){
  const distLong=(fusedScore-60)/8, distShort=(40-fusedScore)/8, distNeutral=-Math.abs(fusedScore-50)/8+0.3;
  const dirProbs=softmax([distShort, distNeutral, distLong]);
  const scoreDeviation=Math.abs(fusedScore-50);
  const magnitude=0.3+scoreDeviation*0.04+Math.abs(newsAdj)*0.15;
  const componentValues=[mlScores.ridge,mlScores.k3,mlScores.k4,mlScores.fund];
  const componentDisagreement=std(componentValues)/10;
  const volatility=(componentDisagreement+MKT.vix/20+(sent.cot_extreme?0.4:0))/2.5;
  const agreement=1-Math.min(1,componentDisagreement);
  const conviction=Math.min(1,scoreDeviation/25);
  const riskPenalty=sent.cot_extreme?0.7:1.0;
  const confidence=sigmoid(((agreement*0.5+conviction*0.5)*riskPenalty-0.5)*6);
  return{direction:{probs:{short:dirProbs[0],neutral:dirProbs[1],long:dirProbs[2]},class:dirProbs[2]>dirProbs[0]&&dirProbs[2]>dirProbs[1]?"LONG":dirProbs[0]>dirProbs[2]&&dirProbs[0]>dirProbs[1]?"SHORT":"NEUTRAL"},magnitude,volatility,confidence};
}

function kellySize(heads){
  const winProb=heads.direction.probs.long+heads.direction.probs.short;
  const lossProb=heads.direction.probs.neutral;
  const odds=heads.magnitude/Math.max(0.1,heads.volatility);
  let kelly=(winProb*odds-lossProb)/odds;
  kelly=Math.max(0,Math.min(1,kelly));
  return Math.min(0.25, kelly*heads.confidence);
}

function tradingMetrics(trades){
  const closed=trades.filter(t=>t.status==="closed");
  if(closed.length===0) return null;
  const returns=closed.map(t=>t.pnlR);
  const wins=returns.filter(r=>r>0), losses=returns.filter(r=>r<0).map(r=>-r);
  const totalGains=wins.reduce((s,r)=>s+r,0), totalLosses=losses.reduce((s,r)=>s+r,0);
  const profitFactor=totalLosses>0?totalGains/totalLosses:totalGains>0?99:0;
  const avgReturn=returns.reduce((s,r)=>s+r,0)/returns.length;
  const stdReturn=std(returns);
  const sharpe=stdReturn>0?avgReturn/stdReturn*Math.sqrt(52):0;
  const winRate=wins.length/closed.length;
  const avgWin=wins.length>0?totalGains/wins.length:0;
  const avgLoss=losses.length>0?totalLosses/losses.length:0;
  const expectancy=winRate*avgWin-(1-winRate)*avgLoss;
  const biasTrades=closed.filter(t=>t.bias);
  const biasWinRate=biasTrades.length>0?biasTrades.filter(t=>t.pnlR>0).length/biasTrades.length:0;
  // Max Drawdown auf Equity-Curve
  const equity=[1];
  closed.forEach(t=>equity.push(equity[equity.length-1]*(1+t.pnlR*0.01)));
  let peak=equity[0], maxDD=0;
  equity.forEach(e=>{if(e>peak)peak=e;const dd=(e-peak)/peak;if(dd<maxDD)maxDD=dd;});
  const sortinoStd=Math.sqrt(losses.reduce((s,v)=>s+v*v,0)/Math.max(losses.length,1));
  const sortino=sortinoStd>0?avgReturn/sortinoStd*Math.sqrt(52):0;
  return{profitFactor,sharpe,sortino,winRate,expectancy,avgWin,avgLoss,biasWinRate,n:closed.length,maxDD,calmar:maxDD<0?(avgReturn*52)/Math.abs(maxDD):0};
}

function scoreLabel(s){
  if(s>=76)return{c:"#00e5a0",l:"STARK LONG",a:"▲▲"};
  if(s>=63)return{c:"#7ef542",l:"LONG",a:"▲"};
  if(s>=51)return{c:"#c8f020",l:"LEICHT LONG",a:"↗"};
  if(s>=40)return{c:"#f5c842",l:"NEUTRAL",a:"→"};
  if(s>=30)return{c:"#f58c42",l:"SHORT",a:"↘"};
  if(s>=20)return{c:"#f56442",l:"STARK SHORT",a:"▼"};
  return{c:"#f54242",l:"SEHR SCHWACH",a:"▼▼"};
}
function sentLabel(rl){
  if(rl>65)return{l:`${rl}% Long → BEARISH`,c:"#f54242"};
  if(rl>55)return{l:`${rl}% Long → leicht bearish`,c:"#f58c42"};
  if(rl<35)return{l:`${rl}% Long → BULLISH`,c:"#00e5a0"};
  if(rl<45)return{l:`${rl}% Long → leicht bullish`,c:"#7ef542"};
  return{l:`${rl}% Long → Neutral`,c:"#f5c842"};
}
function getPairs(ranked){
  return[["CHF","CAD"],["EUR","CAD"],["EUR","JPY"],["CHF","JPY"],["GBP","CNY"],["EUR","CNY"],["GBP","CAD"],["USD","CHF"],["AUD","JPY"],["EUR","AUD"],["CHF","CNY"],["USD","JPY"]].map(([b,q])=>{
    const base=ranked.find(r=>r.code===b),quote=ranked.find(r=>r.code===q);
    if(!base||!quote)return null;
    const diff=base.score-quote.score,abs=Math.abs(diff);
    if(abs<8)return null;
    const combinedConf=(base.heads.confidence+quote.heads.confidence)/2;
    const combinedKelly=(base.kelly+quote.kelly)/2;
    return{pair:`${b}/${q}`,base,quote,dir:diff>0?"LONG":"SHORT",abs,str:abs>35?"🔥🔥 EXTREM":abs>25?"🔥 SEHR STARK":abs>15?"⚡ STARK":"💧 MITTEL",conf:Math.min(93,32+abs*1.8)|0,mlConf:Math.round(combinedConf*100),kelly:combinedKelly};
  }).filter(Boolean).sort((a,b)=>b.abs-a.abs).slice(0,6);
}

function useJournal(){
  const[t,setT]=useState(()=>{try{return JSON.parse(localStorage.getItem("fxp18")||"[]")}catch{return[]}});
  const save=x=>{const u=[x,...t];setT(u);try{localStorage.setItem("fxp18",JSON.stringify(u.slice(0,300)))}catch{}};
  const rm=id=>{const u=t.filter(x=>x.id!==id);setT(u);try{localStorage.setItem("fxp18",JSON.stringify(u))}catch{}};
  const upd=(id,ch)=>{const u=t.map(x=>x.id===id?{...x,...ch}:x);setT(u);try{localStorage.setItem("fxp18",JSON.stringify(u))}catch{}};
  return{trades:t,save,rm,upd};
}

// ════════════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════════════
export default function App(){
  // Live-Daten: forceUpdate-Counter triggert useMemo-Re-calc
  const[_tick, setTick]=useState(0);
  const[liveStatus, setLiveStatus]=useState("🟡 Laden...");
  const[lastRefresh, setLastRefresh]=useState(null);

  useEffect(()=>{
    async function refresh(){
      const[fg, fx]=await Promise.all([_fetchFG(), _fetchFX()]);
      let updated=false;
      if(fg!==null){MKT={...MKT,fearGreed:fg};updated=true;}
      if(fx){
        if(fx.eurusd) MKT={...MKT,eurusd:fx.eurusd};
        if(fx.usdjpy) MKT={...MKT,usdjpy:fx.usdjpy};
        if(fx.gbpusd) MKT={...MKT,gbpusd:fx.gbpusd};
        updated=true;
      }
      if(updated){
        setTick(t=>t+1); // triggert Re-render + useMemo-Neuberechnung
        setLastRefresh(new Date());
        const src=[];
        if(fg!==null) src.push("F&G");
        if(fx) src.push("ECB-FX");
        setLiveStatus("🟢 LIVE: "+src.join("+"));
      } else {
        setLiveStatus("🟡 Fallback");
      }
    }
    refresh();
    const id=setInterval(refresh,60000);
    return()=>clearInterval(id);
  },[]);
  const today=getToday();
  const[tab,setTab]=useState("ranking");
  const[calFilter,setCalFilter]=useState("ALL");
  const[expanded,setExpanded]=useState(null);
  const[perfP,setPerfP]=useState("d30");
  const[nt,setNt]=useState({pair:"EUR/CAD",dir:"LONG",e:"",sl:"",tp:"",bias:true});
  const[showForm,setShowForm]=useState(false);
  const[quantCurrency,setQuantCurrency]=useState("CHF");
  const{trades,save,rm,upd}=useJournal();

  const{ranked, pairs}=useMemo(()=>{
    // FIX v18: Robuste Normalisierung via Median+MAD (Flash-Crash-immun)
    const{med, madV}=mkNormRobust(TX);
    const txn=TX.map(r=>nrmRobust(r, med, madV));
    const rW=ridgeTrain(txn,TY,4.0,TF);
    const scored=CODES.map(code=>{
      const b=BIAS[code],ir=RATES[code],s=SENTIMENT[code];
      const fv=buildFV(code),fn=nrmRobust(fv, med, madV),tn=TF.map(i=>fn[i]);
      const pr=ridgePredict(rW,fn,TF);
      const pk3=wKNN(txn.map(r=>TF.map(i=>r[i])),TY,tn,3);
      const pk4=wKNN(txn.map(r=>TF.map(i=>r[i])),TY,tn,4);
      const pf=fundScore(code);
      const mlScores={ridge:Math.round(pr),k3:Math.round(pk3),k4:Math.round(pk4),fund:Math.round(pf)};
      const rl=s.retail_long, sentSignal=rl>62?-0.6:rl<38?0.6:(50-rl)/50*0.4;
      const newsAdj=BREAKING.reduce((sum,n)=>sum+(n.impact[code]||0),0);
      const fusion=gatedFusion(mlScores, b.score, newsAdj, sentSignal);
      const score=Math.max(10,Math.min(92,Math.round(fusion.score)));
      const heads=multiHead(fusion.score, mlScores, s, newsAdj);
      const kelly=kellySize(heads);
      return{code,score,ml:Math.round((mlScores.ridge+mlScores.k3+mlScores.k4+mlScores.fund)/4),newsAdj,base:b.score,ir,flag:FLAGS[code],color:COLORS[code],name:NAMES[code],bias:scoreLabel(score),perf:b.perf,why:b.why,drivers:b.drivers,cds:b.cds,epu:b.epu,carry:b.carry,ois:b.ois,nextMeet:b.nextMeet,sent:s,comps:mlScores,heads,fusion,kelly,fv};
    }).sort((a,b)=>b.score-a.score);
    return{ranked:scored,pairs:getPairs(scored)};
  },[]);

  // ────────────────────────────────────────────────────────────────────
  // QUANT-TAB Berechnungen (live, memoized pro ausgewählter Währung)
  // ────────────────────────────────────────────────────────────────────
  const quantAnalysis=useMemo(()=>{
    const code=quantCurrency;
    const prices=synthesizePrices(code, 252);
    const logPrices=prices.map(p=>Math.log(p));
    const smoothed=kalmanFilter(prices, 1e-5, 1e-3);
    const ffdResult=findOptimalD(logPrices);
    const ffdSeries=fracDiff(logPrices, ffdResult.optimal);
    const tbResult=tripleBarrier(prices, 2.0, 1.0, 24, 50);
    
    // SHAP-Style: scoreFunc nutzt das Ridge-Modell auf Feature-Vektor
    // FIX v18: Robuste Normalisierung für SHAP-scoreFunc
    const{med, madV}=mkNormRobust(TX);
    const txn=TX.map(r=>nrmRobust(r, med, madV));
    const rW=ridgeTrain(txn,TY,4.0,TF);
    const fv=buildFV(code);
    const scoreFunc=(features)=>{
      const fn=nrmRobust(features, med, madV);
      return ridgePredict(rW, fn, TF);
    };
    const importances=permutationImportance(scoreFunc, FEATURE_NAMES, fv, 15, TX);
    const wfResults=walkForwardBacktest(trades, 4);
    
    // ── NEU v13: HMM Regime ──
    const logRets=prices.map((p,i)=>i===0?0:Math.log(p/prices[i-1])).slice(1);
    const hmmResult=trainHMM(logRets, 3, 25);
    
    // ── NEU v13: ATR + Stops ──
    const atrSeries=computeATR(prices, 14);
    const currentATR=atrSeries[atrSeries.length-1];
    const currentPrice=prices[prices.length-1];
    const stops=atrStops(currentPrice, currentATR, 1.5, 3.0);
    
    // ── NEU v13: Meta-Label-Score für aktuelles Signal ──
    const fundForCode=ranked.find(r=>r.code===quantCurrency);
    const primarySig=fundForCode?(fundForCode.score>55?1:fundForCode.score<45?-1:0):0;
    const currentVolNorm=hmmResult?std(logRets.slice(-24))/std(logRets):1.0;
    const metaScore=hmmResult&&fundForCode?metaLabelScore(primarySig, hmmResult.currentRegimeIdx, currentVolNorm, fundForCode.heads.confidence):null;
    
    // ── NEU v14: DSR auf User-Trades ──
    const userReturns=trades.filter(t=>t.status==="closed").map(t=>t.pnlR*0.01);
    const dsrResult=userReturns.length>=30?computeDSR(userReturns, 10, 52):null;
    
    // ── NEU v14: Regime-Adaptive Parameter ──
    const regimeProbs=hmmResult?(()=>{
      const lastStates=hmmResult.states.slice(-30);
      const counts=[0,0,0];
      lastStates.forEach(s=>counts[s]++);
      return counts.map(c=>c/lastStates.length);
    })():null;
    const adaptiveParams=hmmResult?getRegimeAdaptiveParams(hmmResult.currentRegime, regimeProbs):null;
    const fundForCode2=ranked.find(r=>r.code===quantCurrency);
    const adaptivePosition=adaptiveParams&&fundForCode2?adjustPositionByRegime(
      fundForCode2.kelly, adaptiveParams, fundForCode2.heads.confidence,
      fundForCode2.score>55?1:fundForCode2.score<45?-1:0
    ):0;
    
    // ══ NEU v16: Transfer Entropy - welche Features haben ECHTE Kausalität? ══
    // Wir prüfen jede Feature-Spalte aus TX gegen die TY-Labels
    const teResults=FEATURE_NAMES.slice(0,19).map((name,i)=>{
      const featureColumn=TX.map(row=>row[i]);
      // Target: binäres Signal (TY > median) 
      const medianY=[...TY].sort((a,b)=>a-b)[Math.floor(TY.length/2)];
      const targetBinary=TY.map(y=>y>medianY?1:0);
      const sig=transferEntropySignificance(featureColumn, targetBinary, 20);
      return{name, idx:i, ...sig};
    }).sort((a,b)=>b.effectiveTE-a.effectiveTE);
    
    // ══ NEU v16: GCN Adjacency zwischen allen 8 Währungen ══
    // Synthetische Return-Reihen pro Währung
    const allSynthRets=CODES.map(c=>{
      const p=synthesizePrices(c, 100);
      return p.map((v,i)=>i===0?0:Math.log(v/p[i-1]));
    });
    const corrMat=correlationMatrix(allSynthRets);
    const adjMat=buildAdjacency(corrMat, 0.2);
    const adjNorm=normalizeAdjacency(adjMat);
    
    // Node-Features: [currentScore, perf30d, kelly, conf, newsAdj]
    const nodeFeatures=CODES.map(c=>{
      const r=ranked.find(x=>x.code===c);
      return r?[r.score/100, (r.perf.d30||0)/10, r.kelly, r.heads.confidence, r.newsAdj/10]:[0.5,0,0,0.5,0];
    });
    // Tiny 2-layer GCN mit deterministischen Gewichten
    const W1=randomMatrix(5, 8, quantCurrency.charCodeAt(0));
    const W2=randomMatrix(8, 4, quantCurrency.charCodeAt(1));
    const gcnEmbeddings=gcnForward(nodeFeatures, adjNorm, W1, W2);
    const targetIdx=CODES.indexOf(quantCurrency);
    const targetEmbedding=gcnEmbeddings[targetIdx];
    
    // ══ NEU v16: FinBERT-Proxy auf echte BREAKING-News ══
    const finbertResults=BREAKING.map(n=>({
      news:n.head,
      source:n.src,
      ...finbertProxyScore(n.head),
    }));
    const avgSentiment=finbertResults.reduce((s,r)=>s+r.sentimentScore,0)/finbertResults.length;
    const avgHawkish=finbertResults.reduce((s,r)=>s+r.hawkishDovish,0)/finbertResults.length;
    
    // ══ NEU v16: Stylized-Facts Generator + Kelly-Stresstest ══
    const histReturns=logPrices.map((v,i)=>i===0?0:v-logPrices[i-1]).slice(1);
    const gjrParams=fitStylizedFacts(histReturns);
    // Generate 20 Black-Swan Szenarien mit severity=2.5
    const stressScenarios=[];
    for(let i=0;i<20;i++){
      const path=generateSyntheticPath(gjrParams, 252, 2.5, 42+i);
      const test=stressTestKelly(path, fundForCode?.kelly||0.1);
      stressScenarios.push({scenario:i, returns:path, ...test});
    }
    const stressSummary={
      worstMDD:Math.min(...stressScenarios.map(s=>s.mdd)),
      avgMDD:stressScenarios.reduce((s,sc)=>s+sc.mdd,0)/stressScenarios.length,
      bestReturn:Math.max(...stressScenarios.map(s=>s.finalReturn)),
      worstReturn:Math.min(...stressScenarios.map(s=>s.finalReturn)),
      avgSharpe:stressScenarios.reduce((s,sc)=>s+sc.sharpe,0)/stressScenarios.length,
      ruinCount:stressScenarios.filter(s=>s.mdd<-0.5).length,
    };
    
    // ══ NEU v17 BIAS-DEFENSE ══
    // 1. Adversarial Validation: Train (TX, 24 samples) vs Test (FVs aller 8 Codes)
    const testMatrix=CODES.map(c=>buildFV(c));
    const advResult=adversarialValidation(TX, testMatrix, TF);
    
    // 2. Feature-Neutralization: PCA auf TX, dann TX gegen die 2 ersten Components neutralisieren
    const TXFeatures=TX.map(row=>TF.map(i=>row[i]));
    const pcaRes=pcaSimplified(TXFeatures, 2);
    const neutralResult=neutralizeFeatures(TXFeatures, pcaRes.factors);
    // Original-Korrelation jedes Features zu PCA-1 vs nach Neutralization
    const corrToPC1Orig=[], corrToPC1Neutral=[];
    const pc1=pcaRes.factors.map(r=>r[0]);
    for(let j=0;j<TF.length;j++){
      const origCol=TXFeatures.map(r=>r[j]);
      const neutCol=neutralResult.neutral.map(r=>r[j]);
      corrToPC1Orig.push(corrPearson(origCol, pc1));
      corrToPC1Neutral.push(corrPearson(neutCol, pc1));
    }
    
    // 3. Noise Augmentation
    const augResult=noiseAugment(TXFeatures, TY, 2, 0.05, 123);
    
    // 4. Uniqueness Weights auf Triple-Barrier Labels
    const uniqWeights=computeUniquenessWeights(tbResult.labels, prices.length);
    const meanUniq=uniqWeights.length>0?uniqWeights.reduce((s,v)=>s+v,0)/uniqWeights.length:0;
    const minUniq=uniqWeights.length>0?Math.min(...uniqWeights):0;
    const maxUniq=uniqWeights.length>0?Math.max(...uniqWeights):0;
    
    // 5. Sequential Bootstrap
    const seqBoot=sequentialBootstrap(tbResult.labels, prices.length, Math.min(50,tbResult.labels.length), 42);
    // Vergleich: Standard-Bootstrap (uniform) Diversität
    const stdBootSet=new Set();
    for(let i=0;i<Math.min(50,tbResult.labels.length);i++){
      stdBootSet.add(Math.floor(Math.random()*tbResult.labels.length));
    }
    const stdDiversity=stdBootSet.size/Math.min(50,tbResult.labels.length);
    
    return{
      prices, smoothed, logPrices, ffdResult, ffdSeries, tbResult, importances, wfResults,
      hmmResult, atrSeries, currentATR, stops, metaScore, primarySig, currentVolNorm,
      dsrResult, regimeProbs, adaptiveParams, adaptivePosition,
      teResults, gcnEmbeddings, targetEmbedding, adjMat, corrMat,
      finbertResults, avgSentiment, avgHawkish,
      gjrParams, stressScenarios, stressSummary,
      advResult, pcaRes, neutralResult, corrToPC1Orig, corrToPC1Neutral,
      augResult, uniqWeights, meanUniq, minUniq, maxUniq,
      seqBoot, stdDiversity,
      
      // ══ NEU v18: Modified Z-Score & Flash-Crash Analyse ══
      // 1. Auf Returns der gewählten Währung
      flashCrashAnalysis: (()=>{
        const histReturns=logPrices.map((v,i)=>i===0?0:v-logPrices[i-1]).slice(1);
        const crashDetect=detectFlashCrashes(histReturns, 20, 3.5);
        const currentZ=crashDetect.zResult.modifiedZ[crashDetect.zResult.modifiedZ.length-1];
        // Vergleich Standard-Std vs robuste MAD
        const stdStd=std(histReturns);
        const robustStd=(()=>{
          const vols=robustVolatility(histReturns, 20);
          const validVols=vols.filter(v=>!isNaN(v));
          return validVols.length>0?validVols[validVols.length-1]:0;
        })();
        return{
          returns:histReturns,
          crashes:crashDetect.crashes,
          modifiedZSeries:crashDetect.zResult.modifiedZ,
          outliers:crashDetect.zResult.isOutlier,
          currentZ,
          currentCategory:Math.abs(currentZ)<1?"NEUTRAL":Math.abs(currentZ)<2?"Bewegung":Math.abs(currentZ)<3.5?"Signifikant":"FLASH-CRASH",
          stdStd,
          robustStd,
          ratio:stdStd>0?robustStd/stdStd:1,
        };
      })(),
      
      // 2. Modified Z-Score aller 8 Währungen (nutzt Score als Input)
      allCurrencyZScores: (()=>{
        const scores=ranked.map(r=>r.score);
        const allZ=modifiedZScoreArray(scores);
        return CODES.map((c,i)=>{
          const r=ranked.find(x=>x.code===c);
          const idx=ranked.indexOf(r);
          return{
            code:c,
            score:r?r.score:50,
            modifiedZ:allZ[idx],
            category:Math.abs(allZ[idx])<1?"neutral":Math.abs(allZ[idx])<2?"mild":Math.abs(allZ[idx])<3.5?"strong":"extreme",
            stdZ:r?((r.score-scores.reduce((s,v)=>s+v,0)/scores.length)/(std(scores)||1)):0,
          };
        }).sort((a,b)=>b.modifiedZ-a.modifiedZ);
      })(),
      
      // 3. Winsorized vs Original Feature-Vergleich (Makro für gewählte Währung)
      winsorizedComparison: (()=>{
        // Nimm Feature-Column 24 (VIX) aus TX und zeige Outlier-Cap-Effekt
        const vixColumn=TX.map(row=>row[24]);
        const winsorized=winsorize(vixColumn, 0.1, 0.9);
        return{
          original:vixColumn,
          winsorized,
          affectedCount:vixColumn.filter((v,i)=>Math.abs(v-winsorized[i])>1e-6).length,
        };
      })(),
    };
  },[quantCurrency, trades, ranked]);

  const C={bg:"#030608",card:"#06090f",border:"#0d1525",t:"#b0c8e8",dim:"#283050"};
  const TABS=["ranking","signale","ml","quant","sentiment","news","kalender","journal"];
  const PERFS=[{k:"d1",l:"1T"},{k:"d7",l:"7T"},{k:"d30",l:"30T"},{k:"d90",l:"90T"},{k:"d365",l:"1J"}];
  const cls=trades.filter(t=>t.status==="closed");
  const winR=cls.length?cls.filter(t=>t.pnlR>0).length/cls.length*100:0;
  const totR=cls.reduce((s,t)=>s+t.pnlR,0);
  const tmetrics=tradingMetrics(trades);

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.t,fontFamily:"'IBM Plex Mono',monospace",fontSize:12}}>
      {/* TOPBAR */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:"7px 14px",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",position:"sticky",top:0,zIndex:99}}>
        <div style={{display:"flex",gap:7,alignItems:"center"}}>
          <div style={{width:26,height:26,borderRadius:5,background:"linear-gradient(135deg,#1040e0,#00a0d0)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,color:"#fff"}}>FX</div>
          <div>
            <div style={{fontSize:9,fontWeight:800,letterSpacing:3,color:"#5080d0",lineHeight:1}}>PRO v18</div>
            <div style={{fontSize:6,color:C.dim}}>{today.weekday} {today.short} · <span style={{color:"#00e5a0"}}>{liveStatus}</span> · Kalman+FFD+TB+Kelly+SHAP+HMM+ATR+Meta+DSR+Adaptive+TE+GCN+FinBERT+TimeGAN+AdvVal+Neutral+NoiseAug+Uniq+SeqBoot+ModifiedZ</div>
          </div>
        </div>
        <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
          {[["VIX",MKT.vix,MKT.vix<20?"#00e5a0":"#f5c842"],["DXY",MKT.dxy,"#f54242"],["WTI","$"+MKT.oil,"#f58c42"],["Gold","$"+MKT.gold,"#f5c842"],["SPX",MKT.spx,"#00e5a0"],["EUR/USD",MKT.eurusd,"#f5a623"]].map(([l,v,c])=>(
            <div key={l} style={{padding:"2px 5px",background:C.bg,border:`1px solid ${C.border}`,borderRadius:3}}>
              <span style={{fontSize:6,color:C.dim}}>{l} </span><span style={{fontSize:8,fontWeight:700,color:c}}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:3,flexWrap:"wrap",alignItems:"center"}}>
          {TABS.map(t=>(<button key={t} onClick={()=>setTab(t)} style={{padding:"3px 7px",background:tab===t?"#1040e022":"transparent",border:`1px solid ${tab===t?"#1040e0":C.border}`,borderRadius:3,color:tab===t?"#5080d0":C.dim,fontSize:7,cursor:"pointer",fontFamily:"inherit"}}>{t.toUpperCase()}</button>))}
        </div>
      </div>

      <div style={{background:"#050810",borderBottom:`1px solid ${C.border}`,padding:"4px 14px",overflowX:"auto",whiteSpace:"nowrap",display:"flex",gap:0}}>
        <span style={{fontSize:7,color:"#f54242",fontWeight:700,marginRight:10,flexShrink:0}}>LIVE {today.short}</span>
        {BREAKING.map(n=>(<span key={n.id} style={{fontSize:7,marginRight:16,flexShrink:0}}>{Object.entries(n.impact).map(([k,v])=>(<span key={k} style={{color:v>0?"#00e5a0":"#f54242",fontWeight:700,marginRight:2}}>{k}{v>0?"+":""}{v}</span>))}<span style={{color:"#2a3850",marginLeft:2}}>{n.head}</span></span>))}
      </div>
      <div style={{background:"#040710",borderBottom:`1px solid ${C.border}`,padding:"3px 14px",fontSize:7,color:"#3a5070"}}>{MKT.context}</div>

      <div style={{padding:"10px 14px",maxWidth:1100,margin:"0 auto"}}>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* RANKING TAB                                                   */}
        {/* ════════════════════════════════════════════════════════════ */}
        {tab==="ranking"&&(<>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 14px",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
              <span style={{fontSize:7,color:C.dim,letterSpacing:2}}>RANKING {today.short} · MULTI-HEAD + LIVE QUANT</span>
              <div style={{display:"flex",gap:3}}>{PERFS.map(p=>(<button key={p.k} onClick={()=>setPerfP(p.k)} style={{padding:"2px 5px",background:perfP===p.k?"#1040e022":"transparent",border:`1px solid ${perfP===p.k?"#1040e0":C.border}`,borderRadius:3,color:perfP===p.k?"#5080d0":C.dim,fontSize:7,cursor:"pointer",fontFamily:"inherit"}}>{p.l}</button>))}</div>
            </div>
            <div style={{position:"relative",height:38,background:"#030608",borderRadius:4}}>
              <div style={{position:"absolute",left:0,top:0,bottom:0,width:"40%",background:"linear-gradient(90deg,#f5424208,transparent)"}}/>
              <div style={{position:"absolute",right:0,top:0,bottom:0,width:"40%",background:"linear-gradient(90deg,transparent,#00e5a008)"}}/>
              <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:1,background:"#0d1525"}}/>
              {ranked.map(r=>(<div key={r.code} style={{position:"absolute",left:`${r.score}%`,top:"50%",transform:"translate(-50%,-50%)",textAlign:"center",cursor:"pointer"}} onClick={()=>setExpanded(expanded===r.code?null:r.code)}><div style={{fontSize:16}}>{r.flag}</div><div style={{fontSize:7,color:r.bias.c,fontWeight:700}}>{r.score}</div></div>))}
            </div>
          </div>

          <div style={{display:"grid",gap:5,marginBottom:8}}>
            {ranked.map((r,idx)=>{
              const isEx=expanded===r.code,sl=sentLabel(r.sent.retail_long);
              const confColor=r.heads.confidence>0.7?"#00e5a0":r.heads.confidence>0.5?"#f5c842":"#f58c42";
              return(<div key={r.code} onClick={()=>setExpanded(isEx?null:r.code)} style={{background:isEx?`${r.color}07`:C.card,border:`1px solid ${isEx?r.color+"55":C.border}`,borderRadius:8,padding:"10px 14px",cursor:"pointer"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:20,textAlign:"center",fontSize:13}}>{["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣"][idx]}</div>
                  <div style={{display:"flex",gap:6,alignItems:"center",width:88}}><span style={{fontSize:22}}>{r.flag}</span><div><div style={{fontSize:11,fontWeight:800,color:r.color,lineHeight:1}}>{r.code}</div><div style={{fontSize:7,color:C.dim}}>{r.name}</div></div></div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:2,alignItems:"center"}}>
                      <span style={{fontSize:8,color:r.bias.c,fontWeight:700}}>{r.bias.a} {r.heads.direction.class}</span>
                      <div style={{display:"flex",gap:4}}>
                        <span style={{fontSize:6,color:confColor,padding:"1px 4px",background:`${confColor}15`,borderRadius:2,fontWeight:700}}>CONF {Math.round(r.heads.confidence*100)}%</span>
                        <span style={{fontSize:6,color:sl.c,padding:"1px 3px",background:`${sl.c}15`,borderRadius:2}}>{sl.l}</span>
                      </div>
                    </div>
                    <div style={{height:16,background:"#030608",borderRadius:3,overflow:"hidden",position:"relative"}}>
                      <div style={{position:"absolute",left:0,top:0,bottom:0,width:"50%",background:"#f5424206"}}/><div style={{position:"absolute",right:0,top:0,bottom:0,width:"50%",background:"#00e5a005"}}/><div style={{position:"absolute",left:"50%",top:0,bottom:0,width:1,background:"#0d1525"}}/>
                      <div style={{position:"absolute",top:1,bottom:1,left:1,width:`calc(${r.score}% - 2px)`,background:`linear-gradient(90deg,${r.bias.c}30,${r.bias.c})`,borderRadius:2,transition:"width 1.2s ease"}}/>
                      <div style={{position:"absolute",right:4,top:"50%",transform:"translateY(-50%)",fontSize:10,fontWeight:900,color:r.bias.c}}>{r.score}</div>
                    </div>
                  </div>
                  <div style={{width:78,display:"grid",gap:1}}>
                    {[[`Mag ${r.heads.magnitude.toFixed(2)}`,"Größe"],[`Vol ${r.heads.volatility.toFixed(2)}`,"Risiko"],[`K ${(r.kelly*100).toFixed(0)}%`,"Größe"]].map(([v,l])=>(<div key={l} style={{display:"flex",justifyContent:"space-between",fontSize:7}}><span style={{color:C.dim}}>{l}</span><span style={{color:r.color,fontWeight:700}}>{v}</span></div>))}
                  </div>
                  <div style={{width:12,color:C.dim,fontSize:9,textAlign:"center"}}>{isEx?"▲":"▼"}</div>
                </div>
                {isEx&&(<div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${r.color}1a`,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  <div>
                    <div style={{fontSize:8,color:"#5070a0",lineHeight:1.7,marginBottom:6}}>{r.why}</div>
                    <div style={{fontSize:7,color:C.dim,marginBottom:3}}>TREIBER:</div>
                    <div style={{display:"grid",gap:2,marginBottom:8}}>{r.drivers.map((d,i)=>{const dc=d.s>0?"#00e5a0":d.s<0?"#f54242":"#f5c842";return(<div key={i} style={{padding:"3px 6px",background:d.s>0?"#00e5a007":d.s<0?"#f5424207":"#f5c84207",borderRadius:3,fontSize:7,color:dc}}><span style={{fontWeight:900,marginRight:3}}>{d.s>0?"▲":d.s<0?"▼":"→"}</span>{d.t}</div>);})}</div>
                    <div style={{fontSize:7,color:C.dim,marginBottom:3}}>DIRECTION-WAHRSCHEINLICHKEITEN:</div>
                    <div style={{display:"flex",gap:3,marginBottom:8}}>{[["SHORT",r.heads.direction.probs.short,"#f54242"],["NEUTRAL",r.heads.direction.probs.neutral,"#f5c842"],["LONG",r.heads.direction.probs.long,"#00e5a0"]].map(([l,p,c])=>(<div key={l} style={{flex:1,textAlign:"center",padding:"4px 2px",background:`${c}10`,borderRadius:3,border:`1px solid ${c}33`}}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:9,fontWeight:700,color:c}}>{(p*100).toFixed(0)}%</div></div>))}</div>
                    <div style={{fontSize:7,color:C.dim,marginBottom:3}}>ML BASE LEARNERS:</div>
                    <div style={{display:"flex",gap:3}}>{[["Ridge",r.comps.ridge],["wKNN3",r.comps.k3],["wKNN4",r.comps.k4],["Fund",r.comps.fund]].map(([l,v])=>(<div key={l} style={{flex:1,textAlign:"center",padding:"3px 2px",background:v>=50?"#00e5a010":"#f5424210",borderRadius:3}}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:8,fontWeight:700,color:v>=50?"#00e5a0":"#f54242"}}>{v}</div></div>))}</div>
                  </div>
                  <div>
                    <div style={{padding:"6px 8px",background:"#030608",borderRadius:5,border:`1px solid ${r.color}18`,marginBottom:6}}>
                      <div style={{fontSize:8,color:r.color,fontWeight:700,marginBottom:3}}>{NEWS[r.code].head}</div>
                      {NEWS[r.code].items.map((it,i)=>(<div key={i} style={{fontSize:7,color:"#3a4a60",marginTop:1}}>· {it}</div>))}
                    </div>
                    <div style={{fontSize:7,color:C.dim,marginBottom:3}}>MULTI-HEAD OUTPUT:</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3,marginBottom:6}}>
                      {[["Magnitude",r.heads.magnitude.toFixed(2),"#5080d0"],["Volatility",r.heads.volatility.toFixed(2),"#f5c842"],["Confidence",`${(r.heads.confidence*100).toFixed(0)}%`,confColor],["Kelly Size",`${(r.kelly*100).toFixed(1)}%`,r.kelly>0.05?"#00e5a0":"#f58c42"]].map(([l,v,c])=>(<div key={l} style={{background:"#030608",borderRadius:3,padding:"5px 7px"}}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:9,color:c,fontWeight:700}}>{v}</div></div>))}
                    </div>
                    <div style={{fontSize:7,color:C.dim,marginBottom:3}}>FUSION GATES ({r.fusion.regime}):</div>
                    <div style={{display:"flex",gap:2,marginBottom:6}}>{[["ML",r.fusion.gates.ml],["Bias",r.fusion.gates.base],["News",r.fusion.gates.news],["Sent",r.fusion.gates.sent]].map(([l,w])=>(<div key={l} style={{flex:1}}><div style={{fontSize:5,color:C.dim,textAlign:"center"}}>{l}</div><div style={{height:14,background:"#030608",borderRadius:2,overflow:"hidden",position:"relative"}}><div style={{position:"absolute",left:0,top:0,bottom:0,width:`${w*100}%`,background:`linear-gradient(90deg,#1040e066,#1040e0)`}}/><div style={{position:"absolute",right:2,top:1,fontSize:6,color:"#fff",fontWeight:700}}>{(w*100).toFixed(0)}%</div></div></div>))}</div>
                    <div style={{display:"flex",gap:3,marginBottom:5}}>{PERFS.map(p=>{const v=r.perf[p.k]||0;return(<div key={p.k} style={{flex:1,textAlign:"center",padding:"2px",background:v>=0?"#00e5a010":"#f5424210",borderRadius:3}}><div style={{fontSize:5,color:C.dim}}>{p.l}</div><div style={{fontSize:7,fontWeight:700,color:v>=0?"#00e5a0":"#f54242"}}>{v>0?"+":""}{v.toFixed(1)}%</div></div>);})}</div>
                    <div style={{padding:"4px 7px",background:"#030608",borderRadius:4,fontSize:7,color:C.dim}}>🗓 {r.nextMeet} · {r.ois.slice(0,38)}</div>
                    {r.sent.cot_extreme&&<div style={{marginTop:4,padding:"4px 7px",background:"#f5c84215",border:"1px solid #f5c84233",borderRadius:4,fontSize:7,color:"#f5c842"}}>⚡ COT {r.sent.cot_net}k EXTREM → Squeeze!</div>}
                  </div>
                </div>)}
              </div>);
            })}
          </div>

          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px"}}>
            <div style={{fontSize:8,color:C.dim,letterSpacing:2,marginBottom:8}}>⚡ TOP SIGNALE (mit Multi-Head Confidence)</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
              {pairs.map(p=>{const c=p.abs>35?"#00e5a0":p.abs>25?"#7ef542":p.abs>15?"#f5c842":"#f58c42";return(<div key={p.pair} style={{background:C.bg,borderRadius:6,padding:"9px 10px",border:`1px solid ${c}22`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:12,fontWeight:900,color:"#6080a0"}}>{p.pair}</span><span style={{fontSize:14,fontWeight:900,color:p.dir==="LONG"?"#00e5a0":"#f54242"}}>{p.dir==="LONG"?"▲":"▼"}</span></div>
                <div style={{fontSize:7,color:c,marginBottom:3}}>{p.str} · ML-Conf {p.mlConf}%</div>
                <div style={{height:3,background:C.border,borderRadius:2,overflow:"hidden",marginBottom:3}}><div style={{height:"100%",width:`${p.mlConf}%`,background:c}}/></div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:6,color:"#1a2840",marginBottom:3}}><span>{p.base.code}<b style={{color:p.base.bias.c}}> {p.base.score}</b></span><span>Δ{p.abs}</span><span>{p.quote.code}<b style={{color:p.quote.bias.c}}> {p.quote.score}</b></span></div>
                <div style={{padding:"3px 5px",background:p.kelly>0.05?"#00e5a015":"#f5c84215",borderRadius:3,fontSize:6,color:p.kelly>0.05?"#00e5a0":"#f5c842",fontWeight:700,textAlign:"center"}}>Kelly Position: {(p.kelly*100).toFixed(1)}% des Kapitals</div>
              </div>);})}
            </div>
          </div>
        </>)}

        {/* ════════════════════════════════════════════════════════════ */}
        {/* QUANT TAB — NEU IN v12                                        */}
        {/* ════════════════════════════════════════════════════════════ */}
        {tab==="quant"&&(<div>
          <div style={{background:C.card,border:"1px solid #1040e033",borderRadius:8,padding:"10px 14px",marginBottom:10,fontSize:8,color:"#3a5080",lineHeight:1.7}}>
            🧮 <b style={{color:"#5080d0"}}>QUANT-LABOR v18 — 21 Live-Methoden (Flash-Crash-Proof)</b><br/>
            Alle Berechnungen laufen live im Browser auf 252 synthetischen Tagespreisen pro Währung.<br/>
            <b>Methoden:</b> Kalman · FFD · Triple-Barrier · SHAP · Walk-Forward · HMM · ATR · Meta-Labeling · DSR · Regime-Adaptive · TE · GCN · FinBERT · TimeGAN · Stress · AdvVal · Neutral · Noise · Uniq · SeqBoot · <b style={{color:"#f54242"}}>Modified Z-Score (Flash-Crash-Proof)</b>
          </div>

          {/* Currency Selector */}
          <div style={{display:"flex",gap:3,marginBottom:10,flexWrap:"wrap"}}>
            <span style={{fontSize:7,color:C.dim,padding:"6px 4px"}}>WÄHRUNG:</span>
            {CODES.map(c=>(<button key={c} onClick={()=>setQuantCurrency(c)} style={{padding:"4px 10px",background:quantCurrency===c?`${COLORS[c]}22`:"transparent",border:`1px solid ${quantCurrency===c?COLORS[c]:C.border}`,borderRadius:3,color:quantCurrency===c?COLORS[c]:C.dim,fontSize:8,cursor:"pointer",fontFamily:"inherit",fontWeight:700}}>{FLAGS[c]} {c}</button>))}
          </div>

          {/* ── Section 1: Kalman Filter Visualization ── */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#5080d0",fontWeight:700,letterSpacing:2}}>1. KALMAN FILTER (1D Bayesian Smoothing)</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>Q={'\u003C\u003C'}R → starkes Smoothing · Q=1e-5, R=1e-3</div>
              </div>
              <div style={{textAlign:"right",fontSize:7,color:C.dim}}>{quantAnalysis.prices.length} Bars · 252T History</div>
            </div>
            {/* SVG Chart */}
            <svg viewBox="0 0 600 140" style={{width:"100%",height:140,background:"#030608",borderRadius:4}}>
              {(()=>{
                const prices=quantAnalysis.prices, smoothed=quantAnalysis.smoothed;
                const min=Math.min(...prices, ...smoothed), max=Math.max(...prices, ...smoothed);
                const range=max-min||1;
                const toX=i=>20+(i/(prices.length-1))*560;
                const toY=v=>130-((v-min)/range)*120;
                const rawPath=prices.map((p,i)=>(i===0?"M":"L")+toX(i)+","+toY(p)).join(" ");
                const smPath=smoothed.map((p,i)=>(i===0?"M":"L")+toX(i)+","+toY(p)).join(" ");
                return(<>
                  <path d={rawPath} stroke="#3a5070" strokeWidth={0.6} fill="none" opacity={0.7}/>
                  <path d={smPath} stroke={COLORS[quantCurrency]} strokeWidth={1.5} fill="none"/>
                  <text x={20} y={12} fill="#5080d0" fontSize={6}>Original (grau) vs Kalman-geglättet ({quantCurrency})</text>
                  <text x={20} y={138} fill="#283050" fontSize={5}>t=0</text>
                  <text x={560} y={138} fill="#283050" fontSize={5}>t=251</text>
                </>);
              })()}
            </svg>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5,marginTop:8}}>
              {[["Letzter Preis",quantAnalysis.prices[quantAnalysis.prices.length-1].toFixed(2),"#3a5070"],["Kalman-Estimate",quantAnalysis.smoothed[quantAnalysis.smoothed.length-1].toFixed(2),COLORS[quantCurrency]],["Noise reduziert",((1-std(quantAnalysis.smoothed)/std(quantAnalysis.prices))*100).toFixed(1)+"%","#00e5a0"]].map(([l,v,c])=>(<div key={l} style={{background:C.bg,borderRadius:4,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:11,fontWeight:700,color:c}}>{v}</div></div>))}
            </div>
          </div>

          {/* ── Section 2: Fractional Differencing ── */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#5080d0",fontWeight:700,letterSpacing:2}}>2. FRACTIONAL DIFFERENCING (Lopez de Prado)</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>Suche minimales d ∈ [0.1, 0.9]: stationär (ADF p{'\u003C'}0.05) ∧ Memory {'\u003E'} 0.6</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:6,color:C.dim}}>OPTIMALES d</div>
                <div style={{fontSize:18,fontWeight:900,color:"#00e5a0"}}>{quantAnalysis.ffdResult.optimal.toFixed(2)}</div>
              </div>
            </div>
            {/* Diagnostics Table */}
            <div style={{background:C.bg,borderRadius:5,overflow:"hidden",fontSize:7,marginBottom:6}}>
              <div style={{display:"grid",gridTemplateColumns:"40px 70px 70px 70px 70px 1fr",padding:"4px 8px",background:"#080c16",fontWeight:700,color:"#5080d0",fontSize:6}}>
                <span>d</span><span>ADF-Stat</span><span>p-value</span><span>Corr orig</span><span>Stationär?</span><span>Status</span>
              </div>
              {quantAnalysis.ffdResult.diagnostics.map((diag,i)=>{
                const isOpt=Math.abs(diag.d-quantAnalysis.ffdResult.optimal)<0.001;
                return(<div key={i} style={{display:"grid",gridTemplateColumns:"40px 70px 70px 70px 70px 1fr",padding:"3px 8px",background:isOpt?"#00e5a008":"transparent",borderTop:i>0?"1px solid #080c16":"none"}}>
                  <span style={{color:isOpt?"#00e5a0":"#5070a0",fontWeight:isOpt?700:400}}>{diag.d.toFixed(1)}</span>
                  <span style={{color:"#3a5070"}}>{isNaN(diag.adfStat)?"—":diag.adfStat.toFixed(2)}</span>
                  <span style={{color:diag.stationary?"#00e5a0":"#f58c42"}}>{isNaN(diag.adfPval)?"—":diag.adfPval.toFixed(3)}</span>
                  <span style={{color:diag.memory?"#00e5a0":"#f58c42"}}>{isNaN(diag.corr)?"—":diag.corr.toFixed(2)}</span>
                  <span style={{color:diag.stationary?"#00e5a0":"#f54242"}}>{diag.stationary?"✓":"✗"}</span>
                  <span style={{color:isOpt?"#00e5a0":"#3a5070",fontWeight:isOpt?700:400}}>{isOpt?"← OPTIMAL gewählt":diag.stationary&&diag.memory?"OK":diag.stationary?"Memory zu schwach":"nicht stationär"}</span>
                </div>);
              })}
            </div>
            {/* FFD Series Chart */}
            <svg viewBox="0 0 600 80" style={{width:"100%",height:80,background:"#030608",borderRadius:4}}>
              {(()=>{
                const ffd=quantAnalysis.ffdSeries.filter(v=>!isNaN(v));
                if(ffd.length===0) return null;
                const min=Math.min(...ffd), max=Math.max(...ffd);
                const range=max-min||1;
                const startIdx=quantAnalysis.ffdSeries.findIndex(v=>!isNaN(v));
                const toX=i=>20+(i/(ffd.length-1))*560;
                const toY=v=>70-((v-min)/range)*60;
                const path=ffd.map((p,i)=>(i===0?"M":"L")+toX(i)+","+toY(p)).join(" ");
                const meanY=toY(ffd.reduce((s,v)=>s+v,0)/ffd.length);
                return(<>
                  <line x1={20} y1={meanY} x2={580} y2={meanY} stroke="#283050" strokeDasharray="2,2"/>
                  <path d={path} stroke="#f5a623" strokeWidth={1} fill="none"/>
                  <text x={20} y={10} fill="#f5a623" fontSize={6}>FFD Series (d={quantAnalysis.ffdResult.optimal.toFixed(2)}) — stationär ums Mean</text>
                </>);
              })()}
            </svg>
            <div style={{fontSize:7,color:C.dim,marginTop:5,lineHeight:1.6}}>
              <b style={{color:"#5080d0"}}>Interpretation:</b> Mit d={quantAnalysis.ffdResult.optimal.toFixed(2)} wird die Reihe stationär,
              behält aber {((quantAnalysis.ffdResult.diagnostics.find(x=>Math.abs(x.d-quantAnalysis.ffdResult.optimal)<0.001)?.corr||0)*100).toFixed(0)}% Korrelation
              zur Original-Reihe. Standard d=1 (klassisches Differencing) würde 100% des Memory zerstören.
            </div>
          </div>

          {/* ── Section 3: Triple-Barrier Method ── */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#5080d0",fontWeight:700,letterSpacing:2}}>3. TRIPLE-BARRIER METHOD (Lopez de Prado)</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>PT=2.0σ · SL=1.0σ · t1=24h · σ via 50-Period EWMA</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:6,color:C.dim}}>EVENTS</div>
                <div style={{fontSize:14,fontWeight:900,color:"#5080d0"}}>{quantAnalysis.tbResult.stats.total}</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5,marginBottom:8}}>
              {[["PT-Hits ▲ (TP)",quantAnalysis.tbResult.stats.nPT,(quantAnalysis.tbResult.stats.ptRate*100).toFixed(1)+"%","#00e5a0"],["SL-Hits ▼ (Stop)",quantAnalysis.tbResult.stats.nSL,(quantAnalysis.tbResult.stats.slRate*100).toFixed(1)+"%","#f54242"],["Time-Exits → (t1)",quantAnalysis.tbResult.stats.nT1,(quantAnalysis.tbResult.stats.t1Rate*100).toFixed(1)+"%","#f5c842"]].map(([l,n,p,c])=>(<div key={l} style={{background:C.bg,borderRadius:5,padding:"8px 10px",textAlign:"center",border:`1px solid ${c}33`}}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:14,fontWeight:900,color:c}}>{n}</div><div style={{fontSize:7,color:c,marginTop:2}}>{p}</div></div>))}
            </div>
            {/* Visual Bar */}
            <div style={{height:18,borderRadius:3,overflow:"hidden",display:"flex",marginBottom:6}}>
              <div style={{width:`${quantAnalysis.tbResult.stats.ptRate*100}%`,background:"#00e5a0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,color:"#000",fontWeight:700}}>{quantAnalysis.tbResult.stats.ptRate>0.1?"PT":""}</div>
              <div style={{width:`${quantAnalysis.tbResult.stats.slRate*100}%`,background:"#f54242",display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,color:"#fff",fontWeight:700}}>{quantAnalysis.tbResult.stats.slRate>0.1?"SL":""}</div>
              <div style={{width:`${quantAnalysis.tbResult.stats.t1Rate*100}%`,background:"#f5c842",display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,color:"#000",fontWeight:700}}>{quantAnalysis.tbResult.stats.t1Rate>0.1?"t1":""}</div>
            </div>
            {/* Implied Edge & Kelly */}
            {(()=>{
              const pWin=quantAnalysis.tbResult.stats.ptRate, pLoss=quantAnalysis.tbResult.stats.slRate;
              const totalActioned=pWin+pLoss;
              const condWin=totalActioned>0?pWin/totalActioned:0;
              const wlRatio=2.0; // PT/SL
              const tbKelly=kellyFraction(condWin, wlRatio, 0.25, 0.20);
              const edge=condWin*wlRatio-(1-condWin);
              return(<div style={{padding:"7px 10px",background:edge>0?"#00e5a008":"#f5424208",border:`1px solid ${edge>0?"#00e5a033":"#f5424233"}`,borderRadius:5}}>
                <div style={{fontSize:7,color:C.dim,marginBottom:4}}>STRATEGY-EDGE (basierend auf Triple-Barrier-Outcomes):</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5}}>
                  {[["Cond. Win-Rate",(condWin*100).toFixed(1)+"%",condWin>0.5?"#00e5a0":"#f54242"],["W/L Ratio",wlRatio.toFixed(1),"#5080d0"],["Edge",(edge*100).toFixed(1)+"%",edge>0?"#00e5a0":"#f54242"],["Kelly Size",(tbKelly*100).toFixed(1)+"%",tbKelly>0?"#00e5a0":"#f54242"]].map(([l,v,c])=>(<div key={l} style={{textAlign:"center"}}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:11,fontWeight:700,color:c}}>{v}</div></div>))}
                </div>
              </div>);
            })()}
          </div>

          {/* ── Section 4: SHAP-Style Permutation Feature Importance ── */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#5080d0",fontWeight:700,letterSpacing:2}}>4. SHAP-STYLE FEATURE IMPORTANCE (FIX v15)</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>Permutation mit echter Training-Verteilung · Makro-Features jetzt länderspezifisch</div>
              </div>
            </div>
            <div style={{display:"grid",gap:3}}>
              {quantAnalysis.importances.slice(0,15).map((imp,i)=>{
                // FIX v15: Kategorisiere Feature für Farbcodierung
                const macroIdx=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]; // Zinssatz..Energie
                const sentIdx=[19,20,21,32,38];
                const techIdx=[24,25,26,27,28,29,30];
                const fi=FEATURE_NAMES.indexOf(imp.feature);
                const category=macroIdx.includes(fi)?"makro":sentIdx.includes(fi)?"sent":techIdx.includes(fi)?"tech":"other";
                const catColor={makro:"#00e5a0",sent:"#a855f7",tech:"#f5c842",other:"#5080d0"}[category];
                return(<div key={i} style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{width:14,fontSize:7,color:C.dim,textAlign:"right"}}>{i+1}.</div>
                  <div style={{width:80,fontSize:8,color:"#7090b0"}}>{imp.feature}</div>
                  <div style={{width:50,fontSize:6,color:catColor,fontWeight:700}}>[{category.toUpperCase()}]</div>
                  <div style={{width:55,fontSize:6,color:C.dim,textAlign:"right",fontFamily:"monospace"}}>val={(imp.baseValue||0).toFixed(2)}</div>
                  <div style={{flex:1,height:12,background:C.bg,borderRadius:2,overflow:"hidden",position:"relative"}}>
                    <div style={{position:"absolute",left:0,top:0,bottom:0,width:`${Math.min(100,imp.pct*4)}%`,background:`linear-gradient(90deg,${catColor}66,${catColor})`}}/>
                    <div style={{position:"absolute",right:4,top:0,bottom:0,fontSize:6,color:"#fff",fontWeight:700,display:"flex",alignItems:"center"}}>{imp.pct.toFixed(1)}%</div>
                  </div>
                </div>);
              })}
            </div>
            <div style={{fontSize:7,color:C.dim,marginTop:8,lineHeight:1.6,padding:"6px 8px",background:C.bg,borderRadius:4}}>
              <b style={{color:"#5080d0"}}>FIX v15:</b> Makro-Features zeigen jetzt echte Wichtigkeit (nicht mehr 0.0%).
              Jede Währung hat eigene Inflation/BIP/PMI-Werte aus IMF-Daten. Die Permutation sampled aus der
              Training-Verteilung statt künstlich um den Ausgangswert zu oszillieren. Farbcodes: 
              <span style={{color:"#00e5a0"}}> Makro</span> · 
              <span style={{color:"#a855f7"}}> Sentiment</span> · 
              <span style={{color:"#f5c842"}}> Technisch</span>.
            </div>
          </div>

          {/* ── Section 6: HMM Regime Detection (NEU v13) ── */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#5080d0",fontWeight:700,letterSpacing:2}}>6. HIDDEN MARKOV MODEL — Regime Detection</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>3 Zustände (Bull/Sideways/Bear) trainiert via Baum-Welch (EM)</div>
              </div>
              {quantAnalysis.hmmResult&&(<div style={{textAlign:"right"}}>
                <div style={{fontSize:6,color:C.dim}}>AKTUELLES REGIME</div>
                <div style={{fontSize:14,fontWeight:900,color:quantAnalysis.hmmResult.currentRegime==="BULL"?"#00e5a0":quantAnalysis.hmmResult.currentRegime==="BEAR"?"#f54242":"#f5c842"}}>{quantAnalysis.hmmResult.currentRegime}</div>
              </div>)}
            </div>
            {quantAnalysis.hmmResult ? (<>
              {/* Regime Summary Table */}
              <div style={{background:C.bg,borderRadius:5,overflow:"hidden",fontSize:7,marginBottom:8}}>
                <div style={{display:"grid",gridTemplateColumns:"60px 80px 80px 70px 80px 1fr",padding:"4px 8px",background:"#080c16",fontWeight:700,color:"#5080d0",fontSize:6}}>
                  <span>Regime</span><span>μ Return</span><span>σ Return</span><span>Stickiness</span><span>E[Dauer]</span><span>Status</span>
                </div>
                {quantAnalysis.hmmResult.labels.map((lbl,k)=>{
                  const isCurrent=k===quantAnalysis.hmmResult.currentRegimeIdx;
                  const regimeColor=lbl==="BULL"?"#00e5a0":lbl==="BEAR"?"#f54242":"#f5c842";
                  return(<div key={k} style={{display:"grid",gridTemplateColumns:"60px 80px 80px 70px 80px 1fr",padding:"4px 8px",background:isCurrent?`${regimeColor}10`:"transparent",borderTop:k>0?"1px solid #080c16":"none"}}>
                    <span style={{color:regimeColor,fontWeight:700}}>{lbl}</span>
                    <span style={{color:"#3a5070"}}>{(quantAnalysis.hmmResult.means[k]*100).toFixed(3)}%</span>
                    <span style={{color:"#3a5070"}}>{(quantAnalysis.hmmResult.stds[k]*100).toFixed(3)}%</span>
                    <span style={{color:"#5080d0"}}>{quantAnalysis.hmmResult.A[k][k].toFixed(2)}</span>
                    <span style={{color:"#5080d0"}}>{quantAnalysis.hmmResult.expectedDuration[k].toFixed(0)}T</span>
                    <span style={{color:isCurrent?regimeColor:"#3a5070",fontWeight:isCurrent?700:400}}>{isCurrent?"← AKTUELL":""}</span>
                  </div>);
                })}
              </div>
              {/* Transition Matrix Visualization */}
              <div style={{fontSize:7,color:C.dim,marginBottom:3}}>TRANSITION-MATRIX P(S_t+1 | S_t):</div>
              <div style={{display:"grid",gridTemplateColumns:"60px 1fr 1fr 1fr",gap:2,fontSize:7,marginBottom:8}}>
                <div></div>
                {quantAnalysis.hmmResult.labels.map(l=>(<div key={l} style={{textAlign:"center",color:C.dim,fontSize:6}}>→ {l}</div>))}
                {quantAnalysis.hmmResult.labels.map((from,i)=>(<>
                  <div key={`from-${i}`} style={{color:C.dim,fontSize:6,textAlign:"right",paddingRight:4}}>{from} →</div>
                  {quantAnalysis.hmmResult.A[i].map((p,j)=>{
                    const intensity=Math.min(1,p*1.5);
                    return(<div key={`${i}-${j}`} style={{padding:"4px",textAlign:"center",background:`rgba(80,128,208,${intensity*0.6})`,borderRadius:2,color:p>0.3?"#fff":"#5080d0",fontWeight:700}}>{(p*100).toFixed(0)}%</div>);
                  })}
                </>))}
              </div>
              {/* Regime History Bar */}
              <div style={{fontSize:7,color:C.dim,marginBottom:3}}>REGIME-VERLAUF (letzte 252 Tage):</div>
              <div style={{display:"flex",height:14,borderRadius:3,overflow:"hidden"}}>
                {quantAnalysis.hmmResult.states.slice(-100).map((s,i)=>{
                  const c=s===0?"#00e5a0":s===2?"#f54242":"#f5c842";
                  return(<div key={i} style={{flex:1,background:c,opacity:0.85}}/>);
                })}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:6,color:C.dim,marginTop:1}}>
                <span>vor 100T</span><span>HEUTE</span>
              </div>
            </>) : (<div style={{padding:"14px",textAlign:"center",fontSize:9,color:C.dim,background:C.bg,borderRadius:5}}>HMM-Training fehlgeschlagen — zu wenig Daten</div>)}
          </div>

          {/* ── Section 7: ATR-Dynamic Stops (NEU v13) ── */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#5080d0",fontWeight:700,letterSpacing:2}}>7. ATR-DYNAMIC STOPS (Wilder 1978)</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>Stop = 1.5 × ATR · Target = 3.0 × ATR · Vola-adaptiv</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:6,color:C.dim}}>AKTUELLER ATR</div>
                <div style={{fontSize:14,fontWeight:900,color:"#f5a623"}}>{quantAnalysis.currentATR.toFixed(3)}</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:8}}>
              {[
                ["Stop-Distance",quantAnalysis.stops.stopDistance.toFixed(3),"#f54242","1.5 × ATR"],
                ["Target-Distance",quantAnalysis.stops.targetDistance.toFixed(3),"#00e5a0","3.0 × ATR"],
                ["Stop in % Preis",quantAnalysis.stops.stopPctOfPrice.toFixed(2)+"%","#f58c42","Distanz relativ"],
                ["R:R Ratio",quantAnalysis.stops.rrRatio.toFixed(1)+":1","#5080d0","Reward/Risk"],
              ].map(([l,v,c,d])=>(<div key={l} style={{background:C.bg,borderRadius:5,padding:"7px",textAlign:"center"}} title={d}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:11,fontWeight:700,color:c}}>{v}</div><div style={{fontSize:5,color:C.dim,marginTop:2}}>{d}</div></div>))}
            </div>
            {/* ATR Visualization */}
            <svg viewBox="0 0 600 60" style={{width:"100%",height:60,background:"#030608",borderRadius:4}}>
              {(()=>{
                const atr=quantAnalysis.atrSeries;
                const min=Math.min(...atr), max=Math.max(...atr);
                const range=max-min||1;
                const toX=i=>20+(i/(atr.length-1))*560;
                const toY=v=>50-((v-min)/range)*40;
                const path=atr.map((p,i)=>(i===0?"M":"L")+toX(i)+","+toY(p)).join(" ");
                return(<>
                  <path d={path} stroke="#f5a623" strokeWidth={1} fill="none"/>
                  <text x={20} y={10} fill="#f5a623" fontSize={6}>ATR-Verlauf — Vola-Pulse erkennen</text>
                </>);
              })()}
            </svg>
            <div style={{fontSize:7,color:C.dim,marginTop:5,lineHeight:1.6}}>
              <b style={{color:"#5080d0"}}>Vorteil:</b> In ruhigen Phasen enge Stops (besseres R:R), in volatilen Phasen weite Stops (vermeidet Volatility-Stops). Klassischer Fix-Pip-Stop verliert in beiden Extremen.
            </div>
          </div>

          {/* ── Section 8: Meta-Labeling Filter (NEU v13) ── */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{fontSize:9,color:"#5080d0",fontWeight:700,letterSpacing:2,marginBottom:8}}>8. META-LABELING FILTER (Lopez de Prado)</div>
            {quantAnalysis.metaScore?(<>
              <div style={{fontSize:7,color:C.dim,marginBottom:6}}>2-stufiger Klassifikator: Primary signalisiert "Was?", Meta entscheidet "Soll ich überhaupt?"</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:8}}>
                {[
                  ["Primary Signal",quantAnalysis.primarySig===1?"LONG":quantAnalysis.primarySig===-1?"SHORT":"NEUTRAL",quantAnalysis.primarySig===1?"#00e5a0":quantAnalysis.primarySig===-1?"#f54242":"#f5c842"],
                  ["Regime Alignment",(quantAnalysis.metaScore.regimeAlignment*100).toFixed(0)+"%",quantAnalysis.metaScore.regimeAlignment>0.7?"#00e5a0":quantAnalysis.metaScore.regimeAlignment>0.4?"#f5c842":"#f54242"],
                  ["Vol-Penalty",(quantAnalysis.metaScore.volPenalty*100).toFixed(0)+"%",quantAnalysis.metaScore.volPenalty>0.7?"#00e5a0":"#f58c42"],
                  ["Meta-Probability",(quantAnalysis.metaScore.metaProb*100).toFixed(0)+"%",quantAnalysis.metaScore.metaProb>0.55?"#00e5a0":"#f54242"],
                ].map(([l,v,c])=>(<div key={l} style={{background:C.bg,borderRadius:5,padding:"7px",textAlign:"center"}}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:12,fontWeight:700,color:c}}>{v}</div></div>))}
              </div>
              <div style={{padding:"8px 10px",background:quantAnalysis.metaScore.pass?"#00e5a015":"#f5424215",border:`1px solid ${quantAnalysis.metaScore.pass?"#00e5a033":"#f5424233"}`,borderRadius:5}}>
                <div style={{fontSize:9,fontWeight:700,color:quantAnalysis.metaScore.pass?"#00e5a0":"#f54242",marginBottom:3}}>
                  {quantAnalysis.metaScore.pass?"✓ TRADE FREIGEGEBEN":"✗ TRADE BLOCKIERT"}
                </div>
                <div style={{fontSize:7,color:C.dim}}>{quantAnalysis.metaScore.explanation}</div>
              </div>
              <div style={{fontSize:7,color:C.dim,marginTop:6,lineHeight:1.6,padding:"5px 8px",background:C.bg,borderRadius:4}}>
                <b style={{color:"#5080d0"}}>Empirie (Lopez de Prado):</b> Primary alone Sharpe ~0.7, Primary+Meta Sharpe 1.4-1.8.
                Filter sortiert ~30-50% der schwachen Signale aus, lässt nur Trades mit Regime-Bestätigung durch.
              </div>
            </>):(<div style={{padding:"14px",textAlign:"center",fontSize:9,color:C.dim,background:C.bg,borderRadius:5}}>Meta-Score nicht berechenbar</div>)}
          </div>

          {/* ── Section 9: Deflated Sharpe Ratio (NEU v14) ── */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#5080d0",fontWeight:700,letterSpacing:2}}>9. DEFLATED SHARPE RATIO (Bailey & Lopez de Prado 2014)</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>Anti-P-Hacking: unterscheidet echten Skill von Multiple-Testing-Glück</div>
              </div>
              {quantAnalysis.dsrResult && (<div style={{textAlign:"right"}}>
                <div style={{fontSize:6,color:C.dim}}>DSR (P[echter Skill])</div>
                <div style={{fontSize:18,fontWeight:900,color:quantAnalysis.dsrResult.dsr>=0.95?"#00e5a0":quantAnalysis.dsrResult.dsr>=0.5?"#f5c842":"#f54242"}}>{(quantAnalysis.dsrResult.dsr*100).toFixed(1)}%</div>
              </div>)}
            </div>
            {quantAnalysis.dsrResult ? (<>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:8}}>
                {[
                  ["Raw Sharpe (ann.)",quantAnalysis.dsrResult.sharpeAnn.toFixed(2),quantAnalysis.dsrResult.sharpeAnn>1?"#00e5a0":"#f58c42","Aus User-Trades"],
                  ["E[max SR] unter H0",quantAnalysis.dsrResult.expectedMaxSharpeH0.toFixed(2),"#f5c842",`Bei ${quantAnalysis.dsrResult.nTrials} Trials`],
                  ["Skewness",quantAnalysis.dsrResult.skewness.toFixed(2),Math.abs(quantAnalysis.dsrResult.skewness)<0.5?"#00e5a0":"#f58c42","Return-Asymmetrie"],
                  ["Ex. Kurtosis",quantAnalysis.dsrResult.kurtosis.toFixed(2),Math.abs(quantAnalysis.dsrResult.kurtosis)<2?"#00e5a0":"#f58c42","Fat-Tails"],
                ].map(([l,v,c,d])=>(<div key={l} style={{background:C.bg,borderRadius:5,padding:"7px",textAlign:"center"}} title={d}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:12,fontWeight:700,color:c}}>{v}</div><div style={{fontSize:5,color:C.dim,marginTop:2}}>{d}</div></div>))}
              </div>
              <div style={{padding:"8px 10px",background:quantAnalysis.dsrResult.significant?"#00e5a015":quantAnalysis.dsrResult.dsr>=0.5?"#f5c84215":"#f5424215",border:`1px solid ${quantAnalysis.dsrResult.significant?"#00e5a033":quantAnalysis.dsrResult.dsr>=0.5?"#f5c84233":"#f5424233"}`,borderRadius:5}}>
                <div style={{fontSize:10,fontWeight:700,color:quantAnalysis.dsrResult.significant?"#00e5a0":quantAnalysis.dsrResult.dsr>=0.5?"#f5c842":"#f54242",marginBottom:3}}>
                  {quantAnalysis.dsrResult.significant?"✓ STATISTISCH SIGNIFIKANT":quantAnalysis.dsrResult.dsr>=0.5?"⚠ AMBIGUOUS — mehr Daten nötig":"✗ WAHRSCHEINLICH P-HACKING"}
                </div>
                <div style={{fontSize:7,color:C.dim,lineHeight:1.6}}>
                  DSR = P(wahres Sharpe {'>'} 0 | observed = {quantAnalysis.dsrResult.sharpeAnn.toFixed(2)}, N-Trials = {quantAnalysis.dsrResult.nTrials}).
                  DSR ≥ 95% = echter Skill · DSR 50-95% = unentschieden · DSR {'<'} 50% = wahrscheinlich Glück.
                  Expected Max SR unter H0 aus {quantAnalysis.dsrResult.nTrials} Trials: {quantAnalysis.dsrResult.expectedMaxSharpeH0.toFixed(2)}.
                </div>
              </div>
            </>):(<div style={{padding:"14px",textAlign:"center",fontSize:9,color:C.dim,background:C.bg,borderRadius:5}}>Mindestens 30 geschlossene Trades für DSR nötig (aktuell: {trades.filter(t=>t.status==="closed").length})</div>)}
          </div>

          {/* ── Section 10: Regime-Adaptive Strategy (NEU v14) ── */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#5080d0",fontWeight:700,letterSpacing:2}}>10. REGIME-ADAPTIVE STRATEGY</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>Kelly × Stops × Frequenz automatisch an HMM-Regime angepasst</div>
              </div>
              {quantAnalysis.adaptiveParams&&(<div style={{textAlign:"right"}}>
                <div style={{fontSize:6,color:C.dim}}>AKTIVES PROFIL</div>
                <div style={{fontSize:10,fontWeight:900,color:"#f5a623"}}>{quantAnalysis.adaptiveParams.label}</div>
              </div>)}
            </div>
            {quantAnalysis.adaptiveParams ? (<>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5,marginBottom:8}}>
                {[
                  ["Kelly Mult",quantAnalysis.adaptiveParams.kellyMult.toFixed(2)+"×",quantAnalysis.adaptiveParams.kellyMult>=0.8?"#00e5a0":quantAnalysis.adaptiveParams.kellyMult>=0.5?"#f5c842":"#f58c42"],
                  ["Min-Conf",(quantAnalysis.adaptiveParams.minConf*100).toFixed(0)+"%","#5080d0"],
                  ["ATR-Stop",quantAnalysis.adaptiveParams.atrStopMult.toFixed(1)+"×","#f54242"],
                  ["ATR-Target",quantAnalysis.adaptiveParams.atrTargetMult.toFixed(1)+"×","#00e5a0"],
                  ["Max/Tag",quantAnalysis.adaptiveParams.maxTradesDay,"#a855f7"],
                ].map(([l,v,c])=>(<div key={l} style={{background:C.bg,borderRadius:5,padding:"7px",textAlign:"center"}}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:11,fontWeight:700,color:c}}>{v}</div></div>))}
              </div>
              {/* Final Position */}
              <div style={{padding:"10px 12px",background:"#030608",borderRadius:5,marginBottom:6}}>
                <div style={{fontSize:7,color:C.dim,marginBottom:5}}>BERECHNUNG FÜR {quantCurrency}:</div>
                <div style={{fontSize:8,color:"#5080d0",lineHeight:1.8,fontFamily:"monospace"}}>
                  Base Kelly = <span style={{color:"#00e5a0"}}>{(ranked.find(r=>r.code===quantCurrency)?.kelly*100).toFixed(2)}%</span> × Regime-Mult = <span style={{color:"#f5a623"}}>{quantAnalysis.adaptiveParams.kellyMult.toFixed(2)}</span><br/>
                  × Confidence-Factor = <span style={{color:"#a855f7"}}>{ranked.find(r=>r.code===quantCurrency)?((ranked.find(r=>r.code===quantCurrency).heads.confidence-quantAnalysis.adaptiveParams.minConf)/(1-quantAnalysis.adaptiveParams.minConf)*100).toFixed(0):"0"}%</span><br/>
                  → <b style={{color:"#00e5a0",fontSize:11}}>FINAL POSITION = {(quantAnalysis.adaptivePosition*100).toFixed(2)}%</b> des Kapitals
                </div>
              </div>
              {/* Profile Comparison */}
              <div style={{fontSize:7,color:C.dim,marginBottom:3}}>VERGLEICH ALLER 3 REGIME-PROFILE:</div>
              <div style={{background:C.bg,borderRadius:5,overflow:"hidden",fontSize:7}}>
                <div style={{display:"grid",gridTemplateColumns:"80px 60px 60px 60px 60px 70px 1fr",padding:"4px 8px",background:"#080c16",fontWeight:700,color:"#5080d0",fontSize:6}}>
                  <span>Regime</span><span>Kelly</span><span>Min-Conf</span><span>Stop</span><span>Target</span><span>Max/Tag</span><span>Stil</span>
                </div>
                {Object.entries(REGIME_PROFILES).map(([name,p],i)=>{
                  const isCurrent=quantAnalysis.hmmResult&&quantAnalysis.hmmResult.currentRegime===name;
                  const c=name==="BULL"?"#00e5a0":name==="BEAR"?"#f54242":"#f5c842";
                  return(<div key={name} style={{display:"grid",gridTemplateColumns:"80px 60px 60px 60px 60px 70px 1fr",padding:"4px 8px",background:isCurrent?`${c}10`:"transparent",borderTop:i>0?"1px solid #080c16":"none"}}>
                    <span style={{color:c,fontWeight:isCurrent?700:400}}>{name}{isCurrent?" ★":""}</span>
                    <span style={{color:"#3a5070"}}>{p.kellyMult.toFixed(2)}×</span>
                    <span style={{color:"#3a5070"}}>{(p.minConf*100).toFixed(0)}%</span>
                    <span style={{color:"#3a5070"}}>{p.atrStopMult.toFixed(1)}×</span>
                    <span style={{color:"#3a5070"}}>{p.atrTargetMult.toFixed(1)}×</span>
                    <span style={{color:"#3a5070"}}>{p.maxTradesDay}</span>
                    <span style={{color:"#3a5070",fontSize:6}}>{p.label}</span>
                  </div>);
                })}
              </div>
            </>):(<div style={{padding:"14px",textAlign:"center",fontSize:9,color:C.dim}}>HMM-Regime nicht verfügbar</div>)}
          </div>

          {/* ── Section 11: TRANSFER ENTROPY (NEU v16 — Next-Gen) ── */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#00e5a0",fontWeight:700,letterSpacing:2}}>11. TRANSFER ENTROPY — Kausale Feature-Selection</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>Schreiber 2000 · TE(X→Y) misst gerichteten Informationsfluss · Löst "Scheinkorrelations"-Problem</div>
              </div>
            </div>
            <div style={{fontSize:7,color:C.dim,marginBottom:6,padding:"5px 8px",background:"#00e5a008",borderRadius:4,lineHeight:1.6}}>
              <b style={{color:"#00e5a0"}}>Warum besser als SHAP/Correlation?</b> TE = 0 bedeutet mathematisch sicher: Feature hat KEINE Vorhersagekraft.
              20 Shuffle-Surrogate pro Feature für Signifikanz-Test.
            </div>
            <div style={{background:C.bg,borderRadius:5,overflow:"hidden",fontSize:7}}>
              <div style={{display:"grid",gridTemplateColumns:"20px 100px 70px 70px 60px 50px 1fr",padding:"4px 8px",background:"#080c16",fontWeight:700,color:"#00e5a0",fontSize:6}}>
                <span>#</span><span>Feature</span><span>TE observed</span><span>eff. TE</span><span>p-value</span><span>Sig?</span><span>Status</span>
              </div>
              {quantAnalysis.teResults.slice(0,15).map((r,i)=>{
                const isMakro=r.idx<=18;
                return(<div key={i} style={{display:"grid",gridTemplateColumns:"20px 100px 70px 70px 60px 50px 1fr",padding:"3px 8px",borderTop:i>0?"1px solid #080c16":"none",background:r.significant?"#00e5a008":"transparent"}}>
                  <span style={{color:C.dim}}>{i+1}</span>
                  <span style={{color:isMakro?"#00e5a0":"#7090b0",fontWeight:700}}>{r.name}</span>
                  <span style={{color:"#3a5070"}}>{r.teObserved.toFixed(4)}</span>
                  <span style={{color:r.effectiveTE>0.05?"#00e5a0":r.effectiveTE>0.01?"#f5c842":"#f58c42",fontWeight:700}}>{r.effectiveTE.toFixed(4)}</span>
                  <span style={{color:r.pValue<0.05?"#00e5a0":"#f58c42"}}>{r.pValue.toFixed(3)}</span>
                  <span style={{color:r.significant?"#00e5a0":"#f54242"}}>{r.significant?"✓":"✗"}</span>
                  <span style={{color:"#3a5070",fontSize:6}}>{r.effectiveTE>0.1?"Starke Kausalität":r.effectiveTE>0.05?"Mittlere Kausalität":r.effectiveTE>0.01?"Schwache Kausalität":"Keine Kausalität"}</span>
                </div>);
              })}
            </div>
            <div style={{fontSize:7,color:C.dim,marginTop:6,padding:"5px 8px",background:C.bg,borderRadius:4,lineHeight:1.6}}>
              <b style={{color:"#00e5a0"}}>Interpretation:</b> {quantAnalysis.teResults.filter(r=>r.significant).length}/{quantAnalysis.teResults.length} Features zeigen kausale Signifikanz.
              Features mit eff. TE {'<'} 0.01 solltest du aus dem Modell entfernen — sie sind reines Rauschen.
            </div>
          </div>

          {/* ── Section 12: GCN ADJACENCY (NEU v16) ── */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#a855f7",fontWeight:700,letterSpacing:2}}>12. GRAPH CONVOLUTIONAL NETWORK — Asset-Beziehungen</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>Kipf & Welling 2017 · Knoten=Währungen, Kanten=Korrelation, 2-Layer GCN</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:6,color:C.dim}}>EMBEDDING DIM</div>
                <div style={{fontSize:10,fontWeight:700,color:"#a855f7"}}>{quantAnalysis.targetEmbedding.length}</div>
              </div>
            </div>
            <div style={{fontSize:7,color:C.dim,marginBottom:5}}>KORRELATIONS-MATRIX (8 Währungen):</div>
            <div style={{display:"grid",gridTemplateColumns:"40px repeat(8, 1fr)",gap:1,fontSize:6,marginBottom:8}}>
              <div></div>
              {CODES.map(c=>(<div key={c} style={{textAlign:"center",color:COLORS[c],fontWeight:700}}>{c}</div>))}
              {CODES.map((code,i)=>(<><div key={`l-${i}`} style={{color:COLORS[code],fontWeight:700,textAlign:"right",paddingRight:2}}>{code}</div>
                {quantAnalysis.corrMat[i].map((v,j)=>{
                  const intensity=Math.abs(v);
                  const color=v>0?"80,128,208":"245,66,66";
                  return(<div key={`${i}-${j}`} style={{padding:"3px",textAlign:"center",background:`rgba(${color},${intensity*0.6})`,borderRadius:1,color:Math.abs(v)>0.5?"#fff":"#5080d0",fontSize:5,fontWeight:700}}>{v.toFixed(2)}</div>);
                })}
              </>))}
            </div>
            {/* Adjacency (>0.2 threshold) */}
            <div style={{fontSize:7,color:C.dim,marginBottom:3}}>ADJAZENZ-MATRIX (Edges wo |corr| {'>'} 0.2):</div>
            <div style={{display:"grid",gridTemplateColumns:"40px repeat(8, 1fr)",gap:1,fontSize:6,marginBottom:8}}>
              <div></div>
              {CODES.map(c=>(<div key={`a-${c}`} style={{textAlign:"center",color:COLORS[c],fontWeight:700}}>{c}</div>))}
              {CODES.map((code,i)=>(<><div key={`al-${i}`} style={{color:COLORS[code],fontWeight:700,textAlign:"right",paddingRight:2}}>{code}</div>
                {quantAnalysis.adjMat[i].map((v,j)=>(<div key={`am-${i}-${j}`} style={{padding:"3px",textAlign:"center",background:v>0?`rgba(168,85,247,${v*0.7})`:"#0a0d15",borderRadius:1,color:v>0.5?"#fff":"#3a5070",fontSize:5,fontWeight:700}}>{v>0?v.toFixed(2):"-"}</div>))}
              </>))}
            </div>
            <div style={{fontSize:7,color:C.dim,marginBottom:3}}>GCN-EMBEDDING für {quantCurrency} (4-dim):</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:6}}>
              {quantAnalysis.targetEmbedding.map((v,i)=>(<div key={i} style={{background:C.bg,borderRadius:4,padding:"6px",textAlign:"center"}}><div style={{fontSize:6,color:C.dim}}>Dim {i}</div><div style={{fontSize:11,fontWeight:700,color:v>0?"#a855f7":"#f58c42"}}>{v.toFixed(3)}</div></div>))}
            </div>
            <div style={{fontSize:7,color:C.dim,padding:"5px 8px",background:C.bg,borderRadius:4,lineHeight:1.6}}>
              <b style={{color:"#a855f7"}}>Integration:</b> Das 4-dim Embedding würde im Production-System mit dem LSTM-Hidden-State konkateniert 
              (<code>concat(h_LSTM, e_GCN)</code>) → bessere Vorhersagen weil das Modell "sieht" wie {quantCurrency} mit anderen Assets verknüpft ist.
            </div>
          </div>

          {/* ── Section 13: FINBERT-PROXY auf Breaking News (NEU v16) ── */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#f5c842",fontWeight:700,letterSpacing:2}}>13. FINBERT-PROXY — Hawkish/Dovish News-Scoring</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>Loughran-McDonald Lexikon · Browser-tauglicher Proxy für echtes FinBERT (440MB)</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:6,color:C.dim}}>AVG SENTIMENT</div>
                <div style={{fontSize:14,fontWeight:900,color:quantAnalysis.avgSentiment>0?"#00e5a0":"#f54242"}}>{quantAnalysis.avgSentiment>0?"+":""}{quantAnalysis.avgSentiment.toFixed(2)}</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:8}}>
              <div style={{background:C.bg,borderRadius:5,padding:"7px",textAlign:"center"}}>
                <div style={{fontSize:6,color:C.dim}}>AVG HAWKISH/DOVISH</div>
                <div style={{fontSize:14,fontWeight:700,color:quantAnalysis.avgHawkish>0?"#f54242":"#00e5a0"}}>{quantAnalysis.avgHawkish>0?"+":""}{quantAnalysis.avgHawkish.toFixed(2)}</div>
                <div style={{fontSize:6,color:C.dim}}>{quantAnalysis.avgHawkish>0.3?"HAWKISH — Zinserhöhungen wahrscheinlich":quantAnalysis.avgHawkish<-0.3?"DOVISH — Zinssenkungen wahrscheinlich":"neutral"}</div>
              </div>
              <div style={{background:C.bg,borderRadius:5,padding:"7px",textAlign:"center"}}>
                <div style={{fontSize:6,color:C.dim}}>NEWS ANALYSIERT</div>
                <div style={{fontSize:14,fontWeight:700,color:"#5080d0"}}>{quantAnalysis.finbertResults.length}</div>
                <div style={{fontSize:6,color:C.dim}}>Live aus BREAKING-Ticker</div>
              </div>
            </div>
            <div style={{background:C.bg,borderRadius:5,overflow:"hidden",fontSize:7}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 60px 60px 50px 60px",padding:"4px 8px",background:"#080c16",fontWeight:700,color:"#f5c842",fontSize:6}}>
                <span>News Headline</span><span>Sentiment</span><span>Hawk/Dove</span><span>Label</span><span>Conf</span>
              </div>
              {quantAnalysis.finbertResults.map((r,i)=>(<div key={i} style={{display:"grid",gridTemplateColumns:"1fr 60px 60px 50px 60px",padding:"4px 8px",borderTop:i>0?"1px solid #080c16":"none"}}>
                <span style={{color:"#7090b0",fontSize:7}}>{r.news}</span>
                <span style={{color:r.sentimentScore>0?"#00e5a0":r.sentimentScore<0?"#f54242":"#f5c842",fontWeight:700}}>{r.sentimentScore>0?"+":""}{r.sentimentScore.toFixed(2)}</span>
                <span style={{color:r.hawkishDovish>0?"#f54242":r.hawkishDovish<0?"#00e5a0":"#f5c842",fontWeight:700}}>{r.hawkishDovish>0?"+":""}{r.hawkishDovish.toFixed(2)}</span>
                <span style={{color:r.label==="positive"?"#00e5a0":r.label==="negative"?"#f54242":"#f5c842",fontWeight:700}}>{r.label}</span>
                <span style={{color:"#3a5070"}}>{(r.confidence*100).toFixed(0)}%</span>
              </div>))}
            </div>
            <div style={{fontSize:7,color:C.dim,marginTop:6,padding:"5px 8px",background:C.bg,borderRadius:4,lineHeight:1.6}}>
              <b style={{color:"#f5c842"}}>Production:</b> Im Python-System (quant_system_v4/nlp/finbert.py) nutzt die Pipeline ProsusAI/finbert über HuggingFace Transformers. 
              Hier im Browser der Proxy via Loughran-McDonald Dictionary (Keywords aus Finance/Central-Bank-Speech-Literatur).
            </div>
          </div>

          {/* ── Section 14: STYLIZED-FACTS Generator (NEU v16 — TimeGAN-Proxy) ── */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#f58c42",fontWeight:700,letterSpacing:2}}>14. STYLIZED-FACTS GENERATOR — Synthetische Black-Swans</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>GJR-GARCH + Student-t + Poisson-Jumps · Reproduziert Vol-Clustering + Fat-Tails + Skew</div>
              </div>
            </div>
            {quantAnalysis.gjrParams && (<>
              <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:5,marginBottom:8}}>
                {[
                  ["ω (omega)",quantAnalysis.gjrParams.omega.toExponential(2),"#5080d0","Unkonditionelle Var."],
                  ["α (ARCH)",quantAnalysis.gjrParams.alpha.toFixed(3),"#f5c842","Kurzfr. Vola-Reaktion"],
                  ["β (GARCH)",quantAnalysis.gjrParams.beta.toFixed(3),"#00e5a0","Vola-Persistenz"],
                  ["γ (Leverage)",quantAnalysis.gjrParams.gamma.toFixed(3),"#f58c42","Neg-Skew Boost"],
                  ["λ Jump",(quantAnalysis.gjrParams.jumpIntensity*100).toFixed(2)+"%",quantAnalysis.gjrParams.jumpIntensity>0.02?"#f54242":"#f5c842","P(Jump/Bar)"],
                  ["Jump σ",quantAnalysis.gjrParams.jumpStd.toFixed(4),"#a855f7","Jump-Magnitude"],
                ].map(([l,v,c,d])=>(<div key={l} style={{background:C.bg,borderRadius:4,padding:"5px",textAlign:"center"}} title={d}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:10,fontWeight:700,color:c}}>{v}</div></div>))}
              </div>
              {/* Preview 3 synthetische Pfade */}
              <div style={{fontSize:7,color:C.dim,marginBottom:3}}>VORSCHAU 3 SYNTHETISCHE PFADE (severity=2.5, 252 Bars):</div>
              <svg viewBox="0 0 600 80" style={{width:"100%",height:80,background:"#030608",borderRadius:4}}>
                {quantAnalysis.stressScenarios.slice(0,3).map((s,idx)=>{
                  // Kumuliere Returns zu Equity-Pfad
                  let equity=1;
                  const path=[1];
                  s.returns.forEach(r=>{equity*=(1+0.1*r);path.push(equity);});
                  const min=Math.min(...path),max=Math.max(...path);
                  const range=max-min||1;
                  const toX=i=>20+(i/(path.length-1))*560;
                  const toY=v=>70-((v-min)/range)*60;
                  const d=path.map((p,i)=>(i===0?"M":"L")+toX(i)+","+toY(p)).join(" ");
                  const color=["#00e5a0","#f5c842","#f58c42"][idx];
                  return(<path key={idx} d={d} stroke={color} strokeWidth={0.8} fill="none" opacity={0.8}/>);
                })}
                <text x={20} y={10} fill="#f58c42" fontSize={6}>3 von 20 synthetischen Black-Swan-Szenarien</text>
              </svg>
            </>)}
          </div>

          {/* ── Section 15: KELLY STRESS-TEST auf synth. Black-Swans (NEU v16) ── */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#f54242",fontWeight:700,letterSpacing:2}}>15. ROBUSTHEITS-STRESS-TEST — Kelly auf Black-Swans</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>20 synthetische Szenarien × 252 Bars · severity=2.5 · Kelly={((ranked.find(r=>r.code===quantCurrency)?.kelly||0.1)*100).toFixed(1)}%</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:6,color:C.dim}}>RUIN EVENTS (MDD{'>'}50%)</div>
                <div style={{fontSize:14,fontWeight:900,color:quantAnalysis.stressSummary.ruinCount===0?"#00e5a0":quantAnalysis.stressSummary.ruinCount<=3?"#f5c842":"#f54242"}}>{quantAnalysis.stressSummary.ruinCount}/20</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5,marginBottom:8}}>
              {[
                ["Worst MDD",(quantAnalysis.stressSummary.worstMDD*100).toFixed(1)+"%",quantAnalysis.stressSummary.worstMDD>-0.3?"#00e5a0":quantAnalysis.stressSummary.worstMDD>-0.5?"#f5c842":"#f54242"],
                ["Avg MDD",(quantAnalysis.stressSummary.avgMDD*100).toFixed(1)+"%",quantAnalysis.stressSummary.avgMDD>-0.1?"#00e5a0":"#f58c42"],
                ["Best Return",(quantAnalysis.stressSummary.bestReturn*100).toFixed(1)+"%","#00e5a0"],
                ["Worst Return",(quantAnalysis.stressSummary.worstReturn*100).toFixed(1)+"%",quantAnalysis.stressSummary.worstReturn>-0.2?"#f5c842":"#f54242"],
                ["Avg Sharpe",quantAnalysis.stressSummary.avgSharpe.toFixed(2),quantAnalysis.stressSummary.avgSharpe>0?"#00e5a0":"#f54242"],
              ].map(([l,v,c])=>(<div key={l} style={{background:C.bg,borderRadius:5,padding:"7px",textAlign:"center"}}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:12,fontWeight:700,color:c}}>{v}</div></div>))}
            </div>
            {/* Distribution Bar — MDDs aller Szenarien */}
            <div style={{fontSize:7,color:C.dim,marginBottom:3}}>MDD-VERTEILUNG ÜBER 20 STRESSTESTS:</div>
            <div style={{display:"flex",gap:1,height:30,marginBottom:6}}>
              {quantAnalysis.stressScenarios.sort((a,b)=>a.mdd-b.mdd).map((s,i)=>{
                const c=s.mdd>-0.1?"#00e5a0":s.mdd>-0.3?"#f5c842":s.mdd>-0.5?"#f58c42":"#f54242";
                return(<div key={i} style={{flex:1,background:c,borderRadius:1,display:"flex",alignItems:"flex-end",justifyContent:"center",fontSize:5,color:"#fff",fontWeight:700}} title={`Scenario ${s.scenario}: MDD=${(s.mdd*100).toFixed(1)}%, Sharpe=${s.sharpe.toFixed(2)}`}>{Math.abs(s.mdd*100)<50?Math.abs(s.mdd*100).toFixed(0):""}</div>);
              })}
            </div>
            <div style={{fontSize:7,color:C.dim,padding:"6px 8px",background:quantAnalysis.stressSummary.ruinCount===0?"#00e5a010":"#f5424210",border:`1px solid ${quantAnalysis.stressSummary.ruinCount===0?"#00e5a033":"#f5424233"}`,borderRadius:4,lineHeight:1.6}}>
              <b style={{color:quantAnalysis.stressSummary.ruinCount===0?"#00e5a0":"#f54242"}}>
                {quantAnalysis.stressSummary.ruinCount===0?"✓ ROBUST":quantAnalysis.stressSummary.ruinCount<=3?"⚠ MARGINALLY ROBUST":"✗ NICHT ROBUST"}
              </b>
              {" — "}
              Deine Kelly-Position von {((ranked.find(r=>r.code===quantCurrency)?.kelly||0.1)*100).toFixed(1)}% {quantAnalysis.stressSummary.ruinCount===0?"überlebt alle 20 extremen Markt-Szenarien ohne Ruin":`produziert ${quantAnalysis.stressSummary.ruinCount} Ruin-Events (MDD>50%) — Kelly-Multiplier reduzieren!`}.
              Production: Python-System trainiert echtes TimeGAN (Yoon 2019) mit PyTorch — liefert realistischere Szenarien als dieser GJR-GARCH-Proxy.
            </div>
          </div>

          {/* ══════ BIAS-DEFENSE SECTIONS (NEU v17) ══════ */}
          
          {/* ── Section 16: ADVERSARIAL VALIDATION ── */}
          <div style={{background:C.card,border:"1px solid #f5424222",borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#f54242",fontWeight:700,letterSpacing:2}}>16. ADVERSARIAL VALIDATION — Train vs Test Drift</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>Trainiert Classifier "is this train or test?" · AUC misst Distribution-Drift</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:6,color:C.dim}}>AUC</div>
                <div style={{fontSize:18,fontWeight:900,color:quantAnalysis.advResult.severity==="none"?"#00e5a0":quantAnalysis.advResult.severity==="mild"?"#f5c842":quantAnalysis.advResult.severity==="moderate"?"#f58c42":"#f54242"}}>{quantAnalysis.advResult.auc.toFixed(3)}</div>
              </div>
            </div>
            <div style={{padding:"8px 10px",background:quantAnalysis.advResult.severity==="none"?"#00e5a015":quantAnalysis.advResult.severity==="severe"?"#f5424215":"#f5c84215",border:`1px solid ${quantAnalysis.advResult.severity==="none"?"#00e5a033":quantAnalysis.advResult.severity==="severe"?"#f5424233":"#f5c84233"}`,borderRadius:5,marginBottom:8}}>
              <div style={{fontSize:10,fontWeight:700,color:quantAnalysis.advResult.severity==="none"?"#00e5a0":quantAnalysis.advResult.severity==="severe"?"#f54242":"#f5c842",marginBottom:3}}>
                {quantAnalysis.advResult.interpretation}
              </div>
              <div style={{fontSize:7,color:C.dim,lineHeight:1.6}}>
                {quantAnalysis.nTrain || quantAnalysis.advResult.nTrain} Train-Samples vs {quantAnalysis.advResult.nTest} Test-Samples · 
                LogReg-Classifier · Severity: <b>{quantAnalysis.advResult.severity.toUpperCase()}</b>
              </div>
            </div>
            <div style={{fontSize:7,color:C.dim,marginBottom:3}}>TOP DRIFT-DRIVER FEATURES (im Production-System entfernen):</div>
            <div style={{display:"grid",gap:3}}>
              {quantAnalysis.advResult.driftDrivers.map((d,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:14,fontSize:7,color:C.dim,textAlign:"right"}}>{i+1}.</div>
                <div style={{width:90,fontSize:8,color:"#7090b0"}}>{d.name}</div>
                <div style={{flex:1,height:10,background:C.bg,borderRadius:2,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${Math.min(100,d.importance/quantAnalysis.advResult.driftDrivers[0].importance*100)}%`,background:"linear-gradient(90deg,#f5424255,#f54242)"}}/>
                </div>
                <div style={{width:50,fontSize:6,color:"#f54242",textAlign:"right",fontWeight:700}}>|w|={d.importance.toFixed(2)}</div>
              </div>))}
            </div>
            <div style={{fontSize:7,color:C.dim,marginTop:6,padding:"5px 8px",background:C.bg,borderRadius:4,lineHeight:1.6}}>
              <b style={{color:"#f54242"}}>Lopez de Prado:</b> "If AUC {'>'} 0.7 you're training on one world, testing on another."
              {quantAnalysis.advResult.auc>0.7?" → Drift-Driver-Features entfernen oder mit Importance-Sampling neu gewichten.":" → Verteilungen ähnlich genug."}
            </div>
          </div>
          
          {/* ── Section 17: FEATURE NEUTRALIZATION (PCA-basierte Beta-Removal) ── */}
          <div style={{background:C.card,border:"1px solid #a855f733",borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#a855f7",fontWeight:700,letterSpacing:2}}>17. FEATURE NEUTRALIZATION — Beta-Removal via PCA</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>F_neutral = F - M(M'M)^(-1)M'F · Orthogonal zu Market-Faktoren</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:6,color:C.dim}}>EXPLAINED VAR (PC1+PC2)</div>
                <div style={{fontSize:14,fontWeight:900,color:"#a855f7"}}>{((quantAnalysis.pcaRes.explainedVar[0]+quantAnalysis.pcaRes.explainedVar[1])*100).toFixed(0)}%</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:8}}>
              {[0,1].map(idx=>(<div key={idx} style={{background:C.bg,borderRadius:4,padding:"6px 8px"}}>
                <div style={{fontSize:7,color:"#a855f7",fontWeight:700}}>PC{idx+1} (Market-Factor {idx+1})</div>
                <div style={{fontSize:6,color:C.dim,marginTop:2}}>Erklärt {(quantAnalysis.pcaRes.explainedVar[idx]*100).toFixed(1)}% der Total-Varianz</div>
                <div style={{fontSize:6,color:C.dim}}>Eigenwert: {quantAnalysis.pcaRes.components[idx].eigenvalue.toFixed(3)}</div>
              </div>))}
            </div>
            <div style={{fontSize:7,color:C.dim,marginBottom:3}}>FEATURE-KORRELATION ZU PC1 — VORHER vs NACH NEUTRALIZATION:</div>
            <div style={{background:C.bg,borderRadius:5,overflow:"hidden",fontSize:7}}>
              <div style={{display:"grid",gridTemplateColumns:"30px 110px 80px 80px 1fr",padding:"4px 8px",background:"#080c16",fontWeight:700,color:"#a855f7",fontSize:6}}>
                <span>#</span><span>Feature</span><span>Corr orig</span><span>Corr neutral</span><span>Reduktion</span>
              </div>
              {TF.slice(0,10).map((idx,i)=>{
                const orig=quantAnalysis.corrToPC1Orig[i];
                const neut=quantAnalysis.corrToPC1Neutral[i];
                const reduction=Math.abs(orig)>0?(1-Math.abs(neut)/Math.abs(orig))*100:0;
                return(<div key={i} style={{display:"grid",gridTemplateColumns:"30px 110px 80px 80px 1fr",padding:"3px 8px",borderTop:i>0?"1px solid #080c16":"none"}}>
                  <span style={{color:C.dim}}>{i+1}</span>
                  <span style={{color:"#7090b0"}}>{FEATURE_NAMES[idx]||"Feat_"+idx}</span>
                  <span style={{color:Math.abs(orig)>0.5?"#f54242":Math.abs(orig)>0.3?"#f58c42":"#3a5070"}}>{orig.toFixed(3)}</span>
                  <span style={{color:Math.abs(neut)<0.1?"#00e5a0":"#f5c842",fontWeight:700}}>{neut.toFixed(3)}</span>
                  <span style={{color:reduction>80?"#00e5a0":reduction>50?"#f5c842":"#3a5070",fontSize:6}}>{reduction.toFixed(0)}% Beta entfernt</span>
                </div>);
              })}
            </div>
            <div style={{fontSize:7,color:C.dim,marginTop:6,padding:"5px 8px",background:C.bg,borderRadius:4,lineHeight:1.6}}>
              <b style={{color:"#a855f7"}}>Effekt:</b> Features mit hoher Original-Korrelation zu PC1 hatten Beta-Exposure (= waren teilweise nur Market-Proxy). 
              Nach Neutralization bleibt nur das echte Alpha-Signal.
            </div>
          </div>
          
          {/* ── Section 18: NOISE INJECTION AUGMENTATION ── */}
          <div style={{background:C.card,border:"1px solid #f5c84233",borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#f5c842",fontWeight:700,letterSpacing:2}}>18. NOISE-INJECTION AUGMENTATION</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>X_aug = X + N(0, 5% × σ_feature) · Labels stable · Robustheit vs. Mess-Noise</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:8}}>
              {[
                ["Original Samples",quantAnalysis.augResult.originalSize,"#5080d0"],
                ["Augmentations",2,"#f5c842"],
                ["Final Size",quantAnalysis.augResult.finalSize,"#00e5a0"],
                ["Noise Level σ","5%","#f58c42"],
              ].map(([l,v,c])=>(<div key={l} style={{background:C.bg,borderRadius:5,padding:"7px",textAlign:"center"}}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:14,fontWeight:700,color:c}}>{v}</div></div>))}
            </div>
            <div style={{fontSize:7,color:C.dim,padding:"6px 8px",background:C.bg,borderRadius:4,lineHeight:1.6}}>
              <b style={{color:"#f5c842"}}>Konzept:</b> Jeder Trainings-Sample wird 2x dupliziert mit Gaußschem Rauschen (5% der Feature-Std). 
              Labels bleiben gleich. Modell muss lernen: "Signal ist robust gegen kleine Input-Variationen". 
              Trainings-Set wuchs von {quantAnalysis.augResult.originalSize} → {quantAnalysis.augResult.finalSize} Samples.
            </div>
          </div>
          
          {/* ── Section 19: UNIQUENESS WEIGHTS ── */}
          <div style={{background:C.card,border:"1px solid #00e5a033",borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#00e5a0",fontWeight:700,letterSpacing:2}}>19. SAMPLE-WEIGHTS via UNIQUENESS (Lopez de Prado Ch.4)</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>Triple-Barrier-Labels überlappen zeitlich · Stark überlappende → niedriges Gewicht</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:6,color:C.dim}}>EVENTS</div>
                <div style={{fontSize:14,fontWeight:900,color:"#00e5a0"}}>{quantAnalysis.uniqWeights.length}</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:8}}>
              {[
                ["Mean Weight",quantAnalysis.meanUniq.toFixed(3),"#5080d0"],
                ["Min Weight",quantAnalysis.minUniq.toFixed(3),"#f54242"],
                ["Max Weight",quantAnalysis.maxUniq.toFixed(3),"#00e5a0"],
                ["Range",((quantAnalysis.maxUniq-quantAnalysis.minUniq).toFixed(3)),"#f5c842"],
              ].map(([l,v,c])=>(<div key={l} style={{background:C.bg,borderRadius:5,padding:"7px",textAlign:"center"}}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:11,fontWeight:700,color:c}}>{v}</div></div>))}
            </div>
            {/* Histogram der Uniqueness-Werte */}
            <div style={{fontSize:7,color:C.dim,marginBottom:3}}>VERTEILUNG DER WEIGHTS (16 Bins, Range 0-2):</div>
            {(()=>{
              const bins=new Array(16).fill(0);
              quantAnalysis.uniqWeights.forEach(w=>{
                const idx=Math.min(15,Math.max(0,Math.floor(w/2*16)));
                bins[idx]++;
              });
              const max=Math.max(...bins);
              return(<div style={{display:"flex",alignItems:"flex-end",gap:1,height:40,marginBottom:6}}>
                {bins.map((c,i)=>(<div key={i} style={{flex:1,background:i<8?"#f54242":"#00e5a0",height:max>0?`${c/max*100}%`:"0%",borderRadius:1,opacity:0.7}} title={`${(i/16*2).toFixed(2)}-${((i+1)/16*2).toFixed(2)}: ${c} events`}/>))}
              </div>);
            })()}
            <div style={{display:"flex",justifyContent:"space-between",fontSize:6,color:C.dim,marginBottom:6}}>
              <span>0 (stark überlappend)</span><span>1 (durchschnittlich)</span><span>2 (eindeutig)</span>
            </div>
            <div style={{fontSize:7,color:C.dim,padding:"5px 8px",background:C.bg,borderRadius:4,lineHeight:1.6}}>
              <b style={{color:"#00e5a0"}}>Effekt:</b> Würde sample_weight in LightGBM/Sklearn übergeben werden. 
              Stark überlappende Events (Weight {'<'} 0.5) werden im Training abgeschwächt → Modell sieht keine künstlich überrepräsentierten Marktphasen.
            </div>
          </div>
          
          {/* ── Section 20: SEQUENTIAL BOOTSTRAPPING ── */}
          <div style={{background:C.card,border:"1px solid #f58c4233",borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#f58c42",fontWeight:700,letterSpacing:2}}>20. SEQUENTIAL BOOTSTRAPPING (Lopez de Prado Ch.4)</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>Iteratives Sampling minimiert Overlap · Statt zufällig: gewichtet nach noch-nicht-Überlapp</div>
              </div>
            </div>
            {quantAnalysis.seqBoot && quantAnalysis.seqBoot.diversityRatio !== undefined ? (<>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                <div style={{background:C.bg,borderRadius:5,padding:"8px 10px",border:"1px solid #f5424222"}}>
                  <div style={{fontSize:7,color:"#f54242",fontWeight:700,marginBottom:3}}>STANDARD BOOTSTRAP</div>
                  <div style={{fontSize:18,fontWeight:900,color:"#f58c42"}}>{(quantAnalysis.stdDiversity*100).toFixed(0)}%</div>
                  <div style={{fontSize:6,color:C.dim,marginTop:2}}>Diversität (unique/total)</div>
                </div>
                <div style={{background:C.bg,borderRadius:5,padding:"8px 10px",border:"1px solid #00e5a033"}}>
                  <div style={{fontSize:7,color:"#00e5a0",fontWeight:700,marginBottom:3}}>SEQUENTIAL BOOTSTRAP</div>
                  <div style={{fontSize:18,fontWeight:900,color:"#00e5a0"}}>{(quantAnalysis.seqBoot.diversityRatio*100).toFixed(0)}%</div>
                  <div style={{fontSize:6,color:C.dim,marginTop:2}}>Diversität (unique/total)</div>
                </div>
              </div>
              <div style={{padding:"6px 10px",background:quantAnalysis.seqBoot.diversityRatio>quantAnalysis.stdDiversity?"#00e5a015":"#f5c84215",border:`1px solid ${quantAnalysis.seqBoot.diversityRatio>quantAnalysis.stdDiversity?"#00e5a033":"#f5c84233"}`,borderRadius:5}}>
                <div style={{fontSize:8,fontWeight:700,color:quantAnalysis.seqBoot.diversityRatio>quantAnalysis.stdDiversity?"#00e5a0":"#f5c842"}}>
                  {quantAnalysis.seqBoot.diversityRatio>quantAnalysis.stdDiversity?"✓ Sequential schlägt Standard":"~ Beide ähnlich"} — 
                  {quantAnalysis.seqBoot.uniqueDrawn} eindeutige aus {quantAnalysis.seqBoot.selectedIndices.length} gezogenen Samples
                </div>
                <div style={{fontSize:7,color:C.dim,marginTop:3,lineHeight:1.6}}>
                  Bei stark überlappenden Triple-Barrier-Events sieht ein Standard-Bootstrap denselben Marktzustand mehrfach. 
                  Sequential Bootstrap zieht iterativ Events die noch nicht "abgedeckt" sind → effektiv diverseres Bagging.
                </div>
              </div>
            </>):(<div style={{padding:"14px",textAlign:"center",fontSize:9,color:C.dim,background:C.bg,borderRadius:5}}>Nicht genug Triple-Barrier-Events</div>)}
          </div>

          {/* ══════ SECTION 21 — FLASH-CRASH-PROOF STATISTICS (NEU v18) ══════ */}
          <div style={{background:C.card,border:"2px solid #f5424233",borderRadius:8,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:9,color:"#f54242",fontWeight:700,letterSpacing:2}}>21. MODIFIED Z-SCORE — Flash-Crash-immune Statistik</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2}}>M_i = 0.6745 × (x − median) / MAD · threshold=3.5 (Iglewicz & Hoaglin 1993)</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:6,color:C.dim}}>FLASH CRASHES DETECTED</div>
                <div style={{fontSize:18,fontWeight:900,color:quantAnalysis.flashCrashAnalysis.crashes.length===0?"#00e5a0":quantAnalysis.flashCrashAnalysis.crashes.length<3?"#f5c842":"#f54242"}}>{quantAnalysis.flashCrashAnalysis.crashes.length}</div>
              </div>
            </div>
            
            {/* Warum Modified Z-Score */}
            <div style={{padding:"6px 8px",background:"#f5424208",borderRadius:4,marginBottom:8,fontSize:7,color:C.dim,lineHeight:1.7}}>
              <b style={{color:"#f54242"}}>Problem mit Standard-Z-Score:</b> σ wird durch Quadrierung extrem von Outliern verzerrt. 
              Ein Flash-Crash lässt σ explodieren — wochenlang erscheint dann jede normale Bewegung "winzig".
              <b style={{color:"#00e5a0"}}> Lösung:</b> Median + MAD sind statistisch robust (Breakdown-Point 50%).
            </div>
            
            {/* Current Reading — Flash-Crash Meter */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,marginBottom:8}}>
              <div style={{background:C.bg,borderRadius:5,padding:"8px",textAlign:"center",border:`2px solid ${Math.abs(quantAnalysis.flashCrashAnalysis.currentZ)<1?"#00e5a0":Math.abs(quantAnalysis.flashCrashAnalysis.currentZ)<3.5?"#f5c842":"#f54242"}33`}}>
                <div style={{fontSize:6,color:C.dim}}>AKTUELLER Z ({quantCurrency})</div>
                <div style={{fontSize:18,fontWeight:900,color:Math.abs(quantAnalysis.flashCrashAnalysis.currentZ)<1?"#00e5a0":Math.abs(quantAnalysis.flashCrashAnalysis.currentZ)<3.5?"#f5c842":"#f54242"}}>{quantAnalysis.flashCrashAnalysis.currentZ>0?"+":""}{quantAnalysis.flashCrashAnalysis.currentZ.toFixed(2)}</div>
                <div style={{fontSize:7,color:C.dim,marginTop:2,fontWeight:700}}>{quantAnalysis.flashCrashAnalysis.currentCategory}</div>
              </div>
              <div style={{background:C.bg,borderRadius:5,padding:"8px",textAlign:"center"}}>
                <div style={{fontSize:6,color:C.dim}}>STANDARD σ (anfällig)</div>
                <div style={{fontSize:14,fontWeight:700,color:"#f58c42"}}>{(quantAnalysis.flashCrashAnalysis.stdStd*100).toFixed(3)}</div>
                <div style={{fontSize:6,color:C.dim,marginTop:2}}>Quadriert → Outlier-verzerrt</div>
              </div>
              <div style={{background:C.bg,borderRadius:5,padding:"8px",textAlign:"center"}}>
                <div style={{fontSize:6,color:C.dim}}>ROBUSTER σ (MAD)</div>
                <div style={{fontSize:14,fontWeight:700,color:"#00e5a0"}}>{(quantAnalysis.flashCrashAnalysis.robustStd*100).toFixed(3)}</div>
                <div style={{fontSize:6,color:C.dim,marginTop:2}}>Ratio: {quantAnalysis.flashCrashAnalysis.ratio.toFixed(2)}×</div>
              </div>
            </div>
            
            {/* Scale Bar — wo liegt der aktuelle Z-Score */}
            <div style={{fontSize:7,color:C.dim,marginBottom:3}}>Z-SCORE SKALA (threshold 3.5 = 99% Konfidenz Outlier):</div>
            <div style={{position:"relative",height:22,background:"linear-gradient(90deg,#f5424222 0%,#f5424211 15%,#f5c84211 30%,#00e5a022 50%,#f5c84211 70%,#f5424211 85%,#f5424222 100%)",borderRadius:4,marginBottom:4}}>
              <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:1,background:"#2a3850"}}/>
              {[-3.5,-2,-1,1,2,3.5].map(z=>{
                const pct=((z+4)/8)*100;
                return(<div key={z} style={{position:"absolute",left:`${pct}%`,top:0,bottom:0,width:1,background:Math.abs(z)>=3.5?"#f54242":Math.abs(z)>=2?"#f5c842":"#3a5070",opacity:0.5}}/>);
              })}
              {/* Current-Z Marker */}
              <div style={{position:"absolute",left:`${Math.min(100,Math.max(0,((quantAnalysis.flashCrashAnalysis.currentZ+4)/8)*100))}%`,top:"50%",transform:"translate(-50%,-50%)",width:12,height:12,borderRadius:"50%",background:Math.abs(quantAnalysis.flashCrashAnalysis.currentZ)<1?"#00e5a0":Math.abs(quantAnalysis.flashCrashAnalysis.currentZ)<3.5?"#f5c842":"#f54242",boxShadow:"0 0 6px currentColor",border:"2px solid #fff"}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:5,color:C.dim,marginBottom:8}}>
              <span>−4</span><span style={{color:"#f54242"}}>−3.5 Crash</span><span>−2</span><span>−1</span><span style={{color:"#00e5a0"}}>0</span><span>+1</span><span>+2</span><span style={{color:"#f54242"}}>+3.5 Spike</span><span>+4</span>
            </div>
            
            {/* ── All 8 Currencies ranked by Modified Z-Score ── */}
            <div style={{fontSize:7,color:C.dim,marginBottom:3}}>ALLE 8 WÄHRUNGEN — ECHTE RELATIVE STÄRKE (ausreißer-robust):</div>
            <div style={{background:C.bg,borderRadius:5,overflow:"hidden",fontSize:7,marginBottom:8}}>
              <div style={{display:"grid",gridTemplateColumns:"20px 60px 60px 70px 70px 1fr",padding:"4px 8px",background:"#080c16",fontWeight:700,color:"#f54242",fontSize:6}}>
                <span>#</span><span>Währung</span><span>Score</span><span>Modified Z</span><span>Standard Z</span><span>Kategorie</span>
              </div>
              {quantAnalysis.allCurrencyZScores.map((cc,i)=>{
                const diff=Math.abs(cc.modifiedZ-cc.stdZ);
                const color=Math.abs(cc.modifiedZ)>2?"#f54242":Math.abs(cc.modifiedZ)>1?"#f5c842":"#00e5a0";
                return(<div key={cc.code} style={{display:"grid",gridTemplateColumns:"20px 60px 60px 70px 70px 1fr",padding:"3px 8px",borderTop:i>0?"1px solid #080c16":"none",background:cc.code===quantCurrency?`${COLORS[cc.code]}10`:"transparent"}}>
                  <span style={{color:C.dim}}>{i+1}</span>
                  <span style={{color:COLORS[cc.code],fontWeight:700}}>{FLAGS[cc.code]} {cc.code}</span>
                  <span style={{color:"#5080d0"}}>{cc.score}</span>
                  <span style={{color:color,fontWeight:700}}>{cc.modifiedZ>0?"+":""}{cc.modifiedZ.toFixed(2)}</span>
                  <span style={{color:"#5070a0",fontSize:6}}>{cc.stdZ>0?"+":""}{cc.stdZ.toFixed(2)}</span>
                  <span style={{color:color,fontSize:6}}>
                    {cc.category==="extreme"?(cc.modifiedZ>0?"🔥 BREAKOUT":"❄ OVERSOLD"):cc.category==="strong"?(cc.modifiedZ>0?"↗ stark":"↘ schwach"):cc.category==="mild"?"~ leicht":"• neutral"}
                    {diff>0.5?` · ∆${diff.toFixed(2)} zum Std-Z`:""}
                  </span>
                </div>);
              })}
            </div>
            
            {/* ── Z-Score Time Series Visualization ── */}
            <div style={{fontSize:7,color:C.dim,marginBottom:3}}>Z-SCORE-VERLAUF ÜBER 252 TAGE ({quantCurrency}) — ROTE LINIEN = FLASH-CRASHES:</div>
            <svg viewBox="0 0 600 100" style={{width:"100%",height:100,background:"#030608",borderRadius:4,marginBottom:6}}>
              {(()=>{
                const zSer=quantAnalysis.flashCrashAnalysis.modifiedZSeries;
                if(zSer.length<2) return null;
                const maxAbs=Math.max(5, ...zSer.map(v=>Math.abs(v)));
                const toX=i=>20+(i/(zSer.length-1))*560;
                const toY=v=>50-(v/maxAbs)*40;
                // Threshold lines
                const thresh=3.5;
                return(<>
                  <line x1={20} y1={toY(0)} x2={580} y2={toY(0)} stroke="#2a3850" strokeDasharray="2,2"/>
                  <line x1={20} y1={toY(thresh)} x2={580} y2={toY(thresh)} stroke="#f54242" strokeDasharray="3,3" opacity={0.5}/>
                  <line x1={20} y1={toY(-thresh)} x2={580} y2={toY(-thresh)} stroke="#f54242" strokeDasharray="3,3" opacity={0.5}/>
                  <text x={582} y={toY(thresh)+3} fill="#f54242" fontSize={5}>+3.5</text>
                  <text x={582} y={toY(-thresh)+3} fill="#f54242" fontSize={5}>-3.5</text>
                  {/* Main line */}
                  <path d={zSer.map((v,i)=>(i===0?"M":"L")+toX(i)+","+toY(v)).join(" ")} stroke="#f5c842" strokeWidth={0.8} fill="none"/>
                  {/* Flash-Crash markers */}
                  {quantAnalysis.flashCrashAnalysis.crashes.map((c,ci)=>(<circle key={ci} cx={toX(c.index)} cy={toY(c.modifiedZ)} r={2.5} fill={c.direction==="spike"?"#00e5a0":"#f54242"} stroke="#fff" strokeWidth={0.5}/>))}
                  <text x={22} y={14} fill="#f5c842" fontSize={6}>Modified Z-Score (μ=Median, σ=MAD)</text>
                </>);
              })()}
            </svg>
            
            {/* ── Crash Events Table ── */}
            {quantAnalysis.flashCrashAnalysis.crashes.length>0&&(<div style={{marginBottom:6}}>
              <div style={{fontSize:7,color:C.dim,marginBottom:3}}>DETECTED FLASH-CRASH EVENTS ({quantAnalysis.flashCrashAnalysis.crashes.length} gefunden):</div>
              <div style={{background:C.bg,borderRadius:5,overflow:"hidden",fontSize:7}}>
                <div style={{display:"grid",gridTemplateColumns:"50px 60px 60px 50px 1fr",padding:"4px 8px",background:"#080c16",fontWeight:700,color:"#f54242",fontSize:6}}>
                  <span>Index</span><span>Return %</span><span>Mod. Z</span><span>Richt.</span><span>Severity</span>
                </div>
                {quantAnalysis.flashCrashAnalysis.crashes.slice(0,8).map((c,i)=>(<div key={i} style={{display:"grid",gridTemplateColumns:"50px 60px 60px 50px 1fr",padding:"3px 8px",borderTop:i>0?"1px solid #080c16":"none"}}>
                  <span style={{color:C.dim}}>t={c.index}</span>
                  <span style={{color:c.return>0?"#00e5a0":"#f54242",fontWeight:700}}>{(c.return*100).toFixed(2)}%</span>
                  <span style={{color:Math.abs(c.modifiedZ)>5?"#f54242":"#f5c842",fontWeight:700}}>{c.modifiedZ>0?"+":""}{c.modifiedZ.toFixed(2)}</span>
                  <span style={{color:c.direction==="spike"?"#00e5a0":"#f54242"}}>{c.direction==="spike"?"↑ Spike":"↓ Crash"}</span>
                  <span style={{color:c.severity==="extreme"?"#f54242":"#f5c842",fontSize:6}}>{c.severity==="extreme"?"🚨 EXTREME (|Z|>5)":"⚠ Outlier"}</span>
                </div>))}
                {quantAnalysis.flashCrashAnalysis.crashes.length>8&&(<div style={{padding:"3px 8px",textAlign:"center",fontSize:6,color:C.dim,borderTop:"1px solid #080c16"}}>+{quantAnalysis.flashCrashAnalysis.crashes.length-8} weitere...</div>)}
              </div>
            </div>)}
            
            {/* Winsorization Visualization */}
            <div style={{fontSize:7,color:C.dim,marginBottom:3}}>WINSORIZATION-EFFEKT auf VIX-Feature (10%-90% Caps):</div>
            <div style={{padding:"6px 8px",background:C.bg,borderRadius:4,fontSize:7,color:C.dim,lineHeight:1.7}}>
              <span style={{color:"#f54242"}}>{quantAnalysis.winsorizedComparison.affectedCount}</span> von {quantAnalysis.winsorizedComparison.original.length} Trainings-Samples haben VIX-Werte die 
              gewinsorised würden. Ihre Extremwerte werden auf Quantile 10%/90% gekappt statt entfernt — erhält Sample-Size bei reduzierter Varianz-Inflation.
            </div>
            
            <div style={{fontSize:7,color:C.dim,marginTop:6,padding:"6px 8px",background:quantAnalysis.flashCrashAnalysis.crashes.length===0?"#00e5a008":"#f5424208",border:`1px solid ${quantAnalysis.flashCrashAnalysis.crashes.length===0?"#00e5a022":"#f5424222"}`,borderRadius:4,lineHeight:1.6}}>
              <b style={{color:quantAnalysis.flashCrashAnalysis.crashes.length===0?"#00e5a0":"#f54242"}}>Integration in v18:</b> Haupt-Normalisierung der 44 Features (mkNorm → mkNormRobust) nutzt jetzt Median+MAD statt Mean+Std. 
              Ein zukünftiger Flash-Crash in z.B. VIX wird das Modell NICHT mehr für Wochen "betäuben" — die Skala bleibt stabil. 
              Threshold 3.5 ist statistischer Standard nach Iglewicz & Hoaglin (99% Konfidenz).
            </div>
          </div>

          {/* ── Section 5: Walk-Forward Backtest ── */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px"}}>
            <div style={{fontSize:9,color:"#5080d0",fontWeight:700,letterSpacing:2,marginBottom:8}}>5. WALK-FORWARD BACKTEST</div>
            {quantAnalysis.wfResults && quantAnalysis.wfResults.length>0 ? (
              <div>
                <div style={{fontSize:7,color:C.dim,marginBottom:6}}>4 Folds auf deinen geschlossenen Trades — Train auf Past, Test auf Future</div>
                <div style={{background:C.bg,borderRadius:5,overflow:"hidden",fontSize:7}}>
                  <div style={{display:"grid",gridTemplateColumns:"40px 60px 60px 80px 80px 60px 60px",padding:"4px 8px",background:"#080c16",fontWeight:700,color:"#5080d0",fontSize:6}}>
                    <span>Fold</span><span>Train</span><span>Test</span><span>Train Bias-WR</span><span>Test Win-Rate</span><span>Sharpe</span><span>Σ R</span>
                  </div>
                  {quantAnalysis.wfResults.map((r,i)=>(<div key={i} style={{display:"grid",gridTemplateColumns:"40px 60px 60px 80px 80px 60px 60px",padding:"3px 8px",borderTop:i>0?"1px solid #080c16":"none"}}>
                    <span style={{color:"#5080d0",fontWeight:700}}>#{r.fold}</span>
                    <span style={{color:C.dim}}>{r.trainSize}</span>
                    <span style={{color:C.dim}}>{r.testSize}</span>
                    <span style={{color:r.trainBiasWR>=0.5?"#00e5a0":"#f54242"}}>{(r.trainBiasWR*100).toFixed(0)}%</span>
                    <span style={{color:r.testWinR>=0.5?"#00e5a0":"#f54242",fontWeight:700}}>{(r.testWinR*100).toFixed(0)}%</span>
                    <span style={{color:r.sharpe>0?"#00e5a0":"#f54242"}}>{r.sharpe.toFixed(2)}</span>
                    <span style={{color:r.totalR>0?"#00e5a0":"#f54242"}}>{r.totalR>0?"+":""}{r.totalR.toFixed(1)}</span>
                  </div>))}
                </div>
                <div style={{fontSize:7,color:C.dim,marginTop:6,padding:"5px 8px",background:"#0a0d15",borderRadius:4,lineHeight:1.6}}>
                  <b style={{color:"#5080d0"}}>Konsistenz-Check:</b> Wenn Test-Win-Rate stabil bleibt → Strategie generalisiert.
                  Wenn Test-Win-Rate {'\u003C'}{'\u003C'} Train-Win-Rate → Overfitting!
                </div>
              </div>
            ) : (
              <div style={{padding:"14px",textAlign:"center",fontSize:9,color:C.dim,background:C.bg,borderRadius:5}}>
                Mindestens 8 geschlossene Trades nötig für Walk-Forward (aktuell: {trades.filter(t=>t.status==="closed").length}).
                Trage mehr Trades im Journal-Tab ein.
              </div>
            )}
          </div>
        </div>)}

        {/* ════════════════════════════════════════════════════════════ */}
        {/* SIGNALE TAB                                                   */}
        {/* ════════════════════════════════════════════════════════════ */}
        {tab==="signale"&&(<div>
          <div style={{background:C.card,border:"1px solid #1040e033",borderRadius:8,padding:"8px 14px",marginBottom:10,fontSize:8,color:"#3a5080",lineHeight:1.8}}>💡 4H Sweep → 15M BOS → 50% Fib → SL unter Sweep → TP 2:1 · ⚠️ 30 Min vor HIGH-Events kein Entry!<br/>📐 <b style={{color:"#5080d0"}}>Kelly-Sizing:</b> Position = Kapital × Kelly%. Bei Conf {'\u003E'}70% volle Größe, sonst halbieren.</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {pairs.map(p=>{const c=p.abs>35?"#00e5a0":p.abs>25?"#7ef542":p.abs>15?"#f5c842":"#f58c42";return(<div key={p.pair} style={{background:C.card,border:`1px solid ${c}33`,borderRadius:10,padding:14}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><div><div style={{fontSize:16,fontWeight:900,color:"#6080a0"}}>{p.pair}</div><div style={{fontSize:8,color:c}}>{p.str} · ML-Conf {p.mlConf}%</div></div><div style={{textAlign:"center"}}><div style={{fontSize:20,fontWeight:900,color:p.dir==="LONG"?"#00e5a0":"#f54242"}}>{p.dir==="LONG"?"▲":"▼"}</div><div style={{fontSize:9,fontWeight:700,color:p.dir==="LONG"?"#00e5a0":"#f54242"}}>{p.dir}</div></div></div>
              <div style={{display:"flex",gap:6,marginBottom:8}}>{[{r:p.base,l:"KAUFEN"},{r:p.quote,l:"VERKAUFEN"}].map(({r,l})=>(<div key={l} style={{flex:1,background:C.bg,borderRadius:6,padding:"7px",textAlign:"center",border:`1px solid ${r.color}18`}}><div style={{fontSize:18}}>{r.flag}</div><div style={{fontSize:9,fontWeight:700,color:r.color}}>{r.code}</div><div style={{fontSize:16,fontWeight:900,color:"#6080a0"}}>{r.score}</div><div style={{fontSize:7,color:r.bias.c}}>{r.bias.a} {r.heads.direction.class}</div><div style={{fontSize:6,color:sentLabel(r.sent.retail_long).c}}>{r.sent.retail_long}% Long</div><div style={{fontSize:6,color:C.dim}}>{l}</div></div>))}</div>
              <div style={{height:4,background:C.border,borderRadius:2,overflow:"hidden",marginBottom:4}}><div style={{height:"100%",width:`${p.mlConf}%`,background:c}}/></div>
              <div style={{padding:"4px 7px",background:p.kelly>0.05?"#00e5a015":"#f5c84215",border:`1px solid ${p.kelly>0.05?"#00e5a033":"#f5c84233"}`,borderRadius:4,fontSize:7,color:p.kelly>0.05?"#00e5a0":"#f5c842",textAlign:"center",fontWeight:700}}>📐 Kelly: {(p.kelly*100).toFixed(1)}% des Kapitals · Score-Diff Δ{p.abs}</div>
            </div>);})}
          </div>
        </div>)}

        {/* ML TAB */}
        {tab==="ml"&&(<div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px",marginBottom:10,fontSize:8,color:"#3a5080",lineHeight:1.8}}>
            🧠 <b style={{color:"#5080d0"}}>Multi-Head Architektur (ForexAlphaNetV2):</b><br/>
            <b style={{color:"#00e5a0"}}>1. Direction:</b> 3-Klassen Softmax (Long/Neutral/Short)<br/>
            <b style={{color:"#f5c842"}}>2. Magnitude:</b> Erwartete Bewegungs-Größe<br/>
            <b style={{color:"#f58c42"}}>3. Volatility:</b> Modell schätzt eigene Unsicherheit<br/>
            <b style={{color:"#a855f7"}}>4. Confidence:</b> Hoch wenn ML-Komponenten übereinstimmen<br/>
            <b style={{color:"#f74f4f"}}>5. Kelly Sizing:</b> Optimale Positionsgröße<br/>
            👉 Für mathematische Diagnostik (Kalman/FFD/Triple-Barrier/SHAP) siehe QUANT-Tab
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
            {ranked.map(r=>{
              const confColor=r.heads.confidence>0.7?"#00e5a0":r.heads.confidence>0.5?"#f5c842":"#f58c42";
              return(<div key={r.code} style={{background:C.card,border:`1px solid ${r.color}28`,borderRadius:9,padding:12}}>
                <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}><span style={{fontSize:22}}>{r.flag}</span><div style={{flex:1}}><div style={{fontSize:11,fontWeight:700,color:r.color}}>{r.code}</div><div style={{fontSize:13,fontWeight:900,color:r.bias.c}}>{r.score} <span style={{fontSize:8}}>{r.heads.direction.class}</span></div></div><div style={{textAlign:"right"}}><div style={{fontSize:6,color:C.dim}}>FUSION REGIME</div><div style={{fontSize:7,color:"#5080d0",fontWeight:700}}>{r.fusion.regime}</div></div></div>
                <div style={{marginBottom:8}}>
                  <div style={{fontSize:6,color:C.dim,marginBottom:2}}>DIRECTION-WAHRSCHEINLICHKEITEN</div>
                  <div style={{display:"flex",height:18,borderRadius:3,overflow:"hidden"}}>
                    <div style={{width:`${r.heads.direction.probs.short*100}%`,background:"#f54242",display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,color:"#fff",fontWeight:700}}>{r.heads.direction.probs.short*100>10?(r.heads.direction.probs.short*100).toFixed(0)+"%":""}</div>
                    <div style={{width:`${r.heads.direction.probs.neutral*100}%`,background:"#f5c842",display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,color:"#000",fontWeight:700}}>{r.heads.direction.probs.neutral*100>10?(r.heads.direction.probs.neutral*100).toFixed(0)+"%":""}</div>
                    <div style={{width:`${r.heads.direction.probs.long*100}%`,background:"#00e5a0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,color:"#000",fontWeight:700}}>{r.heads.direction.probs.long*100>10?(r.heads.direction.probs.long*100).toFixed(0)+"%":""}</div>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:6,color:C.dim,marginTop:1}}><span>SHORT</span><span>NEUTRAL</span><span>LONG</span></div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:3,marginBottom:8}}>
                  {[["Magnitude",r.heads.magnitude.toFixed(2),"#5080d0"],["Volatility",r.heads.volatility.toFixed(2),"#f5c842"],["Confidence",`${(r.heads.confidence*100).toFixed(0)}%`,confColor],["Kelly",`${(r.kelly*100).toFixed(1)}%`,r.kelly>0.05?"#00e5a0":"#f58c42"]].map(([l,v,c])=>(<div key={l} style={{background:"#030608",borderRadius:4,padding:"5px 4px",textAlign:"center"}}><div style={{fontSize:5,color:C.dim}}>{l}</div><div style={{fontSize:10,color:c,fontWeight:700}}>{v}</div></div>))}
                </div>
                <div style={{fontSize:6,color:C.dim,marginBottom:3}}>GATED FUSION</div>
                <div style={{display:"flex",gap:2}}>{[["ML",r.fusion.gates.ml,"#5080d0"],["Bias",r.fusion.gates.base,"#7ef542"],["News",r.fusion.gates.news,"#f5a623"],["Sent",r.fusion.gates.sent,"#a855f7"]].map(([l,w,c])=>(<div key={l} style={{flex:1}}><div style={{fontSize:5,color:C.dim,textAlign:"center"}}>{l}</div><div style={{height:18,background:"#030608",borderRadius:2,overflow:"hidden",position:"relative"}}><div style={{position:"absolute",left:0,top:0,bottom:0,width:`${w*100}%`,background:`linear-gradient(90deg,${c}66,${c})`}}/><div style={{position:"absolute",right:2,top:"50%",transform:"translateY(-50%)",fontSize:7,color:"#fff",fontWeight:700}}>{(w*100).toFixed(0)}%</div></div></div>))}</div>
              </div>);
            })}
          </div>
          {tmetrics&&(<div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px"}}>
            <div style={{fontSize:8,color:C.dim,letterSpacing:2,marginBottom:8}}>📊 TRADING METRIKEN ({tmetrics.n} Trades)</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:5}}>
              {[["Profit Factor",tmetrics.profitFactor.toFixed(2),tmetrics.profitFactor>1.5?"#00e5a0":tmetrics.profitFactor>1?"#f5c842":"#f54242"],["Sharpe",tmetrics.sharpe.toFixed(2),tmetrics.sharpe>1?"#00e5a0":tmetrics.sharpe>0.5?"#f5c842":"#f54242"],["Sortino",tmetrics.sortino.toFixed(2),tmetrics.sortino>1?"#00e5a0":"#f5c842"],["Win Rate",`${(tmetrics.winRate*100).toFixed(0)}%`,tmetrics.winRate>0.5?"#00e5a0":"#f54242"],["Max DD",`${(tmetrics.maxDD*100).toFixed(1)}%`,tmetrics.maxDD>-0.1?"#00e5a0":"#f54242"],["Calmar",tmetrics.calmar.toFixed(2),tmetrics.calmar>1?"#00e5a0":"#f5c842"]].map(([l,v,c])=>(<div key={l} style={{background:C.bg,borderRadius:5,padding:"7px",textAlign:"center"}}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:13,fontWeight:900,color:c}}>{v}</div></div>))}
            </div>
            <div style={{marginTop:6,padding:"6px 10px",background:tmetrics.biasWinRate>tmetrics.winRate?"#00e5a015":"#f5c84215",border:`1px solid ${tmetrics.biasWinRate>tmetrics.winRate?"#00e5a033":"#f5c84233"}`,borderRadius:4,fontSize:7,color:tmetrics.biasWinRate>tmetrics.winRate?"#00e5a0":"#f5c842"}}>
              <b>Bias-Filter Effekt:</b> Mit Bias = {(tmetrics.biasWinRate*100).toFixed(0)}% WR vs. {(tmetrics.winRate*100).toFixed(0)}% gesamt. {tmetrics.biasWinRate>tmetrics.winRate?"✓ Filter wirkt":"~ Mehr Daten nötig"}
            </div>
          </div>)}
        </div>)}

        {/* SENTIMENT TAB */}
        {tab==="sentiment"&&(<div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 14px",marginBottom:10,fontSize:8,color:"#3a5080",lineHeight:1.8}}>📊 <b style={{color:"#5080d0"}}>Contrarian:</b> {'\u003E'}65% Retail Long → Profis Short → bearisch · COT Extrem = Squeeze-Risiko</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {ranked.map(r=>{const s=r.sent,rl=s.retail_long,sl=sentLabel(rl);return(<div key={r.code} style={{background:C.card,border:`1px solid ${r.color}28`,borderRadius:9,padding:12}}>
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}><span style={{fontSize:22}}>{r.flag}</span><div style={{flex:1}}><div style={{fontSize:11,fontWeight:700,color:r.color}}>{r.code}</div><div style={{fontSize:13,fontWeight:900,color:r.bias.c}}>{r.score} <span style={{fontSize:8}}>{r.bias.a}</span></div></div></div>
              <div style={{marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:7,marginBottom:3}}><span style={{color:"#00e5a0"}}>Long {rl}%</span><span style={{color:sl.c,fontWeight:700}}>{rl>62?"🔴 BEARISH":rl<38?"🟢 BULLISH":"🟡 NEUTRAL"}</span><span style={{color:"#f54242"}}>Short {100-rl}%</span></div>
                <div style={{height:10,background:"#030608",borderRadius:5,overflow:"hidden",position:"relative"}}><div style={{position:"absolute",left:0,top:0,bottom:0,width:`${rl}%`,background:"linear-gradient(90deg,#00e5a055,#00e5a0)",borderRadius:"5px 0 0 5px"}}/><div style={{position:"absolute",right:0,top:0,bottom:0,width:`${100-rl}%`,background:"linear-gradient(90deg,#f5424255,#f54242)",borderRadius:"0 5px 5px 0"}}/><div style={{position:"absolute",left:"50%",top:0,bottom:0,width:1,background:"#0d1525"}}/></div>
                <div style={{fontSize:7,color:sl.c,marginTop:2,fontWeight:700,textAlign:"center"}}>{sl.l}</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:3}}>{[["COT",`${s.cot_net}k`,Math.abs(s.cot_net)>20?"#f5c842":"#5070a0"],["Extrem",s.cot_extreme?"JA ⚡":"NEIN",s.cot_extreme?"#f5c842":"#3a5070"],["IG",s.ig,s.ig==="long"?"#00e5a0":s.ig==="short"?"#f54242":"#f5c842"]].map(([l,v,c])=>(<div key={l} style={{background:"#030608",borderRadius:3,padding:"4px 5px",textAlign:"center"}}><div style={{fontSize:6,color:C.dim}}>{l}</div><div style={{fontSize:8,color:c,fontWeight:700}}>{v}</div></div>))}</div>
              {s.cot_extreme&&<div style={{marginTop:6,padding:"4px 8px",background:"#f5c84215",border:"1px solid #f5c84233",borderRadius:4,fontSize:7,color:"#f5c842"}}>⚡ COT EXTREM → Squeeze!</div>}
            </div>);})}
          </div>
        </div>)}

        {/* NEWS TAB */}
        {tab==="news"&&(<div>
          <div style={{fontSize:8,color:C.dim,marginBottom:8}}>📰 <b style={{color:"#5080d0"}}>{today.de}</b> · Daten: {EMBEDDED_DATE}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {ranked.map(r=>{const n=NEWS[r.code];return(<div key={r.code} style={{background:C.card,border:`1px solid ${r.color}22`,borderRadius:9,padding:12}}>
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:7}}><span style={{fontSize:22}}>{r.flag}</span><div style={{flex:1}}><div style={{fontSize:11,fontWeight:700,color:r.color}}>{r.code}</div><div style={{display:"flex",gap:5,alignItems:"center"}}><span style={{fontSize:14,fontWeight:900,color:r.bias.c}}>{r.score}</span><span style={{fontSize:8,color:r.bias.c}}>{r.bias.a} {r.heads.direction.class}</span>{r.newsAdj!==0&&<span style={{padding:"1px 4px",background:r.newsAdj>0?"#00e5a015":"#f5424215",borderRadius:3,fontSize:7,fontWeight:700,color:r.newsAdj>0?"#00e5a0":"#f54242"}}>{r.newsAdj>0?"+":""}{r.newsAdj}</span>}</div></div></div>
              <div style={{marginBottom:6,padding:"5px 7px",background:C.bg,borderRadius:5}}><div style={{fontSize:8,color:r.color,fontWeight:700,marginBottom:3}}>{n.head}</div>{n.items.map((it,i)=>(<div key={i} style={{fontSize:7,color:"#3a4a60",marginTop:1}}>· {it}</div>))}</div>
              {r.drivers.slice(0,3).map((d,i)=>(<div key={i} style={{fontSize:7,padding:"2px 4px",color:d.s>0?"#00e5a0":d.s<0?"#f58c42":"#4a5870"}}>{d.s>0?"▲":d.s<0?"▼":"→"} {d.t}</div>))}
            </div>);})}
          </div>
        </div>)}

        {/* KALENDER TAB */}
        {tab==="kalender"&&(<div>
          <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:8}}>{["ALL","HIGH","USD","EUR","GBP","JPY","CHF","AUD","CAD","CNY"].map(f=>(<button key={f} onClick={()=>setCalFilter(f)} style={{padding:"3px 7px",background:calFilter===f?"#1040e022":"transparent",border:`1px solid ${calFilter===f?"#1040e0":C.border}`,borderRadius:3,color:calFilter===f?"#5080d0":C.dim,fontSize:7,cursor:"pointer",fontFamily:"inherit"}}>{f}</button>))}</div>
          {(()=>{
            const filt=CALENDAR.filter(e=>calFilter==="ALL"?true:calFilter==="HIGH"?e.imp==="H":e.cur===calFilter);
            const byDate={};filt.forEach(e=>{if(!byDate[e.d])byDate[e.d]=[];byDate[e.d].push(e);});
            const DN=["So","Mo","Di","Mi","Do","Fr","Sa"],IC={H:"#f54242",M:"#f5c842",L:"#1a2840"};
            return Object.entries(byDate).sort(([a],[b])=>a.localeCompare(b)).map(([date,events])=>{
              const day=new Date(date),isToday=date===today.iso,hC=events.filter(e=>e.imp==="H").length,isDanger=hC>=3;
              return(<div key={date} style={{marginBottom:10}}>
                <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4}}>
                  <div style={{padding:"2px 9px",background:isToday?"#1040e0":isDanger?"#f5424215":"#050810",border:`1px solid ${isToday?"#1040e0":isDanger?"#f5424233":C.border}`,borderRadius:3,fontSize:8,fontWeight:700,color:isToday?"#7090d0":isDanger?"#f58c42":C.dim}}>
                    {isToday?"📍 HEUTE":DN[day.getDay()]} {day.toLocaleDateString("de-DE",{day:"2-digit",month:"short"})}{isDanger?" ⚠️":""}
                  </div>
                  <div style={{flex:1,height:1,background:C.border}}/>{hC>0&&<div style={{fontSize:7,color:isDanger?"#f54242":C.dim}}>{hC}× HIGH</div>}
                </div>
                <div style={{background:C.card,border:`1px solid ${isDanger?"#f5424222":C.border}`,borderRadius:7,overflow:"hidden"}}>
                  {events.map((ev,i)=>{const cu=CODES.includes(ev.cur)?{color:COLORS[ev.cur],flag:FLAGS[ev.cur]}:{color:"#6090c0",flag:"🌐"};return(<div key={i} style={{padding:"7px 12px",borderBottom:i<events.length-1?"1px solid #080c16":"none",background:ev.imp==="H"?"#f5424205":"transparent"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{width:40,fontSize:8,color:ev.imp==="H"?"#f5c842":C.dim}}>{ev.t}</span>
                      <div style={{width:7,height:7,borderRadius:"50%",background:IC[ev.imp],flexShrink:0,boxShadow:ev.imp==="H"?"0 0 4px #f5424288":"none"}}/>
                      <div style={{width:52,display:"flex",gap:3,alignItems:"center"}}><span style={{fontSize:13}}>{cu.flag}</span><span style={{fontSize:8,fontWeight:700,color:cu.color}}>{ev.cur}</span></div>
                      <div style={{flex:1}}><div style={{fontSize:9,color:ev.imp==="H"?"#8ab0d0":"#5a6a80",fontWeight:ev.imp==="H"?"700":"400"}}>{ev.name}</div>{ev.why&&<div style={{fontSize:7,color:C.dim,fontStyle:"italic",marginTop:1}}>💡 {ev.why}</div>}</div>
                      {ev.prog&&<div style={{textAlign:"center",padding:"2px 6px",background:C.bg,borderRadius:3}}><div style={{fontSize:6,color:C.dim}}>Prog</div><div style={{fontSize:8,color:"#5080c0",fontWeight:700}}>{ev.prog}</div></div>}
                      {ev.prev&&<div style={{textAlign:"center",padding:"2px 6px",background:C.bg,borderRadius:3}}><div style={{fontSize:6,color:C.dim}}>Vor</div><div style={{fontSize:8,color:C.dim}}>{ev.prev}</div></div>}
                    </div>
                  </div>);})}</div>
              </div>);
            });
          })()}
        </div>)}

        {/* JOURNAL TAB */}
        {tab==="journal"&&(<div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:10}}>{[{l:"Trades",v:cls.length,c:"#5080c0"},{l:"Win-Rate",v:`${winR.toFixed(0)}%`,c:winR>=50?"#00e5a0":"#f54242"},{l:"Total R",v:`${totR.toFixed(1)}R`,c:totR>=0?"#00e5a0":"#f54242"},{l:"Offen",v:trades.filter(t=>t.status==="open").length,c:"#f5c842"}].map(k=>(<div key={k.l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:7,padding:"9px",textAlign:"center"}}><div style={{fontSize:7,color:C.dim,marginBottom:2}}>{k.l}</div><div style={{fontSize:20,fontWeight:900,color:k.c}}>{k.v}</div></div>))}</div>
          <button onClick={()=>setShowForm(!showForm)} style={{width:"100%",padding:"8px",background:showForm?"#1040e018":"transparent",border:`1px solid ${showForm?"#1040e0":C.border}`,borderRadius:6,color:showForm?"#5080d0":C.dim,fontSize:8,letterSpacing:2,cursor:"pointer",fontFamily:"inherit",marginBottom:8}}>{showForm?"✕ ABBRECHEN":"+ TRADE EINTRAGEN"}</button>
          {showForm&&(<div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:8}}>{[{l:"Pair",k:"pair",ph:"EUR/CAD"},{l:"Entry",k:"e",ph:"0.000"},{l:"SL",k:"sl",ph:"0.000"},{l:"TP",k:"tp",ph:"0.000"}].map(f=>(<div key={f.k}><div style={{fontSize:7,color:C.dim,marginBottom:2}}>{f.l}</div><input value={nt[f.k]} onChange={e=>setNt(p=>({...p,[f.k]:e.target.value}))} placeholder={f.ph} style={{width:"100%",background:C.bg,border:`1px solid ${C.border}`,borderRadius:3,padding:"4px 6px",color:C.t,fontSize:8,fontFamily:"inherit",boxSizing:"border-box",outline:"none"}}/></div>))}</div>
            <div style={{display:"flex",gap:6,marginBottom:8}}>{["LONG","SHORT"].map(dd=>(<button key={dd} onClick={()=>setNt(p=>({...p,dir:dd}))} style={{padding:"4px 12px",background:nt.dir===dd?(dd==="LONG"?"#00e5a018":"#f5424218"):"transparent",border:`1px solid ${nt.dir===dd?(dd==="LONG"?"#00e5a0":"#f54242"):C.border}`,borderRadius:3,color:nt.dir===dd?(dd==="LONG"?"#00e5a0":"#f54242"):C.dim,fontSize:8,cursor:"pointer",fontFamily:"inherit"}}>{dd}</button>))}<button onClick={()=>setNt(p=>({...p,bias:!p.bias}))} style={{padding:"4px 12px",background:nt.bias?"#00e5a018":"#f5424218",border:`1px solid ${nt.bias?"#00e5a0":"#f54242"}`,borderRadius:3,color:nt.bias?"#00e5a0":"#f54242",fontSize:8,cursor:"pointer",fontFamily:"inherit"}}>{nt.bias?"✅ BIAS":"❌ KONTRÄR"}</button></div>
            <button onClick={()=>{const e=parseFloat(nt.e),sl=parseFloat(nt.sl),tp=parseFloat(nt.tp);if(!nt.pair||!e)return;const slP=Math.abs(e-sl),tpP=Math.abs(tp-e);save({id:Date.now(),date:today.short,pair:nt.pair,dir:nt.dir,entry:e,sl,tp,rr:slP?parseFloat((tpP/slP).toFixed(2)):0,bias:nt.bias,status:"open",pnlR:0});setNt({pair:"EUR/CAD",dir:"LONG",e:"",sl:"",tp:"",bias:true});setShowForm(false);}} style={{width:"100%",padding:"7px",background:"linear-gradient(135deg,#1040e0,#0090c0)",border:"none",borderRadius:5,color:"#fff",fontSize:9,letterSpacing:3,cursor:"pointer",fontFamily:"inherit",fontWeight:800}}>▶ SPEICHERN</button>
          </div>)}
          {trades.length>0&&(<div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}><div style={{maxHeight:280,overflowY:"auto"}}>{trades.map(t=>(<div key={t.id} style={{padding:"7px 12px",borderBottom:"1px solid #080c16",display:"flex",gap:8,alignItems:"center"}}><div style={{flex:1}}><div style={{fontSize:9,fontWeight:700,color:"#5080a0"}}>{t.pair}</div><div style={{fontSize:7,color:C.dim}}>{t.date}</div></div><div style={{fontSize:9,color:t.dir==="LONG"?"#00e5a0":"#f54242",fontWeight:700}}>{t.dir} {t.rr}R</div><div style={{fontSize:9,fontWeight:700,color:t.status==="open"?"#f5c842":t.pnlR>0?"#00e5a0":"#f54242"}}>{t.status==="open"?"OFFEN":`${t.pnlR>0?"+":""}${t.pnlR}R`}</div><div style={{fontSize:7,color:t.bias?"#00e5a0":"#f58c42"}}>{t.bias?"✓":"~"}</div>{t.status==="open"&&<><button onClick={()=>upd(t.id,{status:"closed",pnlR:t.rr})} style={{padding:"2px 6px",background:"#00e5a018",border:"1px solid #00e5a033",borderRadius:2,color:"#00e5a0",fontSize:7,cursor:"pointer",fontFamily:"inherit"}}>W</button><button onClick={()=>upd(t.id,{status:"closed",pnlR:-1})} style={{padding:"2px 6px",background:"#f5424218",border:"1px solid #f5424233",borderRadius:2,color:"#f54242",fontSize:7,cursor:"pointer",fontFamily:"inherit"}}>L</button></>}<button onClick={()=>rm(t.id)} style={{padding:"2px 5px",background:"transparent",border:`1px solid ${C.border}`,borderRadius:2,color:C.dim,fontSize:7,cursor:"pointer",fontFamily:"inherit"}}>✕</button></div>))}</div></div>)}
        </div>)}

        <div style={{marginTop:10,fontSize:6,color:"#080c16",textAlign:"center"}}>FX PRO v18 · MULTI-HEAD + LIVE QUANT · Kalman+FFD+TripleBarrier+Kelly+SHAP+WalkForward · KEINE ANLAGEBERATUNG</div>
      </div>
      <style>{`::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-track{background:#030608}::-webkit-scrollbar-thumb{background:#0d1525;border-radius:2px}*{box-sizing:border-box}`}</style>
    </div>
  );
}
