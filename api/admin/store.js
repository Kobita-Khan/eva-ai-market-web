import { json, requireAdmin, serviceRequest } from '../_supabase.js';
export default async function handler(req,res){
 const ctx=await requireAdmin(req,res);if(!ctx)return;
 if(req.method==='GET'){
  const [pr,or]=await Promise.all([serviceRequest(ctx,'store_products?select=*&order=sort_order.asc'),serviceRequest(ctx,'store_orders?select=*&order=created_at.desc&limit=100')]);
  const [products,orders]=await Promise.all([pr.json().catch(()=>[]),or.json().catch(()=>[])]);
  if(!pr.ok||!or.ok)return json(res,502,{error:products?.message||orders?.message||'Could not load store.'});
  return json(res,200,{products,orders});
 }
 if(req.method==='POST'){
  const action=String(req.body?.action||'');
  if(action==='stock'){
   const productId=String(req.body?.productId||''),stock=Number(req.body?.stock);
   if(!/^[a-z0-9-]{2,60}$/.test(productId)||!Number.isInteger(stock)||stock<0)return json(res,400,{error:'Invalid stock update.'});
   const response=await serviceRequest(ctx,'rpc/admin_set_product_stock',{method:'POST',body:JSON.stringify({p_product_id:productId,p_stock:stock})});
   const result=await response.json().catch(()=>({}));if(!response.ok)return json(res,400,{error:result.message||'Stock update failed.'});return json(res,200,{updated:true,result});
  }
  if(action==='order'){
   const orderId=String(req.body?.orderId||''),status=String(req.body?.status||'');
   if(!/^[0-9a-f-]{36}$/i.test(orderId))return json(res,400,{error:'Invalid order.'});
   const response=await serviceRequest(ctx,'rpc/admin_update_store_order',{method:'POST',body:JSON.stringify({p_order_id:orderId,p_status:status,p_delivery_details:String(req.body?.deliveryDetails||'').slice(0,4000)||null,p_admin_note:String(req.body?.adminNote||'').slice(0,1000)||null})});
   const result=await response.json().catch(()=>({}));if(!response.ok)return json(res,400,{error:result.message||'Order update failed.'});return json(res,200,{updated:true,result});
  }
  return json(res,400,{error:'Invalid store action.'});
 }
 return json(res,405,{error:'Method not allowed.'});
}