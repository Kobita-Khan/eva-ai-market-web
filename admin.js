let adminClient;
const adminNotice = (message, error = false) => { const el=document.getElementById('admin-notice'); el.textContent=message; el.className=error?'dash-notice error':'dash-notice success'; };
const escapeAdmin = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function adminFetch(path, options = {}, retry = true) {
  let { data: { session } } = await adminClient.auth.getSession();
  if (!session) {
    const refreshed = await adminClient.auth.refreshSession();
    session = refreshed.data.session;
  }
  if (!session) {
    await adminClient.auth.signOut();
    location.replace('/login.html');
    throw new Error('Sign in required.');
  }
  const response = await fetch(path, { ...options, headers: { 'content-type':'application/json', authorization:`Bearer ${session.access_token}`, ...(options.headers||{}) } });
  const body = await response.json();
  if (response.status === 401 && retry) {
    const refreshed = await adminClient.auth.refreshSession();
    if (refreshed.data.session) return adminFetch(path, options, false);
    await adminClient.auth.signOut();
    location.replace('/login.html');
    throw new Error('Session expired. Please sign in again.');
  }
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
    await Promise.all([loadDeposits(),loadStoreAdmin()]);
  } catch(error) { adminNotice(error.message,true); }
}

async function loadDeposits() {
  const { deposits } = await adminFetch(`/api/admin/deposits?refresh=${Date.now()}`, { cache:'no-store', headers:{ 'cache-control':'no-cache' } });
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
initAdmin();

async function loadStoreAdmin(){const {products,orders}=await adminFetch('/api/admin/store');document.getElementById('admin-product-grid').innerHTML=products.map(p=>`<article class="panel stock-editor"><div><b>${escapeAdmin(p.name)}</b><small>${escapeAdmin(p.subtitle)} · $${Number(p.price_usd).toFixed(2)}</small></div><label>Stock<input type="number" min="0" max="10000" value="${p.stock}" data-stock-id="${escapeAdmin(p.id)}"></label><button class="button secondary small-button save-stock" type="button">Save</button></article>`).join('');document.querySelectorAll('.save-stock').forEach(button=>button.addEventListener('click',()=>saveStock(button)));document.getElementById('admin-order-rows').innerHTML=orders.length?orders.map(o=>`<tr><td>${new Date(o.created_at).toLocaleString()}</td><td><code>${escapeAdmin(o.user_id.slice(0,8))}…</code></td><td>${escapeAdmin(o.product_name)}</td><td>$${Number(o.price_usd).toFixed(2)}</td><td><select class="order-status"><option ${o.status==='approved'?'selected':''}>approved</option><option ${o.status==='processing'?'selected':''}>processing</option><option ${o.status==='delivered'?'selected':''}>delivered</option><option ${o.status==='cancelled'?'selected':''}>cancelled</option><option ${o.status==='refunded'?'selected':''}>refunded</option></select></td><td><textarea class="order-delivery" rows="3" placeholder="Secure delivery details or admin note">${escapeAdmin(o.delivery_details||'')}</textarea></td><td><button class="button primary small-button save-order" type="button" data-order-id="${o.id}">Update</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty">No account orders yet.</td></tr>';document.querySelectorAll('.save-order').forEach(button=>button.addEventListener('click',()=>saveOrder(button)))}
async function saveStock(button){const card=button.closest('.stock-editor'),input=card.querySelector('[data-stock-id]');button.disabled=true;try{await adminFetch('/api/admin/store',{method:'POST',body:JSON.stringify({action:'stock',productId:input.dataset.stockId,stock:Number(input.value)})});adminNotice('Stock updated.');await loadStoreAdmin()}catch(error){adminNotice(error.message,true);button.disabled=false}}
async function saveOrder(button){const row=button.closest('tr'),status=row.querySelector('.order-status').value,deliveryDetails=row.querySelector('.order-delivery').value;if(status==='delivered'&&!deliveryDetails.trim())return adminNotice('Add delivery details before marking Delivered.',true);if(status==='refunded'&&!confirm('Refund this order, return the balance, and restore stock?'))return;button.disabled=true;try{await adminFetch('/api/admin/store',{method:'POST',body:JSON.stringify({action:'order',orderId:button.dataset.orderId,status,deliveryDetails})});adminNotice('Order updated.');await loadStoreAdmin()}catch(error){adminNotice(error.message,true);button.disabled=false}}
