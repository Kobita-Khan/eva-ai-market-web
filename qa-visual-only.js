(() => {
  const qaCatalog = [
    {id:'chatgpt-plus',category:'AI Chat',name:'ChatGPT Plus',subtitle:'Premium AI access',price_usd:20,stock:50,warranty_days:30,access_label:'1 Month',sort_order:1,official_price_label:'$20/mo',purchase_mode:'account',card_tone:'green'},
    {id:'claude-pro',category:'AI Chat',name:'Claude Pro',subtitle:'Advanced Claude access',price_usd:15,stock:50,warranty_days:30,access_label:'1 Month',sort_order:2,official_price_label:'$15/mo',purchase_mode:'account',card_tone:'orange'},
    {id:'gemini-ultra',category:'AI Chat',name:'Gemini Ultra',subtitle:'Google AI premium',price_usd:15,stock:50,warranty_days:30,access_label:'1 Month',sort_order:3,official_price_label:'$15/mo',purchase_mode:'account',card_tone:'blue'},
    {id:'aws-vcpu-8',category:'Cloud',name:'AWS 8 vCPU',subtitle:'Cloud compute access',price_usd:30,stock:25,warranty_days:30,access_label:'8 vCPU',sort_order:4,official_price_label:'$30/mo',purchase_mode:'account',card_tone:'yellow'},
    {id:'capcut-pro',category:'Creative',name:'CapCut Pro',subtitle:'Creative editing suite',price_usd:8,stock:50,warranty_days:30,access_label:'1 Month',sort_order:5,official_price_label:'$8/mo',purchase_mode:'account',card_tone:'purple'},
    {id:'telegram-premium',category:'Social',name:'Telegram Premium',subtitle:'Premium messaging',price_usd:20,stock:50,warranty_days:90,access_label:'3 Months',sort_order:6,official_price_label:'$20/3mo',purchase_mode:'account',card_tone:'cyan'}
  ];
  window.__EVA_VISUAL_QA__ = true;
  window.__EVA_QA_CATALOG__ = qaCatalog;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response(JSON.stringify({error:'Visual QA mode: mutations are disabled.'}), {status:403,headers:{'content-type':'application/json'}});
    }
    if (/\/api\/store(?:\?|$)/.test(url)) {
      return new Response(JSON.stringify({products:qaCatalog,qa_visual_only:true}), {status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
    }
    if (/\/api\//.test(url)) {
      return new Response(JSON.stringify({error:'Visual QA mode: protected functionality is disabled.'}), {status:403,headers:{'content-type':'application/json'}});
    }
    return originalFetch(input, init);
  };
  document.addEventListener('submit', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const status = document.getElementById('auth-status') || document.querySelector('[role="status"]');
    if (status) status.textContent = 'Visual QA mode — submission disabled.';
  }, true);
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const text = String(button.textContent || '').toLowerCase();
    if (/pay|purchase|deposit|refund|approve|reject|delete|remove|stock|save|submit|sign out/.test(text)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
})();