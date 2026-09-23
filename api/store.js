const products = [
  {id:'chatgpt-plus',category:'AI Chat',name:'ChatGPT Plus',subtitle:'Premium AI access',price_usd:20,stock:50,warranty_days:30,access_label:'1 Month',sort_order:1,official_price_label:'$20/mo',purchase_mode:'account',card_tone:'green'},
  {id:'claude-pro',category:'AI Chat',name:'Claude Pro',subtitle:'Advanced Claude access',price_usd:15,stock:50,warranty_days:30,access_label:'1 Month',sort_order:2,official_price_label:'$15/mo',purchase_mode:'account',card_tone:'orange'},
  {id:'gemini-ultra',category:'AI Chat',name:'Gemini Ultra',subtitle:'Google AI premium',price_usd:15,stock:50,warranty_days:30,access_label:'1 Month',sort_order:3,official_price_label:'$15/mo',purchase_mode:'account',card_tone:'blue'},
  {id:'aws-vcpu-8',category:'Cloud',name:'AWS 8 vCPU',subtitle:'Cloud compute access',price_usd:30,stock:25,warranty_days:30,access_label:'8 vCPU',sort_order:4,official_price_label:'$30/mo',purchase_mode:'account',card_tone:'yellow'},
  {id:'capcut-pro',category:'Creative',name:'CapCut Pro',subtitle:'Creative editing suite',price_usd:8,stock:50,warranty_days:30,access_label:'1 Month',sort_order:5,official_price_label:'$8/mo',purchase_mode:'account',card_tone:'purple'},
  {id:'telegram-premium',category:'Social',name:'Telegram Premium',subtitle:'Premium messaging',price_usd:20,stock:50,warranty_days:90,access_label:'3 Months',sort_order:6,official_price_label:'$20/3mo',purchase_mode:'account',card_tone:'cyan'}
];
export default function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method==='GET') return res.status(200).json({products,qa_visual_only:true});
  return res.status(403).json({error:'Visual QA mode: all mutations are disabled.'});
}
