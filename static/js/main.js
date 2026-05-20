const FN   = ["Thumb","Index","Middle","Ring","Pinky"];
const FC   = ["#58A4B0","#DB9D47","#34d399","#fbbf24","#f87171"];
const FC_B = ["#ede9fe","#dbeafe","#d1fae5","#fef3c7","#fee2e2"];
const SN   = ["Thumb","ThAux","Index","Middle","Ring","Pinky"];
const SC   = ["#58A4B0","#7bbec9","#DB9D47","#34d399","#fbbf24","#f87171"];
const HLEN = 200, FSCALE = 2500;
const POSES = {
  open:   [0,   0,   0,    0,    0,    0],
  fist:   [800, 800, 1000, 1000, 1000, 1000],
  point:  [800, 800, 0,    1000, 1000, 1000],
  peace:  [800, 800, 0,    0,    1000, 1000],
  pinch:  [500, 0,   500,  0,    0,    0],
  ok:     [700, 600, 700,  0,    0,    0],
  gun:    [0,   0,   0,    1000, 1000, 1000],
  claw:   [0,   0,   500,  500,  500,  500],
  spread: [0,   0,   0,    0,    0,    0],
  relax:  [300, 200, 300,  300,  300,  300],
  three:  [800, 800, 0,    0,    0,    1000],
  rock:   [0,   0,   1000, 1000, 0,    0],
};
// Inspire RH56DFTP pose library
// Finger order: [Little, Ring, Middle, Index, Thumb-bend, Thumb-rotate]
// IPs: Left=192.168.124.210  Right=192.168.124.211  Port=6000
const INSPIRE_POSES = {
  open:   [0,    0,    0,    0,    0,    0  ],
  fist:   [1000, 1000, 1000, 1000, 1000, 500],
  point:  [1000, 1000, 1000, 0,    1000, 500],
  peace:  [1000, 1000, 0,    0,    900,  500],
  pinch:  [1000, 1000, 1000, 500,  500,  500],
  ok:     [0,    0,    0,    800,  200,  500],
  gun:    [1000, 1000, 1000, 0,    0,    0  ],
  claw:   [500,  500,  500,  500,  500,  500],
  spread: [0,    0,    0,    0,    0,    0  ],
  relax:  [300,  300,  300,  300,  200,  500],
  three:  [1000, 0,    0,    0,    1000, 500],
  rock:   [0,    1000, 1000, 0,    1000, 500],
  thumbs: [1000, 1000, 1000, 1000, 0,    500],
};
const DEMO_SEQ = [
  {pose:"open",dur:1200},{pose:"fist",dur:1200},{pose:"point",dur:900},
  {pose:"peace",dur:900},{pose:"gun",dur:900},{pose:"ok",dur:900},
  {pose:"claw",dur:900},{pose:"rock",dur:900},{pose:"three",dur:900},{pose:"open",dur:800}
];

let ws, hzF=0, hzT=performance.now();
const sliderVals = [0,0,0,0,0,0];
const history    = Array.from({length:5},()=>Array(HLEN).fill(0));
const forceLevel = [0,0,0,0,0];
const prevForce  = [0,0,0,0,0];
const tipPos     = Array.from({length:5},()=>({x:100,y:60}));
let demoRunning=false, dragState=null, dragMoved=false;
let totalFrames=0;
const sessionStart=Date.now();
let chartPaused=false;
const chartHidden=new Set();
let sliderLock=0; // global timestamp of last user interaction — blocks WS override

// Dev state
const MAX_BUFFER=18000;
const frameBuffer=[];
const labelsList=[];
const sessions=[];
let activeRecording=null;
let loggerRowCount=0;
let streamCount=0;
const MAX_STREAM=200;
const MAX_LOGGER=500;

// ── Tactile cards ──────────────────────────────────────
const fgrid=document.getElementById("fgrid");
FN.forEach((name,i)=>{
  const c=FC[i],R=14,circ=(2*Math.PI*R).toFixed(1);
  const d=document.createElement("div");
  d.className="fc";d.id="fc"+i;d.style.setProperty("--c",c);
  d.innerHTML='<div class="glow"></div>'+
    '<div class="flabel">'+name+'<span class="sdot" id="sd'+i+'"></span></div>'+
    '<div class="fc-row">'+
      '<svg class="arc-svg" viewBox="0 0 38 38">'+
        '<circle cx="19" cy="19" r="'+R+'" class="arc-track"/>'+
        '<circle cx="19" cy="19" r="'+R+'" class="arc-fill" id="arc'+i+'"'+
          ' stroke-dasharray="'+circ+'" stroke-dashoffset="'+circ+'" transform="rotate(-90 19 19)"/>'+
        '<text x="19" y="22" text-anchor="middle" font-size="7" class="nfsv-text"'+
          ' fill="'+c+'" font-family="Inter,sans-serif" id="nfsv'+i+'">0</text></svg>'+
      '<div class="nfv" id="nfv'+i+'" style="color:'+c+'">0.0</div>'+
      '<div style="font-size:12px;color:var(--text3);font-weight:600;letter-spacing:.08em;text-transform:uppercase">Newtons</div>'+
      '<div style="display:flex;align-items:center;gap:5px">'+
        '<svg width="18" height="18" viewBox="-12 -12 24 24" style="overflow:visible;flex-shrink:0">'+
          '<circle r="9" fill="none" stroke="#161720" stroke-width="1"/>'+
          '<g id="tarr'+i+'"><line x1="0" y1="0" x2="0" y2="-6" stroke="'+c+'" stroke-width="1.6" stroke-linecap="round"/>'+
          '<polygon points="0,-9 1.4,-5.5 -1.4,-5.5" fill="'+c+'"/></g>'+
          '<circle r="1.2" fill="'+c+'" opacity=".4"/></svg>'+
        '<div class="tval" id="tv'+i+'">0.0 N tangential</div>'+
      '</div>'+
    '</div>'+
    '<div class="prox-wrap"><div class="prox-lbl"><span>Proximity</span><span id="pv'+i+'">0</span></div>'+
      '<div class="prox-track"><div class="prox-fill" id="pf'+i+'" style="width:0%"></div></div></div>';
  fgrid.appendChild(d);
});

// ── Finger tiles ───────────────────────────────────────
const ftiles=document.getElementById("ftiles");
SN.forEach((n,i)=>{
  const c=SC[i],tile=document.createElement("div");
  tile.className="ftile";tile.style.setProperty("--c",c);
  tile.innerHTML='<div class="ftile-top"><div class="ftile-name">'+n+'</div>'+
    '<div class="ftile-dot" id="ftd'+i+'"></div></div>'+
    '<div class="ftile-val" id="sv'+i+'">0</div>'+
    '<div class="ftile-row"><div class="ftile-pct" id="svp'+i+'">0%</div>'+
      '<div class="ftile-max">/ 1000</div></div>'+
    '<div class="ftile-track"><div class="ftile-fill" id="stfill'+i+'" style="width:0%"></div></div>'+
    '<input type="range" class="ftile-slider" min="0" max="1000" value="0" id="sl'+i+'"'+
      ' oninput="onSlider('+i+',+this.value)">';
  ftiles.appendChild(tile);
});
function setTileVal(i,v){
  document.getElementById("sv"+i).textContent=Math.round(v);
  document.getElementById("svp"+i).textContent=Math.round(v/10)+"%";
  document.getElementById("stfill"+i).style.width=(v/10)+"%";
  const dot=document.getElementById("ftd"+i);
  if(dot)dot.classList.toggle("active",v>0);
}
function onSlider(i,v){sliderLock=Date.now();sliderVals[i]=v;setTileVal(i,v);sendPositions();updateHandViz(sliderVals);}

// chart legend
const cleg=document.getElementById("cleg");
FN.forEach((n,i)=>{
  const li=document.createElement("div");li.className="cli";li.id="cli"+i;
  li.innerHTML='<div class="cld" style="background:'+FC[i]+'"></div>'+n;
  li.onclick=()=>{chartHidden.has(i)?chartHidden.delete(i):chartHidden.add(i);li.classList.toggle("dim",chartHidden.has(i));};
  cleg.appendChild(li);
});

// ── SVG hand ───────────────────────────────────────────
const SVG_NS="http://www.w3.org/2000/svg";
const handSvg=document.getElementById("hand-svg");
function mkEl(tag,attrs={}){
  const e=document.createElementNS(SVG_NS,tag);
  Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));
  return e;
}
function mkLine(x1,y1,x2,y2,extra={}){return mkEl("line",{x1,y1,x2,y2,...extra});}
const defs=mkEl("defs");handSvg.appendChild(defs);
const FDEFS=[
  {bx:52,by:168,segs:[28,22,18],angle:-120,color:"#DB9D47",si:0,name:"Thumb"},
  {bx:72,by:108,segs:[36,28,20],angle:-88,color:"#58A4B0",si:2,name:"Index"},
  {bx:96,by:100,segs:[42,30,22],angle:-90,color:"#34d399",si:3,name:"Middle"},
  {bx:120,by:106,segs:[38,28,20],angle:-90,color:"#fbbf24",si:4,name:"Ring"},
  {bx:142,by:118,segs:[28,22,16],angle:-88,color:"#f87171",si:5,name:"Pinky"},
];
const THUMB_BX_OPEN=52,THUMB_BX_CLOSED=62;
FDEFS.forEach((fd,fi)=>{
  const totalLen=fd.segs.reduce((s,l)=>s+l,0);
  const rad=fd.angle*Math.PI/180;
  const tx=fd.bx+Math.cos(rad)*totalLen,ty=fd.by+Math.sin(rad)*totalLen;
  const g1=mkEl("linearGradient",{id:"fg"+fi,gradientUnits:"userSpaceOnUse",x1:fd.bx,y1:fd.by,x2:tx,y2:ty});
  g1.appendChild(mkEl("stop",{offset:"0%","stop-color":fd.color,"stop-opacity":"0.1"}));
  g1.appendChild(mkEl("stop",{offset:"35%","stop-color":fd.color,"stop-opacity":"0.7"}));
  g1.appendChild(mkEl("stop",{offset:"100%","stop-color":FC_B[fi],"stop-opacity":"1"}));
  defs.appendChild(g1);
});
const palmEl=mkEl("path",{d:"M50,170 Q38,202 43,244 Q58,274 100,278 Q142,274 157,244 Q162,202 150,170 Q138,153 118,147 Q100,143 82,147 Z",fill:"#0a0b11",stroke:"#191a27","stroke-width":"1.2"});
handSvg.appendChild(palmEl);
const palmLbl=mkEl("text",{x:"100",y:"230","class":"palm-label"});palmLbl.textContent="Revo2Touch";handSvg.appendChild(palmLbl);
const fingerData=[];
FDEFS.forEach((fd,fi)=>{
  const rad=fd.angle*Math.PI/180;
  const g=mkEl("g",{id:"fg"+fi,"class":"finger-group"});handSvg.appendChild(g);
  const bones=[],knuckles=[];
  let cx=fd.bx,cy=fd.by;
  fd.segs.forEach((len,si)=>{
    const ex=cx+Math.cos(rad)*len,ey=cy+Math.sin(rad)*len;
    const b=mkLine(cx,cy,ex,ey,{stroke:"url(#fg"+fi+")","stroke-width":"9","stroke-linecap":"round",opacity:"0.45"});
    g.appendChild(b);bones.push(b);
    const k=mkEl("circle",{cx,cy,r:"4.5",fill:fd.color,opacity:"0.4",stroke:"rgba(255,255,255,.1)","stroke-width":"0.7"});
    g.appendChild(k);knuckles.push(k);
    cx=ex;cy=ey;
  });
  const tipCirc=mkEl("circle",{cx,cy,r:"6.5",fill:fd.color,opacity:"0.28",id:"tip"+fi});
  g.appendChild(tipCirc);
  const lbl=mkEl("text",{x:fd.bx+(fd.name==="Thumb"?-18:0),y:fd.by+(fd.name==="Thumb"?14:18),fill:fd.color,"font-size":"7.5","text-anchor":"middle","font-family":"Inter,sans-serif","font-weight":"700",opacity:"0.55","pointer-events":"none"});
  lbl.textContent=fd.name;handSvg.appendChild(lbl);
  tipPos[fi]={x:cx,y:cy};
  fingerData.push({bones,knuckles,tipCirc,fdef:fd});
});

function updateHandViz(vals){
  const thAux=(vals[1]||0)/1000;
  FDEFS[0].bx=THUMB_BX_OPEN+(THUMB_BX_CLOSED-THUMB_BX_OPEN)*thAux;
  FDEFS.forEach((fd,fi)=>{
    const frac=(vals[fd.si]||0)/1000;
    const rad=fd.angle*Math.PI/180,maxCurl=1.4;
    let cx=fd.bx,cy=fd.by,angle=rad;
    const fd_i=fingerData[fi];
    fd.segs.forEach((len,si)=>{
      const segCurl=(si===0?.4:si===1?.55:.45)*maxCurl*frac;
      angle+=(si===0?0:segCurl);
      const ex=cx+Math.cos(angle)*len,ey=cy+Math.sin(angle)*len;
      fd_i.bones[si].setAttribute("x1",cx.toFixed(1));fd_i.bones[si].setAttribute("y1",cy.toFixed(1));
      fd_i.bones[si].setAttribute("x2",ex.toFixed(1));fd_i.bones[si].setAttribute("y2",ey.toFixed(1));
      fd_i.bones[si].setAttribute("opacity",(0.3+frac*.46).toFixed(2));
      fd_i.knuckles[si].setAttribute("cx",cx.toFixed(1));fd_i.knuckles[si].setAttribute("cy",cy.toFixed(1));
      if(si===0)angle+=segCurl;
      cx=ex;cy=ey;
    });
    tipPos[fi]={x:cx,y:cy};
    fd_i.tipCirc.setAttribute("cx",cx.toFixed(1));fd_i.tipCirc.setAttribute("cy",cy.toFixed(1));
    fd_i.tipCirc.setAttribute("opacity",(0.2+frac*.4).toFixed(2));
    const gr=document.getElementById("fg"+fi);
    if(gr){gr.setAttribute("x2",cx.toFixed(1));gr.setAttribute("y2",cy.toFixed(1));}
  });
}

// ── Interactions ───────────────────────────────────────
const tooltip=document.getElementById("hand-tooltip");
FDEFS.forEach((fd,fi)=>{
  const g=document.getElementById("fg"+fi);
  g.addEventListener("mouseenter",()=>{tooltip.style.display="block";});
  g.addEventListener("mousemove",e=>{tooltip.textContent=fd.name+" · "+sliderVals[fd.si];tooltip.style.left=(e.clientX+14)+"px";tooltip.style.top=(e.clientY-8)+"px";});
  g.addEventListener("mouseleave",()=>{tooltip.style.display="none";});
  g.addEventListener("click",e=>{
    if(dragMoved){dragMoved=false;return;}
    sliderLock=Date.now();
    const v=sliderVals[fd.si]>500?0:1000;
    sliderVals[fd.si]=v;document.getElementById("sl"+fd.si).value=v;
    setTileVal(fd.si,v);sendPositions();updateHandViz(sliderVals);
  });
  g.addEventListener("wheel",e=>{
    e.preventDefault();
    sliderLock=Date.now();
    const v=Math.max(0,Math.min(1000,sliderVals[fd.si]+(e.deltaY>0?-50:50)));
    sliderVals[fd.si]=Math.round(v);document.getElementById("sl"+fd.si).value=v;
    setTileVal(fd.si,v);sendPositions();updateHandViz(sliderVals);
  },{passive:false});
  g.addEventListener("mousedown",e=>{e.preventDefault();e.stopPropagation();dragState={si:fd.si,fi,startY:e.clientY,startVal:sliderVals[fd.si]};dragMoved=false;});
  g.addEventListener("touchstart",e=>{e.preventDefault();dragState={si:fd.si,fi,startY:e.touches[0].clientY,startVal:sliderVals[fd.si]};dragMoved=false;},{passive:false});
});
window.addEventListener("mousemove",e=>{
  if(!dragState)return;
  const delta=e.clientY-dragState.startY;
  if(Math.abs(delta)>3)dragMoved=true;
  const v=Math.max(0,Math.min(1000,dragState.startVal+delta*4));
  sliderLock=Date.now();
  sliderVals[dragState.si]=Math.round(v);document.getElementById("sl"+dragState.si).value=v;
  setTileVal(dragState.si,v);updateHandViz(sliderVals);sendPositions();
  tooltip.textContent=FDEFS[dragState.fi].name+" · "+Math.round(v);
});
window.addEventListener("mouseup",()=>{dragState=null;});
window.addEventListener("touchmove",e=>{
  if(!dragState)return;e.preventDefault();
  const v=Math.max(0,Math.min(1000,dragState.startVal+(e.touches[0].clientY-dragState.startY)*4));
  sliderVals[dragState.si]=Math.round(v);document.getElementById("sl"+dragState.si).value=v;
  setTileVal(dragState.si,v);updateHandViz(sliderVals);sendPositions();
},{passive:false});
window.addEventListener("touchend",()=>{dragState=null;});
document.addEventListener("keydown",e=>{
  if(e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA")return;
  const map={o:"open",f:"fist",p:"point",v:"peace",n:"pinch",k:"ok"," ":"open"};
  const pose=map[e.key.toLowerCase()];if(pose){e.preventDefault();sendPose(pose);}
});

const DPR=window.devicePixelRatio||1;

// ── Tactile update ─────────────────────────────────────
function updateTactile(touch){
  FN.forEach((_,i)=>{
    const t=touch[i],nf=t.normal,tf=t.tangential,dir=t.direction,prox=t.proximity;
    history[i].push(nf);if(history[i].length>HLEN)history[i].shift();
    prevForce[i]=forceLevel[i];forceLevel[i]=Math.min(nf/FSCALE,1);
    const R=14,circ=2*Math.PI*R,frac=forceLevel[i];
    const arcEl=document.getElementById("arc"+i);
    arcEl.style.strokeDashoffset=circ*(1-frac);
    const ac=nf<500?FC[i]:nf<1500?"#e8b400":"#f03e5a";
    arcEl.style.stroke=ac;
    document.getElementById("nfsv"+i).textContent=nf.toFixed(1);
    const nfv=document.getElementById("nfv"+i);nfv.textContent=nf.toFixed(1);nfv.style.color=ac;
    document.getElementById("tv"+i).textContent=tf.toFixed(1)+" N";
    document.getElementById("tarr"+i).setAttribute("transform","rotate("+dir+")");
    document.getElementById("pf"+i).style.width=Math.min(prox/200*100,100)+"%";
    document.getElementById("pv"+i).textContent=prox.toFixed(0);
    const dot=document.getElementById("sd"+i);
    dot.className="sdot"+(t.status===1?" w":t.status===2?" e":"");
    document.getElementById("fc"+i).classList.toggle("contact",nf>50);
  });
}

// ── Chart ──────────────────────────────────────────────
const cv=document.getElementById("chart"),ctx=cv.getContext("2d");
function toggleChartPause(){
  chartPaused=!chartPaused;
  const btn=document.getElementById("chartPauseBtn");
  btn.textContent=chartPaused?"Resume":"Pause";
  btn.classList.toggle("paused",chartPaused);
}
function drawChart(){
  if(chartPaused)return;
  const W=cv.offsetWidth,H=cv.offsetHeight;
  if(!W||!H)return;
  cv.width=W*DPR;cv.height=H*DPR;
  ctx.scale(DPR,DPR);
  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle="#181920";ctx.lineWidth=1;
  ctx.fillStyle="#2a2e44";ctx.font="8px JetBrains Mono,monospace";ctx.textAlign="right";
  [.25,.5,.75,1].forEach(f=>{
    const y=H-f*(H-8)-4;
    ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();
    ctx.fillText(Math.round(f*FSCALE)+" N",W-3,y-2);
  });
  FN.forEach((_,i)=>{
    if(chartHidden.has(i))return;
    const d=history[i];
    ctx.beginPath();ctx.strokeStyle=FC[i];ctx.lineWidth=1.4;
    d.forEach((v,j)=>{
      const x=j/(HLEN-1)*W,y=H-Math.min(v/FSCALE,1)*(H-8)-4;
      j===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.stroke();
  });
}

// ── Header metrics ─────────────────────────────────────
function updateHeaderMetrics(){
  const elapsed=Math.floor((Date.now()-sessionStart)/1000);
  const m=Math.floor(elapsed/60),s=elapsed%60;
  document.getElementById("sessiontime").textContent=m+":"+(s<10?"0":"")+s;
  document.getElementById("framecnt").textContent=totalFrames.toLocaleString();
}

// ── Stream inspector ───────────────────────────────────
const streamContainer=document.getElementById("tab-stream");
const streamEmpty=document.getElementById("streamEmpty");
function addStreamRow(data){
  streamCount++;
  streamEmpty.style.display="none";
  document.getElementById("streamBadge").textContent=streamCount>999?"999+":streamCount;
  const rows=streamContainer.querySelectorAll(".stream-row");
  if(rows.length>=MAX_STREAM)rows[rows.length-1].remove();
  const ts=new Date().toLocaleTimeString("en",{hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"});
  const pos=data.positions?data.positions.join(", "):"—";
  const nf=data.touch?data.touch.map(t=>t.normal.toFixed(0)).join(", "):"—";
  const row=document.createElement("div");row.className="stream-row anim-in";
  row.innerHTML=`<span class="stream-ts">${ts}</span><span class="stream-type">frame</span><span class="stream-data">pos:[${pos}] &nbsp; force:[${nf}]</span>`;
  streamContainer.insertBefore(row,streamContainer.firstChild);
}

// ── Data logger ────────────────────────────────────────
function addLoggerRow(frame){
  const tbody=document.getElementById("loggerBody");
  if(tbody.children.length>=MAX_LOGGER)tbody.lastChild&&tbody.removeChild(tbody.lastChild);
  const tr=document.createElement("tr");
  const ts=((frame.ts-sessionStart)/1000).toFixed(2);
  const nf=frame.touch?frame.touch.map(t=>t.normal.toFixed(1)):["—","—","—","—","—"];
  tr.innerHTML=`<td class="hi">${++loggerRowCount}</td><td>${ts}s</td>`+
    frame.positions.map(v=>`<td>${v}</td>`).join("")+
    nf.map(v=>`<td>${v}</td>`).join("");
  tbody.insertBefore(tr,tbody.firstChild);
  document.getElementById("loggerBadge").textContent=loggerRowCount>999?"999+":loggerRowCount;
}

// ── Session recorder ───────────────────────────────────
function startSessionRec(){
  if(activeRecording)return;
  const name="session_"+new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
  activeRecording={name,ts:Date.now(),frames:[]};
  document.getElementById("recStartBtn").disabled=true;
  document.getElementById("recStopBtn").disabled=false;
}
function stopSessionRec(){
  if(!activeRecording)return;
  sessions.push({...activeRecording});activeRecording=null;
  document.getElementById("recStartBtn").disabled=false;
  document.getElementById("recStopBtn").disabled=true;
  renderSessionsList();updateExportStats();
}
function renderSessionsList(){
  const list=document.getElementById("sessionsList");list.innerHTML="";
  if(!sessions.length){list.innerHTML='<div style="font-size:12px;color:var(--text3)">No recorded sessions yet.</div>';return;}
  sessions.forEach((s,i)=>{
    const dur=(s.frames.length>1?(s.frames[s.frames.length-1].ts-s.frames[0].ts)/1000:0).toFixed(1);
    const el=document.createElement("div");el.className="session-item";
    el.innerHTML=`<span class="session-item-name">${s.name}</span><span class="session-item-meta">${s.frames.length} frames &middot; ${dur}s</span><div class="session-item-actions"><button class="btn-sm primary" onclick="downloadSession(${i})">&#x2B07; JSON</button><button class="btn-sm danger" onclick="deleteSession(${i})">Delete</button></div>`;
    list.appendChild(el);
  });
}
function deleteSession(i){sessions.splice(i,1);renderSessionsList();updateExportStats();}
function downloadSession(i){dlFile(sessions[i].name+".json",JSON.stringify(sessions[i],null,2),"application/json");}

// ── Labels ─────────────────────────────────────────────
function captureLabel(){
  const inp=document.getElementById("labelInput");
  const name=inp.value.trim();if(!name)return;
  labelsList.push({ts:Date.now(),label:name,positions:[...sliderVals],force:[...forceLevel]});
  renderLabels();updateExportStats();inp.value="";inp.focus();
}
function clearLabels(){labelsList.length=0;renderLabels();updateExportStats();}
function renderLabels(){
  const list=document.getElementById("labelsList");
  document.getElementById("labelsBadge").textContent=labelsList.length;
  document.getElementById("labelCount").textContent=labelsList.length;
  if(!labelsList.length){list.innerHTML='<div style="font-size:12px;color:var(--text3)">No labels yet.</div>';return;}
  list.innerHTML="";
  [...labelsList].reverse().forEach((e,ri)=>{
    const i=labelsList.length-1-ri;
    const ts=new Date(e.ts).toLocaleTimeString();
    const el=document.createElement("div");el.className="label-item";
    el.innerHTML=`<span class="label-item-tag">${e.label}</span><span class="label-item-pos">[${e.positions.join(", ")}]</span><span class="label-item-ts">${ts}</span><span class="label-item-del" onclick="labelsList.splice(${i},1);renderLabels();updateExportStats()">&#x2715;</span>`;
    list.appendChild(el);
  });
}

// ── Export ─────────────────────────────────────────────
function dlFile(name,content,mime){
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([content],{type:mime}));
  a.download=name;a.click();URL.revokeObjectURL(a.href);
}
function exportJSON(){dlFile("revo2_buffer_"+Date.now()+".json",JSON.stringify(frameBuffer,null,2),"application/json");}
function exportCSV(){
  const rows=["ts,thumb,thaux,index,middle,ring,pinky,f0,f1,f2,f3,f4"];
  frameBuffer.forEach(f=>{
    const nf=f.touch?f.touch.map(t=>t.normal.toFixed(3)):["0","0","0","0","0"];
    rows.push([f.ts,...f.positions,...nf].join(","));
  });
  dlFile("revo2_buffer_"+Date.now()+".csv",rows.join("\n"),"text/csv");
}
function exportLabels(){
  if(!labelsList.length){alert("No labels captured yet.");return;}
  const rows=["ts,label,thumb,thaux,index,middle,ring,pinky,f0,f1,f2,f3,f4"];
  labelsList.forEach(e=>rows.push([e.ts,'"'+e.label+'"',...e.positions,...e.force.map(v=>v.toFixed(4))].join(",")));
  dlFile("revo2_labels_"+Date.now()+".csv",rows.join("\n"),"text/csv");
}
function exportSessions(){
  if(!sessions.length){alert("No sessions recorded yet.");return;}
  dlFile("revo2_sessions_"+Date.now()+".json",JSON.stringify(sessions,null,2),"application/json");
}
function copyWsUrl(){
  const url=(location.protocol==="https:"?"wss":"ws")+"://"+location.host+"/ws";
  navigator.clipboard.writeText(url).then(()=>alert("Copied: "+url));
}
function copyPySnippet(){
  const s=`import asyncio, json, websockets\n\nasync def stream():\n    uri = "ws://localhost:8765/ws"\n    async with websockets.connect(uri) as ws:\n        async for msg in ws:\n            data = json.loads(msg)\n            print(data["positions"], data.get("touch"))\n\nasyncio.run(stream())`;
  navigator.clipboard.writeText(s).then(()=>alert("Python snippet copied!"));
}
function updateExportStats(){
  document.getElementById("expFrames").textContent=frameBuffer.length.toLocaleString();
  const bd=frameBuffer.length>0?(frameBuffer[frameBuffer.length-1].ts-frameBuffer[0].ts)/1000:0;
  const m=Math.floor(bd/60),s=Math.floor(bd%60);
  document.getElementById("expDur").textContent=m+":"+(s<10?"0":"")+s;
  document.getElementById("expLabels").textContent=labelsList.length;
  document.getElementById("expSessions").textContent=sessions.length;
}

// ── Mode Navigation ───────────────────────────────────────
let currentMode='control';
function switchMode(name){
  currentMode=name;
  document.querySelectorAll('.mode-btn,.mode-help-btn').forEach(b=>b.classList.toggle('active',b.id==='mbtn-'+name));
  document.querySelectorAll('.mode-pane').forEach(p=>p.classList.toggle('active',p.id==='mp-'+name));
  if(name==='data')switchSubTab('data','recorder');
  if(name==='analysis')switchSubTab('analysis','classifier');
  if(name==='sequences')switchSubTab('sequences','sequencer');
  if(name==='help'){const h=document.getElementById('tab-help');if(h)h.classList.add('active');}
}

// ── Sub-tab Navigation ─────────────────────────────────
function switchSubTab(mode,name){
  const pane=document.getElementById('mp-'+mode);
  if(!pane)return;
  pane.querySelectorAll('.sub-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  pane.querySelectorAll('.sub-content > div').forEach(p=>p.classList.remove('active'));
  const t=document.getElementById('tab-'+name);
  if(t)t.classList.add('active');
  if(name==='export')updateExportStats();
  if(name==='pca')pcaRender();
}

// ── Legacy switchTab shim (backward compat) ────────────────
function switchTab(name){
  const map={stream:'data',logger:'data',recorder:'data',export:'data',
    classifier:'analysis',pca:'analysis',labels:'analysis',motion:'analysis',
    sequencer:'sequences',mapping:'sequences',alerts:'sequences',help:'help'};
  const mode=map[name];
  if(!mode)return;
  switchMode(mode);
  if(mode!=='help')switchSubTab(mode,name);
}

function helpNav(sec){
  document.querySelectorAll('.help-nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.sec===sec));
  document.querySelectorAll('.help-section').forEach(s=>s.classList.toggle('active',s.id==='hsec-'+sec));
}

// ── Device Configuration ───────────────────────────────────
const DEVICE_CONFIGS={
  brainco:{name:'BrainCo Revo2Touch',motors:['Thumb','ThAux','Index','Middle','Ring','Pinky'],sensors:['Thumb','Index','Middle','Ring','Pinky']},
  inspire:{name:'Inspire Dex RH56dfq',motors:['Little','Ring','Middle','Index','Thumb B','Thumb R'],sensors:['Little','Ring','Middle','Index','Thumb']}
};
let currentDevice='brainco';
function switchDevice(id){
  currentDevice=id;
  const cfg=DEVICE_CONFIGS[id]||DEVICE_CONFIGS.brainco;
  const sub=document.querySelector('.h-logo-sub');
  if(sub)sub.textContent=cfg.name+' · Dev Console';
  const pl=document.querySelector('.palm-label');
  if(pl)pl.textContent=cfg.name.split(' ')[0];
  for(let i=0;i<cfg.motors.length;i++){
    const tile=document.getElementById('ftiles')?.querySelectorAll('.ftile-name')[i];
    if(tile)tile.textContent=cfg.motors[i];
  }
  for(let i=0;i<cfg.sensors.length;i++){
    const fc=document.getElementById('fc'+i);
    const fl=fc?.querySelector('.flabel');
    if(fl&&fl.childNodes[0]&&fl.childNodes[0].nodeType===3)fl.childNodes[0].textContent=cfg.sensors[i];
  }
  const ths=document.querySelectorAll('.logger-table thead th');
  ['#','Time',...cfg.motors].forEach((n,i)=>{if(ths[i])ths[i].textContent=n;});
  // Show Inspire status panel only when Inspire is selected
  const inspStatus=document.getElementById('inspire-status');
  if(inspStatus)inspStatus.style.display=id==='inspire'?'flex':'none';
  // Show Inspire-only pose buttons
  ['wavebtn','thumbsbtn'].forEach(bid=>{
    const b=document.getElementById(bid);
    if(b)b.style.display=id==='inspire'?'':'none';
  });
  if(id==='inspire')setTimeout(showInspireModal,80);
}

// ── WebSocket ──────────────────────────────────────────
const hbdot=document.getElementById("hbdot"),hbtext=document.getElementById("hbtext");
const hzlbl=document.getElementById("hzlbl");
const devinfo=document.getElementById("devinfo");
function setBadge(state,text){
  hbdot.className="h-status-dot"+(state==="ok"?" ok":state==="err"?" err":"");
  hbtext.className="h-status-label"+(state==="ok"?" ok":state==="err"?" err":"");
  hbtext.textContent=text;
}
// ── Inspire IP configuration helpers ─────────────────────────────────────────
async function showInspireModal(){
  const backdrop=document.getElementById('inspire-modal-backdrop');
  if(!backdrop)return;
  try{
    const cfg=await fetch('/api/inspire/config').then(r=>r.json());
    const ml=document.getElementById('modal-l-ip');
    const mr=document.getElementById('modal-r-ip');
    if(ml)ml.value=cfg.left||'192.168.124.210';
    if(mr)mr.value=cfg.right||'192.168.124.211';
  }catch(_){}
  // Mirror connection dots
  const lSrc=document.getElementById('inspire-l-dot');
  const rSrc=document.getElementById('inspire-r-dot');
  const lDst=document.getElementById('modal-l-dot');
  const rDst=document.getElementById('modal-r-dot');
  if(lSrc&&lDst)lDst.className='modal-dot'+(lSrc.style.background.includes('0,201')?' ok':'');
  if(rSrc&&rDst)rDst.className='modal-dot'+(rSrc.style.background.includes('0,201')?' ok':'');
  backdrop.style.display='flex';
  setTimeout(()=>{const i=document.getElementById('modal-l-ip');if(i)i.focus();},120);
}
async function closeInspireModal(apply){
  if(apply){
    const l=document.getElementById('modal-l-ip')?.value.trim();
    const r=document.getElementById('modal-r-ip')?.value.trim();
    const hl=document.getElementById('inspire-l-ip');
    const hr=document.getElementById('inspire-r-ip');
    if(hl&&l)hl.value=l;
    if(hr&&r)hr.value=r;
    await applyInspireIPs();
  }
  document.getElementById('inspire-modal-backdrop').style.display='none';
}
async function scanFromModal(){
  const btn=document.querySelector('#inspire-modal .modal-btn-scan');
  if(btn){btn.textContent='Scanning…';btn.disabled=true;}
  try{
    const found=await fetch('/api/inspire/scan').then(r=>r.json());
    const ips=Object.keys(found);
    if(ips.length===0){alert('No Inspire hands found on 192.168.124.200-215');}
    else{
      const ml=document.getElementById('modal-l-ip');
      const mr=document.getElementById('modal-r-ip');
      if(ips[0]&&ml)ml.value=ips[0];
      if(ips[1]&&mr)mr.value=ips[1];
      const hl=document.getElementById('inspire-l-ip');
      const hr=document.getElementById('inspire-r-ip');
      if(ips[0]&&hl)hl.value=ips[0];
      if(ips[1]&&hr)hr.value=ips[1];
    }
  }catch(e){alert('Scan failed: '+e);}
  finally{if(btn){btn.textContent='🔍 Scan';btn.disabled=false;}}
}
async function applyInspireIPs(){
  const l=document.getElementById('inspire-l-ip').value.trim();
  const r=document.getElementById('inspire-r-ip').value.trim();
  if(!l&&!r){alert('Enter at least one IP address.');return;}
  try{
    const res=await fetch('/api/inspire/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({left:l,right:r})});
    const j=await res.json();
    if(!j.ok){alert('Error: '+j.error);}
  }catch(e){alert('Could not reach server: '+e);}
}
async function scanInspireHands(){
  const btn=document.getElementById('scanBtn');
  if(btn){btn.textContent='Scanning…';btn.disabled=true;}
  try{
    const res=await fetch('/api/inspire/scan');
    const found=await res.json();
    const ips=Object.keys(found);
    if(ips.length===0){alert('No Inspire hands found on 192.168.124.200-215');}
    else{
      const msg='Found:\n'+ips.map(ip=>'  '+ip).join('\n')+'\n\nAssign left/right IPs?';
      if(confirm(msg)){
        const lIp=document.getElementById('inspire-l-ip');
        const rIp=document.getElementById('inspire-r-ip');
        if(ips[0]&&lIp)lIp.value=ips[0];
        if(ips[1]&&rIp)rIp.value=ips[1];
        await applyInspireIPs();
      }
    }
  }catch(e){alert('Scan failed: '+e);}
  finally{if(btn){btn.textContent='🔍 Scan';btn.disabled=false;}}
}
function connect(){
  const proto=location.protocol==="https:"?"wss":"ws";
  ws=new WebSocket(proto+"://"+location.host+"/ws");
  ws.onopen=()=>{setBadge("ok","Connected");};
  ws.onclose=()=>{if(!activeRecording)setBadge("err","Disconnected");setTimeout(connect,2000);};
  ws.onerror=()=>ws.close();
  ws.onmessage=e=>{
    const d=JSON.parse(e.data);

    // ── Inspire status message ────────────────────────────────────────────────
    if(d.type==='inspire'){
      const lDot=document.getElementById('inspire-l-dot');
      const rDot=document.getElementById('inspire-r-dot');
      if(lDot)lDot.style.background=d.left_connected?'var(--green)':'var(--text3)';
      if(rDot)rDot.style.background=d.right_connected?'var(--green)':'var(--text3)';
      // Sync IP fields with server state (only when not actively editing)
      const lIpEl=document.getElementById('inspire-l-ip');
      const rIpEl=document.getElementById('inspire-r-ip');
      if(lIpEl&&d.left_ip&&document.activeElement!==lIpEl)lIpEl.value=d.left_ip;
      if(rIpEl&&d.right_ip&&document.activeElement!==rIpEl)rIpEl.value=d.right_ip;
      // If inspire device is active, update sliders from actual angles
      if(currentDevice==='inspire'&&(d.left_connected||d.right_connected)){
        const angles=d.right_connected?d.right_angles:d.left_angles;
        if(angles&&!dragState&&!mirrorActive&&Date.now()-sliderLock>1500){
          angles.forEach((p,i)=>{
            const sl=document.getElementById("sl"+i);
            if(sl&&document.activeElement!==sl){sl.value=p;sliderVals[i]=p;setTileVal(i,p);}
          });
          updateHandViz(sliderVals);
        }
      }
      return;
    }

    // ── BrainCo stream message ────────────────────────────────────────────────
    if(d.device_info&&!devinfo.textContent.trim())devinfo.textContent=d.device_info;
    if(!d.connected)return;
    totalFrames++;
    if(currentDevice!=='inspire'&&d.positions&&!dragState&&!mirrorActive&&Date.now()-sliderLock>1500){
      d.positions.forEach((p,i)=>{
        const sl=document.getElementById("sl"+i);
        if(sl&&document.activeElement!==sl){sl.value=p;sliderVals[i]=p;setTileVal(i,p);}
      });
    }
    if(d.touch)updateTactile(d.touch);
    updateHandViz(sliderVals);
    if(!chartPaused){drawChart();drawRadar();}

    const frame={ts:d.ts||Date.now(),positions:[...sliderVals],touch:d.touch?d.touch.map(t=>({normal:t.normal,tangential:t.tangential,proximity:t.proximity})):null};
    frameBuffer.push(frame);if(frameBuffer.length>MAX_BUFFER)frameBuffer.shift();
    if(activeRecording){
      activeRecording.frames.push(frame);
      document.getElementById("recFrameCount").textContent=activeRecording.frames.length;
      const dur=activeRecording.frames.length>1?(activeRecording.frames[activeRecording.frames.length-1].ts-activeRecording.frames[0].ts)/1000:0;
      document.getElementById("recDur").textContent=dur.toFixed(1)+"s";
      document.getElementById("recSize").textContent=(JSON.stringify(activeRecording.frames).length/1024).toFixed(1)+" KB";
    }
    if(totalFrames%4===0)addStreamRow(d);
    if(totalFrames%8===0)addLoggerRow(frame);

    hzF++;
    const now=performance.now();
    if(now-hzT>1000){hzlbl.textContent=hzF;hzF=0;hzT=now;updateHeaderMetrics();}
  };
}
function sendPositions(){
  if(!ws||ws.readyState!==1)return;
  if(currentDevice==='inspire'){
    ws.send(JSON.stringify({type:"inspire_set_positions",positions:[...sliderVals]}));
  } else {
    ws.send(JSON.stringify({type:"set_positions",positions:[...sliderVals]}));
  }
}
function sendPose(name){
  if(currentDevice==='inspire'){
    const p=INSPIRE_POSES[name];
    if(!p)return;
    if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:"inspire_pose",name}));
    p.forEach((v,i)=>{sliderVals[i]=v;const sl=document.getElementById("sl"+i);if(sl)sl.value=v;setTileVal(i,v);});
  } else {
    if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:"pose",name}));
    const p=POSES[name];if(!p)return;
    p.forEach((v,i)=>{sliderVals[i]=v;const sl=document.getElementById("sl"+i);if(sl)sl.value=v;setTileVal(i,v);});
  }
  updateHandViz(sliderVals);
}
async function runDemo(){
  if(demoRunning)return;demoRunning=true;
  const btn=document.getElementById("demobtn");btn.classList.add("running");
  const fill=document.getElementById("seqfill");
  const total=DEMO_SEQ.reduce((s,x)=>s+x.dur,0);let elapsed=0;
  for(const step of DEMO_SEQ){
    if(!demoRunning)break;sendPose(step.pose);btn.innerHTML='<span class="em">&#x25b6;</span>'+step.pose;
    const t0=performance.now();
    while(performance.now()-t0<step.dur){if(!demoRunning)break;elapsed+=16;fill.style.width=Math.min(elapsed/total*100,100)+"%";await new Promise(r=>setTimeout(r,16));}
  }
  demoRunning=false;btn.classList.remove("running");btn.innerHTML='<span class="em">&#x25b6;</span>Run Demo';fill.style.width="0%";
}
document.querySelectorAll(".pbtn:not(#demobtn)").forEach(b=>b.addEventListener("click",()=>{demoRunning=false;}));

// ── Custom code runner ─────────────────────────────────
function runCustomCode(){
  const out=document.getElementById("runOutput");const code=document.getElementById("codeEditor").value;
  out.textContent="";
  const api={
    send:(p)=>{sliderVals.splice(0,6,...p);p.forEach((v,i)=>{const sl=document.getElementById("sl"+i);if(sl)sl.value=v;setTileVal(i,v);});sendPositions();updateHandViz(sliderVals);},
    pose:(name)=>sendPose(name),sleep:(ms)=>new Promise(r=>setTimeout(r,ms)),
    log:(msg)=>{out.textContent+=(out.textContent?"\n":"")+String(msg);out.scrollTop=out.scrollHeight;}
  };
  const fn=new Function("send","pose","sleep","log",`"use strict";\n${code}`);
  Promise.resolve(fn(api.send,api.pose,api.sleep,api.log)).catch(e=>{out.textContent+="\nERR: "+e.message;});
}

// ── Mirror Mode ────────────────────────────────────────
let mirrorActive=false,handsModel=null,mirrorStream=null,emaVals=null,mirrorAlpha=0.35;
function _vecAngle(a,b){
  const dot=a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const na=Math.hypot(...a),nb=Math.hypot(...b);
  if(na<1e-6||nb<1e-6)return 0;
  return Math.acos(Math.max(-1,Math.min(1,dot/(na*nb))))*180/Math.PI;
}
function _curl(lm,j){
  const p=j.map(i=>[lm[i].x,lm[i].y,lm[i].z]);
  const v0=p[0].map((_,k)=>p[1][k]-p[0][k]),v1=p[1].map((_,k)=>p[2][k]-p[1][k]),v2=p[2].map((_,k)=>p[3][k]-p[2][k]);
  return Math.min((_vecAngle(v0,v1)+_vecAngle(v1,v2))/160,1);
}
function _thumbCurl(lm){
  const p=[1,2,3,4].map(i=>[lm[i].x,lm[i].y,lm[i].z]);
  const v0=p[0].map((_,k)=>p[1][k]-p[0][k]),v1=p[1].map((_,k)=>p[2][k]-p[1][k]),v2=p[2].map((_,k)=>p[3][k]-p[2][k]);
  return Math.min((_vecAngle(v0,v1)+_vecAngle(v1,v2))/140,1);
}
function _thumbAux(lm){
  const tip=[lm[4].x,lm[4].y,lm[4].z],idx=[lm[5].x,lm[5].y,lm[5].z];
  const w=[lm[0].x,lm[0].y,lm[0].z],mid=[lm[9].x,lm[9].y,lm[9].z];
  const sz=Math.hypot(...w.map((_,k)=>mid[k]-w[k]))+1e-6;
  return Math.max(0,Math.min(1,1-(Math.hypot(...tip.map((_,k)=>idx[k]-tip[k]))/sz-0.2)/0.5));
}
function lmToPositions(lm){
  return [Math.round(_thumbCurl(lm)*1000),Math.round(_thumbAux(lm)*1000),
    Math.round(_curl(lm,[5,6,7,8])*1000),Math.round(_curl(lm,[9,10,11,12])*1000),
    Math.round(_curl(lm,[13,14,15,16])*1000),Math.round(_curl(lm,[17,18,19,20])*1000)];
}
function emaUpdate(raw){
  const a=mirrorAlpha;
  if(!emaVals){emaVals=[...raw];return[...raw];}
  emaVals=raw.map((v,i)=>Math.round(a*v+(1-a)*emaVals[i]));return[...emaVals];
}
function applyMirrorPositions(pos){
  pos.forEach((v,i)=>{sliderVals[i]=v;const sl=document.getElementById("sl"+i);if(sl)sl.value=v;setTileVal(i,v);});
  sendPositions();updateHandViz(sliderVals);
}
const MP_CONNECTIONS=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];
const FINGER_TIP_IDX=new Set([4,8,12,16,20]);
function drawSkeleton(ctx,lm,w,h){
  ctx.lineWidth=1.4;ctx.strokeStyle="rgba(108,142,255,.65)";
  const pt=j=>({x:(1-lm[j].x)*w,y:lm[j].y*h});
  MP_CONNECTIONS.forEach(([a,b])=>{const pa=pt(a),pb=pt(b);ctx.beginPath();ctx.moveTo(pa.x,pa.y);ctx.lineTo(pb.x,pb.y);ctx.stroke();});
  lm.forEach((_,j)=>{const {x,y}=pt(j);const isTip=FINGER_TIP_IDX.has(j);ctx.beginPath();ctx.arc(x,y,isTip?3.5:2,0,Math.PI*2);ctx.fillStyle=isTip?"#58A4B0":"rgba(255,255,255,.75)";ctx.fill();});
}
async function initHandsModel(){
  if(handsModel)return;
  handsModel=new Hands({locateFile:f=>`https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`});
  handsModel.setOptions({maxNumHands:1,modelComplexity:1,minDetectionConfidence:0.6,minTrackingConfidence:0.5});
  const pipCanvas=document.getElementById("pipCanvas");const pipCtx=pipCanvas.getContext("2d");
  handsModel.onResults(results=>{
    const w=pipCanvas.width,h=pipCanvas.height;pipCtx.clearRect(0,0,w,h);
    if(results.multiHandLandmarks&&results.multiHandLandmarks.length>0){
      const lm=results.multiHandLandmarks[0];drawSkeleton(pipCtx,lm,w,h);
      applyMirrorPositions(emaUpdate(lmToPositions(lm)));
    } else {applyMirrorPositions(emaUpdate([0,0,0,0,0,0]));}
  });
}
async function toggleMirror(){
  const btn=document.getElementById("mirrorBtn");
  const pip=document.getElementById("mirrorPip");
  const badge=document.getElementById("mirrorBadge");
  const video=document.getElementById("pipVideo");
  if(mirrorActive){
    mirrorActive=false;if(mirrorStream){mirrorStream.getTracks().forEach(t=>t.stop());mirrorStream=null;}
    pip.classList.remove("active");badge.classList.remove("active");btn.classList.remove("active");
    btn.innerHTML='<span class="dot"></span>Mirror';emaVals=null;return;
  }
  btn.innerHTML='Starting&hellip;';
  try{
    mirrorStream=await navigator.mediaDevices.getUserMedia({video:{width:320,height:240,facingMode:"user"},audio:false});
    video.srcObject=mirrorStream;await video.play();initHandsModel();
    mirrorActive=true;pip.classList.add("active");badge.classList.add("active");btn.classList.add("active");
    btn.innerHTML='<span class="dot"></span>Stop Mirror';btn.disabled=false;
    const pipCanvas=document.getElementById("pipCanvas");
    async function mirrorFrame(){
      if(!mirrorActive)return;
      if(video.readyState>=2){pipCanvas.width=video.videoWidth||320;pipCanvas.height=video.videoHeight||240;await handsModel.send({image:video});}
      requestAnimationFrame(mirrorFrame);
    }
    requestAnimationFrame(mirrorFrame);
  } catch(e){
    btn.innerHTML='<span class="dot"></span>Mirror';btn.disabled=false;
    badge.textContent="Camera denied";badge.style.color="var(--red)";badge.style.borderColor="var(--red)";badge.classList.add("active");
    setTimeout(()=>{badge.classList.remove("active");badge.textContent="\u25c9 Mirror Active";badge.style.color="";badge.style.borderColor="";},3000);
  }
}
document.getElementById("hand-svg").addEventListener("mousedown",e=>{if(mirrorActive)e.stopImmediatePropagation();},true);

// ── Header record button ───────────────────────────────
function toggleRecording(){
  const btn=document.getElementById("recBtn");
  if(!activeRecording){
    startSessionRec();btn.classList.add("recording");btn.innerHTML='<span class="dot"></span>Stop Rec';
    switchTab("recorder");if(drawerCollapsed)toggleDrawer();
  } else {
    stopSessionRec();btn.classList.remove("recording");btn.innerHTML='<span class="dot"></span>Record';
  }
}

connect();updateHandViz(sliderVals);
setInterval(updateHeaderMetrics,1000);
window.addEventListener("resize",drawChart);

// ── Row resize ─────────────────────────────────────────
(function(){
  const posesEl=document.querySelector(".right-top");const rh1=document.getElementById("rh1");let drag=null;
  rh1.addEventListener("mousedown",e=>{e.preventDefault();rh1.classList.add("dragging");drag={startY:e.clientY,startH:posesEl.offsetHeight};});
  window.addEventListener("mousemove",e=>{
    if(!drag)return;const delta=e.clientY-drag.startY;
    const rcol=document.getElementById("rcol");
    const newH=Math.max(80,Math.min(rcol.offsetHeight-60,drag.startH+delta));
    posesEl.style.flex="0 0 "+newH+"px";drawChart();
  });
  window.addEventListener("mouseup",()=>{if(drag){rh1.classList.remove("dragging");drag=null;}});
})();

// ── Column resize ──────────────────────────────────────
(function(){
  const lcol=document.getElementById("lcol"),ch1=document.getElementById("ch1"),ch2=document.getElementById("ch2");
  let drag=null;
  function startDrag(e,side){
    e.preventDefault();const startX=e.clientX,startW=side==="left"?lcol.offsetWidth:document.getElementById("ccol").offsetWidth;
    const handle=side==="left"?ch1:ch2;handle.classList.add("dragging");drag={side,startX,startW,handle};
  }
  ch1.addEventListener("mousedown",e=>startDrag(e,"left"));ch2.addEventListener("mousedown",e=>startDrag(e,"right"));
  window.addEventListener("mousemove",e=>{
    if(!drag)return;const delta=e.clientX-drag.startX;
    if(drag.side==="left")lcol.style.width=Math.max(160,Math.min(700,drag.startW+delta))+"px";
    else{const ccol=document.getElementById("ccol");ccol.style.width=Math.max(160,Math.min(600,drag.startW+delta))+"px";}
    drawChart();
  });
  window.addEventListener("mouseup",()=>{if(drag){drag.handle.classList.remove("dragging");drag=null;}});
})();

// ─── Gesture Classifier (k-NN, in-browser, 6-dim motor positions) ───────────
let knnModel = null;

function clsTrain(){
  if(!labelsList.length){alert('No labels captured yet. Use the Labels tab first.');return;}
  const k=Math.max(1,parseInt(document.getElementById('clsK').value)||3);
  const samples=labelsList.map(l=>({label:l.label,vec:l.positions.map(v=>v/1000)}));
  const classes=[...new Set(samples.map(s=>s.label))].sort();
  knnModel={samples,classes,k};
  document.getElementById('clsBadge').textContent=classes.length;
  document.getElementById('clsInfo').textContent=`Model: ${samples.length} samples · ${classes.length} classes · k=${k}`;
  document.getElementById('clsPredConf').textContent='Waiting for frame\u2026';
  _clsRenderBars(classes.map(c=>({name:c,pct:0})));
}

function clsClear(){
  knnModel=null;
  document.getElementById('clsBadge').textContent='0';
  document.getElementById('clsPredName').textContent='\u2014';
  document.getElementById('clsPredConf').textContent='Train the model first';
  document.getElementById('clsConfFill').style.width='0%';
  document.getElementById('clsInfo').textContent='Capture labels in the Labels tab, then click Train.';
  document.getElementById('clsCandidates').innerHTML='<div style="font-size:12px;color:var(--text3)">No model trained yet.</div>';
}

function _clsPredict(positions){
  if(!knnModel)return;
  const vec=positions.map(v=>v/1000);
  const dists=knnModel.samples.map(s=>({
    label:s.label,
    d:Math.sqrt(s.vec.reduce((a,v,i)=>a+(v-vec[i])**2,0))
  }));
  dists.sort((a,b)=>a.d-b.d);
  const votes={};
  knnModel.classes.forEach(c=>votes[c]=0);
  dists.slice(0,knnModel.k).forEach(n=>votes[n.label]=(votes[n.label]||0)+1);
  const sorted=Object.entries(votes).sort((a,b)=>b[1]-a[1]);
  const top=sorted[0],conf=top[1]/knnModel.k;
  document.getElementById('clsPredName').textContent=top[0];
  document.getElementById('clsPredConf').textContent=`${Math.round(conf*100)}% confidence (${top[1]}/${knnModel.k} votes)`;
  document.getElementById('clsConfFill').style.width=(conf*100)+'%';
  _clsRenderBars(sorted.map(([name,v])=>({name,pct:v/knnModel.k})));
}

function _clsRenderBars(candidates){
  const el=document.getElementById('clsCandidates');
  if(!candidates.length){el.innerHTML='<div style="font-size:12px;color:var(--text3)">\u2014</div>';return;}
  el.innerHTML=candidates.map((c,i)=>`
    <div class="cls-cand${i===0?' top1':''}">
      <span class="cls-cand-name">${c.name}</span>
      <div class="cls-cand-bar-wrap"><div class="cls-cand-bar" style="width:${Math.round(c.pct*100)}%"></div></div>
      <span class="cls-cand-pct">${Math.round(c.pct*100)}%</span>
    </div>`).join('');
}

// Hook into incoming WS data after ws is available
(function(){
  const t=setInterval(()=>{
    if(typeof ws!=='undefined'&&ws){
      const orig=ws.onmessage;
      ws.onmessage=function(ev){
        if(orig)orig.call(ws,ev);
        try{
          const d=JSON.parse(ev.data);
          if(d.positions&&knnModel)_clsPredict(d.positions);
          if(d.positions)alertCheck(d.positions,d.touch);

          if(motRecording&&d.positions){
            motRecording.frames.push({ts:d.ts||Date.now(),positions:[...d.positions]});
            document.getElementById('motFrameCount').textContent=motRecording.frames.length;
            const dur=motRecording.frames.length>1?(motRecording.frames[motRecording.frames.length-1].ts-motRecording.frames[0].ts)/1000:0;
            document.getElementById('motDur').textContent=dur.toFixed(1)+'s';
          }
        }catch(e){}
      };
      clearInterval(t);
    }
  },300);
})();

// ─── Radar chart ─────────────────────────────────────────────────────────────
let chartMode='line'; // 'line' | 'radar'
const radarCv=document.getElementById('radarChart');
const radarCtx=radarCv.getContext('2d');
function toggleChartMode(){
  chartMode=chartMode==='line'?'radar':'line';
  document.getElementById('chartModeBtn').textContent=chartMode==='line'?'Radar':'Line';
  document.getElementById('chart').style.display=chartMode==='line'?'':'none';
  radarCv.style.display=chartMode==='radar'?'':'none';
}
function drawRadar(){
  if(chartMode!=='radar'||chartPaused)return;
  const W=radarCv.offsetWidth,H=radarCv.offsetHeight;
  if(!W||!H)return;
  radarCv.width=W*DPR;radarCv.height=H*DPR;
  radarCtx.scale(DPR,DPR);
  radarCtx.clearRect(0,0,W,H);
  const cx=W/2,cy=H/2,maxR=Math.min(cx,cy)*0.78;
  const n=5,step=Math.PI*2/n;
  // grid rings
  [.25,.5,.75,1].forEach(f=>{
    radarCtx.beginPath();
    for(let i=0;i<n;i++){const a=-Math.PI/2+i*step;radarCtx.lineTo(cx+Math.cos(a)*maxR*f,cy+Math.sin(a)*maxR*f);}
    radarCtx.closePath();radarCtx.strokeStyle='rgba(255,255,255,.05)';radarCtx.lineWidth=1;radarCtx.stroke();
    radarCtx.fillStyle='rgba(255,255,255,.04)';radarCtx.font=`8px JetBrains Mono`;radarCtx.textAlign='left';
    radarCtx.fillText(Math.round(f*FSCALE),(cx+maxR*f+3).toFixed(0),cy-2);
  });
  // axes + labels
  for(let i=0;i<n;i++){
    const a=-Math.PI/2+i*step;
    radarCtx.beginPath();radarCtx.moveTo(cx,cy);radarCtx.lineTo(cx+Math.cos(a)*maxR,cy+Math.sin(a)*maxR);
    radarCtx.strokeStyle='rgba(255,255,255,.07)';radarCtx.stroke();
    radarCtx.fillStyle=FC[i];radarCtx.font=`bold 9px Inter`;radarCtx.textAlign='center';
    radarCtx.fillText(FN[i],cx+Math.cos(a)*(maxR+14),cy+Math.sin(a)*(maxR+14)+3);
  }
  // data polygon
  radarCtx.beginPath();
  for(let i=0;i<n;i++){
    const a=-Math.PI/2+i*step,f=Math.min(forceLevel[i],1);
    const x=cx+Math.cos(a)*maxR*f,y=cy+Math.sin(a)*maxR*f;
    i===0?radarCtx.moveTo(x,y):radarCtx.lineTo(x,y);
  }
  radarCtx.closePath();
  radarCtx.fillStyle='rgba(88,164,176,.15)';radarCtx.fill();
  radarCtx.strokeStyle='rgba(88,164,176,.7)';radarCtx.lineWidth=1.8;radarCtx.stroke();
  // dots per finger
  for(let i=0;i<n;i++){
    const a=-Math.PI/2+i*step,f=Math.min(forceLevel[i],1);
    radarCtx.beginPath();radarCtx.arc(cx+Math.cos(a)*maxR*f,cy+Math.sin(a)*maxR*f,4,0,Math.PI*2);
    radarCtx.fillStyle=FC[i];radarCtx.fill();
  }
}

// ─── Force Threshold Alerts ───────────────────────────────────────────────────
const alertThresholds=FN.map(()=>1500);
const alertEnabled=FN.map(()=>true);
let alertAudioCtx=null;
function alertBeep(freq=880,dur=80){
  if(!document.getElementById('alertSound').checked)return;
  try{
    if(!alertAudioCtx)alertAudioCtx=new(window.AudioContext||window.webkitAudioContext)();
    const o=alertAudioCtx.createOscillator(),g=alertAudioCtx.createGain();
    o.connect(g);g.connect(alertAudioCtx.destination);
    o.frequency.value=freq;g.gain.setValueAtTime(.18,alertAudioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(.001,alertAudioCtx.currentTime+dur/1000);
    o.start();o.stop(alertAudioCtx.currentTime+dur/1000);
  }catch(e){}
}
function alertTestSound(){alertBeep(660,120);}
function alertCheck(positions,touch){
  FN.forEach((_,i)=>{
    if(!alertEnabled[i])return;
    const nf=touch&&touch[i]?touch[i].normal:0;
    const el=document.getElementById('alDot'+i);
    const firing=nf>=alertThresholds[i];
    if(el)el.classList.toggle('firing',firing);
    if(firing&&!el._wasFiring){alertBeep(700+i*80);}
    if(el)el._wasFiring=firing;
  });
}
function buildAlertRows(){
  const wrap=document.getElementById('alertRows');wrap.innerHTML='';
  FN.forEach((name,i)=>{
    const row=document.createElement('div');row.className='alert-row';
    row.style.setProperty('--c',FC[i]);
    row.innerHTML=`
      <span class="alert-finger" style="color:${FC[i]}">${name}</span>
      <div class="alert-thresh-wrap">
        <input type="range" min="50" max="2500" step="50" value="${alertThresholds[i]}"
          style="--c:${FC[i]}"
          oninput="alertThresholds[${i}]=+this.value;document.getElementById('alVal${i}').textContent=this.value+' N'"
          id="alSlider${i}">
        <input type="range" min="50" max="2500" step="50" value="${alertThresholds[i]}"
          style="display:none" id="alSlider${i}b">
        <span class="alert-thresh-val" id="alVal${i}">${alertThresholds[i]} N</span>
      </div>
      <div class="alert-active" id="alDot${i}"></div>
      <button class="alert-toggle on" id="alToggle${i}" onclick="alertToggle(${i})">${alertEnabled[i]?'ON':'OFF'}</button>`;
    // fix: the range thumb color via inline style doesn't work well; remove hidden duplicate
    row.querySelector('#alSlider'+i+'b').remove();
    wrap.appendChild(row);
    // set thumb color via JS
    const sl=row.querySelector('#alSlider'+i);
    sl.style.accentColor=FC[i];
  });
}
function alertToggle(i){
  alertEnabled[i]=!alertEnabled[i];
  const btn=document.getElementById('alToggle'+i);
  btn.textContent=alertEnabled[i]?'ON':'OFF';
  btn.classList.toggle('on',alertEnabled[i]);
}
buildAlertRows();

// ─── Motion Recorder & Replay ─────────────────────────────────────────────────
let motRecording=null,motions=[],motNextId=1;
let motPlayAbort=false,motPlaying=false;

function motStartRec(){
  if(motRecording)return;
  motRecording={id:motNextId++,name:'motion_'+Date.now(),frames:[]};
  document.getElementById('motRecBtn').disabled=true;
  document.getElementById('motStopBtn').disabled=false;
  document.getElementById('motFrameCount').textContent='0';
  document.getElementById('motDur').textContent='0.0s';
}
function motStopRec(){
  if(!motRecording||motRecording.frames.length<2)return;
  motions.push({...motRecording});motRecording=null;
  document.getElementById('motRecBtn').disabled=false;
  document.getElementById('motStopBtn').disabled=true;
  document.getElementById('motionBadge').textContent=motions.length;
  renderMotionList();
}
function renderMotionList(){
  const list=document.getElementById('motionList');list.innerHTML='';
  if(!motions.length){list.innerHTML='<div style="font-size:12px;color:var(--text3)">No motions recorded yet.</div>';return;}
  motions.forEach((m,idx)=>{
    const dur=m.frames.length>1?(m.frames[m.frames.length-1].ts-m.frames[0].ts)/1000:0;
    const el=document.createElement('div');el.className='motion-item';el.id='motitem'+m.id;
    el.innerHTML=`<span class="motion-item-name">${m.name}</span>
      <span class="motion-item-meta">${m.frames.length} frames · ${dur.toFixed(1)}s</span>
      <div class="motion-item-bar"><div class="motion-item-prog" id="motprog${m.id}"></div></div>
      <button class="btn-sm primary" onclick="motPlay(${idx})">&#x25b6;</button>
      <button class="btn-sm" onclick="motRename(${idx})">&#x270e;</button>
      <button class="btn-sm danger" onclick="motDelete(${idx})">&#x2715;</button>`;
    list.appendChild(el);
  });
}
function motDelete(idx){motions.splice(idx,1);document.getElementById('motionBadge').textContent=motions.length;renderMotionList();}
function motRename(idx){
  const n=prompt('New name:',motions[idx].name);
  if(n&&n.trim()){motions[idx].name=n.trim();renderMotionList();}
}
async function motPlay(idx){
  if(motPlaying)return;
  const m=motions[idx];if(!m||m.frames.length<2)return;
  motPlaying=true;motPlayAbort=false;
  const speed=parseFloat(document.getElementById('motSpeed').value)||1;
  const el=document.getElementById('motitem'+m.id);
  if(el)el.classList.add('playing');
  const totalDur=(m.frames[m.frames.length-1].ts-m.frames[0].ts)/speed;
  const startTs=m.frames[0].ts;
  const wallStart=performance.now();
  for(let fi=0;fi<m.frames.length&&!motPlayAbort;fi++){
    const f=m.frames[fi];
    const targetWall=(f.ts-startTs)/speed;
    while(performance.now()-wallStart<targetWall&&!motPlayAbort)await new Promise(r=>setTimeout(r,8));
    if(motPlayAbort)break;
    f.positions.forEach((v,i)=>{sliderVals[i]=v;const sl=document.getElementById('sl'+i);if(sl)sl.value=v;setTileVal(i,v);});
    sendPositions();updateHandViz(sliderVals);
    const prog=document.getElementById('motprog'+m.id);
    if(prog)prog.style.width=((fi/(m.frames.length-1))*100)+'%';
  }
  motPlaying=false;if(el)el.classList.remove('playing');
  const prog=document.getElementById('motprog'+m.id);if(prog)prog.style.width='0%';
}

// ─── PCA (2-component, hand-rolled power iteration) ───────────────────────────
const PCA_COLORS=['#58A4B0','#DB9D47','#34d399','#fbbf24','#f87171','#f472b6','#38bdf8','#fb923c','#a3e635','#e879f9'];
let pcaClassColors={};
function pcaRender(){
  const cv=document.getElementById('pcaCanvas');
  const ctx=cv.getContext('2d');
  if(!labelsList.length){ctx.clearRect(0,0,cv.width,cv.height);return;}
  const data=labelsList.map(l=>l.positions.map(v=>v/1000));
  const n=data.length,d=6;
  // center
  const mean=Array(d).fill(0);
  data.forEach(x=>x.forEach((v,i)=>mean[i]+=v));
  mean.forEach((_,i)=>mean[i]/=n);
  const X=data.map(x=>x.map((v,i)=>v-mean[i]));
  // covariance
  const cov=Array.from({length:d},()=>Array(d).fill(0));
  X.forEach(x=>x.forEach((a,i)=>x.forEach((b,j)=>cov[i][j]+=a*b/(n-1))));
  // power iteration for PC1 and PC2
  function powerIter(cov,iters=60){
    let v=Array(d).fill(0);v[0]=1;
    for(let it=0;it<iters;it++){
      const w=Array(d).fill(0);
      v.forEach((vi,i)=>cov[i].forEach((c,j)=>w[j]+=c*vi));
      const norm=Math.sqrt(w.reduce((s,x)=>s+x*x,0))||1;
      v=w.map(x=>x/norm);
    }
    return v;
  }
  const pc1=powerIter(cov);
  // deflate
  const cov2=cov.map((row,i)=>row.map((c,j)=>c-pc1[i]*pc1[j]*pc1.reduce((s,v,k)=>s+cov[k][j]*v,0)));
  const pc2=powerIter(cov2);
  // project
  const proj=X.map(x=>([pc1.reduce((s,v,i)=>s+v*x[i],0),pc2.reduce((s,v,i)=>s+v*x[i],0)]));
  const xs=proj.map(p=>p[0]),ys=proj.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs)||1,minY=Math.min(...ys),maxY=Math.max(...ys)||1;
  const W=cv.offsetWidth,H=cv.offsetHeight;
  cv.width=W*DPR;cv.height=H*DPR;
  ctx.scale(DPR,DPR);ctx.clearRect(0,0,W,H);
  ctx.fillStyle='var(--surface2,#0f1018)';ctx.fillRect(0,0,W,H);
  const pad=28;
  const toX=v=>pad+(v-minX)/(maxX-minX+1e-9)*(W-2*pad);
  const toY=v=>H-pad-(v-minY)/(maxY-minY+1e-9)*(H-2*pad);
  // grid
  ctx.strokeStyle='rgba(255,255,255,.04)';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(W/2,pad);ctx.lineTo(W/2,H-pad);ctx.stroke();
  ctx.beginPath();ctx.moveTo(pad,H/2);ctx.lineTo(W-pad,H/2);ctx.stroke();
  // points
  const classes=[...new Set(labelsList.map(l=>l.label))];
  classes.forEach((c,ci)=>{if(!pcaClassColors[c])pcaClassColors[c]=PCA_COLORS[ci%PCA_COLORS.length];});
  proj.forEach((p,pi)=>{
    const label=labelsList[pi].label;
    ctx.beginPath();ctx.arc(toX(p[0]),toY(p[1]),5,0,Math.PI*2);
    ctx.fillStyle=pcaClassColors[label];ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,.4)';ctx.lineWidth=.8;ctx.stroke();
  });
  // legend
  const leg=document.getElementById('pcaLegend');leg.innerHTML='';
  classes.forEach(c=>{
    const el=document.createElement('div');el.className='pca-leg-item';
    el.innerHTML=`<div class="pca-leg-dot" style="background:${pcaClassColors[c]}"></div>${c}`;
    leg.appendChild(el);
  });
}

// ─── Keyboard / MIDI Mapping ──────────────────────────────────────────────────
const DEFAULT_MAPPINGS=[
  {key:'o',action:'pose:open'},{key:'f',action:'pose:fist'},{key:'p',action:'pose:point'},
  {key:'v',action:'pose:peace'},{key:'n',action:'pose:pinch'},{key:'k',action:'pose:ok'},
  {key:'g',action:'pose:gun'},{key:'c',action:'pose:claw'},{key:'r',action:'pose:rock'},
  {key:'t',action:'pose:three'},{key:'d',action:'demo'},{key:' ',action:'pose:open'},
];
let keyMappings=[...DEFAULT_MAPPINGS.map(m=>({...m}))];
let mapListening=-1;
let midiAccess=null;

function applyMapping(action){
  if(action.startsWith('pose:')){sendPose(action.slice(5));}
  else if(action==='demo'){runDemo();}
}
function mapReset(){keyMappings=DEFAULT_MAPPINGS.map(m=>({...m}));renderMapRows();}
function mapAddRow(){keyMappings.push({key:'?',action:'pose:open'});renderMapRows();}
function mapListen(idx){
  mapListening=idx;
  const btn=document.getElementById('mapEditBtn'+idx);
  if(btn){btn.textContent='press key…';btn.classList.add('listening');}
}
function renderMapRows(){
  const wrap=document.getElementById('mapRows');wrap.innerHTML='';
  keyMappings.forEach((m,i)=>{
    const el=document.createElement('div');el.className='map-row';
    const poseOpts=Object.keys(POSES).map(p=>`<option value="pose:${p}"${m.action==='pose:'+p?' selected':''}>Pose: ${p}</option>`).join('');
    el.innerHTML=`<span class="map-key" id="mapKey${i}">${m.key==='  '?'Space':m.key.toUpperCase()}</span>
      <select class="map-action seq-select" id="mapAct${i}" onchange="keyMappings[${i}].action=this.value">
        ${poseOpts}
        <option value="demo"${m.action==='demo'?' selected':''}>Run Demo</option>
      </select>
      <button class="map-edit-btn" id="mapEditBtn${i}" onclick="mapListen(${i})">Edit Key</button>
      <button class="map-edit-btn" style="border-color:rgba(240,62,90,.25);color:var(--red)" onclick="keyMappings.splice(${i},1);renderMapRows()">&#x2715;</button>`;
    wrap.appendChild(el);
  });
}
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT'){
    if(mapListening>=0){mapListening=-1;}
    return;
  }
  if(mapListening>=0){
    const idx=mapListening;mapListening=-1;
    keyMappings[idx].key=e.key===' '?'Space':e.key.toLowerCase();
    renderMapRows();
    return;
  }
  const found=keyMappings.find(m=>m.key===(e.key===' '?'Space':e.key.toLowerCase()));
  if(found){e.preventDefault();applyMapping(found.action);}
});
// MIDI
if(navigator.requestMIDIAccess){
  navigator.requestMIDIAccess().then(acc=>{
    midiAccess=acc;
    acc.inputs.forEach(input=>{
      input.onmidimessage=ev=>{
        const [status,note,vel]=ev.data;
        if((status&0xF0)===0x90&&vel>0){
          // map MIDI note to pose by index
          const idx=note%Object.keys(POSES).length;
          const pose=Object.keys(POSES)[idx];
          sendPose(pose);
        }
      };
    });
  }).catch(()=>{});
}
renderMapRows();


// ─── Pose Sequencer ──────────────────────────────────────────────────────────
let seqSteps=[],seqNextId=1,seqRunning=false,seqAbort=false;

function seqAddStep(poseOv,durOv){
  const pose=poseOv||document.getElementById('seqPoseSelect').value;
  const dur=parseInt(durOv||document.getElementById('seqDurInput').value)||800;
  seqSteps.push({id:seqNextId++,pose,dur});
  _seqRender();
}

function seqAddAll(){
  const dur=parseInt(document.getElementById('seqDurInput').value)||800;
  ['open','fist','point','peace','pinch','ok','gun','claw','relax','rock','three'].forEach(p=>seqSteps.push({id:seqNextId++,pose:p,dur}));
  _seqRender();
}

function seqDeleteStep(id){seqSteps=seqSteps.filter(s=>s.id!==id);_seqRender();}
function seqClear(){if(seqRunning)seqStop();seqSteps=[];_seqRender();}

function _seqRender(activeId){
  document.getElementById('seqCount').textContent=seqSteps.length;
  const el=document.getElementById('seqTimeline');
  if(!seqSteps.length){el.innerHTML='<div style="font-size:12px;color:var(--text3)">No steps yet. Add poses above.</div>';return;}
  el.innerHTML=seqSteps.map((s,i)=>`
    <div class="seq-step${s.id===activeId?' active-step':''}" id="seqstep${s.id}">
      <span class="seq-step-idx">${i+1}</span>
      <span class="seq-step-name">${s.pose}</span>
      <span class="seq-step-dur">${s.dur}ms</span>
      <div class="seq-step-bar"><div class="seq-step-prog" id="seqsprog${s.id}"></div></div>
      ${seqRunning?'':`<button class="seq-step-del" onclick="seqDeleteStep(${s.id})">&#x2715;</button>`}
    </div>`).join('');
}

async function seqPlay(){
  if(seqRunning||!seqSteps.length)return;
  const loop=document.getElementById('seqLoop').checked;
  seqRunning=true;seqAbort=false;
  document.getElementById('seqPlayBtn').disabled=true;
  document.getElementById('seqStopBtn').disabled=false;
  _seqRender();
  const totalDur=seqSteps.reduce((a,s)=>a+s.dur,0);
  let elapsed=0;
  do{
    for(const step of seqSteps){
      if(seqAbort)break;
      _seqRender(step.id);
      const el=document.getElementById('seqstep'+step.id);
      if(el)el.scrollIntoView({block:'nearest'});
      sendPose(step.pose);
      const start=Date.now();
      while(Date.now()-start<step.dur){
        if(seqAbort)break;
        const frac=(Date.now()-start)/step.dur;
        const pg=document.getElementById('seqsprog'+step.id);
        if(pg)pg.style.width=(frac*100)+'%';
        document.getElementById('seqPlaybarFill').style.width=(((elapsed+(Date.now()-start))/totalDur)*100)+'%';
        await new Promise(r=>setTimeout(r,32));
      }
      elapsed=(elapsed+step.dur)%totalDur;
    }
  }while(loop&&!seqAbort);
  seqStop(true);
}

function seqStop(internal){
  seqAbort=true;seqRunning=false;
  document.getElementById('seqPlayBtn').disabled=false;
  document.getElementById('seqStopBtn').disabled=true;
  document.getElementById('seqPlaybarFill').style.width='0%';
  _seqRender();
  if(!internal)seqAbort=false;
}