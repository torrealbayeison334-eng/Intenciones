import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {HttpError,parseSubmission} from '../supabase/functions/_shared/domain.ts';
import {publicHandler} from '../supabase/functions/_shared/public-handler.ts';
import {intercessorAuth,username,password,recoveryCode,normalizeCode,digest,type AuthDeps} from '../supabase/functions/_shared/intercessor-auth.ts';
const valid=()=>({submissionId:randomUUID(),name:'Un alias',message:'Una intención suficientemente larga.',kind:'petition',consent:true,website:'',token:'test-token'});
const request=(body:unknown,origin='https://misterio.example')=>new Request('https://project.supabase.co/functions/v1/test',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('public intentions require consent, type, lengths and captcha but no email',()=>{
  assert.equal('email' in parseSubmission(valid()),false);
  assert.equal('email' in parseSubmission({...valid(),email:'not-even-an-email'}),false);
  for(const patch of [{consent:false},{name:'A'},{message:'x'.repeat(2001)},{kind:'other'},{website:'bot'},{token:''},{submissionId:'invalid'}])assert.throws(()=>parseSubmission({...valid(),...patch}),HttpError);
});
test('verifies captcha before saving; rejects foreign origins and oversized bodies',async()=>{
  let saved=0,verified=false;
  const handler=publicHandler({origin:'https://misterio.example',verify:async()=>{verified=true;},save:async(s)=>{assert.ok(verified);assert.equal('email' in s,false);saved++;}});
  const response=await handler(request(valid()));assert.equal(response.status,201);assert.deepEqual(await response.json(),{ok:true});assert.equal(saved,1);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await handler(request(valid(),'https://foreign.example'))).status,403);
  assert.equal((await handler(request({...valid(),message:'a'.repeat(17000)}))).status,413);assert.equal(saved,1);
});
test('usernames have no spaces; passwords and recovery codes are validated',async()=>{
  assert.equal(username('Ana_Maria'),'ana_maria');
  for(const name of ['Ana María',' conespacio','ana maria','x','<script>'])assert.throws(()=>username(name),HttpError);
  assert.throws(()=>password('short'),HttpError);assert.equal(password('a'.repeat(12)).length,12);
  const one=recoveryCode(),two=recoveryCode();assert.notEqual(one,two);assert.match(one,/^[a-f0-9]{6}(?:-[a-f0-9]{6}){3}$/);assert.equal(normalizeCode(one.toUpperCase()).length,24);assert.equal((await digest(normalizeCode(one))).length,64);
  assert.equal(normalizeCode('ABCDEF12-'.repeat(5)+'ABCDEF12'),'abcdef12'.repeat(6));
  for(const invalid of ['a'.repeat(12),'a'.repeat(23),'a'.repeat(25),'g'.repeat(24)])assert.throws(()=>normalizeCode(invalid),HttpError);
});
const secret='s'.repeat(64);
function dependencies(overrides:Partial<AuthDeps>={}):AuthDeps{return{origin:'https://misterio.example',registrationSecret:()=>secret,limit:async()=>{},db:async()=>[],auth:async()=>({id:'test-user'}),...overrides};}
test('registration rejects a missing, wrong or rotated invitation without creating an account',async()=>{
  let accounts=0;const handler=intercessorAuth(dependencies({auth:async()=>{accounts++;return{id:'user'};}}));
  for(const key of ['', 'wrong', 'old-secret'])assert.equal((await handler(request({action:'register',username:'ana',password:'a'.repeat(12),secret:key}))).status,403);
  assert.equal(accounts,0);
});
test('valid invitation creates a confirmed Auth identity, approved membership and hashed recovery code without sending mail',async()=>{
  const writes:any[]=[];const handler=intercessorAuth(dependencies({auth:async(path,method,body:any)=>{assert.equal(path,'admin/users');assert.equal(method,'POST');assert.equal(body.email_confirm,true);assert.equal(body.email,`${await digest('ana')}@intercesor.misterio.invalid`);return{id:'new-user'};},db:async(path,method,body)=>{writes.push({path,method,body});return null;}}));
  const response=await handler(request({action:'register',username:'Ana',password:'a'.repeat(12),secret}));assert.equal(response.status,201);
  const result=await response.json();assert.equal(result.username,'ana');assert.ok(result.recoveryCode);
  assert.equal(writes[0].path,'rpc/register_intercessor');assert.equal(writes[0].body.p_recovery_hash,await digest(normalizeCode(result.recoveryCode)));
  assert.equal(response.headers.get('cache-control'),'no-store');
});
test('membership failure compensates by removing the newly created Auth account',async()=>{
  const calls:string[]=[];const handler=intercessorAuth(dependencies({auth:async(path)=>{calls.push(path);return{id:'orphan'};},db:async()=>{throw new Error('DB failed');}}));
  assert.equal((await handler(request({action:'register',username:'ana',password:'a'.repeat(12),secret}))).status,503);assert.deepEqual(calls,['admin/users','admin/users/orphan']);
});
test('login returns a session only after verifying current membership',async()=>{
  let approved=false;const handler=intercessorAuth(dependencies({auth:async()=>({access_token:'access',refresh_token:'refresh',user:{id:'id'}}),db:async()=>approved?[{user_id:'id'}]:[]}));
  const body={action:'login',username:'ana',password:'a'.repeat(12)};
  assert.equal((await handler(request(body))).status,403);approved=true;
  assert.deepEqual(await(await handler(request(body))).json(),{access_token:'access',refresh_token:'refresh'});
});
test('throttling and origin checks happen before an Auth write',async()=>{
  let writes=0;const handler=intercessorAuth(dependencies({limit:async()=>{throw new HttpError(429,'Límite');},auth:async()=>{writes++;}}));
  const body={action:'register',username:'ana',password:'a'.repeat(12),secret};
  assert.equal((await handler(request(body))).status,429);assert.equal((await handler(request(body,'https://foreign.example'))).status,403);assert.equal(writes,0);
});
test('recovery accepts existing long codes, releases reservations on Auth failure and rotates to a short code',async()=>{
  for(const [fail,code] of [[true,recoveryCode()],[false,recoveryCode()],[false,'abcdef12-'.repeat(5)+'abcdef12']] as const){
    const writes:any[]=[];const handler=intercessorAuth(dependencies({db:async(path,_method,body)=>{writes.push({path,body});return path==='rpc/reserve_recovery'?'user':true;},auth:async()=>{if(fail)throw new Error('Auth failed');return{};}}));
    const response=await handler(request({action:'recover',username:'ana',password:'a'.repeat(12),code}));
    assert.equal(response.status,fail?503:200);assert.equal(writes[1].body.p_success,!fail);
    assert.equal(writes[0].body.p_hash,await digest(normalizeCode(code)));
    if(!fail){const result=await response.json();assert.equal(normalizeCode(result.recoveryCode).length,24);assert.equal(await digest(normalizeCode(result.recoveryCode)),writes[0].body.p_next_hash);}
  }
});

// Regression for Supabase's non-JWT API keys; only user sessions are Bearer JWTs.
test('modern service keys use apikey without being misrepresented as a JWT',async()=>{
  const {apiHeaders}=await import('../supabase/functions/_shared/platform.ts');
  assert.deepEqual(apiHeaders('sb_secret_test'),{apikey:'sb_secret_test'});
  assert.deepEqual(apiHeaders('sb_secret_test','user.jwt.token'),{apikey:'sb_secret_test',Authorization:'Bearer user.jwt.token'});
  assert.deepEqual(apiHeaders('legacy.jwt.key'),{apikey:'legacy.jwt.key',Authorization:'Bearer legacy.jwt.key'});
});
