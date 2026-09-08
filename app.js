const menuButton=document.querySelector('.menu-button'),siteNav=document.querySelector('nav'),toast=document.getElementById('toast');
function showToast(message){toast.textContent=message;toast.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.remove('show'),2200)}
menuButton.addEventListener('click',()=>{const open=siteNav.classList.toggle('open');menuButton.setAttribute('aria-expanded',String(open))});
siteNav.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>{siteNav.classList.remove('open');menuButton.setAttribute('aria-expanded','false')}));
document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{const address=document.getElementById(button.dataset.copy).textContent.trim();try{await navigator.clipboard.writeText(address)}catch{const area=document.createElement('textarea');area.value=address;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove()}const original=button.textContent;button.textContent='Copied ✓';showToast('Wallet address copied');setTimeout(()=>button.textContent=original,1800)}));

const bedrockProvider=[...document.querySelectorAll('.provider')].find(provider=>provider.querySelector('strong')?.textContent.trim()==='AWS Bedrock — Claude');
if(bedrockProvider){const status=bedrockProvider.querySelector('small'),indicator=bedrockProvider.querySelector(':scope > span');if(status)status.textContent='Status: Live & Available';if(indicator)indicator.textContent='✓'}

const heroButtons=document.querySelector('.hero .buttons');
if(heroButtons){const fundButton=[...heroButtons.querySelectorAll('a')].find(link=>/Add Balance|Fund/i.test(link.textContent));if(fundButton){fundButton.classList.remove('secondary');fundButton.classList.add('primary');fundButton.textContent='Login & Submit Deposit';fundButton.href='/login.html'}const notice=document.createElement('p');notice.className='mini-note';notice.style.marginTop='14px';notice.style.padding='12px 14px';notice.style.border='1px solid rgba(65,215,232,.35)';notice.style.borderRadius='12px';notice.style.background='rgba(65,215,232,.08)';notice.innerHTML='<strong>Already paid?</strong> Submit the successful payment TXID below. Your balance is added after admin approval.';heroButtons.insertAdjacentElement('afterend',notice)}
const depositNav=[...siteNav.querySelectorAll('a')].find(link=>link.textContent.trim()==='Deposit Credits');if(depositNav){depositNav.href='#deposit';depositNav.textContent='Submit Deposit'}

function highlightPaymentNetwork(network){document.querySelectorAll('[data-network-card]').forEach(card=>card.classList.toggle('active',card.dataset.networkCard===network))}
function isValidTelegram(value){return /^@[A-Za-z0-9_]{5,32}$/.test(value)}
function isValidTransactionId(network,value){const ownAddresses=new Set(['0x644ed89caecc120d3a3180e9f20a90d970cfa3e8'.toLowerCase(),'TJCFS6hDKsEnquGuvw43krk141QLvHnGbG'.toLowerCase()]);if(ownAddresses.has(value.toLowerCase()))return false;if(network==='BEP20'||network==='ERC20')return /^0x[a-fA-F0-9]{64}$/.test(value);return /^[a-fA-F0-9]{64}$/.test(value)}
const networkSelect=document.getElementById('network');
networkSelect.addEventListener('change',()=>highlightPaymentNetwork(networkSelect.value));
highlightPaymentNetwork(networkSelect.value);

const form=document.getElementById('payment-form');
function setError(id,message){const input=document.getElementById(id);input.classList.toggle('invalid',Boolean(message));const target=document.querySelector(`[data-error="${id}"]`);if(target)target.textContent=message}

function loadScript(src){return new Promise((resolve,reject)=>{if(document.querySelector(`script[src="${src}"]`))return resolve();const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.head.appendChild(script)})}
async function createPublicDepositClient(){await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');const response=await fetch('/api/config',{cache:'no-store'});const config=await response.json().catch(()=>({}));if(!response.ok)throw new Error(config.error||'Account service unavailable.');return window.supabase.createClient(config.url,config.anonKey)}

(function mountPublicDepositForm(){
 const depositSection=document.getElementById('deposit');
 if(!depositSection||!form)return;
 form.hidden=false;
 form.className='payment-form panel public-deposit-form';
 form.innerHTML=`
  <h3 style="margin-top:0">Submit payment for balance</h3>
  <p class="safe-note">You must be signed in. After admin verification, the approved amount is added to your EVA balance.</p>
  <label>Telegram username<input id="telegram" type="text" placeholder="@username" required><small data-error="telegram"></small></label>
  <label>Amount in USDT<input id="amount" type="number" min="10" step="0.01" value="10" required><small data-error="amount"></small></label>
  <label>Product / purpose<select id="product"><option>Wallet balance</option><option>Claude / AI subscription</option><option>AWS / Cloud service</option><option>Telegram service</option></select></label>
  <label>Network<select id="network"><option>TRC20</option><option>BEP20</option><option>ERC20</option></select></label>
  <label>Completed transaction ID<input id="txid" type="text" placeholder="Paste TxID / transaction hash" required><small data-error="txid"></small></label>
  <button class="button primary submit" type="submit">Submit for verification</button>
  <p class="form-note">Do not paste the wallet address. Use the completed transaction ID.</p>`;
 const grid=depositSection.querySelector('.deposit-grid');
 if(grid)grid.insertAdjacentElement('afterend',form);
 const select=document.getElementById('network');
 select.addEventListener('change',()=>highlightPaymentNetwork(select.value));
 highlightPaymentNetwork(select.value);
})();

form.addEventListener('submit',async event=>{
 event.preventDefault();
 event.stopImmediatePropagation();
 const button=form.querySelector('button[type="submit"]');
 const telegram=document.getElementById('telegram').value.trim();
 const amount=Number(document.getElementById('amount').value);
 const network=document.getElementById('network').value;
 const txid=document.getElementById('txid').value.trim();
 const telegramOk=isValidTelegram(telegram),txidOk=isValidTransactionId(network,txid);
 setError('telegram',telegramOk?'':'Enter a valid username starting with @.');
 setError('amount',amount>=10?'':'Minimum deposit is 10 USDT.');
 setError('txid',txidOk?'':'Enter the completed payment TxID—not a wallet address.');
 if(!telegramOk||amount<10||!txidOk){showToast('Please correct the payment details');return}
 const original=button.textContent;button.disabled=true;button.textContent='Submitting…';
 try{
  const client=await createPublicDepositClient();
  let {data:{session}}=await client.auth.getSession();
  if(!session){const refreshed=await client.auth.refreshSession();session=refreshed.data.session}
  if(!session){sessionStorage.setItem('eva-return-to','/#deposit');location.href='/login.html';return}
  const response=await fetch('/api/store',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'submit_deposit',refreshToken:session.refresh_token,amount,network,transaction_id:txid})});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'Deposit submission failed.');
  showToast('Deposit submitted for verification');
  form.reset();
  document.getElementById('amount').value='10';
  document.getElementById('network').value='TRC20';
  highlightPaymentNetwork('TRC20');
 }catch(error){showToast(error.message||'Deposit submission failed.')}
 finally{button.disabled=false;button.textContent=original}
},true);

function sortStoreProducts(products){return [...products].sort((a,b)=>{const aAws=a.category==='AWS Cloud Accounts',bAws=b.category==='AWS Cloud Accounts';if(aAws!==bAws)return aAws?-1:1;if(!aAws)return 0;const size=p=>{const text=`${p.name||''} ${p.subtitle||''}`;const match=text.match(/(\d{1,4})\s*(?:v?cpu|v\b)/i);return match?Number(match[1]):Number((p.name||'').match(/\d{1,4}/)?.[0]||0)};return size(b)-size(a)})}
const telegramQuoteServices=[
 {name:'Telegram Premium',subtitle:'3, 6 or 12-month official gift subscription'},
 {name:'Telegram Stars Recharge',subtitle:'Official Stars top-up for your Telegram account'},
 {name:'Telegram Ads Recharge',subtitle:'Telegram Ads balance top-up assistance'},
 {name:'Channel / Group Boost',subtitle:'Official boost setup for eligible channels and groups'},
 {name:'Telegram Giveaway',subtitle:'Premium or Stars giveaway setup assistance'},
 {name:'Telegram Recharge / Top-up',subtitle:'Custom official Telegram recharge service'}
];
function telegramQuoteCards(){return telegramQuoteServices.map(service=>`<article class="account-product panel telegram-service"><div class="product-cover cover-telegram"><div class="cover-grid"></div><div class="brand-icon-shell"><span class="brand-symbol brand-symbol-telegram" aria-hidden="true">➤</span></div><div class="cover-brand">Telegram</div><strong>${escapeStore(service.name)}</strong><small><i></i> Official service support</small></div><span class="product-tag">Telegram Services</span><h3>${escapeStore(service.name)}</h3><p>${escapeStore(service.subtitle)}</p><strong>Custom <small>QUOTE</small></strong><div class="stock-line"><span class="in-stock">Available</span><span>Manual delivery</span></div><a class="button secondary" href="https://t.me/eva007_8?text=${encodeURIComponent('Hello, I want '+service.name+'. Please send the current price.')}" target="_blank" rel="noopener noreferrer">Contact for Price</a></article>`).join('')}

const publicStore=document.getElementById('public-store-products');
async function loadPublicStore(){if(!publicStore)return;try{const response=await fetch('/api/store');const body=await response.json();if(!response.ok)throw new Error(body.error||'Store unavailable');publicStore.innerHTML=sortStoreProducts(body.products).map(product=>`<article class="account-product panel">${publicProductCover(product)}<span class="product-tag">${escapeStore(product.category)}</span><h3>${escapeStore(product.name)}</h3>${publicProductSubtitle(product)}<strong>$${Number(product.price_usd).toFixed(2)} <small>USDT</small></strong><div class="stock-line"><span class="${product.stock>0?'in-stock':'out-stock'}">${product.stock>0?product.stock+' in stock':'Out of stock'}</span><span>${product.warranty_days}-day warranty</span></div><a class="button ${product.stock>0?'secondary':'disabled'}" href="/login.html">${product.stock>0?'Buy with EVA Balance':'Unavailable'}</a></article>`).join('')+telegramQuoteCards()}catch(error){publicStore.innerHTML=`<article class="panel store-loading">${escapeStore(error.message)} Contact support for current stock.</article>`}}
function brandMark(theme){
 const marks={aws:'AWS',claude:'✳',openai:'◉',gemini:'✦',grok:'𝕏',capcut:'✂',telegram:'➤',ai:'AI'};
 return `<span class="brand-symbol brand-symbol-${theme}" aria-hidden="true">${marks[theme]||marks.ai}</span>`;
}
function publicProductCover(product){const text=`${product.name||''} ${product.subtitle||''}`.toLowerCase();let theme='ai',brand='EVA AI',label=product.name;if(text.includes('aws')||product.category==='AWS Cloud Accounts'){theme='aws';brand='AWS';label='Amazon Web Services'}else if(text.includes('claude')){theme='claude';brand='Claude';label=product.name}else if(text.includes('gpt')||text.includes('openai')){theme='openai';brand='OpenAI';label=product.name}else if(text.includes('gemini')||text.includes('google')){theme='gemini';brand='Google Gemini';label=product.name}else if(text.includes('grok')){theme='grok';brand='Grok';label=product.name}else if(text.includes('capcut')){theme='capcut';brand='CapCut';label=product.name}return `<div class="product-cover cover-${theme}" role="img" aria-label="${escapeStore(product.name)} product cover"><div class="cover-grid"></div><div class="brand-icon-shell">${brandMark(theme)}</div><div class="cover-brand">${escapeStore(brand)}</div><strong>${escapeStore(label)}</strong><small><i></i> Verified digital service</small></div>`}
function publicProductLogo(product){const aws=product.category==='AWS Cloud Accounts';return `<div class="product-logo ${aws?'aws-logo':'claude-logo'}"><span>${aws?'AWS':'AI'}</span><i></i></div>`}
function publicProductSubtitle(product){return product.category==='AWS Cloud Accounts'?'':`<p>${escapeStore(product.subtitle)}</p>`}
function escapeStore(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
loadPublicStore();

const demoTransactions=[
 {product:'Claude Max 5× — Monthly'},
 {product:'Claude Max 20× — Monthly'},
 {product:'GPT Premium Subscription'},
 {product:'AWS Bedrock Account'},
 {product:'Gemini Ultra Service'}
];
const demoUsernames=[
 '@li_wei88','@mei_lin24','@chenhao_ai','@xiaoyu_cloud','@wang_jun7','@anna_volkova','@dmitri_k92','@sofia_orlova','@nikita_dev','@elena_mir','@michael_reed','@emily_carter','@daniel_brooks','@olivia_hayes','@james_wilson','@sophia_morgan'
];
function mountDemoTransaction(){
 const popup=document.createElement('aside');
 popup.className='demo-transaction';
 popup.setAttribute('role','status');
 popup.setAttribute('aria-live','polite');
 popup.setAttribute('aria-label','Recent demo transaction');
 popup.innerHTML='<div class="demo-check">✓</div><div class="demo-copy"><div><strong>Transaction completed</strong><span class="demo-time">Just now</span><span class="demo-label">Demo</span></div><small class="demo-order"></small><small class="demo-user"></small><p>Purchased: <b class="demo-product"></b></p></div><em>Delivered</em>';
 document.body.appendChild(popup);
 let cursor=0;
 const demoTimes=['Just now','1 min ago','2 min ago','3 min ago','5 min ago'];
 const show=()=>{
  const item=demoTransactions[cursor%demoTransactions.length];
  popup.querySelector('.demo-time').textContent=demoTimes[cursor%demoTimes.length];cursor++;
  const now=new Date();
  const datePart=String(now.getFullYear()).slice(-2)+String(now.getMonth()+1).padStart(2,'0')+String(now.getDate()).padStart(2,'0');
  let randomPart;
  do{randomPart=String(Math.floor(100000+Math.random()*900000))}while(randomPart===show.lastOrder);
  show.lastOrder=randomPart;
  popup.querySelector('.demo-order').textContent='Order No. '+datePart+randomPart;
  popup.querySelector('.demo-user').textContent='User: '+demoUsernames[Math.floor(Math.random()*demoUsernames.length)];
  popup.querySelector('.demo-product').textContent=item.product;
  popup.classList.add('show');
  clearTimeout(show.hideTimer);
  show.hideTimer=setTimeout(()=>popup.classList.remove('show'),6500);
 };
 setTimeout(show,8000);
 setInterval(show,26000);
}
mountDemoTransaction();
