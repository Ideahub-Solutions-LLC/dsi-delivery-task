import test from 'node:test';import assert from 'node:assert/strict';import handler,{validatePatch} from '../api/app.js';
function call(action,body,cookie=''){const req={url:'/api/app?action='+action,method:body?'POST':'GET',headers:{host:'unit.test',cookie},body};const res={headers:{},setHeader(k,v){this.headers[k]=v},status(c){this.code=c;return this},json(v){this.value=v;return this}};return handler(req,res).then(()=>res)}
const cookieOf=r=>r.headers['Set-Cookie'].split(';')[0];
const secret='test-only-secret-with-more-than-32-characters';
function fakeRedis(db){return async(_url,opts)=>{const c=JSON.parse(opts.body);let result;
 if(c[0]==='GET')result=db.get(c[1])??null;
 if(c[0]==='SET'){if(c[3]==='NX'&&db.has(c[1]))result=null;else{db.set(c[1],c[2]);result='OK'}}
 if(c[0]==='INCR'){result=(db.get(c[1])||0)+1;db.set(c[1],result)}
 if(c[0]==='EXPIRE')result=1;
 if(c[0]==='EVAL'){const old=JSON.parse(db.get(c[3])||'{"revision":0}');result=old.revision===Number(c[4])?1:0;if(result)db.set(c[3],c[5])}
 return {ok:true,json:async()=>({result})};}}
test('accounts, validation, shared updates and stale revisions',async()=>{
 const original=global.fetch;const db=new Map();global.fetch=fakeRedis(db);
 try{
 delete process.env.DSI_LOCAL_DEV;delete process.env.SESSION_SECRET;
 assert.equal((await call('bootstrap')).code,503);
 process.env.SESSION_SECRET=secret;process.env.UPSTASH_REDIS_REST_URL='https://redis.invalid';process.env.UPSTASH_REDIS_REST_TOKEN='test-only-token';
 assert.equal((await call('bootstrap')).code,401);
 const config=(await call('config')).value;assert.equal(config.accounts,true);assert.ok(config.people.some(p=>p.id==='wyline'&&p.role==='Program Director'));assert.equal(config.google,undefined);
 // There is no team password and no access code: only personal accounts.
 assert.equal((await call('login',{password:'anything'})).code,401);
 assert.equal((await call('google',{credential:'x'})).code,401);
 const account={personId:'wyline',name:'Wyline',email:'Wyline@Example.com',password:'correct horse'};
 assert.equal((await call('signup',{...account,personId:'nobody'})).code,400);
 assert.equal((await call('signup',{...account,password:'short'})).code,400);
 assert.equal((await call('signup',{...account,email:'not-an-email'})).code,400);
 const signup=await call('signup',account);assert.equal(signup.code,200);assert.equal(signup.value.user.email,'wyline@example.com');assert.equal(signup.value.user.passwordHash,undefined);
 assert.equal((await call('signup',account)).code,409);
 assert.ok(!db.get('dsi-user:wyline@example.com').includes('correct horse'));
 assert.equal((await call('login',{email:'wyline@example.com',password:'wrong password'})).code,401);
 assert.equal((await call('login',{email:'nobody@example.com',password:'correct horse'})).code,401);
 const login=await call('login',{email:' WYLINE@example.com ',password:'correct horse'});assert.equal(login.code,200);const cookie=cookieOf(login);
 const boot=await call('bootstrap',null,cookie);assert.equal(boot.code,200);assert.equal(boot.value.plan.tasks.length,494);assert.equal(Object.keys(boot.value.views).length,9);assert.equal(boot.value.user.personId,'wyline');
 const profile=await call('profile',{name:'Wyline R.',personId:'wyline',phone:'+1 555 0100',timezone:'America/Los_Angeles'},cookie);assert.equal(profile.code,200);assert.equal(profile.value.user.name,'Wyline R.');
 assert.equal((await call('profile',{name:'Wyline',personId:'nobody'},cookie)).code,400);
 assert.throws(()=>validatePatch('tasks','T0001',{status:'Accepted',evidence:'',acceptedBy:'Wyline'}));
 assert.throws(()=>validatePatch('tasks','T0001',{originalDueDate:'2099-01-01'}));
 assert.throws(()=>validatePatch('results','2026-10-22',{actuals:{booked:-1},evidence:'CQL'}));
 const patch={status:'Accepted',evidence:'Reviewed source output',acceptedBy:'Wyline'};
 let r=await call('update',{kind:'tasks',id:'T0001',patch,revision:0,editor:'Test editor'},cookie);assert.equal(r.code,200);assert.equal(r.value.state.revision,1);assert.equal(r.value.state.log[0].editor,'Test editor');assert.ok(r.value.state.tasks.T0001.acceptedAt);
 r=await call('update',{kind:'tasks',id:'T0001',patch,revision:0,editor:'Second editor'},cookie);assert.equal(r.code,409);
 r=await call('update',{kind:'tasks',id:'T0001',patch:{evidence:''},revision:1,editor:'Test editor'},cookie);assert.equal(r.code,400);
 assert.equal((await call('state',null,cookie+'tampered')).code,401);
 // Login attempts are rate limited per client.
 for(const k of db.keys())if(k.startsWith('dsi-login:'))db.delete(k);
 let last;for(let i=0;i<21;i++)last=await call('login',{email:'wyline@example.com',password:'wrong password'});assert.equal(last.code,429);
 }finally{global.fetch=original;for(const k of ['SESSION_SECRET','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'])delete process.env[k]}
});
test('sign-in is unavailable without account storage',async()=>{
 try{
 process.env.SESSION_SECRET=secret;
 assert.equal((await call('config')).value.accounts,false);
 assert.equal((await call('login',{email:'w@example.com',password:'correct horse'})).code,503);
 assert.equal((await call('signup',{personId:'wyline',name:'W',email:'w@example.com',password:'correct horse'})).code,503);
 assert.equal((await call('bootstrap')).code,401);
 }finally{delete process.env.SESSION_SECRET}
});
test('Vercel Upstash integration variable names enable shared storage',async()=>{
 const original=global.fetch;let seen;global.fetch=async(url,opts)=>{seen={url,auth:opts.headers.Authorization};return {ok:true,json:async()=>({result:null})}};
 try{
 process.env.SESSION_SECRET=secret;process.env.KV_REST_API_URL='https://kv.invalid';process.env.KV_REST_API_TOKEN='kv-test-token';
 assert.equal((await call('config')).value.accounts,true);
 assert.equal((await call('login',{email:'nobody@example.com',password:'correct horse'})).code,401);
 assert.deepEqual(seen,{url:'https://kv.invalid',auth:'Bearer kv-test-token'});
 }finally{global.fetch=original;for(const k of ['SESSION_SECRET','KV_REST_API_URL','KV_REST_API_TOKEN'])delete process.env[k]}
});
