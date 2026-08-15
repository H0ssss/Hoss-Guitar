const $=id=>document.getElementById(id);
const file=$("file"),drop=$("drop"),info=$("info"),tracks=$("tracks"),track=$("track");
const convert=$("convert"),result=$("result"),output=$("output"),copy=$("copy"),status=$("status");
const low=midiNumber("E1"), high=midiNumber("A#4");
let midi=null,filename="";

file.onchange=()=>file.files[0]&&load(file.files[0]);
["dragenter","dragover"].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.add("drag")}));
["dragleave","drop"].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.remove("drag")}));
drop.ondrop=e=>e.dataTransfer.files[0]&&load(e.dataTransfer.files[0]);

async function load(f){
 try{
  midi=parseMidi(new Uint8Array(await f.arrayBuffer())); filename=f.name;
  info.textContent=`${f.name} • ${midi.tracks.length} tracks • ${midi.tpb} ticks/beat`;
  track.innerHTML="";
  midi.tracks.forEach((t,i)=>{
   const o=document.createElement("option");o.value=i;
   o.textContent=`${i+1}. ${t.name||"Untitled track"} (${t.notes.length} notes)`;
   track.appendChild(o);
  });
  const preferred=midi.tracks.findIndex(t=>/violin|melody|flute|lead|voice|guitar|piano/i.test(t.name));
  track.value=String(preferred<0?0:preferred);tracks.classList.remove("hidden");result.classList.add("hidden");
 }catch(e){info.textContent="Could not read MIDI: "+e.message;tracks.classList.add("hidden")}
}

convert.onclick=()=>{
 const t=midi.tracks[+track.value],song=build(t,midi.tempo,midi.tpb);
 $("title").textContent=filename.replace(/\.(mid|midi)$/i,"");
 $("sTrack").textContent=t.name||"Untitled";$("sEvents").textContent=song.events.length;
 $("sNotes").textContent=song.count;$("sTempo").textContent=song.bpm.toFixed(1)+" BPM";
 $("sDuration").textContent=duration(song.length);
 if(song.bad.length){
  $("warning").textContent=`${song.bad.length} note(s) outside E1–A#4: ${[...new Set(song.bad.map(midiName))].join(", ")}. They are skipped.`;
  $("warning").classList.remove("hidden");
 }else $("warning").classList.add("hidden");
 output.value=notecard(song,filename);status.textContent="";result.classList.remove("hidden");
};

copy.onclick=async()=>{
 try{await navigator.clipboard.writeText(output.value)}catch(e){output.select();document.execCommand("copy")}
 status.textContent="✓ Copied. Paste it into a Second Life notecard.";copy.textContent="Copied!";
 setTimeout(()=>copy.textContent="Copy song",1500);
};

function build(t,tempo,tpb){
 const good=[],bad=[];
 for(const n of t.notes){
  const s=ticksSec(n.start,tempo,tpb),e=ticksSec(n.end,tempo,tpb);
  if(n.num<low||n.num>high)bad.push(n.num);else good.push({s,d:e-s,num:n.num});
 }
 const map=new Map();
 for(const n of good){const k=Math.round(n.s*1000000);if(!map.has(k))map.set(k,[]);map.get(k).push(n)}
 const events=[...map.values()].sort((a,b)=>a[0].s-b[0].s).map(g=>({
  s:g[0].s,d:Math.max(...g.map(x=>x.d)),notes:g.sort((a,b)=>a.num-b.num).map(x=>midiName(x.num))
 }));
 return {events,count:good.length,bad,bpm:tempo[0]?.bpm||120,length:events.length?events.at(-1).s+events.at(-1).d:0};
}
function notecard(song,name){
 const lines=[`# ${name.replace(/\.(mid|midi)$/i,"").toUpperCase()}`,`# BPM=${song.bpm.toFixed(3)}`,"# FORMAT: time_ms|notes"];
 song.events.forEach(e=>lines.push(`${Math.round(e.s*1000)}|${e.notes.join("+")}`));
 return lines.join("\n");
}
function ticksSec(t,map,tpb){
 let x=map[0]||{tick:0,sec:0,tempo:500000};
 for(let i=1;i<map.length&&map[i].tick<=t;i++)x=map[i];
 return x.sec+(t-x.tick)*(x.tempo/1000000)/tpb;
}
function parseMidi(b){
 let p=0;const u8=()=>b[p++],u16=()=>{let v=b[p]*256+b[p+1];p+=2;return v},u32=()=>{let v=b[p]*16777216+b[p+1]*65536+b[p+2]*256+b[p+3];p+=4;return v>>>0};
 const str=n=>{let s="";for(let i=0;i<n;i++)s+=String.fromCharCode(b[p++]);return s};
 const vlq=()=>{let v=0,x;do{x=u8();v=(v<<7)|(x&127)}while(x&128);return v};
 if(str(4)!=="MThd")throw Error("Not a MIDI file");const hl=u32(),format=u16(),tc=u16(),tpb=u16();p+=Math.max(0,hl-6);
 const tracks=[],tempos=[{tick:0,tempo:500000}];
 for(let ti=0;ti<tc;ti++){
  if(str(4)!=="MTrk")throw Error("Invalid MIDI track");const len=u32(),end=p+len;let tick=0,status=0,name="",notes=[],active=new Map();
  while(p<end){
   tick+=vlq();let s=b[p];if(s<128)s=status;else{p++;status=s}
   if(s===255){const type=u8(),n=vlq();if(type===3)name=new TextDecoder().decode(b.slice(p,p+n));if(type===81&&n===3)tempos.push({tick,tempo:(b[p]<<16)|(b[p+1]<<8)|b[p+2]});p+=n;continue}
   if(s===240||s===247){const n=vlq();p+=n;continue}
   const type=s&240,ch=s&15;
   if(type===128||type===144){
    const num=u8(),vel=u8(),key=ch+":"+num;
    if(type===144&&vel)active.set(key,{tick,vel});
    else if(active.has(key)){const on=active.get(key);notes.push({start:on.tick,end:Math.max(tick,on.tick),num,vel:on.vel});active.delete(key)}
   }else if(type===160||type===176||type===224)p+=2;
   else if(type===192||type===208)p++;
   else throw Error("Unsupported MIDI event");
  }
  p=end;tracks.push({name,notes});
 }
 tempos.sort((a,b)=>a.tick-b.tick);let lastTick=0,lastSec=0,lastTempo=tempos[0].tempo,map=[];
 for(const e of tempos){if(e.tick===lastTick){lastTempo=e.tempo;continue}lastSec+=(e.tick-lastTick)*(lastTempo/1e6)/tpb;lastTick=e.tick;lastTempo=e.tempo;map.push({tick:e.tick,sec:lastSec,tempo:lastTempo,bpm:60000000/lastTempo})}
 map.unshift({tick:0,sec:0,tempo:tempos[0].tempo,bpm:60000000/tempos[0].tempo});
 return {format,tpb,tracks,tempo:map};
}
function midiNumber(n){const m=n.match(/^([A-G]#?)(-?\d+)$/),s={C:0,"C#":1,D:2,"D#":3,E:4,F:5,"F#":6,G:7,"G#":8,A:9,"A#":10,B:11};return(+m[2]+1)*12+s[m[1]]}
function midiName(n){const a=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];return a[n%12]+(Math.floor(n/12)-1)}
function duration(x){x=Math.round(x);return Math.floor(x/60)+":"+String(x%60).padStart(2,"0")}
