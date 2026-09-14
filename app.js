const menuButton=document.querySelector('.menu-button'),siteNav=document.getElementById('site-nav')||document.querySelector('nav'),toast=document.getElementById('toast');
function showToast(message){if(!toast)return;toast.textContent=message;toast.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.remove('show'),2200)}
if(menuButton&&siteNav){menuButton.addEventListener('click',()=>{const open=siteNav.classList.toggle('open');menuButton.setAttribute('aria-expanded',String(open))});siteNav.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>{siteNav.classList.remove('open');menuButton.setAttribute('aria-expanded','false')}))}
document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{const address=document.getElementById(button.dataset.copy).textContent.trim();try{await navigator.clipboard.writeText(address)}catch{const area=document.createElement('textarea');area.value=address;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove()}const original=button.textContent;button.textContent='Copied ✓';showToast('Wallet address copied');setTimeout(()=>button.textContent=original,1800)}));

const bedrockProvider=[...document.querySelectorAll('.provider')].find(provider=>provider.querySelector('strong')?.textContent.trim()==='AWS Bedrock — Claude');
if(bedrockProvider){const status=bedrockProvider.querySelector('small'),indicator=bedrockProvider.querySelector(':scope > span');if(status)status.textContent='Status: Live & Available';if(indicator)indicator.textContent='✓'}

const heroButtons=document.querySelector('.hero .buttons');
if(heroButtons){const fundButton=[...heroButtons.querySelectorAll('a')].find(link=>/Add Balance|Fund/i.test(link.textContent));if(fundButton){fundButton.classList.remove('secondary');fundButton.classList.add('primary');fundButton.textContent='Login & Submit Deposit';fundButton.href='/login.html'}const notice=document.createElement('p');notice.className='mini-note';notice.style.marginTop='14px';notice.style.padding='12px 14px';notice.style.border='1px solid rgba(65,215,232,.35)';notice.style.borderRadius='12px';notice.style.background='rgba(65,215,232,.08)';notice.innerHTML='<strong>Already paid?</strong> Submit the successful payment TXID below. Your balance is added after admin approval.';heroButtons.insertAdjacentElement('afterend',notice)}
const depositNav=siteNav?[...siteNav.querySelectorAll('a')].find(link=>/^(Deposit|Deposit Credits)$/.test(link.textContent.trim())):null;if(depositNav){depositNav.href='#deposit'}

function highlightPaymentNetwork(network){document.querySelectorAll('[data-network-card]').forEach(card=>card.classList.toggle('active',card.dataset.networkCard===network))}
function isValidTransactionId(network,value){const ownAddresses=new Set(['0x644ed89caecc120d3a3180e9f20a90d970cfa3e8'.toLowerCase(),'TJCFS6hDKsEnquGuvw43krk141QLvHnGbG'.toLowerCase()]);if(ownAddresses.has(value.toLowerCase()))return false;if(network==='BEP20'||network==='ERC20')return /^0x[a-fA-F0-9]{64}$/.test(value);return /^[a-fA-F0-9]{64}$/.test(value)}
const networkSelect=document.getElementById('network');
if(networkSelect){networkSelect.addEventListener('change',()=>highlightPaymentNetwork(networkSelect.value));highlightPaymentNetwork(networkSelect.value)}

const form=document.getElementById('payment-form');
function setError(id,message){const input=document.getElementById(id);if(input)input.classList.toggle('invalid',Boolean(message));const target=document.querySelector(`[data-error="${id}"]`);if(target)target.textContent=message}

function loadScript(src){return new Promise((resolve,reject)=>{if(document.querySelector(`script[src="${src}"]`))return resolve();const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.head.appendChild(script)})}
async function createPublicDepositClient(){await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');const response=await fetch('/api/config',{cache:'no-store'});const config=await response.json().catch(()=>({}));if(!response.ok)throw new Error(config.error||'Account service unavailable.');return window.supabase.createClient(config.url,config.anonKey)}

(function mountPublicDepositForm(){
 const depositSection=document.getElementById('deposit');
 if(!depositSection||!form)return;
 form.hidden=false;
 form.className='payment-form panel public-deposit-form';
 form.innerHTML=`
  <h3 style="margin-top:0">Submit payment for balance</h3>
  <p class="safe-note">Your signed-in EVA account is used for identification. After admin verification, the approved amount is added to your EVA balance.</p>
  <label>Amount in USDT<input id="amount" type="number" min="10" step="0.01" value="10" required><small data-error="amount"></small></label>
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

if(form)form.addEventListener('submit',async event=>{
 event.preventDefault();
 event.stopImmediatePropagation();
 const button=form.querySelector('button[type="submit"]');
 const amount=Number(document.getElementById('amount').value);
 const network=document.getElementById('network').value;
 const txid=document.getElementById('txid').value.trim();
 const txidOk=isValidTransactionId(network,txid);
 setError('amount',amount>=10?'':'Minimum deposit is 10 USDT.');
 setError('txid',txidOk?'':'Enter the completed payment TxID—not a wallet address.');
 if(amount<10||!txidOk){showToast('Please correct the payment details');return}
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
function productPaletteStyle(index){const h=Math.round((index*137.508+326)%360),h2=Math.round((h+42+(index%3)*18)%360);return `--h:${h};--h2:${h2}`}
const telegramQuoteServices=[
 {name:'Telegram Premium — 3 Months',subtitle:'Official 3-month Telegram Premium gift subscription',price:20},
 {name:'Telegram Premium — 6 Months',subtitle:'Official 6-month Telegram Premium gift subscription',price:30},
 {name:'Telegram Premium — 1 Year',subtitle:'Official 12-month Telegram Premium gift subscription',price:45},
 {name:'Telegram Stars Recharge',subtitle:'Official Stars top-up for your Telegram account'},
 {name:'Telegram Ads Recharge',subtitle:'Telegram Ads balance top-up assistance'},
 {name:'Channel / Group Boost',subtitle:'Official boost setup for eligible channels and groups'},
 {name:'Telegram Giveaway',subtitle:'Premium or Stars giveaway setup assistance'},
 {name:'Telegram Recharge / Top-up',subtitle:'Custom official Telegram recharge service'}
];
function telegramQuoteCards(){return telegramQuoteServices.map((service,index)=>{const priced=Number.isFinite(service.price);const priceLine=priced?`${Number(service.price).toFixed(2)} <small>USDT</small>`:'Custom <small>QUOTE</small>';const message=priced?`Hello, I want ${service.name} for ${service.price}.`:`Hello, I want ${service.name}. Please send the current price.`;return `<article class="account-product panel telegram-service telegram-tone-${(index%4)+1}" data-product-index="${index+30}" style="${productPaletteStyle(index+30)}"><div class="product-cover cover-telegram"><div class="cover-grid"></div><div class="brand-icon-shell brand-photo-shell"><img class="brand-photo" src="/assets/logos/telegram-badge-only.png?v=20260909-complete" alt="Telegram official product logo" loading="lazy"></div><div class="cover-brand">Telegram</div><strong>${escapeStore(service.name)}</strong><small><i></i> Official service support</small></div><span class="product-tag">Telegram Services</span><h3>${escapeStore(service.name)}</h3><p>${escapeStore(service.subtitle)}</p><strong>${priceLine}</strong><div class="stock-line"><span class="in-stock">Available</span><span>Manual delivery</span></div><a class="button secondary" href="https://t.me/eva007_8?text=${encodeURIComponent(message)}" target="_blank" rel="noopener noreferrer">${priced?'Order Now':'Contact for Price'}</a></article>`}).join('')}

function calculatorKind(product){const id=String(product.id||'');if(id==='claude-team-standard')return 'claude-standard';if(id==='claude-team-premium')return 'claude-premium';if(id==='claude-enterprise')return 'claude-enterprise';if(id==='chatgpt-business')return 'chatgpt-business';if(id==='chatgpt-enterprise')return 'chatgpt-enterprise';if(id==='gemini-enterprise')return 'gemini-enterprise';return ''}
const publicStore=document.getElementById('public-store-products');
async function loadPublicStore(){if(!publicStore)return;try{const response=await fetch('/api/store',{cache:'no-store'});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||'Store unavailable');const products=Array.isArray(body.products)?body.products:[];const displayedProductCount=products.length+telegramQuoteServices.length;document.querySelectorAll('[data-total-products]').forEach(el=>el.textContent=String(displayedProductCount));document.querySelectorAll('[data-total-products-parenthesized]').forEach(el=>el.textContent='('+displayedProductCount+')');document.querySelectorAll('[data-total-products-label]').forEach(el=>el.textContent='Browse '+displayedProductCount+' Products →');let awsToneIndex=0,claudeToneIndex=0;publicStore.innerHTML=sortStoreProducts(products).map((product,index)=>{const awsTone=product.category==='AWS Cloud Accounts'?' aws-tone-'+((awsToneIndex++%4)+1):'';const productText=`${product.name||''} ${product.subtitle||''}`.toLowerCase();const claudeTone=productText.includes('claude')?' claude-tone-'+((claudeToneIndex++%5)+1):'';const safeTone=/^[a-z0-9-]+$/.test(product.card_tone||'')?' tone-'+product.card_tone:'';const legacyButtonStyle='';const mode=['balance','contact','reference'].includes(product.purchase_mode)?product.purchase_mode:'balance';const available=mode==='balance'&&Number(product.stock)>0;const official=product.official_price_label?`<div class="official-price">Official price: <b>${escapeStore(product.official_price_label)}</b></div>`:'';const price=mode==='contact'?'<strong class="product-price">Custom <small>QUOTE</small></strong>':mode==='reference'?'<strong class="product-price">'+escapeStore(product.official_price_label||'Free')+'</strong>':'<strong class="product-price">$'+Number(product.price_usd).toFixed(2)+' <small>USDT</small></strong>';const contactMessage=encodeURIComponent('Hello, I want to order '+product.name+'. Please help me complete the purchase.');const calcKind=calculatorKind(product);const action=calcKind?`<button class="button secondary price-calculator-trigger" type="button" data-calc-kind="${calcKind}" data-calc-name="${escapeStore(product.name)}">Calculate Price</button>`:mode==='contact'||mode==='reference'?`<a class="button secondary" href="https://t.me/eva007_8?text=${contactMessage}" target="_blank" rel="noopener noreferrer">Contact for Order</a>`:`<a class="button ${available?'secondary':'disabled'}"${available?legacyButtonStyle:''} href="/login.html">${available?'Buy with EVA Balance':'Unavailable'}</a>`;const stockLine=mode==='reference'||mode==='contact'?'<span class="in-stock">Order available</span><span>Contact support</span>':`<span class="${available?'in-stock':'out-stock'}">${available?product.stock+' in stock':'Out of stock'}</span><span>${product.warranty_days}-day warranty</span>`;return `<article class="account-product panel${awsTone}${claudeTone}${safeTone}" data-product-index="${index}" style="${productPaletteStyle(index)}"><span class="product-serial">${String(index+1).padStart(2,'0')}</span>${publicProductCover(product)}<span class="product-tag">${escapeStore(product.category)}</span><h3>${escapeStore(product.name)}</h3>${publicProductSubtitle(product)}${official}${price}<div class="stock-line">${stockLine}</div>${action}</article>`}).join('')+telegramQuoteCards()}catch(error){publicStore.innerHTML=`<article class="panel store-loading">${escapeStore(error.message)} Contact support for current stock.</article>`}}
function brandMark(theme){
 const icons={
  aws:'<path d="M6.763 10.036c0 .296.032.535.088.71.064.176.144.368.256.576.04.063.056.127.056.183 0 .08-.048.16-.152.24l-.503.335c-.137.096-.287.096-.447-.04a3.34 3.34 0 0 1-.535-.846c-.622.734-1.405 1.101-2.347 1.101C1.588 12.295.993 11.537.993 10.188c0-1.365 1.03-2.267 2.681-2.267.551 0 1.15.088 1.764.24v-.583c0-1.213-.503-1.644-1.676-1.644-.559 0-1.15.12-1.74.36-.288.12-.447.063-.447-.2v-.391c0-.232.08-.32.28-.424a5.38 5.38 0 0 1 2.29-.51c1.9 0 2.801.862 2.801 2.705v2.562zm-3.24 1.214c.814 0 1.532-.4 1.772-1.15.095-.303.143-.71.143-1.045a6.5 6.5 0 0 0-1.468-.184c-1.061 0-1.58.447-1.58 1.277 0 .742.399 1.102 1.133 1.102zm6.41.862c-.256 0-.376-.08-.472-.391L7.586 5.55c-.096-.32-.056-.52.12-.52h.782c.263 0 .375.08.47.392l1.342 5.284 1.245-5.284c.08-.312.176-.392.47-.392h.639c.27 0 .375.08.47.392l1.262 5.348 1.381-5.348c.096-.312.2-.392.471-.392h.743c.176 0 .232.2.12.527l-1.924 6.17c-.095.312-.215.392-.47.392h-.687c-.271 0-.383-.08-.47-.4l-1.238-5.148-1.23 5.14c-.08.32-.191.408-.47.408zm10.256.215c-.83 0-1.676-.175-2.147-.463-.2-.12-.295-.224-.295-.447v-.407c0-.247.12-.311.383-.175.63.279 1.277.407 1.932.407 1.013 0 1.58-.343 1.58-1.022 0-.51-.303-.758-1.022-.99l-1.157-.36c-1.061-.335-1.556-.997-1.556-1.97 0-1.317 1.07-2.107 2.593-2.107.862 0 1.692.2 2.1.447.2.12.287.224.287.423v.375c0 .248-.12.32-.375.192a3.66 3.66 0 0 0-1.532-.311c-.95 0-1.437.31-1.437.933 0 .535.36.79 1.117 1.038l1.134.358c1.093.352 1.604.934 1.604 1.884 0 1.397-1.133 2.275-2.865 2.275zM21.698 16.207c-2.626 1.94-6.442 2.969-9.722 2.969-4.598 0-8.74-1.7-11.87-4.526-.247-.223-.024-.527.272-.351 3.384 1.963 7.559 3.153 11.877 3.153 2.914 0 6.114-.607 9.06-1.852.439-.2.814.287.383.607zM22.792 14.961c-.336-.43-2.22-.207-3.074-.103-.255.032-.295-.192-.063-.36 1.5-1.053 3.967-.75 4.254-.399.287.36-.08 2.826-1.485 4.007-.215.184-.423.088-.327-.151.32-.79 1.03-2.57.695-2.994z"/>',
  claude:'<path d="M17.304 3.541h-3.672l6.696 16.918H24zM6.696 3.541 0 20.459h3.744l1.37-3.553h7.005l1.369 3.553h3.744L10.536 3.541zm-.371 10.223 2.291-5.946 2.292 5.946z"/>',
  openai:'<path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.911 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.182a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.096 5.98 5.98 0 0 0 .511 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.989 5.989 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zm-9.022 12.608a4.476 4.476 0 0 1-2.876-1.041l4.92-2.839a.795.795 0 0 0 .392-.681v-6.737l2.02 1.169.038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.599 18.304a4.471 4.471 0 0 1-.535-3.014l4.926 2.843a.771.771 0 0 0 .781 0l5.843-3.368v2.332l-.034.062-4.84 2.791a4.499 4.499 0 0 1-6.141-1.646zM2.341 7.896a4.485 4.485 0 0 1 2.365-1.973V11.6c0 .28.148.538.388.677l5.814 3.354-2.02 1.169h-.071l-4.83-2.787A4.504 4.504 0 0 1 2.341 7.872zm16.596 3.855-5.833-3.387L15.119 7.2h.071l4.831 2.791a4.494 4.494 0 0 1-.677 8.104v-5.677a.79.79 0 0 0-.407-.667zm2.011-3.023-4.916-2.867a.776.776 0 0 0-.785 0L9.409 9.23V6.897l.028-.061 4.831-2.787a4.499 4.499 0 0 1 6.68 4.66zM8.307 12.863l-2.02-1.164-.038-.057V6.074a4.499 4.499 0 0 1 7.375-3.454L8.704 5.459a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>',
  gemini:'<path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"/>',
  grok:'<path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/>',
  capcut:'<path d="M3 5.2h17.8l-6.2 4.7 6.2 4.6H3l6.1-4.6zm0 9.3h17.8L14.5 19H3l6.1-4.5z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>',
  telegram:'<path d="M11.944 0A12 12 0 1 0 24 12 12 12 0 0 0 12 0h-.056zm4.962 7.224c.1-.002.321.023.465.14.12.098.153.23.171.325.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>',
  ai:'<path d="M12 1.5 14.8 9l7.7 3-7.7 3L12 22.5 9.2 15l-7.7-3 7.7-3z"/>'
 };
 const icon=icons[theme]||icons.ai;
 if(theme==='gemini')return `<svg class="brand-logo brand-logo-gemini" viewBox="0 0 24 24" role="img" aria-label="Google Gemini logo"><defs><linearGradient id="gemini-brand-gradient" x1="2" y1="22" x2="22" y2="2" gradientUnits="userSpaceOnUse"><stop stop-color="#4285F4"/><stop offset=".5" stop-color="#8E75FF"/><stop offset="1" stop-color="#D96570"/></linearGradient></defs><g fill="url(#gemini-brand-gradient)">${icon}</g></svg>`;
 return `<svg class="brand-logo brand-logo-${theme}" viewBox="0 0 24 24" role="img" aria-label="${theme} logo">${icon}</svg>`;
}
function publicProductCover(product){if(product.id==='aws-kiro-gcp-bundle'||/^AWS\s*\+\s*Kiro\s*\+\s*GCP AI Bundle$/i.test(product.name||''))return `<div class="product-cover bundle-image-cover"><img src="/assets/aws-kiro-gcp-bundle.svg?v=20260909-cropped" alt="AWS + Kiro + GCP AI Bundle" loading="eager"></div>`;const text=`${product.name||''} ${product.subtitle||''}`.toLowerCase();let theme='ai',brand='EVA AI',label=product.name;if(text.includes('aws')||product.category==='AWS Cloud Accounts'){theme='aws';brand='AWS';label='Amazon Web Services'}else if(text.includes('claude')){theme='claude';brand='Claude';label=product.name}else if(text.includes('gpt')||text.includes('openai')){theme='openai';brand='OpenAI';label=product.name}else if(text.includes('gemini')||text.includes('google')){theme='gemini';brand='Google Gemini';label=product.name}else if(text.includes('grok')){theme='grok';brand='Grok';label=product.name}else if(text.includes('capcut')){theme='capcut';brand='CapCut';label=product.name}const photoLogos={aws:'/assets/logos/aws-premium.png?v=20260909',claude:'/assets/logos/claude-premium.png?v=20260909',ai:'/assets/logos/ai-premium.jpeg?v=20260909'};const photo=photoLogos[theme];return `<div class="product-cover cover-${theme}" role="img" aria-label="${escapeStore(product.name)} product cover"><div class="cover-grid"></div><div class="brand-icon-shell ${photo?'brand-photo-shell':''}">${photo?`<img class="brand-photo" src="${photo}" alt="${escapeStore(brand)} official product logo" loading="lazy">`:brandMark(theme)}</div><div class="cover-brand">${escapeStore(brand)}</div><strong>${escapeStore(label)}</strong><small><i></i> Verified digital service</small></div>`}
function publicProductLogo(product){const aws=product.category==='AWS Cloud Accounts';return `<div class="product-logo ${aws?'aws-logo':'claude-logo'}"><span>${aws?'AWS':'AI'}</span><i></i></div>`}
function publicProductSubtitle(product){return product.category==='AWS Cloud Accounts'?'':`<p>${escapeStore(product.subtitle)}</p>`}
function escapeStore(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
loadPublicStore();
const PUBLIC_STOCK_REFRESH_MS=60000;
setInterval(()=>{if(!document.hidden)loadPublicStore()},PUBLIC_STOCK_REFRESH_MS);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadPublicStore()});

const demoTransactions=[
 {type:'purchase',product:'Claude Max 5× — Monthly'},
 {type:'deposit',amount:200},
 {type:'purchase',product:'Claude Max 20× — Monthly'},
 {type:'deposit',amount:100},
 {type:'purchase',product:'GPT Premium Subscription'},
 {type:'deposit',amount:500},
 {type:'purchase',product:'AWS Bedrock Account'},
 {type:'deposit',amount:50},
 {type:'purchase',product:'Gemini Ultra Service'},
 {type:'deposit',amount:300}
];
const demoUsernames=[
 '@li_wei88','@mei_lin24','@chenhao_ai','@xiaoyu_cloud','@wang_jun7','@anna_volkova','@dmitri_k92','@sofia_orlova','@nikita_dev','@elena_mir','@michael_reed','@emily_carter','@daniel_brooks','@olivia_hayes','@james_wilson','@sophia_morgan'
];
function randomDemoId(){
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
 let value='TX-';
 for(let i=0;i<12;i++)value+=alphabet[Math.floor(Math.random()*alphabet.length)];
 return value;
}
function mountDemoTransaction(){
 const popup=document.createElement('aside');
 popup.className='demo-transaction';
 popup.setAttribute('role','status');
 popup.setAttribute('aria-live','polite');
 popup.setAttribute('aria-label','Simulated demo activity');
 popup.innerHTML='<div class="demo-check">✓</div><div class="demo-copy"><div><strong class="demo-heading">Transaction completed</strong><span class="demo-time">Just now</span><span class="demo-label">Demo</span></div><small class="demo-order"></small><small class="demo-user"></small><p class="demo-detail">Purchased: <b class="demo-product"></b></p></div><em class="demo-status">Delivered</em>';
 document.body.appendChild(popup);
 let cursor=0;
 const demoTimes=['Just now','1 min ago','2 min ago','3 min ago','5 min ago'];
 const show=()=>{
  const item=demoTransactions[cursor%demoTransactions.length];
  popup.querySelector('.demo-time').textContent=demoTimes[cursor%demoTimes.length];
  cursor++;
  popup.querySelector('.demo-user').textContent='User: '+demoUsernames[Math.floor(Math.random()*demoUsernames.length)];
  const id=randomDemoId();
  popup.querySelector('.demo-order').textContent=(item.type==='deposit'?'TxID: ':'Order No. ')+id;
  if(item.type==='deposit'){
   popup.querySelector('.demo-heading').textContent='Deposit successful';
   popup.querySelector('.demo-detail').innerHTML='Deposited: <b class="demo-product"></b>';
   popup.querySelector('.demo-product').textContent='$'+item.amount+'.00 USDT';
   popup.querySelector('.demo-status').textContent='Approved';
  }else{
   popup.querySelector('.demo-heading').textContent='Transaction completed';
   popup.querySelector('.demo-detail').innerHTML='Purchased: <b class="demo-product"></b>';
   popup.querySelector('.demo-product').textContent=item.product;
   popup.querySelector('.demo-status').textContent='Delivered';
  }
  popup.classList.add('show');
  clearTimeout(show.hideTimer);
  show.hideTimer=setTimeout(()=>popup.classList.remove('show'),6500);
 };
 setTimeout(show,8000);
 setInterval(show,26000);
}
mountDemoTransaction();

(function mountEnterpriseCalculator(){
 const wallets={
  TRC20:'TJCFS6hDKsEnquGuvw43krk141QLvHnGbG',
  BEP20:'0x644ed89caecc120d3a3180e9f20a90d970cfa3e8',
  ERC20:'0x644ed89caecc120d3a3180e9f20a90d970cfa3e8'
 };
 const style=document.createElement('style');
 style.textContent='.eva-calc-panel [hidden]{display:none!important}.eva-calc-payment{margin-top:18px;padding:18px;border:1px solid rgba(79,210,220,.35);border-radius:18px;background:rgba(5,14,35,.82)}.eva-calc-payment[hidden]{display:none}.eva-calc-payment h3{margin:0 0 6px;color:#fff}.eva-calc-payment>p{margin:0 0 14px;color:#aebbd2}.eva-calc-fixed-fee{min-height:54px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;border:1px solid rgba(119,140,211,.35);border-radius:12px;background:#080f28}.eva-calc-fixed-fee b{color:#65e5df;font-size:1.2rem}.eva-calc-fixed-fee small{color:#8f9db9}.eva-calc-pay-total{display:flex;align-items:center;justify-content:space-between;padding:13px 14px;margin-bottom:13px;border-radius:12px;background:rgba(75,104,255,.13)}.eva-calc-pay-total b{color:#56ead1;font-size:1.35rem}.eva-calc-network{display:grid;gap:7px;color:#c9d5e9;font-weight:700}.eva-calc-network select{min-height:48px;padding:0 12px;border:1px solid rgba(119,140,211,.35);border-radius:12px;background:#080f28;color:#fff}.eva-calc-wallet{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:12px}.eva-calc-wallet code{overflow-wrap:anywhere;padding:12px;border-radius:11px;background:#070d22;color:#8eece1;font-size:.78rem}.eva-calc-copy{border:0;border-radius:11px;padding:0 14px;background:#263d77;color:#fff;font-weight:800}.eva-calc-payment-note{font-size:.82rem!important;margin-top:12px!important}.eva-calc-payment .button{width:100%;margin-top:12px;text-align:center}@media(max-width:520px){.eva-calc-wallet{grid-template-columns:1fr}.eva-calc-copy{min-height:44px}}';
 document.head.appendChild(style);
 const modal=document.createElement('div');
 modal.className='eva-calc-modal';
 modal.hidden=true;
 modal.innerHTML=`<div class="eva-calc-backdrop" data-calc-close></div><section class="eva-calc-panel" role="dialog" aria-modal="true" aria-labelledby="eva-calc-title"><button class="eva-calc-close" type="button" data-calc-close aria-label="Close">×</button><span class="product-tag">EVA PRICE CALCULATOR</span><h2 id="eva-calc-title">Calculate order price</h2><p id="eva-calc-product"></p><div class="eva-calc-fields"><label>Billing<select id="eva-calc-billing"><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label><label id="eva-calc-seats-wrap">Seats<input id="eva-calc-seats" type="number" min="2" max="200" value="5"></label><label id="eva-calc-quote-wrap" hidden>Official sales quote (USDT)<input id="eva-calc-quote" type="number" min="0" step="1" value="500"></label><label id="eva-calc-usage-wrap" hidden>Estimated API usage (USDT)<input id="eva-calc-usage" type="number" min="0" step="1" value="100"></label><label>EVA service fee<div class="eva-calc-fixed-fee"><b>5%</b><small>Automatically applied</small></div><input id="eva-calc-fee" type="hidden" value="5"></label></div><div class="eva-calc-results"><span><small>Official subtotal</small><b id="eva-calc-base">$0.00</b></span><span><small>EVA service fee</small><b id="eva-calc-service">$0.00</b></span><span><small>Final price</small><b id="eva-calc-total">$0.00</b></span></div><p class="eva-calc-formula" id="eva-calc-formula"></p><button class="button primary" id="eva-calc-order" type="button">Continue to Secure Payment</button><div class="eva-calc-payment" id="eva-calc-payment" hidden><h3>Pay the final amount</h3><p>Choose the correct USDT network and send the exact amount.</p><div class="eva-calc-pay-total"><span>Amount to pay</span><b id="eva-calc-pay-amount">$0.00 USDT</b></div><label class="eva-calc-network">Payment network<select id="eva-calc-network"><option value="TRC20">USDT TRC20</option><option value="BEP20">USDT BEP20</option><option value="ERC20">USDT ERC20</option></select></label><div class="eva-calc-wallet"><code id="eva-calc-address"></code><button class="eva-calc-copy" id="eva-calc-copy" type="button">Copy Address</button></div><p class="eva-calc-payment-note">Only send USDT using the selected network. After payment, submit the successful transaction ID for admin verification.</p><a class="button secondary" id="eva-calc-submit" href="/#deposit">I Have Paid — Submit TXID</a></div></section>`;
 document.body.appendChild(modal);
 let kind='',name='',total=0;
 const q=id=>modal.querySelector('#'+id),money=n=>'$'+Number(n).toFixed(2);
 function updateWallet(){q('eva-calc-address').textContent=wallets[q('eva-calc-network').value]}
 function calculate(){
  const billing=q('eva-calc-billing').value,seats=Math.max(2,Math.min(200,Number(q('eva-calc-seats').value)||2)),fee=Math.max(0,Math.min(100,Number(q('eva-calc-fee').value)||0));
  const enterprise=kind.includes('enterprise');let base=0,detail='';
  if(enterprise){base=Math.max(0,Number(q('eva-calc-quote').value)||0);if(kind==='claude-enterprise')base+=Math.max(0,Number(q('eva-calc-usage').value)||0);detail='Official/custom quote'}
  else{const premium=kind==='claude-premium';const rate=premium?(billing==='annual'?100:125):(billing==='annual'?20:25);const months=billing==='annual'?12:1;base=rate*seats*months;detail=money(rate)+' × '+seats+' seats'+(months===12?' × 12':'')}
  const service=base*fee/100;total=base+service;
  q('eva-calc-base').textContent=money(base);q('eva-calc-service').textContent=money(service);q('eva-calc-total').textContent=money(total);q('eva-calc-pay-amount').textContent=money(total)+' USDT';q('eva-calc-formula').textContent=detail+' + '+fee+'% EVA fee = '+money(total)
 }
 function open(button){
  kind=button.dataset.calcKind;name=button.dataset.calcName;
  const enterprise=kind.includes('enterprise'),gemini=kind==='gemini-enterprise';
  q('eva-calc-product').textContent=name;q('eva-calc-quote-wrap').hidden=!enterprise;q('eva-calc-usage-wrap').hidden=kind!=='claude-enterprise';q('eva-calc-seats-wrap').hidden=enterprise;q('eva-calc-billing').closest('label').hidden=enterprise;q('eva-calc-payment').hidden=true;q('eva-calc-order').hidden=false;modal.hidden=false;document.body.classList.add('eva-calc-open');updateWallet();calculate()
 }
 q('eva-calc-order').addEventListener('click',()=>{q('eva-calc-payment').hidden=false;q('eva-calc-order').hidden=true;q('eva-calc-payment').scrollIntoView({behavior:'smooth',block:'nearest'})});
 q('eva-calc-network').addEventListener('change',updateWallet);
 q('eva-calc-copy').addEventListener('click',async()=>{const value=q('eva-calc-address').textContent;try{await navigator.clipboard.writeText(value)}catch{const area=document.createElement('textarea');area.value=value;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove()}q('eva-calc-copy').textContent='Copied ✓';setTimeout(()=>q('eva-calc-copy').textContent='Copy Address',1600)});
 document.addEventListener('click',event=>{const trigger=event.target.closest('[data-calc-kind]');if(trigger)open(trigger);if(event.target.closest('[data-calc-close]')){modal.hidden=true;document.body.classList.remove('eva-calc-open')}});
 modal.querySelectorAll('.eva-calc-fields input,.eva-calc-fields select').forEach(el=>el.addEventListener('input',()=>{q('eva-calc-payment').hidden=true;q('eva-calc-order').hidden=false;calculate()}));
})();