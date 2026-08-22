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

async function loadData(userId) {
  const [wallet, deposits, ledger, keys, usage] = await Promise.all([
    client.from('wallets').select('balance_usd,updated_at').eq('user_id', userId).single(),
    client.from('deposits').select('id,amount_usdt,network,transaction_id,status,created_at').order('created_at',{ascending:false}).limit(10),
    client.from('wallet_ledger').select('amount_usd,entry_type,description,balance_after,created_at').order('created_at',{ascending:false}).limit(10),
    client.from('api_keys').select('id,key_prefix,status,created_at,last_used_at').order('created_at',{ascending:false}),
    client.from('usage_records').select('provider,model,input_tokens,output_tokens,cost_usd,created_at').order('created_at',{ascending:false}).limit(10)
  ]);
  const firstError = [wallet,deposits,ledger,keys,usage].find(result => result.error)?.error;
  if (firstError) throw firstError;
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

document.getElementById('sign-out').addEventListener('click', async () => { await client.auth.signOut(); location.replace('/'); });
initDashboard();
