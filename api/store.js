import { json, requireUser, serviceRequest } from './_supabase.js';

const serviceContext=()=>({url:process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,service:process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY});

export default async function handler(req,res){
 if(req.method==='GET'&&req.query?.view!=='orders'){
  const ctx=serviceContext();
  if(!ctx.url||!ctx.service)return json(res,503,{error:'Store is not configured.'});
  const response=await serviceRequest(ctx,'store_products?select=id,category,name,subtitle,price_usd,stock,warranty_days,access_label&active=eq.true&order=sort_order.asc');
  const products=await response.json().catch(()=>[]);
  if(!response.ok)return json(res,502,{error:products?.message||'Could not load products.'});
  return json(res,200,{products});
 }
 const ctx=await requireUser(req,res);if(!ctx)return;
 if(req.method==='GET'&&req.query?.view==='orders'){
  const path='store_orders?select=id,product_name,price_usd,status,warranty_days,delivery_details,admin_note,created_at,delivered_at&user_id=eq.'+encodeURIComponent(ctx.user.id)+'&order=created_at.desc';
  const response=await serviceRequest(ctx,path);const orders=await response.json().catch(()=>[]);
  if(!response.ok)return json(res,502,{error:orders?.message||'Could not load orders.'});
  return json(res,200,{orders});
 }
 if(req.method==='POST'){
  const productId=String(req.body?.productId||'').trim();
  if(!/^[a-z0-9-]{2,60}$/.test(productId))return json(res,400,{error:'Invalid product.'});
  const response=await serviceRequest(ctx,'rpc/purchase_store_product',{method:'POST',body:JSON.stringify({p_user_id:ctx.user.id,p_product_id:productId})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)return json(res,400,{error:result.message||'Purchase failed.'});
  return json(res,200,{purchased:true,result});
 }
 return json(res,405,{error:'Method not allowed.'});
}