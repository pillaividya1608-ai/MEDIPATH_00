// node tools-gen-maps.js -> assets/maps/*-styled.svg : light "architectural plan" style from the UI reference.
// Uses the SAME coordinates as the router, so overlays always line up. The original PNGs stay in assets/maps/.
const fs=require('fs'),vm=require('vm');const ctx={console};ctx.window=ctx;vm.createContext(ctx);
['map-geometry.js','map-data.js'].forEach(f=>vm.runInContext(fs.readFileSync('data/'+f,'utf8'),ctx));
const D=ctx.MEDIPATH_DATA,G=ctx.MEDIPATH_GEOMETRY;
const INK='#24345f', FILL={ward:'#f3e4e8',icu:'#f3e4e8',emergency:'#f6e1e1',wc:'#e3eaf5',cafe:'#dbe7ee',pharmacy:'#dcece6',waiting:'#eef3e6',reception:'#e1edf4',stairs:'#eceff9',ramp:'#dcf0e4',entrance:'#ebe3d2',lounge:'#ece8f5',admin:'#e8ebf8',records:'#e8ebf8'};
const DEF='#e9edf9', WALL=7, esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
function ladder(x,y,s){ // boxed ladder symbol used for stairs in the reference
  const w=s*0.78,h=s; const x0=x-w/2,y0=y-h/2; let o=`<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="2" fill="#fff" stroke="${INK}" stroke-width="1.8"/>`;
  o+=`<line x1="${x-w*0.22}" y1="${y0+4}" x2="${x-w*0.22}" y2="${y0+h-4}" stroke="${INK}" stroke-width="1.6"/><line x1="${x+w*0.22}" y1="${y0+4}" x2="${x+w*0.22}" y2="${y0+h-4}" stroke="${INK}" stroke-width="1.6"/>`;
  for(let i=1;i<=4;i++){const yy=y0+4+(h-8)*i/5;o+=`<line x1="${x-w*0.22}" y1="${yy}" x2="${x+w*0.22}" y2="${yy}" stroke="${INK}" stroke-width="1.4"/>`;} return o; }
for(const [fid,file] of [['gf','ground-floor-styled.svg'],['f1','first-floor-styled.svg']]){
  const g=G[fid],W=g.width,H=g.height, rs=D.rooms.filter(r=>r.floor===fid), doors=Object.values(D.nodes).filter(n=>n.floor===fid&&n.type==='door');
  let s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter,Segoe UI,Arial,sans-serif">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dcebe1"/><stop offset="1" stop-color="#e6efe6"/></linearGradient>
<filter id="sf" x="-5%" y="-5%" width="110%" height="115%"><feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#6a8a78" flood-opacity=".28"/></filter></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<g fill="#f6faf5" stroke="#f6faf5" stroke-width="2" filter="url(#sf)">`;
  g.walk.forEach(r=>s+=`<rect x="${r[0]-1}" y="${r[1]-1}" width="${r[2]-r[0]+2}" height="${r[3]-r[1]+2}"/>`);
  s+='</g>';
  rs.forEach(r=>{ const [x0,y0,x1,y1]=r.rect,w=x1-x0,h=y1-y0,c=FILL[r.kind]||DEF;
    s+=`<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="${c}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" filter="url(#sf)"/>`;
    s+=`<rect x="${x0+4}" y="${y0+4}" width="${w-8}" height="${h-8}" fill="none" stroke="${INK}" stroke-opacity=".28" stroke-width="1"/>`; });
  doors.forEach(n=>{ const r=rs.find(q=>q.door===n.id); if(!r) return; const [x0,y0,x1,y1]=r.rect;
    const nearV=Math.min(Math.abs(n.x-x0),Math.abs(n.x-x1))<Math.min(Math.abs(n.y-y0),Math.abs(n.y-y1));
    s+= nearV ? `<rect x="${n.x-5}" y="${n.y-10}" width="10" height="20" fill="#f6faf5"/>` : `<rect x="${n.x-10}" y="${n.y-5}" width="20" height="10" fill="#f6faf5"/>`; });
  rs.forEach(r=>{ const [x0,y0,x1,y1]=r.rect,w=x1-x0,h=y1-y0,cx=x0+w/2,cy=y0+h/2;
    if(r.kind==='stairs'){ const s0=Math.min(34,Math.min(w,h)*0.62); s+=ladder(cx,cy,s0); if(w>=100&&h>=60){ /* label under ladder for big stair blocks */ } return; }
    let name=r.name.replace('Radiology (X-Ray)','Radiology').replace('Emergency Department','Emergency').replace('Restrooms (North)','Restrooms').replace('Restrooms (Men)','Restrooms (M)').replace('Restrooms (Women)','Restrooms (W)').replace('Pathology Laboratory','Pathology Lab').replace('Consultation Room ','Consult. ');
    if(r.id==='main_entrance') name='Main Entrance';
    let lines=[name]; const est=n=>n.length*8.6;
    if(est(name)>w-14&&name.includes(' ')){const p=name.split(' ');const m=Math.ceil(p.length/2);lines=[p.slice(0,m).join(' '),p.slice(m).join(' ')];}
    const fz=Math.max(10.5,Math.min(15.5,(w-14)/(Math.max(...lines.map(l=>l.length))*0.6)));
    const code=r.code&&h>=50?r.code:null; const tot=lines.length*fz*1.18+(code?fz*0.95:0); let y=cy-tot/2;
    // keep the middle of the room free for the destination pin: tall rooms label near the top, short rooms near the bottom
    if(h>=96) y=y0+10; else if(h<=92&&h>=40&&r.kind!=='stairs') y=Math.max(y0+6,y1-tot-8);
    lines.forEach((l,i)=>s+=`<text x="${cx}" y="${y+fz*0.92+i*fz*1.18}" text-anchor="middle" font-size="${fz.toFixed(1)}" font-weight="600" fill="#1c2b52">${esc(l)}</text>`);
    if(code) s+=`<text x="${cx}" y="${y+lines.length*fz*1.18+fz*0.82}" text-anchor="middle" font-size="${(fz*0.76).toFixed(1)}" font-weight="500" fill="#5a6b8f">${esc(code)}</text>`; });
  s+='</svg>'; fs.writeFileSync('assets/maps/'+file,s); }
console.log('ok');
