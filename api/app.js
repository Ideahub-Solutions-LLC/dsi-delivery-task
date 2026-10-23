import {readFile} from 'node:fs/promises';
import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import {accountStore,hashPassword,checkPassword,normalEmail,validEmail,normalUsername,validUsername,cleanText,publicUser,fail} from '../lib/accounts.js';
const recovery=JSON.parse(await readFile(new URL('../private/recovery.json',import.meta.url),'utf8'));
const empty=()=>({revision:0,tasks:{},milestones:{},results:{},log:[]});
const digest=s=>createHash('sha256').update(String(s)).digest();
const same=(a,b)=>timingSafeEqual(digest(a),digest(b));
const local=()=>process.env.DSI_LOCAL_DEV==='1'&&!process.env.VERCEL;
const configured=()=>Boolean(process.env.SESSION_SECRET?.length>=32);
// Upstash credentials: set directly, or as KV_REST_API_* by Vercel's Upstash integration.
const redisUrl=()=>process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL,redisToken=()=>process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN;
const shared=()=>Boolean(redisUrl()&&redisToken());
const signature=s=>createHmac('sha256',process.env.SESSION_SECRET||'local-only').update(s).digest('hex');
// Session cookie: "<expiry>.<base64url user email>.<hmac>"
const token=uid=>{const t=String(Date.now()+8*60*60*1000)+'.'+Buffer.from(uid).toString('base64url');return t+'.'+signature(t)};
function session(req){const c=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('dsi_session='))?.slice(12)||'';const [t,u,s]=c.split('.');if(!(configured()||local())||!(Number(t)>Date.now())||!u||s===undefined||!same(s,signature(t+'.'+u)))return null;return {uid:Buffer.from(u,'base64url').toString()};}
const startSession=(res,uid)=>res.setHeader('Set-Cookie',`dsi_session=${token(uid)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${local()?'':'; Secure'}`);
const accounts=()=>accountStore(shared()&&redis,local());
const team=()=>recovery.plan.people.map(({id,name,role,kind})=>({id,name,role,kind}));
async function limited(req){if(!shared())return false;const ip=req.headers['x-forwarded-for']||'unknown';const rk='dsi-login:'+digest(ip).toString('hex')+':'+Math.floor(Date.now()/60000);const attempts=await redis(['INCR',rk]);if(attempts===1)await redis(['EXPIRE',rk,120]);return attempts>20;}
function profileFields(body,user){
 const name=cleanText(body.name,80)||user?.name||'';if(!name)throw fail(400,'Enter your name');
 const personId=String(body.personId||'');if(!recovery.plan.people.some(p=>p.id===personId))throw fail(400,'Choose who you are on the team');
 return {name,personId,phone:cleanText(body.phone,40),timezone:cleanText(body.timezone,60)};
}
async function redis(command){const r=await fetch(redisUrl(),{method:'POST',headers:{Authorization:`Bearer ${redisToken()}`,'Content-Type':'application/json'},body:JSON.stringify(command)});if(!r.ok)throw Error('Shared storage unavailable');const d=await r.json();if(d.error)throw Error('Shared storage unavailable');return d.result;}
const key=()=>process.env.DSI_STORAGE_KEY||'dsi-daily-delivery-v1';
async function state(){const s=await redis(['GET',key()]);return s?JSON.parse(s):empty();}
const scalar=(s,max=8000)=>typeof s==='string'&&s.length<=max;
export function validatePatch(kind,id,p){
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Invalid update');
 const allowed=kind==='tasks'?['status','actual','evidence','blocker','helpNeeded','rescueOwner','recoveryDate','acceptedBy','notes']:kind==='milestones'?['status','evidence','acceptedBy']:kind==='results'?['actuals','evidence']:[];
 if(!allowed.length||Object.keys(p).some(k=>!allowed.includes(k)))throw Error('Invalid update fields');
 const base=kind==='tasks'?recovery.plan.tasks.find(x=>x.id===id):kind==='milestones'?recovery.plan.milestones.find(x=>x.id===id):recovery.plan.calendar.find(x=>x.date===id);
 if(!base)throw Error('Unknown record');
 for(const [k,v] of Object.entries(p)){
  if(k==='actual'){if(v!==null&&(!Number.isFinite(v)||v<0))throw Error('Actual must be a nonnegative number');}
  else if(k==='actuals'){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(x=>!Object.hasOwn(base.actuals,x)))throw Error('Invalid metrics');for(const n of Object.values(v))if(n!==null&&(!Number.isFinite(n)||n<0))throw Error('Metrics must be nonnegative numbers');}
  else if(!scalar(v))throw Error('Invalid text');
 }
 if(p.status&&!recovery.plan.meta.statuses.includes(p.status))throw Error('Invalid stage');
 if(p.recoveryDate&&(!/^20\d{2}-\d{2}-\d{2}$/.test(p.recoveryDate)||!Number.isFinite(Date.parse(p.recoveryDate+'T12:00:00Z'))))throw Error('Invalid recovery date');
 if(p.status==='Accepted'&&(!p.evidence?.trim()||!p.acceptedBy?.trim()))throw Error('Acceptance requires evidence and a recorded reviewer');
 if(kind==='results'&&Object.values(p.actuals||{}).some(x=>x!==null)&&!p.evidence?.trim())throw Error('Results require source evidence');
 return p;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');const send=(code,obj)=>res.status(code).json(obj);
 try{
 const action=new URL(req.url,'http://localhost').searchParams.get('action')||'bootstrap';
 if(!configured()&&!local())return send(503,{error:'Configure a SESSION_SECRET of at least 32 characters in Vercel, then redeploy.'});
 if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==`https://${req.headers.host}`&&!(local()&&req.headers.origin===`http://${req.headers.host}`))return send(403,{error:'Origin not allowed'});
 let body=req.body;if(typeof body==='string'){try{body=JSON.parse(body)}catch{return send(400,{error:'Invalid JSON'})}}body||={};
 const store=accounts();
 if(action==='config'&&req.method==='GET')return send(200,{accounts:Boolean(store),people:team()});
 if(['login','signup'].includes(action)&&req.method==='POST'){
  if(!store)return send(503,{error:'Sign-in is unavailable: account storage is not configured. Set the Upstash Redis variables in Vercel and redeploy.'});
  if(await limited(req))return send(429,{error:'Too many attempts. Try again in a minute.'});
 }
 if(action==='login'&&req.method==='POST'){
  const id=String(body.login??body.email??'').trim().toLowerCase();
  const user=await store.getUser(id.includes('@')?normalEmail(id):await store.emailForUsername(normalUsername(id))||'');
  if(!await checkPassword(body.password,user?.passwordHash))return send(401,{error:'Incorrect username, email or password'});
  user.lastLoginAt=new Date().toISOString();await store.saveUser(user);startSession(res,user.email);return send(200,{ok:true});
 }
 if(action==='signup'&&req.method==='POST'){
  const email=normalEmail(body.email);if(!validEmail(email))return send(400,{error:'Enter a valid email address'});
  const username=normalUsername(body.username);if(!validUsername(username))return send(400,{error:'Choose a username of 3–30 letters, numbers, dots, dashes or underscores'});
  if(typeof body.password!=='string'||body.password.length<8||body.password.length>200)return send(400,{error:'Use a password of at least 8 characters'});
  const now=new Date().toISOString();const user={email,username,passwordHash:await hashPassword(body.password),...profileFields(body),createdAt:now,lastLoginAt:now};
  // Claim the username first so two sign-ups can never share one; give it back if the email is taken.
  if(!await store.claimUsername(username,email))return send(409,{error:'That username is taken. Choose another.'});
  if(!await store.createUser(user)){await store.releaseUsername(username);return send(409,{error:'An account with this email already exists. Sign in instead.'});}
  startSession(res,user.email);return send(200,{user:publicUser(user)});
 }
 if(action==='logout'&&req.method==='POST'){res.setHeader('Set-Cookie','dsi_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure');return send(200,{ok:true});}
 const sess=session(req);const user=sess&&store?await store.getUser(sess.uid):null;if(!user)return send(401,{error:'Sign in to open this workspace.'});
 if(action==='profile'&&req.method==='POST'){Object.assign(user,profileFields(body,user),{updatedAt:new Date().toISOString()});await store.saveUser(user);return send(200,{user:publicUser(user)});}
 if(action==='bootstrap'&&req.method==='GET')return send(200,{...recovery,user:publicUser(user),mode:shared()?'shared':'local',state:shared()?await state():empty()});
 if(action==='state'&&req.method==='GET')return send(200,{mode:shared()?'shared':'local',state:shared()?await state():empty()});
 if(action==='update'&&req.method==='POST'){
  if(!shared())return send(409,{error:'Shared storage is not configured. Use device-local saving.'});
  const {kind,id,patch,revision,editor}=body;if(!Number.isSafeInteger(revision)||revision<0||!scalar(editor,120)||!editor.trim())return send(400,{error:'Editor name and revision required'});
  try{validatePatch(kind,id,patch)}catch(e){return send(400,{error:e.message})}
  const current=await state();if(current.revision!==revision)return send(409,{error:'Another editor saved first. Refresh, review their update, and retry.'});
  const now=new Date().toISOString();const prev=current[kind][id]||{};const next={...prev,...patch};
  if(next.status==='Accepted'&&(!next.evidence?.trim()||!next.acceptedBy?.trim()))return send(400,{error:'Accepted work must retain evidence and a reviewer'});
  if(kind!=='results')next.acceptedAt=next.status==='Accepted'?(prev.acceptedAt||now):null;
  current[kind][id]=next;current.log.unshift({at:now,editor,kind,id,before:prev,after:next});current.log=current.log.slice(0,500);current.revision++;
  const script="local old=redis.call('GET',KEYS[1]); local rev=0; if old then rev=cjson.decode(old).revision end; if rev~=tonumber(ARGV[1]) then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1";
  const ok=await redis(['EVAL',script,1,key(),String(revision),JSON.stringify(current)]);if(ok!==1)return send(409,{error:'Another editor saved first. Refresh and retry.'});return send(200,{state:current});
 }
 return send(405,{error:'Method not allowed'});
 }catch(e){if(e.status)return send(e.status,{error:e.message});return send(503,{error:'Shared service unavailable. Your unsaved edit remains open; retry after service recovery.'});}
}
