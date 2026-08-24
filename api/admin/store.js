import { json, requireAdmin, serviceRequest } from '../_supabase.js';
export default async function handler(req,res){
 if(req.method!=='GET') return json(res,405,{error:'Method not allowed.'});
 const ctx=await requireAdmin(req,res); if(!ctx) return;
 const [pr,or]=await Promise.all([
  serviceRequest(ctx,'store_products?select=*&order=sort_order.asc'),
  serviceRequest(ctx,'store_orders?select=*&order=created_at.desc&limit=100')
 ]);
 const [products,orders]=await Promise.all([pr.json().catch(()=>[]),or.json().catch(()=>[])]);
 if(!pr.ok||!or.ok) return json(res,502,{error:products?.message||orders?.message||'Could not load store.'});
 return json(res,200,{products,orders});
}