let client;
const money = value => '$' + Number(value || 0).toFixed(2);
const moneyPrecise = value => '$' + Number(value || 0).toFixed(6);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const setNotice = (message, error = false) => { const el = document.getElementById('dash-notice'); el.textContent = message; el.className = error ? 'dash-notice error' : 'dash-notice success'; };

async function initDashboard() {
  try {
    const response = await fetch('/api/config'); const config = await response.json();
    if (!response.ok) throw new Error(config.error || 'Configuration unavailable');
    client = window.supabase.createClient(config.url, config.anonKey);
    const { data: { session } } = await client.auth.getSession();
    if (!session) return location.replace('/login.html');
    document.getElementById('customer-email').textContent = session.user.email;
    await loadData(session.user.id);
    await loadStore();
  } catch (error) { setNotice(error.message, true); }
}

async function loadData(userId, retry = true) {
  const [wallet, deposits, ledger, keys, usage] = await Promise.all([
    client.from('wallets').select('balance_usd,updated_at').eq('user_id', userId).single(),
    client.from('deposits').select('id,amount_usdt,network,transaction_id,status,created_at').order('created_at',{ascending:false}).limit(10),
    client.from('wallet_ledger').select('amount_usd,entry_type,description,balance_after,created_at').order('created_at',{ascending:false}).limit(10),
    client.rpc('list_my_api_keys'),
    client.from('usage_records').select('provider,model,input_tokens,output_tokens,cost_usd,created_at').order('created_at',{ascending:false}).limit(10)
  ]);
  const firstError = [wallet,deposits,ledger,keys,usage].find(result => result.error)?.error;
  if (firstError) {
    if (retry && /JWT issued at future/i.test(firstError.message || '')) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      return loadData(userId, false);
    }
    throw firstError;
  }
  document.getElementById('balance').textContent = moneyPrecise(wallet.data?.balance_usd);
  document.getElementById('pending-count').textContent = deposits.data.filter(item => item.status === 'pending').length;
  document.getElementById('key-count').textContent = keys.data.filter(item => item.status === 'active').length;
  renderRows('deposit-rows', deposits.data, item => `<tr><td>${new Date(item.created_at).toLocaleDateString()}</td><td>${escapeHtml(item.network)}</td><td>${money(item.amount_usdt)}</td><td><span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td></tr>`, 4);
  renderRows('ledger-rows', ledger.data, item => `<tr><td>${new Date(item.created_at).toLocaleDateString()}</td><td>${escapeHtml(item.entry_type)}</td><td class="${Number(item.amount_usd)>=0?'positive':'negative'}">${moneyPrecise(item.amount_usd)}</td><td>${moneyPrecise(item.balance_after)}</td></tr>`, 4);
  renderRows('key-rows', keys.data, item => `<tr><td><code>${escapeHtml(item.key_prefix)}••••••••</code></td><td><span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td><td>${item.last_used_at ? new Date(item.last_used_at).toLocaleDateString() : 'Never'}</td></tr>`, 3);
  renderRows('usage-rows', usage.data, item => `<tr><td>${escapeHtml(item.provider)}</td><td>${escapeHtml(item.model)}</td><td>${Number(item.input_tokens)+Number(item.output_tokens)}</td><td>${moneyPrecise(item.cost_usd)}</td></tr>`, 4);
}

function renderRows(id, rows, mapper, colspan) { document.getElementById(id).innerHTML = rows.length ? rows.map(mapper).join('') : `<tr><td colspan="${colspan}" class="empty">No records yet.</td></tr>`; }

document.getElementById('dashboard-deposit-form').addEventListener('submit', async event => {
  event.preventDefault();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return location.replace('/login.html');
  const amount = Number(document.getElementById('dash-amount').value);
  const network = document.getElementById('dash-network').value;
  const transaction_id = document.getElementById('dash-txid').value.trim();
  if (amount < 10 || !transaction_id) return setNotice('Enter at least 10 USDT and a valid transaction ID.', true);
  const { error } = await client.from('deposits').insert({ user_id:user.id, amount_usdt:amount, network, transaction_id });
  if (error) return setNotice(error.code === '23505' ? 'This transaction ID was already submitted.' : error.message, true);
  setNotice('Deposit submitted. It is pending manual verification.'); event.target.reset(); await loadData(user.id);
});

document.getElementById('reset-api-keys').addEventListener('click', async event => {
  if (!confirm('Revoke every active API key on this account? Applications using them will stop working.')) return;
  const button = event.currentTarget;
  button.disabled = true;
  setNotice('Resetting lost API keys…');
  try {
    const { data: { session } } = await client.auth.getSession();
    if (!session) return location.replace('/login.html');
    const response = await fetch('/api/keys/reset', {
      method: 'POST',
      headers: { authorization: `Bearer ${session.access_token}` }
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not reset API keys.');
    document.getElementById('new-api-key').value = '';
    document.getElementById('new-key-box').hidden = true;
    setNotice(`${body.revoked} active API key(s) revoked. Create one new key now.`);
    const { data: { user } } = await client.auth.getUser();
    if (user) await loadData(user.id);
  } catch (error) {
    setNotice(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('create-api-key').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  setNotice('Creating a secure API key…');
  try {
    const { data: { session } } = await client.auth.getSession();
    if (!session) return location.replace('/login.html');
    const response = await fetch('/api/keys/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ name: 'EVA multi-provider key' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not create API key.');
    document.getElementById('new-api-key').value = body.apiKey;
    document.getElementById('new-key-box').hidden = false;
    setNotice('API key created. Copy it now—it will not be shown again.');
    const { data: { user } } = await client.auth.getUser();
    if (user) await loadData(user.id);
  } catch (error) {
    setNotice(error.message, true);
  } finally {
    button.disabled = false;
  }
});

async function testProvider({ button, provider, endpoint, requestBody, readReply }) {
  const apiKey = document.getElementById('new-api-key').value;
  const resultBox = document.getElementById('api-test-result');
  if (!apiKey) return setNotice('Create a new API key before testing.', true);

  button.disabled = true;
  button.textContent = `Testing ${provider}…`;
  resultBox.hidden = true;
  setNotice(`Sending a small test request to ${provider}…`);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(requestBody)
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `${provider} API test failed.`);

    const reply = readReply(body) || 'Response received';
    const charged = Number(body.eva_usage?.charged_usd || 0);
    const balance = Number(body.eva_usage?.balance_usd || 0);
    resultBox.textContent = `${reply} · Charged $${charged.toFixed(6)} · Balance $${balance.toFixed(6)}`;
    resultBox.hidden = false;
    setNotice(`${provider} API test passed. Usage and balance were updated.`);
    const { data: { user } } = await client.auth.getUser();
    if (user) await loadData(user.id);
  } catch (error) {
    resultBox.textContent = error.message;
    resultBox.hidden = false;
    setNotice(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = `Test ${provider} API`;
  }
}

document.getElementById('test-api-key').addEventListener('click', event => testProvider({
  button: event.currentTarget,
  provider: 'Gemini',
  endpoint: '/api/v1/gemini',
  requestBody: {
    prompt: 'Reply with exactly: EVA Gemini API test successful',
    generationConfig: { maxOutputTokens: 30, temperature: 0 }
  },
  readReply: body => body.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim()
}));

document.getElementById('test-openai-api').addEventListener('click', event => testProvider({
  button: event.currentTarget,
  provider: 'OpenAI',
  endpoint: '/api/v1/openai',
  requestBody: {
    prompt: 'Reply with exactly: EVA OpenAI API test successful',
    max_output_tokens: 64
  },
  readReply: body => body.output_text || body.output
    ?.flatMap(item => item.content || [])
    .map(part => part.text || '')
    .join('')
    .trim()
}));

document.getElementById('test-claude-api').addEventListener('click', event => testProvider({
  button: event.currentTarget,
  provider: 'Claude',
  endpoint: '/api/v1/claude',
  requestBody: {
    prompt: 'Reply with exactly: EVA Claude API test successful',
    max_tokens: 30,
    temperature: 0
  },
  readReply: body => body.content?.map(block => block.text || '').join('').trim()
}));

document.getElementById('copy-api-key').addEventListener('click', async event => {
  const field = document.getElementById('new-api-key');
  const button = event.currentTarget;
  const value = field.value;
  if (!value) return setNotice('No API key is available to copy.', true);

  field.removeAttribute('readonly');
  field.focus();
  field.select();
  field.setSelectionRange(0, value.length);

  let copied = false;
  try { copied = document.execCommand('copy'); } catch {}

  field.setAttribute('readonly', '');
  if (!copied) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch {}
  }

  field.focus();
  field.select();
  field.setSelectionRange(0, value.length);
  button.textContent = copied ? 'Copied — paste now' : 'Key selected — tap Copy';
  setNotice(
    copied
      ? 'Copy requested. Paste into Notes now. If Paste is missing, press and hold the selected key and tap Copy.'
      : 'Key selected. Press and hold the highlighted key, then tap Copy.',
    !copied
  );
});

document.getElementById('sign-out').addEventListener('click', async () => { await client.auth.signOut(); location.replace('/'); });
initDashboard();

async function dashboardApi(path,options={}){const {data:{session}}=await client.auth.getSession();if(!session)throw new Error('Sign in required.');const response=await fetch(path,{...options,headers:{'content-type':'application/json',authorization:`Bearer ${session.access_token}`,...(options.headers||{})}});const body=await response.json();if(!response.ok)throw new Error(body.error||'Store request failed.');return body}
async function loadStore(){const [catalog,orderBody]=await Promise.all([fetch('/api/store/catalog').then(async r=>{const b=await r.json();if(!r.ok)throw new Error(b.error);return b}),dashboardApi('/api/store/orders')]);const products=document.getElementById('dashboard-store-products');products.innerHTML=catalog.products.map(product=>`<article class="account-product panel"><span class="product-tag">${escapeHtml(product.category)}</span><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.subtitle)}</p><strong>${money(product.price_usd)} <small>USDT</small></strong><div class="stock-line"><span class="${product.stock>0?'in-stock':'out-stock'}">${product.stock>0?product.stock+' in stock':'Out of stock'}</span><span>${product.warranty_days}-day warranty</span></div><button class="button ${product.stock>0?'primary':'disabled'} buy-product" type="button" data-product-id="${escapeHtml(product.id)}" data-name="${escapeHtml(product.name)}" data-price="${Number(product.price_usd)}" ${product.stock<1?'disabled':''}>${product.stock>0?'Buy now':'Unavailable'}</button></article>`).join('');products.querySelectorAll('.buy-product').forEach(button=>button.addEventListener('click',()=>purchaseProduct(button)));renderRows('order-rows',orderBody.orders,item=>`<tr><td>${new Date(item.created_at).toLocaleDateString()}</td><td>${escapeHtml(item.product_name)}</td><td>${money(item.price_usd)}</td><td><span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td><td class="delivery-cell">${item.delivery_details?`<details><summary>View securely</summary><pre>${escapeHtml(item.delivery_details)}</pre></details>`:'Pending delivery'}</td></tr>`,5)}
async function purchaseProduct(button){const name=button.dataset.name,price=Number(button.dataset.price);if(!confirm(`Buy ${name} for $${price.toFixed(2)} from your EVA balance?`))return;button.disabled=true;setNotice('Processing secure purchase…');try{await dashboardApi('/api/store/purchase',{method:'POST',body:JSON.stringify({productId:button.dataset.productId})});setNotice('Purchase successful. Your order is ready for processing.');const {data:{user}}=await client.auth.getUser();await Promise.all([loadData(user.id),loadStore()])}catch(error){setNotice(error.message,true);button.disabled=false}}
