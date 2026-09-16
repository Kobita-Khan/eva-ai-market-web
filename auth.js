let evaClient;
const statusEl = document.getElementById('auth-status');
let pendingSignupEmail='';
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

function getSafeReturnTarget() {
  const queryTarget = new URLSearchParams(location.search).get('next');
  const storedTarget = sessionStorage.getItem('eva-return-to');
  const target = queryTarget || storedTarget || '';
  if (!target.startsWith('/') || target.startsWith('//')) return '';
  return target;
}

async function redirectAfterLogin(defaultTarget = '/dashboard.html') {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data } = await evaClient.auth.getSession();
    if (data.session?.access_token) {
      const target = getSafeReturnTarget() || defaultTarget;
      sessionStorage.removeItem('eva-return-to');
      location.replace(target);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Your sign-in could not be saved on this device. Please try again.');
}

async function init() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || 'Configuration unavailable');
    evaClient = window.supabase.createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const { data } = await evaClient.auth.getSession();
    if (data.session) await redirectAfterLogin();
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function sendSignupNotification(email){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await fetch('/api/store',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({action:'notify_signup',email}),signal:controller.signal,keepalive:true
    });
    const body=await response.json().catch(()=>({}));
    return response.ok&&body.telegram!==false;
  }catch(error){return false;}finally{clearTimeout(timer);}
}

async function finishLogin(email,password){
  const { error }=await evaClient.auth.signInWithPassword({email,password});
  if(error) throw error;
  await sendSignupNotification(email);
  await redirectAfterLogin();
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!evaClient) return;
  const email=document.getElementById('login-email').value.trim();
  const password=document.getElementById('login-password').value;
  showStatus('Signing in securely…');
  const { error }=await evaClient.auth.signInWithPassword({email,password});
  if(error) return showStatus(error.message,true);
  try { await redirectAfterLogin(); } catch (error) { showStatus(error.message, true); }
});

document.getElementById('signup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if(!evaClient) return showStatus('Signup service is not ready. Please refresh and try again.',true);
  const email=document.getElementById('signup-email').value.trim().toLowerCase();
  const password=document.getElementById('signup-password').value;
  if(password.length<8) return showStatus('Password must be at least 8 characters.',true);
  const button=event.currentTarget.querySelector('button[type="submit"]'); button.disabled=true;
  showStatus('Sending verification email…');
  try{
    const {data,error}=await evaClient.auth.signUp({email,password,options:{emailRedirectTo:`${location.origin}/login.html`}});
    if(error) throw error;
    pendingSignupEmail=email;
    sessionStorage.setItem('eva-pending-signup-email',email);
    sessionStorage.setItem('eva-pending-signup-password',password);
    if(data.session){ await sendSignupNotification(email); location.replace('/dashboard.html'); return; }
    document.getElementById('verify-email').textContent=email;
    showAuthForm('verify-form');
    showStatus('Verification email sent. Enter the 6-digit code from the email.');
  }catch(error){showStatus(error.message||'Could not send verification email.',true);button.disabled=false;}
});

document.getElementById('verify-form').addEventListener('submit',async(event)=>{
  event.preventDefault(); if(!evaClient)return;
  const email=pendingSignupEmail||sessionStorage.getItem('eva-pending-signup-email')||'';
  const password=sessionStorage.getItem('eva-pending-signup-password')||'';
  const token=document.getElementById('verify-code').value.replace(/\D/g,'').slice(0,6);
  if(token.length!==6)return showStatus('Enter the 6-digit verification code.',true);
  const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;
  showStatus('Verifying your email…');
  try{
    let result=await evaClient.auth.verifyOtp({email,token,type:'email'});
    if(result.error) result=await evaClient.auth.verifyOtp({email,token,type:'signup'});
    if(result.error)throw result.error;
    sessionStorage.removeItem('eva-pending-signup-email');sessionStorage.removeItem('eva-pending-signup-password');
    await sendSignupNotification(email);
    if(result.data.session){location.replace('/dashboard.html');return;}
    await finishLogin(email,password);
  }catch(error){showStatus(error.message||'Invalid or expired verification code.',true);button.disabled=false;}
});

document.getElementById('resend-code').addEventListener('click',async()=>{
  if(!evaClient)return;
  const email=pendingSignupEmail||sessionStorage.getItem('eva-pending-signup-email')||'';
  if(!email)return showStatus('Please start signup again.',true);
  showStatus('Sending a new verification email…');
  const {error}=await evaClient.auth.resend({type:'signup',email,options:{emailRedirectTo:`${location.origin}/login.html`}});
  if(error)return showStatus(error.message,true);
  showStatus('A new verification email was sent to your email.');
});

document.getElementById('forgot-password').addEventListener('click', async () => {
  if(!evaClient)return showStatus('Account service is still loading. Please try again.',true);
  const email=document.getElementById('login-email').value.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){document.getElementById('login-email').focus();return showStatus('Enter your account email first, then tap Forgot password.',true);}
  const button=document.getElementById('forgot-password');const original=button.textContent;button.disabled=true;button.textContent='Sending reset link…';
  showStatus('Sending a secure password reset email…');
  try{const redirectTo=`${location.origin}/reset-password.html`;const {error}=await evaClient.auth.resetPasswordForEmail(email,{redirectTo});if(error)throw error;showStatus('Password reset email sent. Open the link in your email to choose a new password.');}
  catch(error){showStatus(error.message||'Could not send the password reset email.',true);}finally{button.disabled=false;button.textContent=original;}
});

document.querySelectorAll('[data-toggle-password]').forEach((button)=>button.addEventListener('click',()=>{const input=document.getElementById(button.dataset.togglePassword);const showing=input.type==='text';input.type=showing?'password':'text';button.textContent=showing?'Show':'Hide';button.setAttribute('aria-pressed',String(!showing));}));
document.querySelectorAll('[data-auth-tab]').forEach(button=>button.addEventListener('click',()=>{setActiveTab(button.dataset.authTab);showAuthForm(`${button.dataset.authTab}-form`);statusEl.textContent='';statusEl.className='auth-status';}));
if(location.hash==='#signup'){setActiveTab('signup');showAuthForm('signup-form');}
init();