import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {database,role,action,OWNER,FINANCE,READER} from './database-harness.mjs';

test('hosted default grants cannot bypass protected financial history',async t=>{
 const db=await database({migrationsLimit:18,hostedTableGrants:true});t.after(()=>db.close());
 const tables=['payment_metadata_history','payment_status_history'];
 await t.test('fixture reproduces the hosted TRUNCATE grants before the correction',async()=>{
  await db.exec('reset role');
  for(const table of tables)assert.equal((await db.query("select has_table_privilege('authenticated',$1,'TRUNCATE') allowed",['public.'+table])).rows[0].allowed,true);
 });
 await db.exec('reset role');await db.exec(await readFile('supabase/migrations/20261014171907_financial_history_access.sql','utf8'));
 await role(db,'authenticated',OWNER);
 const m=await action(db,'save_member',{full_name:'Isolated grant test member',phone_original:'08012345678',city:'Uyo',country:'Nigeria',skills:[],reason:'Isolated regression fixture'});
 const p=await action(db,'record_payment',{member_id:m.id,amount_kobo:100000,payment_date:'2026-10-14',method:'cash',verified:true,reason:'Isolated receipt fixture',allocations:[]});
 await action(db,'correct_payment',{id:p.id,member_id:m.id,payment_date:'2026-10-13',method:'cash',reason:'Correct documented date'});
 await t.test('anonymous and authenticated users cannot truncate or directly mutate history',async()=>{
  for(const user of ['anon','authenticated']){
   await role(db,user,user==='authenticated'?OWNER:null);
   for(const table of tables){
    for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])assert.equal((await db.query('select has_table_privilege(current_user,$1,$2) allowed',['public.'+table,privilege])).rows[0].allowed,false);
    await assert.rejects(db.exec('truncate public.'+table),/permission denied/);
    await assert.rejects(db.exec('delete from public.'+table),/permission denied/);
   }
  }
 });
 await t.test('audited writes and authorized finance reads survive; read-only executives see no history',async()=>{
  await role(db,'authenticated',FINANCE);for(const table of tables)assert.ok((await db.query('select * from public.'+table)).rows.length>0);
  await role(db,'authenticated',READER);for(const table of tables)assert.equal((await db.query('select * from public.'+table)).rows.length,0);
  await role(db,'anon',null);for(const table of tables)await assert.rejects(db.query('select * from public.'+table),/permission denied/);
 });
 await t.test('new application tables no longer inherit browser privileges',async()=>{
  await db.exec('reset role');await db.exec('create table public.isolated_future_table(id integer)');
  for(const user of ['anon','authenticated'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[user,'public.isolated_future_table',privilege])).rows[0].allowed,false);
 });
});
