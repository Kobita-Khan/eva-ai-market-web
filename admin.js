let adminClient;
const adminNotice = (message, error = false) => { const el=document.getElementById('admin-notice'); el.textContent=message; el.className=error?'dash-notice error':'dash-notice success'; };
const escapeAdmin = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function adminFetch(path, options = {}) {
  const { data: { session } } = await adminClient.auth.getSession();
  if (!session) throw new Error('Sign in required.');
  const response = await fetch(path, { ...options, headers: { 'content-type':'application/json', authorization:`Bearer ${session.access_token}`, ...(options.headers||{}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

async function initAdmin() {
  try {
    const response=await fetch('/api/config'); const config=await response.json();
    if(!response.ok) throw new Error(config.error);
    adminClient=window.supabase.createClient(config.url,config.anonKey);
    const { data:{session} }=await adminClient.auth.getSession();
    if(!session) return location.replace('/login.html');
    await loadDeposits();
  } catch(error) { adminNotice(error.message,true); }
}

async function loadDeposits() {
  const { deposits } = await adminFetch('/api/admin/deposits');
  document.getElementById('admin-deposit-rows').innerHTML = deposits.length ? deposits.map(item => `<tr><td>${new Date(item.created_at).toLocaleString()}</td><td>${escapeAdmin(item.profile?.email || item.user_id)}</td><td>${escapeAdmin(item.network)}</td><td>${Number(item.amount_usdt).toFixed(2)} USDT</td><td><code title="${escapeAdmin(item.transaction_id)}">${escapeAdmin(item.transaction_id.slice(0,10))}…</code></td><td><span class="status ${escapeAdmin(item.status)}">${escapeAdmin(item.status)}</span></td><td>${item.status==='pending'?`<button class="approve-button" data-id="${item.id}">Approve</button>`:'—'}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No deposits yet.</td></tr>';
  document.querySelectorAll('.approve-button').forEach(button => button.addEventListener('click', () => approve(button)));
}

async function approve(button) {
  if(!confirm('Approve this verified payment and add the balance?')) return;
  button.disabled=true; adminNotice('Approving payment…');
  try { await adminFetch('/api/admin/approve',{method:'POST',body:JSON.stringify({depositId:button.dataset.id})}); adminNotice('Payment approved and balance added.'); await loadDeposits(); }
  catch(error){ adminNotice(error.message,true); button.disabled=false; }
}

document.getElementById('trial-credit-form').addEventListener('submit', async event => {
  event.preventDefault();
  const email = document.getElementById('trial-email').value.trim();
  const button = event.currentTarget.querySelector('button');
  if (!confirm(`Grant one-time $0.10 trial credit to ${email}?`)) return;
  button.disabled = true;
  adminNotice('Granting trial credit…');
  try {
    const result = await adminFetch('/api/admin/trial-credit', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    adminNotice(`$0.10 trial granted to ${result.email}. New balance: ${result.balance.toFixed(2)}`);
    event.currentTarget.reset();
  } catch (error) {
    adminNotice(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('admin-refresh').addEventListener('click',()=>loadDeposits().catch(error=>adminNotice(error.message,true)));
initAdmin();
