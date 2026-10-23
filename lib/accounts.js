// User accounts: password hashing, Google ID token verification and account storage.
// Accounts live in Upstash Redis when it is configured, or in data/users.local.json during local development.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createPublicKey,randomBytes,scrypt as scryptCallback,timingSafeEqual,verify} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
const fail=(status,message)=>Object.assign(Error(message),{status});
export {fail};

export const normalEmail=e=>typeof e==='string'?e.trim().toLowerCase():'';
export const validEmail=e=>e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const cleanText=(s,max)=>typeof s==='string'?s.trim().slice(0,max):'';

export async function hashPassword(p){const salt=randomBytes(16);const h=await scrypt(String(p),salt,64);return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`}
export async function checkPassword(p,stored){
 const [kind,salt,hash]=String(stored||'scrypt$00$00').split('$');
 const h=await scrypt(String(p??''),Buffer.from(salt||'00','hex'),64);const e=Buffer.from(hash||'','hex');
 return kind==='scrypt'&&Boolean(stored)&&e.length===h.length&&timingSafeEqual(e,h);
}

export const publicUser=u=>u&&({email:u.email,name:u.name,personId:u.personId,phone:u.phone||'',timezone:u.timezone||'',picture:u.picture||'',methods:[u.passwordHash&&'password',u.googleSub&&'google'].filter(Boolean),createdAt:u.createdAt,lastLoginAt:u.lastLoginAt||null});

// Google's signing keys rotate; cache them for as long as Google's Cache-Control allows.
let certs={keys:[],until:0};
async function googleKeys(force=false){
 if(!force&&certs.until>Date.now())return certs.keys;
 const r=await fetch('https://www.googleapis.com/oauth2/v3/certs');if(!r.ok)throw fail(503,'Google sign-in is unavailable right now. Try again shortly.');
 const age=Number(/max-age=(\d+)/.exec(r.headers?.get?.('cache-control')||'')?.[1]||3600);
 certs={keys:(await r.json()).keys||[],until:Date.now()+age*1000};return certs.keys;
}
// Verifies a Sign in with Google credential (an RS256 JWT) as described in
// https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
export async function verifyGoogle(credential,clientId){
 const invalid=()=>fail(401,'Google sign-in could not be verified. Try again.');
 if(!clientId)throw fail(503,'Google sign-in is not configured. Set GOOGLE_CLIENT_ID and redeploy.');
 if(typeof credential!=='string'||credential.length>8192)throw invalid();
 const [h,p,s]=credential.split('.');if(!h||!p||!s)throw invalid();
 let header,claims;try{header=JSON.parse(Buffer.from(h,'base64url'));claims=JSON.parse(Buffer.from(p,'base64url'))}catch{throw invalid()}
 if(header.alg!=='RS256')throw invalid();
 let jwk=(await googleKeys()).find(k=>k.kid===header.kid);if(!jwk)jwk=(await googleKeys(true)).find(k=>k.kid===header.kid);if(!jwk)throw invalid();
 const signed=verify('RSA-SHA256',Buffer.from(h+'.'+p),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(s,'base64url'));
 if(!signed||!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||claims.aud!==clientId||!(claims.exp*1000>Date.now()-60000)||!claims.sub)throw invalid();
 if(claims.email_verified!==true&&claims.email_verified!=='true')throw fail(401,'Your Google email address is not verified.');
 return {sub:String(claims.sub),email:normalEmail(claims.email),name:cleanText(claims.name,80),picture:/^https:\/\//.test(claims.picture||'')?claims.picture:''};
}

const userKey=e=>'dsi-user:'+e,googleKey=s=>'dsi-google:'+s;
function redisStore(redis){return {
 getUser:async e=>{const v=await redis(['GET',userKey(e)]);return v?JSON.parse(v):null},
 createUser:async u=>await redis(['SET',userKey(u.email),JSON.stringify(u),'NX'])==='OK',
 saveUser:async u=>{await redis(['SET',userKey(u.email),JSON.stringify(u)])},
 emailForGoogle:s=>redis(['GET',googleKey(s)]),
 linkGoogle:async(s,e)=>await redis(['SET',googleKey(s),e,'NX'])==='OK',
}}
function fileStore(file){
 let queue=Promise.resolve();
 const read=async()=>{try{return JSON.parse(await readFile(file,'utf8'))}catch{return {users:{},google:{}}}};
 const change=fn=>queue=queue.then(async()=>{const db=await read();const out=fn(db);await mkdir(new URL('.',file),{recursive:true});await writeFile(file,JSON.stringify(db,null,2));return out});
 return {
  getUser:async e=>(await read()).users[e]||null,
  createUser:u=>change(db=>db.users[u.email]?false:(db.users[u.email]=u,true)),
  saveUser:u=>change(db=>{db.users[u.email]=u}),
  emailForGoogle:async s=>(await read()).google[s]||null,
  linkGoogle:(s,e)=>change(db=>db.google[s]?false:(db.google[s]=e,true)),
 };
}
let localStore;
export function accountStore(redis,local){
 if(redis)return redisStore(redis);
 if(local)return localStore||=fileStore(new URL('../data/users.local.json',import.meta.url));
 return null;
}
