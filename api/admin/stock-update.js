import { json, requireAdmin, serviceRequest } from '../_supabase.js';
export default async function handler(req,res){
 if(req.method!=='POST') return json(res,405,{error:'Method not allowed.'});
 const ctx=await requireAdmin(req,res); if(!ctx) return;
 const productId=String(req.body?.productId||''); const stock=Number(req.body?.stock);
 if(!/^[a-z0-9-]{2,60}$/.test(productId)||!Number.isInteger(stock)||stock<0) return json(res,400,{error:'Invalid stock update.'});
 const response=await serviceRequest(ctx,'rpc/admin_set_product_stock',{method:'POST',body:JSON.stringify({p_product_id:productId,p_stock:stock})});
 const result=await response.json().catch(()=>({}));
 if(!response.ok) return json(res,400,{error:result.message||'Stock update failed.'});
 return json(res,200,{updated:true,result});
}