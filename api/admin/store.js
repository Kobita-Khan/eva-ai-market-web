import { json, requireAdmin, serviceRequest } from '../_supabase.js';

const allowedStatuses = new Set(['approved','processing','delivered','cancelled','refunded']);

async function sendTelegramAlert(text){
 const token=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
 const chatId=String(process.env.TELEGRAM_CHAT_ID||'').trim();
 if(!token||!chatId)return {sent:false,configured:false,error:'Telegram environment variables are missing.'};
 try{
  const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
   method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({chat_id:chatId,text:String(text||'').slice(0,3900),disable_web_page_preview:true})
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok||!body?.ok)return {sent:false,configured:true,error:String(body?.description||`Telegram HTTP ${response.status}`)};
  return {sent:true,configured:true};
 }catch(error){
  return {sent:false,configured:true,error:error?.message||'Telegram network error.'};
 }
}

async function sendTelegramTest(){
 return sendTelegramAlert(`✅ EVA AI MARKET — Telegram Test\n\nYour website notification system is connected.\nTime: ${new Date().toLocaleString('en-GB',{timeZone:'Asia/Dhaka'})} (BD)`);
}

export default async function handler(req,res){
 const ctx=await requireAdmin(req,res);if(!ctx)return;
 if(req.method==='GET'){
  if(req.query?.view==='deposits'){
   const response=await serviceRequest(ctx,'rpc/admin_list_deposits',{method:'POST',body:'{}'});
   const result=await response.json().catch(()=>null);
   if(!response.ok)return json(res,502,{error:result?.message||'Could not load deposits.'});
   let deposits=[];
   if(Array.isArray(result))deposits=result;
   else if(Array.isArray(result?.admin_list_deposits))deposits=result.admin_list_deposits;
   else if(Array.isArray(result?.data))deposits=result.data;
   return json(res,200,{deposits});
  }
  if(req.query?.view==='stats'){
   try{
    const [usersResponse,depositsResponse,visitsResponse]=await Promise.all([
     fetch(`${ctx.url}/auth/v1/admin/users?page=1&per_page=1000`,{headers:{apikey:ctx.service,authorization:`Bearer ${ctx.service}`}}),
     serviceRequest(ctx,'rpc/admin_list_deposits',{method:'POST',body:'{}'}),
     serviceRequest(ctx,'rpc/admin_site_visit_stats',{method:'POST',body:'{}'})
    ]);
    const usersBody=await usersResponse.json().catch(()=>({users:[]}));
    const depositsBody=await depositsResponse.json().catch(()=>[]);
    const visitsBody=await visitsResponse.json().catch(()=>[]);
    if(!usersResponse.ok)return json(res,502,{error:'Could not load customer signups.'});
    if(!depositsResponse.ok)return json(res,502,{error:'Could not load deposit statistics.'});
    const users=Array.isArray(usersBody?.users)?usersBody.users:[];
    const totalUsers=Number(usersBody?.total??users.length);
    const recentUsers=[...users].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,10).map(user=>({id:user.id,email:user.email||'',created_at:user.created_at||null,last_sign_in_at:user.last_sign_in_at||null}));
    let deposits=[];
    if(Array.isArray(depositsBody))deposits=depositsBody;
    else if(Array.isArray(depositsBody?.admin_list_deposits))deposits=depositsBody.admin_list_deposits;
    else if(Array.isArray(depositsBody?.data))deposits=depositsBody.data;
    const pendingDeposits=deposits.filter(d=>d.status==='pending').length;
    const approvedDeposits=deposits.filter(d=>d.status==='approved').length;
    const approvedAmount=deposits.filter(d=>d.status==='approved').reduce((sum,d)=>sum+Number(d.amount_usdt||0),0);
    const visitRow=Array.isArray(visitsBody)?visitsBody[0]:visitsBody;
    return json(res,200,{
     signups:{total:totalUsers,recent:recentUsers},
     deposits:{total:deposits.length,pending:pendingDeposits,approved:approvedDeposits,approvedAmount},
     visits:{
      total:Number(visitRow?.total_visits||0),
      unique:Number(visitRow?.unique_visitors||0),
      today:Number(visitRow?.visits_today||0),
      uniqueToday:Number(visitRow?.unique_today||0),
      onlineNow:Number(visitRow?.online_now||0)
     },
     telegram:{configured:Boolean(String(process.env.TELEGRAM_BOT_TOKEN||'').trim()&&String(process.env.TELEGRAM_CHAT_ID||'').trim())}
    });
   }catch(_error){return json(res,500,{error:'Could not load admin statistics.'});}
  }
  const [pr,or,ur]=await Promise.all([
   serviceRequest(ctx,'store_products?select=*&order=sort_order.asc'),
   serviceRequest(ctx,'store_orders?select=*&order=created_at.desc&limit=100'),
   fetch(`${ctx.url}/auth/v1/admin/users?page=1&per_page=1000`,{
    headers:{apikey:ctx.service,authorization:`Bearer ${ctx.service}`}
   })
  ]);
  const [products,orders,userResult]=await Promise.all([
   pr.json().catch(()=>[]),
   or.json().catch(()=>[]),
   ur.json().catch(()=>({users:[]}))
  ]);
  if(!pr.ok||!or.ok)return json(res,502,{error:products?.message||orders?.message||'Could not load store.'});
  const emailByUserId=new Map((userResult.users||[]).map(user=>[user.id,user.email||'']));
  const ordersWithCustomers=orders.map(order=>({
   ...order,
   customer_email:emailByUserId.get(order.user_id)||''
  }));
  return json(res,200,{products,orders:ordersWithCustomers});
 }
 if(req.method==='POST'){
  const action=String(req.body?.action||'');
  if(action==='telegram_test'){
   const result=await sendTelegramTest();
   if(!result.sent)return json(res,400,{error:result.error||'Telegram test failed.',telegram:result});
   return json(res,200,{ok:true,telegram:result});
  }
  if(action==='stock'){
   const productId=String(req.body?.productId||''),stock=Number(req.body?.stock);
   if(!/^[a-z0-9-]{2,60}$/.test(productId)||!Number.isInteger(stock)||stock<0||stock>10000){
    return json(res,400,{error:'Invalid stock update.'});
   }
   const response=await serviceRequest(ctx,'rpc/admin_set_product_stock',{
    method:'POST',
    body:JSON.stringify({p_product_id:productId,p_stock:stock})
   });
   const result=await response.json().catch(()=>({}));
   if(!response.ok)return json(res,400,{error:result.message||'Stock update failed.'});
   return json(res,200,{updated:true,result});
  }
  if(action==='order'){
   const orderId=String(req.body?.orderId||''),status=String(req.body?.status||'');
   const deliveryDetails=String(req.body?.deliveryDetails||'').trim().slice(0,4000);
   const adminNote=String(req.body?.adminNote||'').trim().slice(0,1000);
   if(!/^[0-9a-f-]{36}$/i.test(orderId))return json(res,400,{error:'Invalid order.'});
   if(!allowedStatuses.has(status))return json(res,400,{error:'Invalid order status.'});
   if(status==='delivered'&&!deliveryDetails)return json(res,400,{error:'Delivery details are required before marking Delivered.'});

   const beforeResponse=await serviceRequest(ctx,`store_orders?select=id,user_id,product_name,price_usd,status&id=eq.${encodeURIComponent(orderId)}&limit=1`);
   const beforeBody=await beforeResponse.json().catch(()=>[]);
   const before=Array.isArray(beforeBody)?beforeBody[0]:null;

   const response=await serviceRequest(ctx,'rpc/admin_update_store_order',{
    method:'POST',
    body:JSON.stringify({
     p_order_id:orderId,
     p_status:status,
     p_delivery_details:deliveryDetails||null,
     p_admin_note:adminNote||null
    })
   });
   const result=await response.json().catch(()=>({}));
   if(!response.ok)return json(res,400,{error:result.message||'Order update failed.'});

   let email='Unknown customer';
   if(before?.user_id){
    const userResponse=await fetch(`${ctx.url}/auth/v1/admin/users/${encodeURIComponent(before.user_id)}`,{headers:{apikey:ctx.service,authorization:`Bearer ${ctx.service}`}});
    const userBody=await userResponse.json().catch(()=>({}));
    if(userResponse.ok&&userBody?.email)email=userBody.email;
   }
   const statusIcon={approved:'✅',processing:'🔄',delivered:'📦',cancelled:'❌',refunded:'💸'}[status]||'ℹ️';
   const telegram=await sendTelegramAlert(`${statusIcon} EVA AI MARKET — Order ${status.charAt(0).toUpperCase()+status.slice(1)}\n\nCustomer: ${email}\nProduct: ${before?.product_name||orderId}\nPrice: $${Number(before?.price_usd||0).toFixed(2)}\nPrevious: ${before?.status||'unknown'}\nNew status: ${status}\nOrder: ${orderId}\nTime: ${new Date().toLocaleString('en-GB',{timeZone:'Asia/Dhaka'})} (BD)\n\nAdmin: https://eva-ai-market.vercel.app/eva-ops-93k7m2`);
   return json(res,200,{updated:true,result,telegram:telegram.sent});
  }
  return json(res,400,{error:'Invalid store action.'});
 }
 return json(res,405,{error:'Method not allowed.'});
}
