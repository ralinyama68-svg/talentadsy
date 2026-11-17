import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import {createRouter} from '../lib/api.js';import {questions,score,aiScore} from '../lib/questions.js';import {client} from '../lib/client.js';
function fixture(){
 const rows=new Map(),calls=[];let allowed=true;
 const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_ANON_KEY:'anon-test',SUPABASE_SERVICE_ROLE_KEY:'service-test',SPV_EMAIL:'spv@example.test'};
 const reply=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status});
 const mock=async(input,options={})=>{
  const u=new URL(input),b=options.body?JSON.parse(options.body):null;calls.push({path:u.pathname,method:options.method||'GET',headers:options.headers,body:b});
  if(u.pathname==='/auth/v1/token'){
   if(u.searchParams.get('grant_type')==='refresh_token')return b.refresh_token==='valid-refresh'?reply({access_token:'refreshed-access',refresh_token:'rotated-refresh',expires_in:3600}):reply({},400);
   return b.email==='spv@example.test'&&b.password==='test-password'?reply({access_token:'valid-access',refresh_token:'valid-refresh',expires_in:3600}):reply({},400);
  }
  if(u.pathname==='/auth/v1/user'){
   const token=options.headers.Authorization;
   if(['Bearer valid-access','Bearer refreshed-access'].includes(token))return reply({id:'spv-user',email:'spv@example.test'});
   if(token==='Bearer outsider-access')return reply({id:'other-user',email:'other@example.test'});
   return reply({},401);
  }
  if(u.pathname==='/auth/v1/logout')return reply({},200);
  assert.equal(options.headers.apikey,env.SUPABASE_SERVICE_ROLE_KEY);
  if(u.pathname==='/rest/v1/rpc/rt_check_rate_limit'){assert.equal(b.p_key.length,64);assert(!b.p_key.includes('127.0'));return reply(allowed);}
  if(u.pathname==='/rest/v1/rt_assessments'){
   if(options.method==='POST'){assert(options.headers.Prefer.includes('ignore-duplicates'));if(!rows.has(b.id))rows.set(b.id,{...b,note:'',created_at:new Date().toISOString()});return reply(null,201);}
   if(options.method==='PATCH'){const id=u.searchParams.get('id').slice(3);if(!rows.has(id))return reply([]);rows.get(id).note=b.note;return reply([{id}]);}
   const cursor=u.searchParams.get('id')?.slice(3);return reply([...rows.values()].filter(r=>!cursor||r.id>cursor).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,101));
  }
  throw Error('Unexpected request '+u);
 };
 const route=createRouter(env,mock);
 const call=(path,body,cookie,origin='https://app.test')=>route(new Request('https://app.test'+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 return {env,mock,call,rows,calls,setAllowed(v){allowed=v;}};
}
const profile={name:'Example Participant',email:'example@example.test',school:'Example school',experience:'Belum pernah'};
const submission=()=>({id:crypto.randomUUID(),assessmentVersion:2,profile,answers:questions.map(q=>q.correct??0)});
async function login(f){const r=await f.call('/api/login',{email:'spv@example.test',password:'test-password'});assert.equal(r.status,200);return r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');}
test('38 questions, balanced placement scores, and independent AI score',async()=>{
 assert.equal(questions.length,38);assert.equal(questions.filter(q=>q.kind==='ai').length,8);
 for(let role=0;role<6;role++){const answers=questions.map(q=>q.correct??role);assert.equal(score(answers)[0].id,role);assert.equal(score(answers)[0].total,39);}
 const answers=submission().answers,wrong=answers.map((a,i)=>i>=30?(a+1)%4:a);assert.deepEqual(score(answers),score(wrong));assert.equal(aiScore(answers).correct,8);assert.equal(aiScore(wrong).correct,0);
 const f=fixture(),q=await(await f.call('/api/questions')).json();assert.equal(q.length,38);assert(!JSON.stringify(q).includes('"correct"'));assert(!JSON.stringify(q).includes('"role"'));assert.equal(f.calls.length,0);new vm.Script(client);
});
test('anonymous/other accounts cannot read results or update notes',async()=>{
 const f=fixture();assert.equal((await f.call('/api/results')).status,401);assert.equal((await f.call('/api/note',{id:crypto.randomUUID(),note:'x'})).status,401);
 assert.equal((await f.call('/api/results',undefined,'rt_access=outsider-access')).status,403);
 assert.equal((await f.call('/api/login',{email:'other@example.test',password:'test-password'})).status,401);
 assert.equal((await f.call('/api/login',{email:'spv@example.test',password:'wrong'})).status,401);
 assert(!f.calls.some(c=>c.path==='/rest/v1/rt_assessments'));
});
test('submission stores server scores only, retries preserve notes, SPV sees all answers',async()=>{
 const f=fixture(),b=submission();const result=await(await f.call('/api/submit',{...b,scores:'forged'})).json();assert.deepEqual(result,{ok:true});const stored=f.rows.get(b.id);assert.equal(stored.ai.correct,8);assert.deepEqual(stored.scores,score(b.answers));
 const cookie=await login(f);const list=await(await f.call('/api/results',undefined,cookie)).json();assert.equal(list.rows[0].responses.length,38);assert.equal(list.rows[0].ai.correct,8);
 assert.equal((await f.call('/api/note',{id:b.id,note:'Try editing task'},cookie)).status,200);await f.call('/api/submit',b);assert.equal(f.rows.size,1);assert.equal(f.rows.get(b.id).note,'Try editing task');
 assert.equal((await f.call('/api/note',{id:crypto.randomUUID(),note:'x'},cookie)).status,404);
});
test('validation, CSRF, rate limiting, and missing configuration fail closed',async()=>{
 const f=fixture(),b=submission();assert.equal((await f.call('/api/submit',{...b,answers:b.answers.slice(0,30)})).status,400);assert.equal((await f.call('/api/submit',{...b,answers:b.answers.map(()=>99)})).status,400);
 assert.equal((await f.call('/api/submit',b,undefined,'https://evil.test')).status,403);assert.equal(f.rows.size,0);
 f.setAllowed(false);assert.equal((await f.call('/api/submit',b)).status,429);assert.equal(f.rows.size,0);
 const route=createRouter({},()=>{throw Error('must not call')});assert.equal((await route(new Request('https://app.test/api/results'))).status,503);
});
test('sessions are HttpOnly and rotate through Supabase, invalid refresh clears cookies',async()=>{
 const f=fixture();const logged=await f.call('/api/login',{email:'spv@example.test',password:'test-password'});const cookies=logged.headers.getSetCookie();assert.equal(cookies.length,2);assert(cookies.every(c=>c.includes('HttpOnly')&&c.includes('Secure')&&c.includes('SameSite=Lax')));
 const refreshed=await f.call('/api/results',undefined,'rt_access=expired; rt_refresh=valid-refresh');assert.equal(refreshed.status,200);assert(refreshed.headers.getSetCookie().some(c=>c.includes('rotated-refresh')));
 const invalid=await f.call('/api/results',undefined,'rt_refresh=invalid');assert.equal(invalid.status,401);assert(invalid.headers.getSetCookie().every(c=>c.includes('Max-Age=0')));
 const cookie=await login(f),logout=await f.call('/api/logout',{},cookie);assert.equal(logout.status,200);assert(logout.headers.getSetCookie().every(c=>c.includes('Max-Age=0')));
});
test('serverless adapter routes query rewrites and emits separate cookies',async()=>{
 const f=fixture(),oldFetch=globalThis.fetch,oldEnv={...process.env};globalThis.fetch=f.mock;Object.assign(process.env,f.env,{VERCEL:'1'});
 try{const {default:handler}=await import('../api/index.js');async function invoke(route,body){const headers={},res={statusCode:0,setHeader(k,v){headers[k]=v},end(data){this.body=data}};await handler({url:'/api?route='+route,query:{route},method:body?'POST':'GET',headers:{host:'app.test',origin:'https://app.test','content-type':'application/json'},body},res);return {...res,headers};}
 const q=await invoke('questions');assert.equal(q.statusCode,200);assert.equal(JSON.parse(q.body).length,38);
 const logged=await invoke('login',{email:'spv@example.test',password:'test-password'});assert.equal(logged.statusCode,200);assert.equal(logged.headers['Set-Cookie'].length,2);
 }finally{globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in oldEnv))delete process.env[k];Object.assign(process.env,oldEnv);}
});
test('SQL denies direct browser access and built frontend excludes server material',()=>{
 const sql=fs.readFileSync(new URL('../supabase/setup.sql',import.meta.url),'utf8');assert(sql.includes('enable row level security'));assert(sql.includes('revoke all on public.rt_assessments from public, anon, authenticated'));assert(sql.includes('grant execute on function public.rt_check_rate_limit(text, integer, integer) to service_role'));
 assert(!client.includes('source-download'));assert(!client.includes('SUPABASE_SERVICE_ROLE_KEY'));assert(client.includes('name="email"'));
});
