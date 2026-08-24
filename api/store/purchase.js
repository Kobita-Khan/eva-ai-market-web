import { json, requireUser, serviceRequest } from '../_supabase.js';
export default async function handler(req,res){
 if(req.method!=='POST') return json(res,405,{error:'Method not allowed.'});
 const ctx=await requireUser(req,res); if(!ctx) return;
 const productId=String(req.body?.productId||'').trim();
 if(!/^[a-z0-9-]{2,60}$/.test(productId)) return json(res,400,{error:'Invalid product.'});
 const response=await serviceRequest(ctx,'rpc/purchase_store_product',{method:'POST',body:JSON.stringify({p_user_id:ctx.user.id,p_product_id:productId})});
 const result=await response.json().catch(()=>({}));
 if(!response.ok) return json(res,400,{error:result.message||'Purchase failed.'});
 return json(res,200,{purchased:true,result});
}