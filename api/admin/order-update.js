import { json, requireAdmin, serviceRequest } from '../_supabase.js';
export default async function handler(req,res){
 if(req.method!=='POST') return json(res,405,{error:'Method not allowed.'});
 const ctx=await requireAdmin(req,res); if(!ctx) return;
 const orderId=String(req.body?.orderId||''); const status=String(req.body?.status||'');
 if(!/^[0-9a-f-]{36}$/i.test(orderId)) return json(res,400,{error:'Invalid order.'});
 const response=await serviceRequest(ctx,'rpc/admin_update_store_order',{method:'POST',body:JSON.stringify({p_order_id:orderId,p_status:status,p_delivery_details:String(req.body?.deliveryDetails||'').slice(0,4000)||null,p_admin_note:String(req.body?.adminNote||'').slice(0,1000)||null})});
 const result=await response.json().catch(()=>({}));
 if(!response.ok) return json(res,400,{error:result.message||'Order update failed.'});
 return json(res,200,{updated:true,result});
}