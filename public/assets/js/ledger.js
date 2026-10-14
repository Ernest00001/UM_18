export function allocationMovements(history,collectionId){
 return history.filter(h=>!h.new_allocations.some(a=>a.merge_target)).map(h=>{const sum=rows=>rows.filter(a=>a.collection_id===collectionId).reduce((s,a)=>s+Number(a.amount_kobo||0),0);return {...h,before_kobo:sum(h.old_allocations),after_kobo:sum(h.new_allocations),delta_kobo:sum(h.new_allocations)-sum(h.old_allocations)};}).filter(h=>h.delta_kobo!==0);
}
export function memberCredit(data,id){return data.payments.filter(p=>p.member_id===id&&p.status==='confirmed').reduce((s,p)=>s+Number(p.amount_kobo)+data.adjustments.filter(a=>a.payment_id===p.id).reduce((n,a)=>n+Number(a.delta_kobo),0)-data.allocations.filter(a=>a.payment_id===p.id).reduce((n,a)=>n+Number(a.amount_kobo),0),0);}
