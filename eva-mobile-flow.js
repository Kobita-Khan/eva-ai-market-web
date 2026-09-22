(()=> {
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const icon=p=>{
    const s=((p?.name||'')+' '+(p?.category||'')).toLowerCase();
    if(s.includes('chatgpt')||s.includes('openai')) return '◉';
    if(s.includes('claude')) return '✺';
    if(s.includes('gemini')) return '✦';
    if(s.includes('grok')) return '𝕏';
    if(s.includes('aws')) return 'aws';
    if(s.includes('google')||s.includes('gcp')) return '☁';
    if(s.includes('capcut')) return '✂';
    if(s.includes('kiro')) return 'K';
    if(s.includes('telegram')) return '➤';
    return '◆';
  };
  const brand=p=>{
    const s=((p?.name||'')+' '+(p?.category||'')).toLowerCase();
    if(s.includes('chatgpt')||s.includes('openai')) return 'openai';
    if(s.includes('claude')) return 'claude';
    if(s.includes('gemini')||s.includes('google')) return 'gemini';
    if(s.includes('grok')) return 'grok';
    if(s.includes('aws')) return 'aws';
    if(s.includes('capcut')) return 'capcut';
    if(s.includes('kiro')) return 'kiro';
    return 'eva';
  };

  let products=[];
  async function catalog(){
    if(products.length) return products;
    const r=await fetch('/api/store',{cache:'no-store'});
    const b=await r.json();
    if(!r.ok) throw new Error(b.error||'Catalog unavailable');
    products=Array.isArray(b.products)?b.products:[];
    return products;
  }
  const id=()=>new URLSearchParams(location.search).get('id');
  function cleanPublicLabel(v){return String(v||'').replace(/\s*\+\s*5%\s*EVA\s*fee/ig,'').replace(/\s{2,}/g,' ').replace(/\s*[·|\-]\s*$/,'').trim();}

  function card(p){
    const unavailable=Number(p.stock)<=0;
    return '<article class="product-card'+(unavailable?' out-of-stock':'')+'"><div class="product-top"><div class="product-logo brand-'+brand(p)+'">'+icon(p)+'</div><span class="heart">♡</span></div><h3>'+esc(p.name)+'</h3><div class="price">$ '+Number(p.price_usd||0).toFixed(2)+' <small>/ '+esc(cleanPublicLabel(p.official_price_label)||p.access_label||'Plan')+'</small></div><button class="buy" data-id="'+esc(p.id)+'"'+(unavailable?' disabled aria-disabled="true"':'')+'>'+(unavailable?'Out of Stock':'Buy Now')+'</button></article>';
  }

  async function productsPage(){
    const grid=$('#productsGrid'), search=$('#productSearch');
    if(!grid) return;
    try{
      await catalog();
      const render=()=>{
        const q=(search?.value||'').trim().toLowerCase();
        const cat=$('.chips .active')?.dataset.cat||'all';
        const filtered=products.filter(p=>{
          const category=(p.category||'').toLowerCase();
          const hay=((p.name||'')+' '+(p.subtitle||'')).toLowerCase();
          return (cat==='all'||category.includes(cat)) && (!q||hay.includes(q));
        });
        const seen=new Set();
        const deduped=filtered.filter(p=>{
          const key=((p.name||'').trim().toLowerCase());
          if(seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const priority=['chatgpt','claude pro','gemini','kiro','aws','capcut'];
        const rank=p=>{
          const n=(p.name||'').toLowerCase();
          const x=priority.findIndex(k=>n.includes(k));
          return x<0?99:x;
        };
        const list=deduped.map((p,i)=>({p,i})).sort((a,b)=>rank(a.p)-rank(b.p)||a.i-b.i).map(x=>x.p);
        grid.innerHTML=list.map(card).join('');
        $$('.buy',grid).forEach(btn=>{
          btn.addEventListener('click',()=>{
            const p=products.find(x=>String(x.id)===String(btn.dataset.id));
            if(p) sessionStorage.setItem('eva-checkout-product',JSON.stringify(p));
            location.href='/product.html?id='+encodeURIComponent(btn.dataset.id);
          });
        });
      };
      search?.addEventListener('input',render);
      $$('.chips button').forEach(btn=>btn.addEventListener('click',()=>{
        $$('.chips button').forEach(x=>x.classList.remove('active'));
        btn.classList.add('active');
        render();
      }));
      render();
    }catch(e){
      grid.innerHTML='<p class="notice">'+esc(e.message)+'</p>';
    }
  }

  async function productPage(){
    const name=$('#pName'), sub=$('#pSub'), price=$('#pPrice'), stock=$('#pStock'), art=$('#detailArt'), buy=$('#buyNow'), badges=$('#pBadges'), features=$('#pFeatures');
    if(!name) return;
    let p=null;
    const paint=x=>{
      name.textContent=x.name||'Product';
      sub.textContent=x.subtitle||x.category||'';
      price.textContent='$'+Number(x.price_usd||0).toFixed(2);
      stock.textContent=Number(x.stock)>0?'In Stock ('+x.stock+')':'Out of Stock';
      if(badges){
        const parts=[];
        if(x.category) parts.push('<span class="badge green">● '+esc(x.category)+'</span>');
        if(x.access_label) parts.push('<span class="badge">▣ '+esc(x.access_label)+'</span>');
        badges.innerHTML=parts.join('');
      }
      if(features){
        const items=[];
        if(x.subtitle) items.push(x.subtitle);
        if(Number(x.warranty_days)>0) items.push(Number(x.warranty_days)+' day warranty');
        if(x.official_price_label){const publicLabel=cleanPublicLabel(x.official_price_label);if(publicLabel)items.push(publicLabel);}
        if(x.purchase_mode) items.push('Purchase mode: '+x.purchase_mode);
        if(x.access_label) items.push(x.access_label);
        features.innerHTML=items.map(v=>'<li>✓ '+esc(v)+'</li>').join('');
      }
      if(art) art.dataset.icon=icon(x);
      if(buy){
        const unavailable=Number(x.stock)<=0;
        buy.disabled=unavailable;
        buy.setAttribute('aria-disabled',String(unavailable));
        buy.textContent=unavailable?'Out of Stock':'Buy Now';
        buy.onclick=unavailable?null:()=>{
          sessionStorage.setItem('eva-checkout-product',JSON.stringify(x));
          location.href='/checkout.html?id='+encodeURIComponent(x.id);
        };
      }
    };
    try{
      const cached=JSON.parse(sessionStorage.getItem('eva-checkout-product'));
      if(cached && String(cached.id)===String(id())){p=cached;paint(p);}
    }catch{}
    if(!p){name.textContent='Loading product…';sub.textContent='';price.textContent='—';stock.textContent='Checking stock…';}
    try{
      await catalog();
      const live=products.find(x=>String(x.id)===String(id()));
      if(!live) throw new Error('Product unavailable');
      p=live;
      sessionStorage.setItem('eva-checkout-product',JSON.stringify(p));
      paint(p);
    }catch(e){
      if(!p){name.textContent='Product unavailable';sub.textContent=e.message;price.textContent='—';stock.textContent='';if(art)art.dataset.icon='!';}
    }
  }

  async function getSession(){
    if(!window.supabase){
      await new Promise((resolve,reject)=>{
        const s=document.createElement('script');
        s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        s.onload=resolve; s.onerror=reject; document.head.appendChild(s);
      });
    }
    const cfg=await fetch('/api/config',{cache:'no-store'}).then(r=>r.json());
    const client=window.supabase.createClient(cfg.url,cfg.anonKey);
    let result=await client.auth.getSession();
    let session=result.data.session;
    if(!session){
      result=await client.auth.refreshSession();
      session=result.data.session;
    }
    return session;
  }

  function paintCheckout(p){
    $('#coLogo').textContent=icon(p);
    $('#coName').textContent=p.name;
    $('#coPlan').textContent=p.subtitle||p.category||'Plan';
    const amount='$'+Number(p.price_usd||0).toFixed(2);
    $('#coPrice').textContent=amount;
    $('#coSubtotal').textContent=amount;
    $('#coTotal').textContent=amount;
  }

  async function checkoutPage(){
    try{
      let p=null;
      try{
        const cached=JSON.parse(sessionStorage.getItem('eva-checkout-product'));
        if(cached && (!id() || String(cached.id)===String(id()))) p=cached;
      }catch{}
      if(p) paintCheckout(p);
      if(!p){
        await catalog();
        p=products.find(x=>String(x.id)===String(id()));
        if(!p) throw new Error('Product unavailable');
        paintCheckout(p);
      }
      const pay=$('#payNow'), agree=$('#agreeTerms'), radios=document.querySelectorAll('input[name="payment"]');
      const unavailable=Number(p.stock)<=0;
      if(unavailable){
        const n=$('#checkoutNotice');
        if(n){n.textContent='This product is currently out of stock.';n.hidden=false;}
        if(pay) pay.textContent='Out of Stock';
      }
      const sync=()=>{
        if(pay) pay.disabled=unavailable||!agree?.checked;
        $$('.payment-option').forEach(x=>{
          const input=x.querySelector('input');
          x.classList.toggle('active',Boolean(input?.checked));
        });
      };
      agree?.addEventListener('change',sync);
      radios.forEach(r=>r.addEventListener('change',sync));
      sync();
      if(pay) pay.addEventListener('click',async()=>{
        if(!agree?.checked) return;
        const method=$('input[name="payment"]:checked')?.value||'USDT (TRC20)';
        pay.disabled=true; pay.textContent='Checking account…';
        try{
          const session=await getSession();
          if(!session){
            sessionStorage.setItem('eva-return-to',location.pathname+location.search);
            location.href='/login.html';
            return;
          }
          pay.textContent='Processing…';
          const r=await fetch('/api/store',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({productId:p.id,refreshToken:session.refresh_token,paymentMethod:method})});
          const b=await r.json();
          if(!r.ok) throw new Error(b.error||'Purchase failed');
          const order={id:b.result?.order_id||('EVA-'+Date.now()),product:p.name,amount:Number(p.price_usd||0),method,status:b.status||'Processing',time:new Date().toLocaleString()};
          sessionStorage.setItem('eva-last-order',JSON.stringify(order));
          location.href='/order-success.html';
        }catch(e){
          const n=$('#checkoutNotice');
          if(n){n.textContent=e.message;n.hidden=false;}
          pay.disabled=false; pay.textContent='Pay Now (USDT)';
        }
      });
    }catch(e){
      const n=$('#checkoutNotice');
      if(n){n.textContent=e.message;n.hidden=false;}
    }
  }

  function successPage(){
    let o=null;
    try{o=JSON.parse(sessionStorage.getItem('eva-last-order'))}catch{}
    const preview=new URLSearchParams(location.search).get('preview')==='1';
    if(!o&&preview) o={id:'EVA-PREVIEW-123456',product:'Kiro Power — 1 Month',amount:130,method:'USDT (TRC20)',status:'Processing',time:'Preview mode — no order created'};
    if(!o){ location.href='/dashboard.html'; return; }
    $('#oId').textContent=String(o.id).slice(0,18);
    $('#oProduct').textContent=o.product;
    $('#oAmount').textContent='$'+Number(o.amount||0).toFixed(2);
    $('#oMethod').textContent=o.method;
    $('#oStatus').textContent=o.status;
    $('#oTime').textContent=o.time;
    if(preview){
      const n=document.createElement('p');
      n.className='notice preview-notice';
      n.textContent='Safe preview — no payment or order was created.';
      $('.success h1')?.after(n);
    }
  }

  function menu(){
    const d=$('#drawer'), b=$('#menuBtn'), x=$('#drawerClose');
    if(!d||!b) return;
    b.addEventListener('click',()=>d.hidden=false);
    x?.addEventListener('click',()=>d.hidden=true);
    d.addEventListener('click',e=>{if(e.target===d)d.hidden=true;});
  }

  document.addEventListener('DOMContentLoaded',()=>{
    menu();
    const page=document.body.dataset.page;
    if(page==='products') productsPage();
    if(page==='product') productPage();
    if(page==='checkout') checkoutPage();
    if(page==='success') successPage();
  });
})();