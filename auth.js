let evaClient;
let directSignupUrl='';
const statusEl = document.getElementById('auth-status');
const showStatus = (message, error = false) => {
  statusEl.textContent = message;
  statusEl.className = error ? 'auth-status error' : 'auth-status success';
};

function showAuthForm(id){
  document.querySelectorAll('.auth-form').forEach(form=>{form.hidden=form.id!==id;});
}

function setActiveTab(name){
  document.querySelectorAll('[data-auth-tab]').forEach(item=>{
    const active=item.dataset.authTab===name;
    item.classList.toggle('active',active);
    item.setAttribute('aria-selected',String(active));
  });
}

async function init() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || 'Configuration unavailable');
    evaClient = window.supabase.createClient(config.url, config.anonKey);
    directSignupUrl=String(config.signupUrl||`${String(config.url).replace(/\/$/,'')}/functions/v1/direct-signup`);
    const { data } = await evaClient.auth.getSession();
    if (data.session) location.replace('/dashboard.html');
  } catch (error) {
    showStatus(error.message, true);
  }
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!evaClient) return;
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  showStatus('Signing in securely…');
  const { error } = await evaClient.auth.signInWithPassword({ email, password });
  if (error) return showStatus(error.message, true);
  location.replace('/dashboard.html');
});

document.getElementById('signup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!evaClient||!directSignupUrl) return showStatus('Signup service is not ready. Please refresh and try again.',true);
  const email = document.getElementById('signup-email').value.trim().toLowerCase();
  const password = document.getElementById('signup-password').value;
  if (password.length < 8) return showStatus('Password must be at least 8 characters.', true);

  const button=event.currentTarget.querySelector('button[type="submit"]');
  button.disabled=true;
  showStatus('Creating your account…');

  try{
    const response=await fetch(directSignupUrl,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({email,password})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result.error||'Account creation failed.');

    showStatus('Account created. Signing you in…');
    const { error }=await evaClient.auth.signInWithPassword({email,password});
    if(error) throw error;

    fetch('/api/store',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({action:'notify_signup',email})
    }).catch(()=>{});

    location.replace('/dashboard.html');
  }catch(error){
    showStatus(error.message||'Could not create the account.',true);
    button.disabled=false;
  }
});

document.getElementById('forgot-password').addEventListener('click', () => {
  const email = document.getElementById('login-email').value.trim();
  const message = email
    ? `Hello, I need help recovering my EVA AI MARKET account. Account email: ${email}`
    : 'Hello, I need help recovering my EVA AI MARKET account.';
  showStatus('Password recovery is handled securely by support for now. Opening Telegram support…');
  window.open(`https://t.me/eva007_8?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer');
});

document.querySelectorAll('[data-toggle-password]').forEach((button) => button.addEventListener('click', () => {
  const input = document.getElementById(button.dataset.togglePassword);
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  button.textContent = showing ? 'Show' : 'Hide';
  button.setAttribute('aria-pressed', String(!showing));
}));

document.querySelectorAll('[data-auth-tab]').forEach(button => button.addEventListener('click', () => {
  setActiveTab(button.dataset.authTab);
  showAuthForm(`${button.dataset.authTab}-form`);
  statusEl.textContent = '';
  statusEl.className = 'auth-status';
}));

init();
