import { FACE_ART, FACE_FEATURE_ART } from './face-art.js';
const safe = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const svg = body => `<svg class="cz-option-art" viewBox="0 0 120 88" aria-hidden="true" focusable="false">${body}</svg>`;
const frame = '<rect x="1" y="1" width="118" height="86" rx="10" fill="#f0f4f5"/>';
const none = '<circle cx="60" cy="44" r="22" fill="none" stroke="#7a8e9b" stroke-width="3"/><path d="m44 60 32-32" stroke="#7a8e9b" stroke-width="3"/>';
const pumpkin = '<path d="M60 15C28 9 9 30 15 56c6 24 85 24 91 0 6-26-14-47-46-41Z" fill="#ef9c39"/><path d="M60 16C38 30 38 64 60 77M60 16c22 14 22 48 0 61" fill="none" stroke="#d28028" stroke-width="2"/>';
export function optionArt(generatorId, key, value, params = {}) {
  if (generatorId==='pumpkin' && FACE_FEATURE_ART[key]?.[value]) {
    const art=FACE_FEATURE_ART[key][value];
    return svg(frame+pumpkin+`<path d="${art.main}" fill="#26343d"/><path d="${art.accent}" fill="#d7613b"/>`);
  }
  if (generatorId === 'pumpkin' && key === 'body_source') return svg(frame + pumpkin + (value === 'parametric' ? '<path d="M22 76h76M22 72v8m76-8v8" stroke="#075b76" stroke-width="2"/>' : '<path d="M60 12v9" stroke="#724b2c" stroke-width="6"/>'));
  if (/magnet|stacking_lip|tealight_fit|hat_supports|keychain_loop|multicolor/.test(key)) {
    const plate='<path d="m23 31 50-12 24 20-50 14Z" fill="#b8dcdf" stroke="#075b76" stroke-width="2"/><path d="M23 31v26l24 20V53l50-14v25L47 77" fill="#69aeb5" stroke="#075b76" stroke-width="2"/>';
    if (/magnet/.test(key)) return svg(frame+plate+'<circle cx="37" cy="35" r="5" fill="#26343d"/><circle cx="75" cy="26" r="5" fill="#26343d"/><circle cx="83" cy="39" r="5" fill="#26343d"/><circle cx="48" cy="47" r="5" fill="#26343d"/>');
    if (/loop/.test(key)) return svg(frame+'<rect x="37" y="26" width="59" height="41" rx="9" fill="#88c3c7" stroke="#075b76" stroke-width="3"/><circle cx="30" cy="44" r="16" fill="none" stroke="#075b76" stroke-width="7"/>');
    if (/supports/.test(key)) return svg(frame+'<path d="m20 29 40-14 40 14v8H20Z" fill="#593274"/><path d="M30 37v34m20-34v34m20-34v34m20-34v34M25 70h70M30 53h60" stroke="#78aab3" stroke-width="3"/>');
    if (/tealight/.test(key)) return svg(frame+'<ellipse cx="60" cy="58" rx="29" ry="12" fill="#b8dcdf" stroke="#075b76" stroke-width="2"/><path d="M31 44v14m58-14v14" stroke="#075b76" stroke-width="2"/><ellipse cx="60" cy="44" rx="29" ry="12" fill="#fff" stroke="#075b76" stroke-width="2"/><path d="M60 16q-17 20 0 23 17-3 0-23" fill="#ef9c39"/>');
    if (/multicolor/.test(key)) return svg(frame+['#ee7d20','#075b76','#593274'].map((c,i)=>`<circle cx="${36+i*24}" cy="44" r="18" fill="${c}" stroke="#fff" stroke-width="2"/>`).join(''));
    return svg(frame+plate+'<path d="m20 26 53-14 28 21-53 15Z" fill="none" stroke="#075b76" stroke-width="5"/>');
  }
  if (key === 'format') return svg(frame+(value==='keychain'?'<circle cx="28" cy="22" r="10" fill="none" stroke="#075b76" stroke-width="4"/><rect x="23" y="28" width="73" height="44" rx="8" fill="#b8dcdf" stroke="#075b76" stroke-width="2"/>':`<rect x="${value==='card'?15:30}" y="19" width="${value==='card'?90:60}" height="52" rx="6" fill="#b8dcdf" stroke="#075b76" stroke-width="2"/>`)+'<path d="M42 40q18-18 36 0m-29 8q11-10 22 0" fill="none" stroke="#075b76" stroke-width="3"/><circle cx="60" cy="56" r="3" fill="#075b76"/>');
  if (key === 'icon' || /_kind$/.test(key)) {
    const icons={heart:'<path d="M60 69 28 40C13 15 50 10 60 32 70 10 107 15 92 40Z"/>',star:'<path d="m60 14 10 21 24 3-18 17 5 24-21-12-21 12 5-24-18-17 24-3Z"/>',house:'<path d="m22 43 38-29 38 29H87v31H69V53H51v21H33V43Z"/>',toilet:'<path d="M28 17h19v29h43q0 22-24 25v7H49V64Q28 59 28 46Zm20 21h47v9H48Z"/>',mug:'<path d="M30 23h49v40q-24 20-49 0Zm50 9h13v23H80v-7h7V39h-7Z"/>',phone:'<rect x="41" y="14" width="38" height="63" rx="7"/>',mail:'<path d="M20 24h80v45H20Zm0 0 40 29 40-29"/>',pin:'<path d="M60 77S23 44 39 25a27 27 0 0 1 42 0C97 44 60 77 60 77Z"/>',disc:'<circle cx="60" cy="44" r="28"/>',ring:'<circle cx="60" cy="44" r="28" fill="none" stroke="#075b76" stroke-width="9"/>',diamond:'<path d="m60 13 30 31-30 31-30-31Z"/>'};
    if(icons[value])return svg(frame+`<g fill="#075b76">${icons[value]}</g>`);
  }
  if (generatorId==='name-plate' && key==='style') return svg(frame+`<rect x="16" y="26" width="88" height="42" rx="8" fill="${value==='inlay'?'#fff':'#b8dcdf'}" stroke="#075b76" stroke-width="2"/><text x="60" y="56" text-anchor="middle" font-family="sans-serif" font-size="30" font-weight="800" fill="${value==='outline'?'none':'#075b76'}" stroke="#075b76" stroke-width="${value==='outline'?1.5:0}">Aa</text>${value==='shadow'?'<path d="M28 72h66" stroke="#88c3c7" stroke-width="5"/>':''}`);
  if (generatorId === 'pumpkin' && key === 'face') {
    const art = FACE_ART[value];
    return svg(frame + pumpkin + (art ? `<path d="${art.main}" fill="#26343d"/><path d="${art.accent}" fill="#d7613b"/>` : value === 'none' ? '' : '<path d="m48 54 24-24 7 7-24 24-11 4Z" fill="#075b76"/>'));
  }
  if (generatorId === 'pumpkin' && key === 'topper') {
    const hats = {
      witch: '<path d="m33 60 15-32q12-27 38-15L69 34l14 26Z" fill="#593274"/><ellipse cx="60" cy="64" rx="43" ry="10" fill="#45275c"/><path d="m37 49 41 2 5 10H33Z" fill="#80549e"/><rect x="52" y="49" width="15" height="13" rx="2" fill="none" stroke="#e6b64d" stroke-width="3"/>',
      baseball: '<path d="M27 55a33 33 0 0 1 66 0Z" fill="#075b76"/><path d="M27 55h66q22 1 23 15H56Z" fill="#008e95"/><path d="M60 22v31M40 29q-8 8-7 24M80 29q8 8 7 24" fill="none" stroke="#64d3d4" stroke-width="1.5"/><ellipse cx="60" cy="22" rx="4" ry="2" fill="#008e95"/>',
      santa: '<path d="m27 64 16-38q20-26 48 13L72 35l9 29Z" fill="#bc2850"/><path d="m44 28 6 29" stroke="#e85b70" stroke-width="3"/><rect x="22" y="58" width="65" height="16" rx="7" fill="#fff" stroke="#c5d0d5"/><circle cx="91" cy="39" r="10" fill="#fff" stroke="#c5d0d5"/>'
    };
    return svg(frame + (hats[value] ?? none));
  }
  if (value === 'none' || value === 'nopass') return svg(frame + none);
  if (key==='model_kind') return svg(frame + (value==='fit'
    ? '<rect x="19" y="30" width="34" height="34" rx="5" fill="#88c3c7" stroke="#075b76" stroke-width="2"/><rect x="68" y="30" width="34" height="34" rx="5" fill="#b8dcdf" stroke="#075b76" stroke-width="2"/><path d="M54 47h13" stroke="#075b76" stroke-width="4"/><circle cx="77" cy="47" r="4" fill="#075b76"/>'
    : Array.from({length:8},(_,i)=>`<rect x="${16+(i%4)*23}" y="${20+Math.floor(i/4)*26}" width="20" height="23" rx="3" fill="${i%2?'#b8dcdf':'#69aeb5'}" stroke="#075b76" stroke-width="2"/>`).join('')));
  if (key==='vase_part') return svg(frame+(value==='shell'
    ? '<path d="M29 28v44h62V28" fill="#88c3c7" stroke="#075b76" stroke-width="2"/><ellipse cx="60" cy="28" rx="31" ry="11" fill="#075b76"/><ellipse cx="60" cy="28" rx="27" ry="8" fill="#e2eff0"/>'
    : '<path d="m23 41 52-12 22 18-52 13Z" fill="#b8dcdf" stroke="#075b76" stroke-width="2"/><path d="M23 41v9l22 18V60l52-13v9L45 68" fill="#69aeb5" stroke="#075b76" stroke-width="2"/><path d="M31 58v10h12m35-8v10h12" fill="none" stroke="#075b76" stroke-width="4"/>'));
  if (generatorId==='pumpkin' && key==='opening') return svg(frame+pumpkin+(value==='top'?'<ellipse cx="60" cy="22" rx="19" ry="7" fill="#26343d"/>':value==='bottom'?'<ellipse cx="60" cy="68" rx="19" ry="7" fill="#26343d"/>':''));
  if (key==='face_style') return svg(frame+`<rect x="18" y="24" width="84" height="48" rx="8" fill="#ef9c39" stroke="#b96c1f" stroke-width="2"/><path d="m36 43 8-12 8 12m16 0 8-12 8 12M40 53q20 24 40 0Z" fill="${value==='inlay'?'#593274':value==='cutout'?'#26343d':'#b96c1f'}" ${value==='engraved'?'stroke="#7d491b" stroke-width="2"':''}/>`);
  if (/_color$|^logo_color$|^qr_(ink|tile)$/.test(key) && params[`color_${value}`]) return svg(frame + `<circle cx="60" cy="44" r="25" fill="${/^#[\da-f]{6}$/i.test(params[`color_${value}`]) ? params[`color_${value}`] : '#075b76'}" stroke="#7a8e9b"/>`);
  if (/align/.test(key)) return svg(frame + [0,1,2,3].map(i=>`<path d="M${value==='right'?35+i%2*15:value==='center'?30+i%2*8:25} ${26+i*12}h${i%2?45:65}" stroke="#075b76" stroke-width="5" stroke-linecap="round"/>`).join(''));
  if (/shape|plate|format|corner|style|construction|opening|model_kind|export_parts|output|vase_part|stem/.test(key)) {
    if (/spher|round|circle|pill|hug/.test(value)) return svg(frame+'<ellipse cx="60" cy="45" rx="36" ry="27" fill="#88c3c7" stroke="#075b76" stroke-width="2"/><path d="M37 27q-17 25 3 38" fill="none" stroke="#d8f0ef" stroke-width="5"/>');
    if (value==='triangle') return svg(frame+'<path d="m60 17 39 53H21Z" fill="#88c3c7" stroke="#075b76" stroke-width="2"/>');
    if (value==='diamond') return svg(frame+'<path d="m60 13 32 31-32 31-32-31Z" fill="#88c3c7" stroke="#075b76" stroke-width="2"/>');
    if (value==='chamfer') return svg(frame+'<path d="M31 22h58l11 11v28L89 72H31L20 61V33Z" fill="#88c3c7" stroke="#075b76" stroke-width="2"/>');
    if (/hollow|vase|bowl|top|cutout/.test(value)) return svg(frame+'<path d="M29 29v40h62V29" fill="#88c3c7" stroke="#075b76" stroke-width="3"/><ellipse cx="60" cy="29" rx="31" ry="12" fill="#075b76"/><ellipse cx="60" cy="29" rx="24" ry="7" fill="#d9ebed"/>');
    if (['cube','rectangular','rect','solid'].includes(value)) return svg(frame+`<g transform="${value==='rectangular'?'translate(-6 20) scale(1.12 .7)':'translate(0 0)'}"><path d="m25 31 50-12 23 17-51 13Z" fill="#b8dcdf" stroke="#075b76" stroke-width="2"/><path d="M25 31v30l22 16V49Zm22 18 51-13v30L47 77Z" fill="#69aeb5" stroke="#075b76" stroke-width="2"/></g>`);
  }
  if (/pattern|decoration|texture|lattice/.test(key)) {
    if(value==='knurled')return svg(frame+Array.from({length:7},(_,i)=>`<path d="M${8+i*15} 20l-35 48M${8+i*15} 20l35 48" stroke="#008e95" stroke-width="2"/>`).join(''));
    if(value==='knit')return svg(frame+Array.from({length:15},(_,i)=>`<path d="m${22+(i%5)*18} ${20+Math.floor(i/5)*18}q0 10 8 15 8-5 8-15" fill="none" stroke="#008e95" stroke-width="2.5"/>`).join(''));
    if(['hexagons','cells'].includes(value))return svg(frame+Array.from({length:12},(_,i)=>{const x=22+(i%4)*25+(Math.floor(i/4)%2)*12,y=22+Math.floor(i/4)*20;return `<path d="m${x} ${y} 11-6 11 6v12l-11 6-11-6Z" fill="none" stroke="#008e95" stroke-width="2"/>`;}).join(''));
    if(value==='scales')return svg(frame+Array.from({length:12},(_,i)=>`<path d="M${14+(i%4)*25} ${22+Math.floor(i/4)*18}q12 26 25 0" fill="none" stroke="#008e95" stroke-width="2"/>`).join(''));
    if(['zigzag','fractal'].includes(value))return svg(frame+Array.from({length:4},(_,i)=>`<path d="m20 ${22+i*14} 10-7 10 7 10-7 10 7 10-7 10 7 10-7 10 7" fill="none" stroke="#008e95" stroke-width="2.5"/>`).join(''));
    const lines = value==='smooth' ? '<path d="M25 44h70" stroke="#008e95" stroke-width="3"/>' : value==='ridged' ? Array.from({length:6},(_,i)=>`<path d="M22 ${24+i*8}h76" stroke="#008e95" stroke-width="3"/>`).join('') : value==='lines' ? Array.from({length:6},(_,i)=>`<path d="M${25+i*14} 20v48" stroke="#008e95" stroke-width="3"/>`).join('') : Array.from({length:6},(_,i)=>`<path d="M${22+i*14} 20q-15 24 0 48" stroke="#008e95" stroke-width="3" fill="none"/>`).join('');
    return svg(frame+lines+(/lattice|hexagons|cells|scales/.test(value)?'<path d="M20 27h80M20 44h80M20 61h80" stroke="#075b76" stroke-width="2"/>':''));
  }
  // Honest typographic option sample for settings that have no verified physical illustration.
  const sample = String(value).replace(/[-_]/g,' ').slice(0,14);
  return svg(frame+`<rect x="19" y="21" width="82" height="46" rx="7" fill="#d9ebed" stroke="#719aa8"/><text x="60" y="48" text-anchor="middle" font-family="sans-serif" font-size="${sample.length>9?10:14}" font-weight="600" fill="#075b76">${safe(sample)}</text>`);
}
