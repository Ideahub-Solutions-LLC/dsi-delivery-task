import test from 'node:test';import assert from 'node:assert/strict';import handler,{validatePatch} from '../api/app.js';
function call(action,body,cookie=''){const req={url:'/api/app?action='+action,method:body?'POST':'GET',headers:{host:'unit.test',cookie},body};const res={headers:{},setHeader(k,v){this.headers[k]=v},status(c){this.code=c;return this},json(v){this.value=v;return this}};return handler(req,res).then(()=>res)}
test('authorization, validation, shared updates and stale revisions',async()=>{
 const original=global.fetch;const db=new Map();
 global.fetch=async(_url,opts)=>{const c=JSON.parse(opts.body);let result;
 if(c[0]==='GET')result=db.get(c[1])||null;
 if(c[0]==='INCR'){result=(db.get(c[1])||0)+1;db.set(c[1],result)}
 if(c[0]==='EXPIRE')result=1;
 if(c[0]==='EVAL'){const old=JSON.parse(db.get(c[3])||'{"revision":0}');result=old.revision===Number(c[4])?1:0;if(result)db.set(c[3],c[5])}
 return {ok:true,json:async()=>({result})};};
 try{
 delete process.env.DSI_LOCAL_DEV;delete process.env.APP_PASSWORD;delete process.env.SESSION_SECRET;
 assert.equal((await call('bootstrap')).code,503);
 process.env.APP_PASSWORD='test-only-password';process.env.SESSION_SECRET='test-only-secret-with-more-than-32-characters';process.env.UPSTASH_REDIS_REST_URL='https://redis.invalid';process.env.UPSTASH_REDIS_REST_TOKEN='test-only-token';
 assert.equal((await call('bootstrap')).code,401);
 assert.equal((await call('login',{password:'wrong'})).code,401);
 const login=await call('login',{password:'test-only-password'});assert.equal(login.code,200);const cookie=login.headers['Set-Cookie'].split(';')[0];
 const boot=await call('bootstrap',null,cookie);assert.equal(boot.code,200);assert.equal(boot.value.plan.tasks.length,494);assert.equal(Object.keys(boot.value.views).length,9);
 assert.throws(()=>validatePatch('tasks','T0001',{status:'Accepted',evidence:'',acceptedBy:'Wyline'}));
 assert.throws(()=>validatePatch('tasks','T0001',{originalDueDate:'2099-01-01'}));
 assert.throws(()=>validatePatch('results','2026-10-22',{actuals:{booked:-1},evidence:'CQL'}));
 const patch={status:'Accepted',evidence:'Reviewed source output',acceptedBy:'Wyline'};
 let r=await call('update',{kind:'tasks',id:'T0001',patch,revision:0,editor:'Test editor'},cookie);assert.equal(r.code,200);assert.equal(r.value.state.revision,1);assert.equal(r.value.state.log[0].editor,'Test editor');assert.ok(r.value.state.tasks.T0001.acceptedAt);
 r=await call('update',{kind:'tasks',id:'T0001',patch,revision:0,editor:'Second editor'},cookie);assert.equal(r.code,409);
 r=await call('update',{kind:'tasks',id:'T0001',patch:{evidence:''},revision:1,editor:'Test editor'},cookie);assert.equal(r.code,400);
 const denied=await call('state',null,cookie+'tampered');assert.equal(denied.code,401);
 }finally{global.fetch=original;for(const k of ['APP_PASSWORD','SESSION_SECRET','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'])delete process.env[k]}
});
