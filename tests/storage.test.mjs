import test from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync,sign} from 'node:crypto';import handler,{validatePatch} from '../api/app.js';
function call(action,body,cookie=''){const req={url:'/api/app?action='+action,method:body?'POST':'GET',headers:{host:'unit.test',cookie},body};const res={headers:{},setHeader(k,v){this.headers[k]=v},status(c){this.code=c;return this},json(v){this.value=v;return this}};return handler(req,res).then(()=>res)}
const cookieOf=r=>r.headers['Set-Cookie'].split(';')[0];
const google=generateKeyPairSync('rsa',{modulusLength:2048});const jwk={...google.publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
function idToken(claims){const part=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const body=part({alg:'RS256',kid:'test-key',typ:'JWT'})+'.'+part({iss:'https://accounts.google.com',aud:'test-client.apps.googleusercontent.com',exp:Math.floor(Date.now()/1000)+600,email_verified:true,...claims});return body+'.'+sign('RSA-SHA256',Buffer.from(body),google.privateKey).toString('base64url')}
test('authorization, accounts, validation, shared updates and stale revisions',async()=>{
 const original=global.fetch;const db=new Map();
 global.fetch=async(url,opts)=>{if(String(url).startsWith('https://www.googleapis.com/'))return {ok:true,headers:{get:()=>'public, max-age=600'},json:async()=>({keys:[jwk]})};
 const c=JSON.parse(opts.body);let result;
 if(c[0]==='GET')result=db.get(c[1])??null;
 if(c[0]==='SET'){if(c[3]==='NX'&&db.has(c[1]))result=null;else{db.set(c[1],c[2]);result='OK'}}
 if(c[0]==='INCR'){result=(db.get(c[1])||0)+1;db.set(c[1],result)}
 if(c[0]==='EXPIRE')result=1;
 if(c[0]==='EVAL'){const old=JSON.parse(db.get(c[3])||'{"revision":0}');result=old.revision===Number(c[4])?1:0;if(result)db.set(c[3],c[5])}
 return {ok:true,json:async()=>({result})};};
 try{
 delete process.env.DSI_LOCAL_DEV;delete process.env.APP_PASSWORD;delete process.env.SESSION_SECRET;
 assert.equal((await call('bootstrap')).code,503);
 process.env.APP_PASSWORD='test-only-password';process.env.SESSION_SECRET='test-only-secret-with-more-than-32-characters';process.env.UPSTASH_REDIS_REST_URL='https://redis.invalid';process.env.UPSTASH_REDIS_REST_TOKEN='test-only-token';process.env.GOOGLE_CLIENT_ID='test-client.apps.googleusercontent.com';
 assert.equal((await call('bootstrap')).code,401);
 assert.deepEqual((await call('config')).value,{accounts:true,google:'test-client.apps.googleusercontent.com'});
 // Accounts replace the shared team password once storage is available.
 assert.equal((await call('login',{password:'test-only-password'})).code,401);
 assert.equal((await call('team',{accessCode:'wrong'})).code,401);
 const team=await call('team',{accessCode:'test-only-password'});assert.equal(team.code,200);assert.ok(team.value.people.some(p=>p.id==='wyline'&&p.role==='Program Director'));
 const account={accessCode:'test-only-password',personId:'wyline',name:'Wyline',email:'Wyline@Example.com',password:'correct horse'};
 assert.equal((await call('signup',{...account,accessCode:'wrong'})).code,401);
 assert.equal((await call('signup',{...account,personId:'nobody'})).code,400);
 assert.equal((await call('signup',{...account,password:'short'})).code,400);
 const signup=await call('signup',account);assert.equal(signup.code,200);assert.equal(signup.value.user.email,'wyline@example.com');assert.deepEqual(signup.value.user.methods,['password']);assert.equal(signup.value.user.passwordHash,undefined);
 assert.equal((await call('signup',account)).code,409);
 assert.ok(!db.get('dsi-user:wyline@example.com').includes('correct horse'));
 assert.equal((await call('login',{email:'wyline@example.com',password:'wrong password'})).code,401);
 assert.equal((await call('login',{email:'nobody@example.com',password:'correct horse'})).code,401);
 const login=await call('login',{email:' WYLINE@example.com ',password:'correct horse'});assert.equal(login.code,200);const cookie=cookieOf(login);
 const boot=await call('bootstrap',null,cookie);assert.equal(boot.code,200);assert.equal(boot.value.plan.tasks.length,494);assert.equal(Object.keys(boot.value.views).length,9);assert.equal(boot.value.user.personId,'wyline');
 const profile=await call('profile',{name:'Wyline R.',personId:'wyline',phone:'+1 555 0100',timezone:'America/Los_Angeles'},cookie);assert.equal(profile.code,200);assert.equal(profile.value.user.name,'Wyline R.');
 assert.equal((await call('profile',{name:'Wyline',personId:'nobody'},cookie)).code,400);
 for(const k of db.keys())if(k.startsWith('dsi-login:'))db.delete(k);
 // Sign in with Google: unknown accounts must sign up; tokens for another app or with a bad signature are rejected.
 const kenneth=idToken({sub:'google-kenneth',email:'kenneth@example.com',name:'Kenneth G.'});
 const unknown=await call('google',{credential:kenneth});assert.equal(unknown.code,404);assert.equal(unknown.value.signup,true);
 assert.equal((await call('google',{credential:idToken({sub:'x',email:'x@example.com',aud:'another-app'})})).code,401);
 assert.equal((await call('google',{credential:kenneth.slice(0,-4)+'AAAA'})).code,401);
 assert.equal((await call('google',{credential:idToken({sub:'y',email:'y@example.com',email_verified:false})})).code,401);
 assert.equal((await call('google',{credential:idToken({sub:'z',email:'z@example.com',exp:Math.floor(Date.now()/1000)-3600})})).code,401);
 const gSignup=await call('signup',{method:'google',credential:kenneth,accessCode:'test-only-password',personId:'kenneth'});assert.equal(gSignup.code,200);assert.equal(gSignup.value.user.name,'Kenneth G.');assert.deepEqual(gSignup.value.user.methods,['google']);
 assert.equal((await call('login',{email:'kenneth@example.com',password:'anything at all'})).code,401);
 const gLogin=await call('google',{credential:kenneth});assert.equal(gLogin.code,200);assert.equal((await call('bootstrap',null,cookieOf(gLogin))).value.user.email,'kenneth@example.com');
 // A verified Google account with the same email links to an existing password account.
 const linked=await call('google',{credential:idToken({sub:'google-wyline',email:'wyline@example.com'})});assert.equal(linked.code,200);assert.deepEqual((await call('bootstrap',null,cookieOf(linked))).value.user.methods,['password','google']);
 assert.throws(()=>validatePatch('tasks','T0001',{status:'Accepted',evidence:'',acceptedBy:'Wyline'}));
 assert.throws(()=>validatePatch('tasks','T0001',{originalDueDate:'2099-01-01'}));
 assert.throws(()=>validatePatch('results','2026-10-22',{actuals:{booked:-1},evidence:'CQL'}));
 const patch={status:'Accepted',evidence:'Reviewed source output',acceptedBy:'Wyline'};
 let r=await call('update',{kind:'tasks',id:'T0001',patch,revision:0,editor:'Test editor'},cookie);assert.equal(r.code,200);assert.equal(r.value.state.revision,1);assert.equal(r.value.state.log[0].editor,'Test editor');assert.ok(r.value.state.tasks.T0001.acceptedAt);
 r=await call('update',{kind:'tasks',id:'T0001',patch,revision:0,editor:'Second editor'},cookie);assert.equal(r.code,409);
 r=await call('update',{kind:'tasks',id:'T0001',patch:{evidence:''},revision:1,editor:'Test editor'},cookie);assert.equal(r.code,400);
 const denied=await call('state',null,cookie+'tampered');assert.equal(denied.code,401);
 }finally{global.fetch=original;for(const k of ['APP_PASSWORD','SESSION_SECRET','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','GOOGLE_CLIENT_ID'])delete process.env[k]}
});
test('team password still works while accounts are unavailable',async()=>{
 try{
 process.env.APP_PASSWORD='test-only-password';process.env.SESSION_SECRET='test-only-secret-with-more-than-32-characters';
 assert.deepEqual((await call('config')).value,{accounts:false,google:''});
 assert.equal((await call('signup',{accessCode:'test-only-password',personId:'wyline',name:'W',email:'w@example.com',password:'correct horse'})).code,503);
 assert.equal((await call('login',{password:'wrong'})).code,401);
 const login=await call('login',{password:'test-only-password'});assert.equal(login.code,200);
 const boot=await call('bootstrap',null,cookieOf(login));assert.equal(boot.code,200);assert.equal(boot.value.user,null);
 }finally{for(const k of ['APP_PASSWORD','SESSION_SECRET'])delete process.env[k]}
});
test('Vercel Upstash integration variable names enable shared storage',async()=>{
 const original=global.fetch;let seen;global.fetch=async(url,opts)=>{seen={url,auth:opts.headers.Authorization};return {ok:true,json:async()=>({result:null})}};
 try{
 process.env.APP_PASSWORD='test-only-password';process.env.SESSION_SECRET='test-only-secret-with-more-than-32-characters';process.env.KV_REST_API_URL='https://kv.invalid';process.env.KV_REST_API_TOKEN='kv-test-token';
 assert.equal((await call('config')).value.accounts,true);
 assert.equal((await call('login',{email:'nobody@example.com',password:'correct horse'})).code,401);
 assert.deepEqual(seen,{url:'https://kv.invalid',auth:'Bearer kv-test-token'});
 }finally{global.fetch=original;for(const k of ['APP_PASSWORD','SESSION_SECRET','KV_REST_API_URL','KV_REST_API_TOKEN'])delete process.env[k]}
});
