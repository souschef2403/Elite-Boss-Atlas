import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm';
import L from 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/+esm';

const cfg = window.ATLAS_CONFIG || {};
const configured = cfg.supabaseUrl && cfg.supabaseAnonKey && !cfg.supabaseUrl.includes('PASTE_') && !cfg.supabaseAnonKey.includes('PASTE_');
const supabase = configured ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } }) : null;
const regions = ['Swamp of Silence','Black Anvil Forge','Forest of the Great Tree','Crimson Mansion','Herba Village','Bercant Manor',"Quietis's Demesne",'Fonos Basin',"Watcher's Post",'Ruins of Turayne','Purelight Tower','Purelight Hill','Shattered Temple','Blackhowl Plains','Carmine Forest','Urstella Fields','Kastleton','Golden Rye Pastures','Windhill Shores','The Raging Wilds','Grayclaw Forest','Canina Village','Akidu Valley','Manawastes','Moonlight Desert','Sanctuary Oasis','Sandworm Lair','Daybreak Shore','Vienta Village','Other'];
let bosses=[], user=null, profile=null, selected=null, pinsUnlocked=false, channel=null, confirmationChannel=null;
const markers = new Map();
const $=s=>document.querySelector(s);
const toast=msg=>{const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),1800)};
const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const pinClass=t=>({'Elite Boss':'elite','World Boss':'world','Dungeon Elite':'dungeon','Event Boss':'event','Rare Spawn':'rare'})[t]||'elite';
const dbToUi=b=>({...b, code:b.code||'', confirmedBy:b.confirmed_by||'', respawnMin:b.respawn_min||0, respawnMax:b.respawn_max||0, lastSeen:b.last_seen||'', image:b.image_url||'', updatedAt:b.updated_at||'', x:Number(b.x), y:Number(b.y)});
const uiToDb=b=>({code:b.code,name:b.name,type:b.type,status:b.status,region:b.region,grid:b.grid,landmark:b.landmark,level:b.level,difficulty:b.difficulty,party:b.party,confirmed_by:b.confirmedBy,respawn_min:b.respawnMin,respawn_max:b.respawnMax,last_seen:b.lastSeen||null,drops:b.drops,weaknesses:b.weaknesses,strategy:b.strategy,notes:b.notes,x:b.x,y:b.y,image_url:b.image||null,updated_by:user?.id||null});

$('#atlasName').textContent=cfg.atlasName||'Elite Boss Atlas'; $('#guildName').textContent=cfg.guildName||'Your Guild';
if(!configured){$('#setupWarning').classList.remove('hidden');$('#connectionStatus').textContent='Offline setup mode';}

const image = new Image(); image.src='assets/world-map.png';
await image.decode().catch(()=>{});
const mapW=image.naturalWidth||1600, mapH=image.naturalHeight||1100;
const bounds=[[0,0],[mapH,mapW]];
const map=L.map('map',{crs:L.CRS.Simple,minZoom:-2,maxZoom:3,zoomSnap:.25,attributionControl:false});
L.imageOverlay('assets/world-map.png',bounds).addTo(map); map.fitBounds(bounds); map.setMaxBounds([[-mapH*.25,-mapW*.25],[mapH*1.25,mapW*1.25]]);

function iconFor(b){return L.divIcon({className:`boss-pin ${pinClass(b.type)} ${pinsUnlocked?'unlocked':'locked'}`,html:`<div class="pin-shape"><span>${esc((b.code||'').replace(/\D/g,'').slice(-3)||'?')}</span></div>`,iconSize:[40,48],iconAnchor:[20,46],popupAnchor:[0,-44]});}
function xyToLatLng(x,y){return [mapH*(Number(y)/100),mapW*(Number(x)/100)]} function latLngToXy(ll){return {x:+(ll.lng/mapW*100).toFixed(4),y:+(ll.lat/mapH*100).toFixed(4)}}
function renderMarkers(){markers.forEach(m=>m.remove());markers.clear();for(const b of filtered()){const marker=L.marker(xyToLatLng(b.x,b.y),{icon:iconFor(b),draggable:Boolean(user&&pinsUnlocked),title:b.name||b.code}).addTo(map);marker.on('click',()=>openDetail(b.id));marker.on('dragend',async e=>{const pos=latLngToXy(e.target.getLatLng());await patchBoss(b.id,pos);toast(`${b.name||b.code} marker moved`)});markers.set(b.id,marker)}}
function filtered(){const q=$('#searchInput').value.trim().toLowerCase();return bosses.filter(b=>(!q||[b.name,b.region,b.grid,b.landmark,b.drops,b.notes].join(' ').toLowerCase().includes(q))&&(!$('#typeFilter').value||b.type===$('#typeFilter').value)&&(!$('#statusFilter').value||b.status===$('#statusFilter').value)&&(!$('#regionFilter').value||b.region===$('#regionFilter').value))}
function render(){const items=filtered();$('#bossList').innerHTML=items.length?items.map(b=>`<button class="boss-card" data-id="${b.id}"><div class="boss-card-top"><strong>${esc(b.name||'Unnamed boss')}</strong><span class="badge ${b.status==='Confirmed'?'confirmed':''}">${esc(b.status)}</span></div><small>${esc(b.code)} · ${esc(b.type)} · ${esc(b.region||'Unknown region')} ${b.grid?`· ${esc(b.grid)}`:''}</small><small>${esc(b.landmark||'No landmark yet')}</small></button>`).join(''):'<div class="empty-state">No bosses match these filters.</div>';$('#bossCount').textContent=bosses.length;$('#confirmedCount').textContent=bosses.filter(b=>b.status==='Confirmed').length;$('#regionCount').textContent=new Set(bosses.map(b=>b.region).filter(Boolean)).size;const used=[...new Set([...regions,...bosses.map(b=>b.region).filter(Boolean)])].sort();const current=$('#regionFilter').value;$('#regionFilter').innerHTML='<option value="">All regions</option>'+used.map(r=>`<option ${r===current?'selected':''}>${esc(r)}</option>`).join('');$('#regionSuggestions').innerHTML=used.map(r=>`<option value="${esc(r)}"></option>`).join('');renderMarkers()}
async function loadBosses(){if(!supabase)return;$('#connectionStatus').textContent='Loading shared atlas…';const {data,error}=await supabase.from('bosses').select('*').order('code');if(error){$('#connectionStatus').textContent='Database error: '+error.message;return}bosses=(data||[]).map(dbToUi);$('#connectionStatus').textContent='Live shared atlas connected';render()}
async function patchBoss(id,patch){const {error}=await supabase.from('bosses').update({...patch,updated_by:user.id}).eq('id',id);if(error)toast(error.message)}
async function loadProfile(){
  if(!supabase||!user){profile=null;return}
  const {data,error}=await supabase.from('profiles').select('id,display_name').eq('id',user.id).maybeSingle();
  if(error){toast('Profile error: '+error.message);return}
  profile=data||null;
  $('#userLabel').textContent=profile?.display_name||'Guild member';
  if(!profile||profile.display_name==='Guild member'){
    $('#profileName').value='';
    $('#profileDialog').showModal();
  }
}
async function setUser(next){
  user=next;
  profile=null;
  $('#userLabel').textContent=user?'Guild member':'Public viewer';
  $('#authBtn').classList.toggle('hidden',!!user);
  $('#signOutBtn').classList.toggle('hidden',!user);
  $('#profileBtn').classList.toggle('hidden',!user);
  $('#addBossBtn').disabled=!user;
  $('#pinLockBtn').disabled=!user;
  $('#importInput').disabled=!user;
  $('#editBossBtn').disabled=!user;
  $('#markSeenBtn').disabled=!user;
  $('#confirmBossBtn').disabled=!user;
  if(!user){pinsUnlocked=false;$('#pinLockBtn').textContent='🔒 Pins locked'}
  if(user) await loadProfile();
  renderMarkers();
}
if(supabase){
  const {data:{session}}=await supabase.auth.getSession();
  await setUser(session?.user||null);
  supabase.auth.onAuthStateChange(async(_e,s)=>await setUser(s?.user||null));
  await loadBosses();
  channel=supabase.channel('bosses-live').on('postgres_changes',{event:'*',schema:'public',table:'bosses'},()=>loadBosses()).subscribe();
  confirmationChannel=supabase.channel('confirmations-live').on('postgres_changes',{event:'*',schema:'public',table:'boss_confirmations'},()=>{if($('#leaderboardDialog').open)loadLeaderboard()}).subscribe();
}else setUser(null);

map.on('click',e=>{if(!user||!pinsUnlocked)return;const pos=latLngToXy(e.latlng);openForm(null,pos)});
$('#bossList').addEventListener('click',e=>{const c=e.target.closest('[data-id]');if(c)openDetail(c.dataset.id)});
['#searchInput','#typeFilter','#statusFilter','#regionFilter'].forEach(s=>$(s).addEventListener(s==='#searchInput'?'input':'change',render));
$('#clearFiltersBtn').addEventListener('click',()=>{$('#searchInput').value=$('#typeFilter').value=$('#statusFilter').value=$('#regionFilter').value='';render()});
$('#authBtn').addEventListener('click',()=>$('#authDialog').showModal());
$('#signOutBtn').addEventListener('click',()=>supabase.auth.signOut());
$('#profileBtn').addEventListener('click',()=>{if(!user)return;$('#profileName').value=profile?.display_name||'';$('#profileMessage').textContent='';$('#profileDialog').showModal()});
$('#profileForm').addEventListener('submit',async e=>{e.preventDefault();const name=$('#profileName').value.trim();if(name.length<2){$('#profileMessage').textContent='Use at least 2 characters.';return}$('#profileMessage').textContent='Saving…';const {data,error}=await supabase.from('profiles').update({display_name:name}).eq('id',user.id).select('id,display_name').single();if(error){$('#profileMessage').textContent=error.message;return}profile=data;$('#userLabel').textContent=name;$('#profileDialog').close();toast('Display name saved')});
$('#leaderboardBtn').addEventListener('click',async()=>{$('#leaderboardDialog').showModal();await loadLeaderboard()});
$('#closeLeaderboardBtn').addEventListener('click',()=>$('#leaderboardDialog').close());
async function loadLeaderboard(){
  $('#leaderboardBody').innerHTML='<div class="empty-state">Loading leaderboard…</div>';
  const {data,error}=await supabase.from('contributor_leaderboard').select('*').order('score',{ascending:false}).order('bosses_added',{ascending:false});
  if(error){$('#leaderboardBody').innerHTML=`<div class="form-message">${esc(error.message)}</div>`;return}
  const rows=data||[];
  $('#leaderboardBody').innerHTML=rows.length?rows.map((r,i)=>`<div class="leader-row ${i<3?'podium rank-'+(i+1):''}"><span class="rank">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</span><strong>${esc(r.display_name||'Guild member')}</strong><span>${r.bosses_added} added</span><span>${r.bosses_confirmed} confirmed</span><b>${r.score} pts</b></div>`).join(''):'<div class="empty-state">No contributions yet.</div>';
}

$('#signInSubmit').addEventListener('click',async()=>{const email=$('#authEmail').value.trim(),password=$('#authPassword').value;$('#authMessage').textContent='Signing in…';const {error}=await supabase.auth.signInWithPassword({email,password});$('#authMessage').textContent=error?error.message:'';if(!error)$('#authDialog').close()});
$('#signUpSubmit').addEventListener('click',async()=>{const email=$('#authEmail').value.trim(),password=$('#authPassword').value,displayName=$('#authDisplayName').value.trim();if(displayName.length<2){$('#authMessage').textContent='Choose a display name with at least 2 characters.';return}$('#authMessage').textContent='Creating account…';const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:displayName}}});$('#authMessage').textContent=error?error.message:(data.session?'Account created and signed in.':'Account created. Check your email if confirmation is enabled.');if(data.session)$('#authDialog').close()});
$('#addBossBtn').addEventListener('click',()=>openForm());
$('#pinLockBtn').addEventListener('click',()=>{pinsUnlocked=!pinsUnlocked;$('#pinLockBtn').textContent=pinsUnlocked?'🔓 Pins unlocked':'🔒 Pins locked';renderMarkers();toast(pinsUnlocked?'Click the map to add, or drag pins to move':'Pins locked')});

function nextCode(){const n=Math.max(0,...bosses.map(b=>Number((b.code||'').match(/\d+/)?.[0]||0)))+1;return `EB-${String(n).padStart(3,'0')}`}
function localInput(v){if(!v)return'';const d=new Date(v);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16)}
function openForm(b=null,pos={x:50,y:50}){if(!user)return;$('#dialogTitle').textContent=b?'Edit elite boss':'Add elite boss';$('#bossIdLabel').textContent=b?.code||'New record';$('#bossUuid').value=b?.id||'';$('#bossCode').value=b?.code||nextCode();$('#bossName').value=b?.name||'';$('#bossType').value=b?.type||'Elite Boss';$('#bossStatus').value=b?.status||'Unconfirmed';$('#bossRegion').value=b?.region||'';$('#bossGrid').value=b?.grid||'';$('#bossLandmark').value=b?.landmark||'';$('#bossLevel').value=b?.level||'';$('#bossDifficulty').value=b?.difficulty||'★★★☆☆';$('#bossParty').value=b?.party||'';$('#bossConfirmedBy').value=b?.confirmedBy||'';$('#bossRespawnMin').value=b?.respawnMin||'';$('#bossRespawnMax').value=b?.respawnMax||'';$('#bossLastSeen').value=localInput(b?.lastSeen);$('#bossDrops').value=b?.drops||'';$('#bossWeaknesses').value=b?.weaknesses||'';$('#bossStrategy').value=b?.strategy||'';$('#bossNotes').value=b?.notes||'';$('#positionX').value=b?.x??pos.x;$('#positionY').value=b?.y??pos.y;$('#imagePreview').src=b?.image||'';$('#imagePreviewWrap').classList.toggle('hidden',!b?.image);$('#deleteBossBtn').classList.toggle('hidden',!b);$('#saveMessage').textContent='';$('#bossDialog').showModal()}
$('#closeDialogBtn').addEventListener('click',()=>$('#bossDialog').close());$('#cancelBtn').addEventListener('click',()=>$('#bossDialog').close());
$('#bossImage').addEventListener('change',e=>{const f=e.target.files[0];if(f){$('#imagePreview').src=URL.createObjectURL(f);$('#imagePreviewWrap').classList.remove('hidden')}});$('#removeImageBtn').addEventListener('click',()=>{$('#imagePreview').src='';$('#bossImage').value='';$('#imagePreviewWrap').classList.add('hidden')});
async function uploadImage(file,code){if(!file)return null;const safe=`${code}-${Date.now()}-${file.name.replace(/[^a-z0-9._-]/gi,'_')}`;const {error}=await supabase.storage.from('boss-images').upload(`${user.id}/${safe}`,file,{upsert:false});if(error)throw error;return supabase.storage.from('boss-images').getPublicUrl(`${user.id}/${safe}`).data.publicUrl}
$('#bossForm').addEventListener('submit',async e=>{e.preventDefault();$('#saveMessage').textContent='Saving…';try{const existing=bosses.find(b=>b.id===$('#bossUuid').value);let image=existing?.image||null;const file=$('#bossImage').files[0];if(file)image=await uploadImage(file,$('#bossCode').value.trim());if(!$('#imagePreview').src)image=null;const record={code:$('#bossCode').value.trim().toUpperCase(),name:$('#bossName').value.trim(),type:$('#bossType').value,status:$('#bossStatus').value,region:$('#bossRegion').value.trim(),grid:$('#bossGrid').value.trim().toUpperCase(),landmark:$('#bossLandmark').value.trim(),level:$('#bossLevel').value.trim(),difficulty:$('#bossDifficulty').value,party:$('#bossParty').value.trim(),confirmedBy:$('#bossConfirmedBy').value.trim(),respawnMin:Number($('#bossRespawnMin').value)||0,respawnMax:Number($('#bossRespawnMax').value)||0,lastSeen:$('#bossLastSeen').value?new Date($('#bossLastSeen').value).toISOString():null,drops:$('#bossDrops').value.trim(),weaknesses:$('#bossWeaknesses').value.trim(),strategy:$('#bossStrategy').value.trim(),notes:$('#bossNotes').value.trim(),x:Number($('#positionX').value),y:Number($('#positionY').value),image};let result;if(existing)result=await supabase.from('bosses').update(uiToDb(record)).eq('id',existing.id);else result=await supabase.from('bosses').insert({...uiToDb(record),created_by:user.id});if(result.error)throw result.error;$('#bossDialog').close();toast(existing?'Boss updated':'Boss added');await loadBosses()}catch(err){$('#saveMessage').textContent=err.message}});
$('#deleteBossBtn').addEventListener('click',async()=>{const id=$('#bossUuid').value;if(id&&confirm('Delete this boss record for everyone?')){const {error}=await supabase.from('bosses').delete().eq('id',id);if(error)toast(error.message);else{$('#bossDialog').close();toast('Boss deleted');await loadBosses()}}});

function formatDate(v){return v?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'Not recorded'}function duration(ms){const m=Math.max(0,Math.floor(ms/60000)),h=Math.floor(m/60);return h?`${h}h ${m%60}m`:`${m}m`}function timer(b){if(!b.lastSeen||(!b.respawnMin&&!b.respawnMax))return'No active timer';const s=new Date(b.lastSeen).getTime(),now=Date.now(),a=s+b.respawnMin*60000,z=s+(b.respawnMax||b.respawnMin)*60000;if(now<a)return`Earliest in ${duration(a-now)} · latest in ${duration(z-now)}`;if(now<=z)return`Spawn window open · closes in ${duration(z-now)}`;return`Window passed ${duration(now-z)} ago`}
function openDetail(id){const b=bosses.find(x=>x.id===id);if(!b)return;selected=b;$('#detailContent').innerHTML=`<div class="detail-hero">${b.image?`<img src="${esc(b.image)}" alt="${esc(b.name)} screenshot">`:'<div class="detail-placeholder">No screenshot</div>'}<div><p class="eyebrow">${esc(b.code)} · ${esc(b.type)}</p><h2 class="detail-title">${esc(b.name)}</h2><div class="detail-meta"><span class="badge ${b.status==='Confirmed'?'confirmed':''}">${esc(b.status)}</span><span class="badge">${esc(b.difficulty||'No difficulty')}</span><span class="badge">${esc(b.party||'Party unknown')}</span></div><p>${esc(b.region||'Unknown region')} ${b.grid?`· Grid ${esc(b.grid)}`:''}</p><p>${esc(b.landmark||'No landmark recorded')}</p><p class="timer">${esc(timer(b))}</p></div></div><div class="detail-grid"><section class="detail-block"><h3>Last seen</h3><p>${esc(formatDate(b.lastSeen))}</p></section><section class="detail-block"><h3>Respawn</h3><p>${esc(b.respawnMin||'?')}–${esc(b.respawnMax||'?')} minutes</p></section><section class="detail-block"><h3>Drops / loot</h3><p>${esc(b.drops||'Not recorded')}</p></section><section class="detail-block"><h3>Weaknesses</h3><p>${esc(b.weaknesses||'Not recorded')}</p></section><section class="detail-block"><h3>Strategy</h3><p>${esc(b.strategy||'Not recorded')}</p></section><section class="detail-block"><h3>Notes</h3><p>${esc(b.notes||'No notes')}</p></section><section class="detail-block"><h3>Confirmation</h3><p>${esc(b.confirmedBy||'No confirmer recorded')}</p></section><section class="detail-block"><h3>Map position</h3><p>${b.x.toFixed(2)}%, ${b.y.toFixed(2)}%</p></section></div>`;$('#detailDialog').showModal()}
$('#closeDetailBtn').addEventListener('click',()=>$('#detailDialog').close());$('#editBossBtn').addEventListener('click',()=>{if(!selected)return;$('#detailDialog').close();openForm(selected)});$('#markSeenBtn').addEventListener('click',async()=>{if(!selected||!user)return;const now=new Date().toISOString();await patchBoss(selected.id,{last_seen:now,updated_by:user.id});toast('Last seen set to now');await loadBosses();selected=bosses.find(x=>x.id===selected.id);openDetail(selected.id)});
$('#confirmBossBtn').addEventListener('click',async()=>{
  if(!selected||!user)return;
  if(!profile||profile.display_name==='Guild member'){toast('Set your display name first');$('#profileBtn').click();return}
  const {error}=await supabase.from('boss_confirmations').insert({boss_id:selected.id,user_id:user.id});
  if(error&&error.code!=='23505'){toast(error.message);return}
  await patchBoss(selected.id,{status:'Confirmed',confirmed_by:profile.display_name});
  toast(error?.code==='23505'?'You already confirmed this boss':'Boss confirmed — +1 point');
  await loadBosses();
  selected=bosses.find(x=>x.id===selected.id);
  openDetail(selected.id);
});
$('#exportBtn').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),bosses},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`elite-boss-atlas-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)});
$('#importInput').addEventListener('change',async e=>{if(!user)return;try{const parsed=JSON.parse(await e.target.files[0].text()),incoming=Array.isArray(parsed)?parsed:parsed.bosses;if(!Array.isArray(incoming))throw new Error('Invalid atlas file');if(!confirm(`Import ${incoming.length} records into the shared atlas? Existing matching Boss IDs will be updated.`))return;for(const src of incoming){const record={code:src.code||src.id||nextCode(),name:src.name||'Unnamed boss',type:src.type||'Elite Boss',status:src.status||'Unconfirmed',region:src.region||'',grid:src.grid||'',landmark:src.landmark||'',level:String(src.level||''),difficulty:src.difficulty||'★★★☆☆',party:src.party||'',confirmed_by:src.confirmedBy||src.confirmed_by||'',respawn_min:Number(src.respawnMin??src.respawn_min)||0,respawn_max:Number(src.respawnMax??src.respawn_max)||0,last_seen:src.lastSeen||src.last_seen||null,drops:src.drops||'',weaknesses:src.weaknesses||'',strategy:src.strategy||'',notes:src.notes||'',x:Number(src.x)||50,y:Number(src.y)||50,image_url:src.image||src.image_url||null,updated_by:user.id};const {error}=await supabase.from('bosses').upsert({...record,created_by:user.id},{onConflict:'code'});if(error)throw error}toast('Shared atlas imported');await loadBosses()}catch(err){alert(err.message)}finally{e.target.value=''}});
setInterval(()=>{if($('#detailDialog').open&&selected)openDetail(selected.id)},30000);
render();
