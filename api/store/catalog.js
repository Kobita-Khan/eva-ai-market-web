import { json, serviceRequest } from '../_supabase.js';
export default async function handler(req,res){
 if(req.method!=='GET') return json(res,405,{error:'Method not allowed.'});
 const ctx={url:process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,service:process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY};
 if(!ctx.url||!ctx.service) return json(res,503,{error:'Store is not configured.'});
 const response=await serviceRequest(ctx,'store_products?select=id,category,name,subtitle,price_usd,stock,warranty_days,access_label&active=eq.true&order=sort_order.asc');
 const products=await response.json().catch(()=>[]);
 if(!response.ok) return json(res,502,{error:products?.message||'Could not load products.'});
 return json(res,200,{products});
}