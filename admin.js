let adminClient;
let adminRefreshPromise = null;
const EVA_ADMIN_CANONICAL_HOST = 'aicloudmarket.shop';
const EVA_ADMIN_ALIAS_HOSTS = new Set(['eva-ai-market.vercel.app', 'eva-ai-market-web.vercel.app']);

function canonicalizeAdminOrigin() {
  if (!EVA_ADMIN_ALIAS_HOSTS.has(location.hostname)) return false;
  location.replace(`https://${EVA_ADMIN_CANONICAL_HOST}${location.pathname}${location.search}${location.hash}`);
  return true;
}

function rememberAdminReturn() {
  sessionStorage.setItem('eva-return-to', `${location.pathname}${location.search}${location.hash}`);
}

function goToAdminLogin() {
  rememberAdminReturn();
  location.replace('/login.html');
}

async function refreshAdminSession() {
  if (!adminRefreshPromise) {
    adminRefreshPromise = adminClient.auth.refreshSession().finally(() => {
      adminRefreshPromise = null;
    });
  }
  return adminRefreshPromise;
}

async function getAdminSession(forceRefresh = false) {
  if (!forceRefresh) {
    const current = await adminClient.auth.getSession();
    if (current.data.session) return current.data.session;
  }
  const refreshed = await refreshAdminSession();
  if (refreshed.data.session) return refreshed.data.session;
  const message = String(refreshed.error?.message || '');
  if (!message || /refresh token|session.*missing|invalid.*token/i.test(message)) return null;
  throw new Error('Connection problem while refreshing the admin session. Your login has been kept; please retry.');
}

const adminNotice = (message, error = false) => { const el=document.getElementById('admin-notice'); el.textContent=message; el.className=error?'dash-notice error':'dash-notice success'; };
const escapeAdmin = value => String(value ?? '').replace(/[&<>'\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));

async function adminFetch(path, options = {}, retry = true) {
  const session = await getAdminSession();
  if (!session) {
    goToAdminLogin();
    throw new Error('Sign in required.');
  }
  const response = await fetch(path, { ...options, headers: { 'content-type':'application/json', authorization:`Bearer ${session.access_token}`, ...(options.headers||{}) } });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && retry) {
    const refreshedSession = await getAdminSession(true);
    if (refreshedSession) return adminFetch(path, options, false);
  }
  if (response.status === 401) {
    goToAdminLogin();
    throw new Error('Session expired. Please sign in again.');
  }
  if (response.status === 403) {
    throw new Error('This signed-in account is not authorized for EVA Admin. Your login session has been kept.');
  }
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

async function initAdmin() {
  try {
    const response=await fetch('/api/config'); const config=await response.json();
    if(!response.ok) throw new Error(config.error);
    adminClient=window.supabase.createClient(config.url,config.anonKey);
    const session = await getAdminSession();
    if (!session) return goToAdminLogin();
    adminClient.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') goToAdminLogin();
    });
    await Promise.all([loadDeposits(),loadStoreAdmin()]);
  } catch(error) { adminNotice(error.message,true); }
}

async function loadDeposits() {
  const { deposits } = await adminFetch(`/api/admin/store?view=deposits&refresh=${Date.now()}`, { cache:'no-store', headers:{ 'cache-control':'no-cache' } });
  document.getElementById('admin-deposit-rows').innerHTML = deposits.length ? deposits.map(item => {
    const action = item.status==='pending'
      ? `<button class="approve-button" data-id="${item.id}">Approve</button>`
      : item.status==='approved'
        ? `<button class="repair-button button secondary small-button" data-id="${item.id}">Repair balance</button>`
        : '—';
    return `<tr><td>${new Date(item.created_at).toLocaleString()}</td><td>${escapeAdmin(item.profile?.email || item.user_id)}</td><td>${escapeAdmin(item.network)}</td><td>${Number(item.amount_usdt).toFixed(2)} USDT</td><td><code title="${escapeAdmin(item.transaction_id)}">${escapeAdmin(item.transaction_id.slice(0,10))}…</code></td><td><span class="status ${escapeAdmin(item.status)}">${escapeAdmin(item.status)}</span></td><td>${action}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No deposits yet.</td></tr>';
  document.querySelectorAll('.approve-button').forEach(button => button.addEventListener('click', () => approve(button)));
  document.querySelectorAll('.repair-button').forEach(button => button.addEventListener('click', () => repairBalance(button)));
}

async function approve(button) {
  if(!confirm('Approve this verified payment and add the balance?')) return;
  button.disabled=true; adminNotice('Approving payment…');
  try { await adminFetch('/api/admin/approve',{method:'POST',body:JSON.stringify({depositId:button.dataset.id})}); adminNotice('Payment approved and balance added.'); await loadDeposits(); }
  catch(error){ adminNotice(error.message,true); button.disabled=false; }
}

async function repairBalance(button) {
  if(!confirm('Repair this approved deposit only if the customer balance was not credited?')) return;
  button.disabled=true; adminNotice('Checking and repairing customer balance…');
  try {
    const result=await adminFetch('/api/admin/approve',{method:'POST',body:JSON.stringify({depositId:button.dataset.id,repair:true})});
    adminNotice(result.repaired?'Balance repaired successfully.':'No repair was needed; this deposit was already credited.');
    await loadDeposits();
  } catch(error){ adminNotice(error.message,true); button.disabled=false; }
}

document.getElementById('trial-credit-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = document.getElementById('trial-email').value.trim();
  const button = form.querySelector('button');
  if (!confirm(`Grant one-time $0.10 trial credit to ${email}?`)) return;
  button.disabled = true;
  adminNotice('Granting trial credit…');
  try {
    const result = await adminFetch('/api/admin/trial-credit', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    adminNotice(`$0.10 trial granted to ${result.email}. New balance: ${result.balance.toFixed(2)}`);
    form.reset();
  } catch (error) {
    adminNotice(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('admin-refresh').addEventListener('click',async event=>{const button=event.currentTarget,original=button.textContent;button.disabled=true;button.textContent='Refreshing…';adminNotice('Loading latest deposits and orders…');try{await Promise.all([loadDeposits(),loadStoreAdmin()]);adminNotice('Updated with the latest deposits and orders.')}catch(error){adminNotice(error.message,true)}finally{button.disabled=false;button.textContent=original}});
if (!canonicalizeAdminOrigin()) initAdmin();

async function loadStoreAdmin(){const {products,orders}=await adminFetch('/api/admin/store');document.getElementById('admin-product-grid').innerHTML=products.map(p=>`<article class="panel stock-editor"><div><b>${escapeAdmin(p.name)}</b><small>${escapeAdmin(p.subtitle)} · $${Number(p.price_usd).toFixed(2)}</small></div><label>Stock<input type="number" min="0" max="10000" value="${p.stock}" data-stock-id="${escapeAdmin(p.id)}"></label><button class="button secondary small-button save-stock" type="button">Save</button></article>`).join('');document.querySelectorAll('.save-stock').forEach(button=>button.addEventListener('click',()=>saveStock(button)));document.getElementById('admin-order-rows').innerHTML=orders.length?orders.map(o=>`<tr><td>${new Date(o.created_at).toLocaleString()}</td><td><strong>${escapeAdmin(o.customer_email||'Email unavailable')}</strong><br><code>${escapeAdmin(o.user_id.slice(0,8))}…</code></td><td>${escapeAdmin(o.product_name)}</td><td>$${Number(o.price_usd).toFixed(2)}</td><td><select class="order-status"><option ${o.status==='approved'?'selected':''}>approved</option><option ${o.status==='processing'?'selected':''}>processing</option><option ${o.status==='delivered'?'selected':''}>delivered</option><option ${o.status==='cancelled'?'selected':''}>cancelled</option><option ${o.status==='refunded'?'selected':''}>refunded</option></select></td><td><textarea class="order-delivery" rows="3" placeholder="Secure delivery details or admin note">${escapeAdmin(o.delivery_details||'')}</textarea></td><td><button class="button primary small-button save-order" type="button" data-order-id="${o.id}" data-order-email="${escapeAdmin(o.customer_email||'Email unavailable')}" data-order-product="${escapeAdmin(o.product_name)}" data-order-price="${Number(o.price_usd).toFixed(2)}">Update</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty">No account orders yet.</td></tr>';document.querySelectorAll('.save-order').forEach(button=>button.addEventListener('click',()=>saveOrder(button)))}
async function saveStock(button){const card=button.closest('.stock-editor'),input=card.querySelector('[data-stock-id]');button.disabled=true;try{await adminFetch('/api/admin/store',{method:'POST',body:JSON.stringify({action:'stock',productId:input.dataset.stockId,stock:Number(input.value)})});adminNotice('Stock updated.');await loadStoreAdmin()}catch(error){adminNotice(error.message,true);button.disabled=false}}
async function saveOrder(button){const row=button.closest('tr'),status=row.querySelector('.order-status').value,deliveryDetails=row.querySelector('.order-delivery').value;if(status==='delivered'&&!deliveryDetails.trim())return adminNotice('Add delivery details before marking Delivered.',true);if(status==='refunded'){const email=button.dataset.orderEmail,product=button.dataset.orderProduct,price=button.dataset.orderPrice;if(!confirm(`Refund ${price} for ${product} to ${email}? The wallet balance and stock will be updated.`))return;}button.disabled=true;try{const result=await adminFetch('/api/admin/store',{method:'POST',body:JSON.stringify({action:'order',orderId:button.dataset.orderId,status,deliveryDetails})});adminNotice(status==='refunded'?(`Refund completed for ${button.dataset.orderEmail}. Customer balance was returned.`):'Order updated.');await loadStoreAdmin()}catch(error){adminNotice(error.message,true);button.disabled=false}}

let lastSignupTotal=null;
function ensureStatsUI(){
 if(document.getElementById('admin-live-stats')) return;
 const nav=document.querySelector('.admin-quick-nav');
 if(!nav) return;
 nav.insertAdjacentHTML('afterend',`<section id="admin-live-stats" class="panel dash-card eva-live-stats"><div class="card-title-row"><div><span class="kicker">LIVE BUSINESS DATA</span><h2>Signups, visits & deposits</h2></div><span class="eva-live-badge">● checks every 60 sec</span></div><div class="eva-stat-grid"><article><span>Total signups</span><strong id="stat-signups">—</strong><small>Registered customers</small></article><article><span>Unique visitors</span><strong id="stat-visitors">—</strong><small id="stat-visits-total">Tracking now</small></article><article><span>Visits today</span><strong id="stat-visits-today">—</strong><small>Store activity</small></article><article><span>Total deposits</span><strong id="stat-deposits">—</strong><small id="stat-deposits-pending">Pending —</small></article><article><span>Approved deposits</span><strong id="stat-approved">—</strong><small id="stat-approved-amount">$0.00 credited</small></article></div><div class="eva-recent-signups"><h3>Recent customer signups</h3><div class="table-wrap"><table><thead><tr><th>Customer</th><th>Signed up</th><th>Last sign in</th></tr></thead><tbody id="recent-signup-rows"><tr><td colspan="3" class="empty">Loading…</td></tr></tbody></table></div></div></section>`);
 const style=document.createElement('style');
 style.textContent=`.eva-live-stats{margin:18px 0}.eva-live-badge{font-size:12px;color:#34d399;font-weight:700}.eva-stat-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-top:16px}.eva-stat-grid article{padding:16px;border:1px solid rgba(148,163,184,.18);border-radius:16px;background:rgba(15,23,42,.58)}.eva-stat-grid span,.eva-stat-grid small{display:block;color:#94a3b8}.eva-stat-grid strong{display:block;font-size:26px;margin:6px 0;color:#f8fafc}.eva-recent-signups{margin-top:20px}.eva-recent-signups h3{margin:0 0 10px}@media(max-width:900px){.eva-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){.eva-stat-grid{grid-template-columns:1fr}}`;
 document.head.appendChild(style);
}

async function loadAdminStats(notify=true){
 if(!adminClient) return;
 ensureStatsUI();
 try{
  const data=await adminFetch(`/api/admin/stats?refresh=${Date.now()}`,{cache:'no-store',headers:{'cache-control':'no-cache'}});
  const total=Number(data.signups?.total||0);
  document.getElementById('stat-signups').textContent=total.toLocaleString();
  document.getElementById('stat-visitors').textContent=Number(data.visits?.unique||0).toLocaleString();
  document.getElementById('stat-visits-total').textContent=`${Number(data.visits?.total||0).toLocaleString()} total visits since tracking started`;
  document.getElementById('stat-visits-today').textContent=Number(data.visits?.today||0).toLocaleString();
  document.getElementById('stat-deposits').textContent=Number(data.deposits?.total||0).toLocaleString();
  document.getElementById('stat-deposits-pending').textContent=`Pending ${Number(data.deposits?.pending||0).toLocaleString()}`;
  document.getElementById('stat-approved').textContent=Number(data.deposits?.approved||0).toLocaleString();
  document.getElementById('stat-approved-amount').textContent=`$${Number(data.deposits?.approvedAmount||0).toFixed(2)} credited`;
  const recent=Array.isArray(data.signups?.recent)?data.signups.recent:[];
  document.getElementById('recent-signup-rows').innerHTML=recent.length?recent.map(user=>`<tr><td>${escapeAdmin(user.email||user.id||'Unknown')}</td><td>${user.created_at?new Date(user.created_at).toLocaleString():'—'}</td><td>${user.last_sign_in_at?new Date(user.last_sign_in_at).toLocaleString():'Never'}</td></tr>`).join(''):'<tr><td colspan="3" class="empty">No customer signups yet.</td></tr>';
  if(notify&&lastSignupTotal!==null&&total>lastSignupTotal){
   const diff=total-lastSignupTotal;
   adminNotice(`🔔 ${diff} new customer signup${diff>1?'s':''} detected.`);
  }
  lastSignupTotal=total;
 }catch(error){
  const rows=document.getElementById('recent-signup-rows');
  if(rows) rows.innerHTML=`<tr><td colspan="3" class="empty">${escapeAdmin(error.message)}</td></tr>`;
 }
}

setTimeout(()=>loadAdminStats(false),1200);
setInterval(()=>loadAdminStats(true),60000);
document.getElementById('admin-refresh').addEventListener('click',()=>setTimeout(()=>loadAdminStats(false),250));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !adminClient) return;
  getAdminSession()
    .then(session => {
      if (!session) return goToAdminLogin();
      return Promise.all([loadDeposits(), loadStoreAdmin(), loadAdminStats(false)]);
    })
    .catch(error => adminNotice(error.message, true));
});
