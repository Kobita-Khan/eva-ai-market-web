import { json, requireUser, serviceRequest } from '../_supabase.js';
export default async function handler(req,res){
 if(req.method!=='GET') return json(res,405,{error:'Method not allowed.'});
 const ctx=await requireUser(req,res); if(!ctx) return;
 const path='store_orders?select=id,product_name,price_usd,status,warranty_days,delivery_details,admin_note,created_at,delivered_at&user_id=eq.'+encodeURIComponent(ctx.user.id)+'&order=created_at.desc';
 const response=await serviceRequest(ctx,path); const orders=await response.json().catch(()=>[]);
 if(!response.ok) return json(res,502,{error:orders?.message||'Could not load orders.'});
 return json(res,200,{orders});
}