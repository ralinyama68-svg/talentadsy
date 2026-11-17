import {createHmac} from 'node:crypto';
import {questions,score,aiScore} from './questions.js';
const common={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...common,'Content-Type':'application/json'}});
const problem=(message,status)=>Object.assign(new Error(message),{status});
const validExperience=['Belum pernah','Pernah untuk tugas / pribadi','Pernah untuk organisasi / klien'];
function cookies(request){return Object.fromEntries((request.headers.get('cookie')||'').split(';').map(s=>s.trim().split('=')).filter(a=>a.length===2));}
export function createRouter(env,fetcher=fetch){
 const base=(env.SUPABASE_URL||'').replace(/\/$/,'');
 const configured=()=>/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(base)&&env.SUPABASE_SERVICE_ROLE_KEY&&env.SUPABASE_ANON_KEY&&env.SPV_EMAIL;
 const serviceHeaders=()=>({apikey:env.SUPABASE_SERVICE_ROLE_KEY,...(env.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}),'Content-Type':'application/json'});
 async function db(path,options={}){
  let response;try{response=await fetcher(base+'/rest/v1/'+path,{...options,headers:{...serviceHeaders(),...options.headers},signal:AbortSignal.timeout(12000)});}catch{throw problem('Database belum dapat dihubungi. Coba lagi.',503);}
  if(!response.ok)throw problem('Database belum siap. Supervisor perlu memeriksa konfigurasi dan menjalankan SQL setup.',503);
  if(response.status===204)return null;const text=await response.text();return text?JSON.parse(text):null;
 }
 async function auth(path,body,access){
  let response;try{response=await fetcher(base+'/auth/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:env.SUPABASE_ANON_KEY,'Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(12000)});}catch{throw problem('Layanan login belum dapat dihubungi.',503);}
  const data=await response.json().catch(()=>({}));return {ok:response.ok,status:response.status,data};
 }
 const permitted=user=>user?.email?.toLowerCase()===env.SPV_EMAIL.trim().toLowerCase();
 async function rate(request,kind,limit){
  // Vercel overwrites x-vercel-forwarded-for. Do not trust arbitrary x-forwarded-for.
  const ip=request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()||'local';
  const key=createHmac('sha256',env.SUPABASE_SERVICE_ROLE_KEY).update(kind+':'+ip).digest('hex');
  const allowed=await db('rpc/rt_check_rate_limit',{method:'POST',body:JSON.stringify({p_key:key,p_limit:limit,p_window_seconds:3600})});
  if(allowed!==true)throw problem('Batas percobaan tercapai. Coba lagi dalam satu jam.',429);
 }
 return async function route(request){
  const pendingCookies=[];const secure=new URL(request.url).protocol==='https:';
  const setCookie=(name,value,maxAge)=>pendingCookies.push(name+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+maxAge+(secure?'; Secure':''));
  const clear=()=>{setCookie('rt_access','',0);setCookie('rt_refresh','',0);};
  function setSession(data){
   if(typeof data.access_token!=='string'||typeof data.refresh_token!=='string'||!/^[a-zA-Z0-9._~-]+$/.test(data.access_token)||!/^[a-zA-Z0-9._~-]+$/.test(data.refresh_token))throw problem('Sesi login tidak valid.',503);
   setCookie('rt_access',data.access_token,Math.max(60,Number(data.expires_in)||3600));setCookie('rt_refresh',data.refresh_token,7*86400);
  }
  async function requireSPV(){
   const c=cookies(request);
   if(c.rt_access){const verified=await auth('user',undefined,c.rt_access);if(verified.ok){if(!permitted(verified.data))throw problem('Akun ini tidak memiliki akses supervisor.',403);return c.rt_access;}if(verified.status>=500)throw problem('Layanan login sedang bermasalah.',503);}
   if(c.rt_refresh){const refreshed=await auth('token?grant_type=refresh_token',{refresh_token:c.rt_refresh});if(refreshed.ok){const verified=await auth('user',undefined,refreshed.data.access_token);if(verified.ok&&permitted(verified.data)){setSession(refreshed.data);return refreshed.data.access_token;}}}
   clear();throw problem('Silakan masuk sebagai supervisor.',401);
  }
  async function body(){const raw=await request.text();if(raw.length>20000)throw problem('Data terlalu besar.',413);try{return JSON.parse(raw);}catch{throw problem('Data tidak valid.',400);}}
  async function handle(){
   const url=new URL(request.url),path=url.pathname;
   if(request.method==='POST'){
    if(request.headers.get('origin')!==url.origin)throw problem('Permintaan tidak diizinkan.',403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))throw problem('Format permintaan tidak sesuai.',415);
    if(Number(request.headers.get('content-length')||0)>20000)throw problem('Data terlalu besar.',413);
   }
   if(path==='/api/questions'&&request.method==='GET')return json(questions.map(({id,kind,text,options})=>({id,kind,text,options:options.map(({id,text})=>({id,text}))})));
   if(!configured())throw problem('Aplikasi belum dikonfigurasi. Supervisor perlu mengisi environment variables di Vercel.',503);
   if(path==='/api/login'&&request.method==='POST'){
    await rate(request,'login',15);const b=await body();
    if(typeof b.email!=='string'||typeof b.password!=='string'||b.email.length>254||b.password.length>1000)throw problem('Isi email dan kata sandi dengan benar.',400);
    if(b.email.trim().toLowerCase()!==env.SPV_EMAIL.trim().toLowerCase())throw problem('Email atau kata sandi tidak sesuai.',401);
    const signed=await auth('token?grant_type=password',{email:b.email.trim(),password:b.password});
    if(!signed.ok){if(signed.status===429)throw problem('Terlalu banyak percobaan login. Coba lagi nanti.',429);if(signed.status>=500)throw problem('Layanan login sedang bermasalah.',503);throw problem('Email atau kata sandi tidak sesuai.',401);}
    // Independently verify token with Supabase Auth; never trust client-supplied claims.
    const verified=await auth('user',undefined,signed.data.access_token);if(!verified.ok||!permitted(verified.data))throw problem('Akun ini tidak memiliki akses supervisor.',403);
    setSession(signed.data);return json({ok:true});
   }
   if(path==='/api/logout'&&request.method==='POST'){
    const c=cookies(request);if(c.rt_access)await auth('logout',{},c.rt_access).catch(()=>{});clear();return json({ok:true});
   }
   if(path==='/api/submit'&&request.method==='POST'){
    const b=await body(),p=b.profile;
    if(!uuid(b.id)||!p||typeof p.name!=='string'||!p.name.trim()||p.name.length>100||typeof p.email!=='string'||!/^\S+@\S+\.\S+$/.test(p.email)||p.email.length>150||typeof p.school!=='string'||!p.school.trim()||p.school.length>150||!validExperience.includes(p.experience))throw problem('Lengkapi identitas dengan benar.',400);
    if(b.assessmentVersion!==2||!Array.isArray(b.answers)||b.answers.length!==questions.length||questions.some((q,i)=>!q.options.some(o=>o.id===b.answers[i])))throw problem('Jawab seluruh 38 pertanyaan sebelum mengirim.',400);
    await rate(request,'submit',100);
    const row={id:b.id,profile:{name:p.name.trim(),email:p.email.trim(),school:p.school.trim(),experience:p.experience},answers:b.answers,scores:score(b.answers),ai:aiScore(b.answers),assessment_version:2,consent_version:1};
    // Ignore duplicate UUIDs: retries cannot overwrite records or notes.
    await db('rt_assessments?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(row)});
    return json({ok:true});
   }
   if(path==='/api/results'&&request.method==='GET'){
    await requireSPV();const cursor=url.searchParams.get('cursor');if(cursor&&!uuid(cursor))throw problem('Halaman tidak valid.',400);
    const records=await db('rt_assessments?select=*&order=id.asc&limit=101'+(cursor?'&id=gt.'+encodeURIComponent(cursor):''));
    const batch=records.slice(0,100);const rows=batch.map(r=>({id:r.id,profile:r.profile,answers:r.answers,scores:r.scores,ai:r.ai,note:r.note,createdAt:r.created_at,assessmentVersion:r.assessment_version,responses:questions.slice(0,r.answers.length).map(q=>({question:q.text,answer:q.options.find(o=>o.id===r.answers[q.id])?.text??'Tidak dijawab'}))})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    return json({rows,cursor:records.length>100?batch[99].id:null});
   }
   if(path==='/api/note'&&request.method==='POST'){
    await requireSPV();const b=await body();if(!uuid(b.id)||typeof b.note!=='string'||b.note.length>3000)throw problem('Catatan tidak valid.',400);
    const updated=await db('rt_assessments?id=eq.'+encodeURIComponent(b.id)+'&select=id',{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({note:b.note})});
    if(!updated.length)throw problem('Peserta tidak ditemukan.',404);return json({ok:true});
   }
   return json({error:'Halaman tidak ditemukan.'},404);
  }
  let response;try{response=await handle();}catch(error){response=json({error:error.status?error.message:'Layanan sementara bermasalah. Jawaban belum dikonfirmasi tersimpan; coba lagi.'},error.status||500);}
  for(const c of pendingCookies)response.headers.append('Set-Cookie',c);return response;
 };
}
