let client;
const money = value => `$${Number(value || 0).toFixed(2)}`;
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
  document.getElementById('balance').textContent = money(wallet.data?.balance_usd);
  document.getElementById('pending-count').textContent = deposits.data.filter(item => item.status === 'pending').length;
  document.getElementById('key-count').textContent = keys.data.filter(item => item.status === 'active').length;
  renderRows('deposit-rows', deposits.data, item => `<tr><td>${new Date(item.created_at).toLocaleDateString()}</td><td>${escapeHtml(item.network)}</td><td>${money(item.amount_usdt)}</td><td><span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td></tr>`, 4);
  renderRows('ledger-rows', ledger.data, item => `<tr><td>${new Date(item.created_at).toLocaleDateString()}</td><td>${escapeHtml(item.entry_type)}</td><td class="${Number(item.amount_usd)>=0?'positive':'negative'}">${money(item.amount_usd)}</td><td>${money(item.balance_after)}</td></tr>`, 4);
  renderRows('key-rows', keys.data, item => `<tr><td><code>${escapeHtml(item.key_prefix)}••••••••</code></td><td><span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td><td>${item.last_used_at ? new Date(item.last_used_at).toLocaleDateString() : 'Never'}</td></tr>`, 3);
  renderRows('usage-rows', usage.data, item => `<tr><td>${escapeHtml(item.provider)}</td><td>${escapeHtml(item.model)}</td><td>${Number(item.input_tokens)+Number(item.output_tokens)}</td><td>${money(item.cost_usd)}</td></tr>`, 4);
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
      body: JSON.stringify({ name: 'Gemini key' })
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

document.getElementById('copy-api-key').addEventListener('click', async () => {
  const field = document.getElementById('new-api-key');
  field.focus();
  field.select();
  field.setSelectionRange(0, field.value.length);
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(field.value);
      copied = true;
    }
  } catch {}
  if (!copied) {
    try { copied = document.execCommand('copy'); } catch {}
  }
  setNotice(
    copied ? 'API key copied. Paste it into Notes now.' : 'Key selected. Press and hold inside the field, then tap Copy.',
    !copied
  );
});

document.getElementById('sign-out').addEventListener('click', async () => { await client.auth.signOut(); location.replace('/'); });
initDashboard();
