// User accounts: password hashing and account storage.
// Accounts live in Upstash Redis when it is configured, or in data/users.local.json during local development.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export const fail=(status,message)=>Object.assign(Error(message),{status});

export const normalEmail=e=>typeof e==='string'?e.trim().toLowerCase():'';
export const validEmail=e=>e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
// Usernames never contain "@", so a login identifier with "@" is always an email.
export const normalUsername=u=>typeof u==='string'?u.trim().toLowerCase():'';
export const validUsername=u=>/^[a-z0-9][a-z0-9._-]{2,29}$/.test(u);
export const cleanText=(s,max)=>typeof s==='string'?s.trim().slice(0,max):'';

export async function hashPassword(p){const salt=randomBytes(16);const h=await scrypt(String(p),salt,64);return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`}
// Always runs scrypt, even for unknown emails, so response timing does not reveal which accounts exist.
export async function checkPassword(p,stored){
 const [kind,salt,hash]=String(stored||'scrypt$00$00').split('$');
 const h=await scrypt(String(p??''),Buffer.from(salt||'00','hex'),64);const e=Buffer.from(hash||'','hex');
 return kind==='scrypt'&&Boolean(stored)&&e.length===h.length&&timingSafeEqual(e,h);
}

export const publicUser=u=>u&&({email:u.email,username:u.username||'',name:u.name,personId:u.personId,phone:u.phone||'',timezone:u.timezone||'',createdAt:u.createdAt,lastLoginAt:u.lastLoginAt||null});

const userKey=e=>'dsi-user:'+e,usernameKey=u=>'dsi-username:'+u;
function redisStore(redis){return {
 getUser:async e=>{const v=await redis(['GET',userKey(e)]);return v?JSON.parse(v):null},
 createUser:async u=>await redis(['SET',userKey(u.email),JSON.stringify(u),'NX'])==='OK',
 saveUser:async u=>{await redis(['SET',userKey(u.email),JSON.stringify(u)])},
 emailForUsername:u=>redis(['GET',usernameKey(u)]),
 claimUsername:async(u,e)=>await redis(['SET',usernameKey(u),e,'NX'])==='OK',
 releaseUsername:async u=>{await redis(['DEL',usernameKey(u)])},
}}
function fileStore(file){
 let queue=Promise.resolve();
 const read=async()=>{try{return JSON.parse(await readFile(file,'utf8'))}catch{return {users:{},usernames:{}}}};
 const change=fn=>queue=queue.then(async()=>{const db=await read();const out=fn(db);await mkdir(new URL('.',file),{recursive:true});await writeFile(file,JSON.stringify(db,null,2));return out});
 return {
  getUser:async e=>(await read()).users[e]||null,
  createUser:u=>change(db=>db.users[u.email]?false:(db.users[u.email]=u,true)),
  saveUser:u=>change(db=>{db.users[u.email]=u}),
  emailForUsername:async u=>(await read()).usernames?.[u]||null,
  claimUsername:(u,e)=>change(db=>{db.usernames||={};return db.usernames[u]?false:(db.usernames[u]=e,true)}),
  releaseUsername:u=>change(db=>{delete db.usernames?.[u]}),
 };
}
let localStore;
export function accountStore(redis,local){
 if(redis)return redisStore(redis);
 if(local)return localStore||=fileStore(new URL('../data/users.local.json',import.meta.url));
 return null;
}
