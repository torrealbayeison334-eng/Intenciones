import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
let db:PGlite;
const a=randomUUID(),b=randomUUID(),outsider=randomUUID();
const legacyUser=randomUUID(),legacyPending=randomUUID(),legacyAssigned=randomUUID(),legacyCompleted=randomUUID();
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text unique);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
  // Supabase can grant named API roles EXECUTE by default. Revoking PUBLIC
  // alone must not leave anonymous or authenticated access to server RPCs.
  await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;');
  for(const name of ['202610060001_initial.sql','202610060002_access_approval.sql']) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
  await db.query('insert into auth.users(id,email) values($1,$2)',[legacyUser,'legacy@example.com']);
  await db.query("insert into public.members(user_id,display_name,role,approved) values($1,'Legado','priest',true)",[legacyUser]);
  for(const [id,kind,status] of [[legacyPending,'petition','pending'],[legacyAssigned,'petition','assigned'],[legacyCompleted,'gratitude','completed']]){
    await db.query("insert into public.intentions(id,submission_id,name,message,kind,status,assigned_to,completed_at) values($1,$2,'Alias legado','Un mensaje anterior a la migración',$3,$4,$5,case when $4='completed' then now()-interval '1 hour' else null end)",[id,randomUUID(),kind,status,status==='pending'?null:legacyUser]);
    await db.query('insert into public.intention_contacts(intention_id,email) values($1,$2)',[id,'private@example.com']);
  }
  await db.query('insert into public.email_jobs(intention_id) values($1)',[legacyCompleted]);
  await db.exec(await readFile(new URL('../supabase/migrations/202610150001_intercessor_inbox.sql',import.meta.url),'utf8'));
  for(const [id,approved] of [[a,true],[b,true],[outsider,false]] as const){
    await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${id}@example.com`]);
    await db.query('insert into public.members(user_id,display_name,role,approved) values($1,$2,$3,$4)',[id,'Intercesor de prueba','intercessor',approved]);
  }
});
after(async()=>{await db.close();});
async function asUser<T>(id:string,work:()=>Promise<T>):Promise<T>{
  await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  try{return await work();}finally{await db.exec('reset role');}
}
async function create(kind='petition',key=randomUUID(),rate=randomUUID().replaceAll('-','').repeat(2)){
  return (await db.query<{id:string}>('select public.create_intention($1,$2,$3,$4,$5) as id',[key,'Alias privado','Una intención suficientemente larga.',kind,rate])).rows[0].id;
}
async function stats(){return(await db.query<any>('select * from public.community_totals')).rows[0];}
test('migration preserves existing messages and prior readings, seeds totals and retires queued mail',async()=>{
  const rows=(await db.query<any>('select id,read_at from public.intentions order by id')).rows;
  assert.equal(rows.find(row=>row.id===legacyPending).read_at,null);
  assert.ok(rows.find(row=>row.id===legacyAssigned).read_at);
  assert.ok(Date.now()-Date.parse(rows.find(row=>row.id===legacyCompleted).read_at)>=3599000);
  const totals=await stats();assert.equal(Number(totals.petitions),2);assert.equal(Number(totals.gratitudes),1);assert.equal(Number(totals.petitions_read),1);assert.equal(Number(totals.gratitudes_read),1);assert.equal(Number(totals.intercessors),1);
  assert.equal((await db.query<any>("select to_regclass('public.email_jobs') as table")).rows[0].table,null);
});
test('anonymous and unapproved users cannot read messages, counters or recovery hashes',async()=>{
  await db.exec('set role anon');try{
    for(const table of ['intentions','community_totals','intercessor_credentials','request_limits']) await assert.rejects(db.query(`select * from public.${table}`),/permission denied/);
    await assert.rejects(db.query('select * from public.open_intention($1)',[randomUUID()]),/permission denied/);
    await assert.rejects(db.query('select public.create_intention($1,$2,$3,$4,$5)',[randomUUID(),'Alias','Un texto largo de prueba','petition','f'.repeat(64)]),/permission denied/);
  }finally{await db.exec('reset role');}
  await asUser(outsider,async()=>{
    assert.equal((await db.query('select * from public.intentions')).rows.length,0);
    assert.equal((await db.query('select * from public.community_totals')).rows.length,0);
    await assert.rejects(db.query('select * from public.open_intention($1)',[randomUUID()]),/not_authorized/);
  });
});
test('first opening is shared, keeps the message visible and counts it once',async()=>{
  const initial=await stats();const id=await create();let readAt:unknown;
  await asUser(a,async()=>{
    const row=(await db.query<any>('select * from public.open_intention($1)',[id])).rows[0];readAt=row.read_at;
    assert.ok(readAt);assert.equal(row.name,'Alias privado');assert.equal('email' in row,false);
    await assert.rejects(db.query('delete from public.intentions where id=$1',[id]),/permission denied/);
    await assert.rejects(db.query('update public.intentions set read_at=null where id=$1',[id]),/permission denied/);
    await assert.rejects(db.query('select * from public.intercessor_credentials'),/permission denied/);
  });
  await asUser(b,async()=>{
    const row=(await db.query<any>('select * from public.open_intention($1)',[id])).rows[0];
    assert.equal(String(row.read_at),String(readAt));assert.equal((await db.query('select * from public.intentions where id=$1',[id])).rows.length,1);
  });
  assert.equal(Number((await stats()).petitions_read),Number(initial.petitions_read)+1);
});
test('petitions and gratitudes have independent persistent counters; duplicate submissions do not count twice',async()=>{
  const initial=await stats(),key=randomUUID();const id=await create('gratitude',key);
  assert.equal(await create('gratitude',key),id);
  await asUser(a,async()=>{await db.query('select * from public.open_intention($1)',[id]);});
  const current=await stats();assert.equal(Number(current.gratitudes),Number(initial.gratitudes)+1);assert.equal(Number(current.gratitudes_read),Number(initial.gratitudes_read)+1);
  assert.equal(Number(current.petitions),Number(initial.petitions));
});
test('48h retention is measured from first read, hides expired rows before cleanup, preserves unread and cumulative counts',async()=>{
  const expired=await create(),unread=await create(),recent=await create();
  await asUser(a,async()=>{await db.query('select * from public.open_intention($1)',[expired]);await db.query('select * from public.open_intention($1)',[recent]);});
  await db.query("update public.intentions set read_at=now()-interval '48 hours 1 second' where id=$1",[expired]);
  await db.query("update public.intentions set created_at=now()-interval '400 days' where id=$1",[unread]);
  const initial=await stats();
  await asUser(b,async()=>{
    assert.equal((await db.query('select * from public.intentions where id=$1',[expired])).rows.length,0);
    await assert.rejects(db.query('select * from public.open_intention($1)',[expired]),/intention_unavailable/);
    assert.equal((await db.query('select * from public.intentions where id=$1',[unread])).rows.length,1);
  });
  await db.query('select public.cleanup_personal_data()');
  assert.equal((await db.query('select * from public.intentions where id=$1',[expired])).rows.length,0);
  assert.equal((await db.query('select * from public.intentions where id=any($1)',[[unread,recent]])).rows.length,2);
  assert.deepEqual(await stats(),initial);
});
test('no mail pipeline remains and old transitions cannot be invoked',async()=>{
  for(const name of ['intention_contacts','email_jobs'])assert.equal((await db.query<any>('select to_regclass($1) as table',[`public.${name}`])).rows[0].table,null);
  for(const name of ['claim_intention','complete_intention','release_intention'])await assert.rejects(db.query(`select public.${name}($1)`,[randomUUID()]),/does not exist/);
});
test('hourly server throttling is independent of an email address',async()=>{
  const rate='a'.repeat(64);
  for(let i=0;i<10;i++)await create('petition',randomUUID(),rate);
  await assert.rejects(create('petition',randomUUID(),rate),/rate_limit/);
});
test('registration is service-only, usernames are unique and counters survive account removal',async()=>{
  const id=randomUUID(),second=randomUUID(),initial=Number((await stats()).intercessors);
  for(const user of [id,second])await db.query('insert into auth.users(id,email) values($1,$2)',[user,`${user}@example.com`]);
  await asUser(a,async()=>{await assert.rejects(db.query('select public.register_intercessor($1,$2,$3)',[id,'ana_maria','a'.repeat(64)]),/permission denied/);});
  await db.query('select public.register_intercessor($1,$2,$3)',[id,'ana_maria','a'.repeat(64)]);
  await assert.rejects(db.query('select public.register_intercessor($1,$2,$3)',[second,'ana_maria','b'.repeat(64)]),/duplicate key/);
  await assert.rejects(db.query('select public.register_intercessor($1,$2,$3)',[second,'con espacio','b'.repeat(64)]),/check constraint/);
  const member=(await db.query<any>('select role,approved from public.members where user_id=$1',[id])).rows[0];assert.deepEqual(member,{role:'intercessor',approved:true});
  await db.query('delete from auth.users where id=$1',[id]);assert.equal(Number((await stats()).intercessors),initial+1);
});
test('recovery reservations prevent reuse and rotate the code only on success',async()=>{
  const id=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[id,'recover@example.com']);
  await db.query('select public.register_intercessor($1,$2,$3)',[id,'recover','a'.repeat(64)]);
  const reserve=async(hash:string,next:string)=>(await db.query<any>('select public.reserve_recovery($1,$2,$3) as id',['recover',hash,next])).rows[0].id;
  assert.equal(await reserve('f'.repeat(64),'b'.repeat(64)),null);
  assert.equal(await reserve('a'.repeat(64),'b'.repeat(64)),id);
  assert.equal(await reserve('a'.repeat(64),'c'.repeat(64)),null);
  await db.query('select public.finish_recovery($1,$2,false)',[id,'b'.repeat(64)]);
  assert.equal(await reserve('a'.repeat(64),'c'.repeat(64)),id);
  await db.query('select public.finish_recovery($1,$2,true)',[id,'c'.repeat(64)]);
  assert.equal(await reserve('a'.repeat(64),'d'.repeat(64)),null);
  assert.equal(await reserve('c'.repeat(64),'d'.repeat(64)),id);
});
