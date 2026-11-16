(() => {
  let mode = 'login';
  const $=id=>document.getElementById(id), form=$('authForm'), alert=$('authAlert');
  const setAlert=(msg,type='danger')=>{alert.className=`alert alert-${type}`;alert.textContent=msg;alert.classList.remove('d-none');};
  const clearAlert=()=>alert.classList.add('d-none');
  const setMode=(nextMode)=>{
    mode = nextMode;
    const isSignup = nextMode === 'signup';
    const isForgot = nextMode === 'forgot';
    $('nameField').classList.toggle('d-none', !isSignup);
    $('passwordField').classList.toggle('d-none', isForgot);
    $('forgotPasswordBtn').classList.toggle('d-none', isForgot);
    $('formTitle').textContent = isForgot ? 'Reset your password' : (isSignup ? 'Create your Elevate account' : 'Welcome back');
    $('formSubtitle').textContent = isForgot ? 'Enter your email to receive a reset link.' : (isSignup ? 'Save your career workspace across sessions.' : 'Sign in to keep your career workspace synced.');
    $('submitBtn').innerHTML = isForgot ? '<i class="bi bi-envelope-arrow-up me-1"></i> Send reset link' : (isSignup ? '<i class="bi bi-person-plus me-1"></i> Create account' : '<i class="bi bi-box-arrow-in-right me-1"></i> Sign in');
    $('switchText').textContent = isForgot ? 'Remembered your password?' : (isSignup ? 'Already have an account?' : 'New to Elevate?');
    $('switchMode').textContent = isForgot ? 'Back to sign in' : (isSignup ? 'Sign in' : 'Create an account');
    if (isForgot) {
      $('password').removeAttribute('required');
      $('password').value = '';
    } else {
      $('password').setAttribute('required', 'required');
      if (!isSignup) $('name').value = '';
    }
    clearAlert();
  };

  $('switchMode').addEventListener('click',()=>{
    const nextMode = mode === 'signup' ? 'login' : (mode === 'forgot' ? 'login' : 'signup');
    setMode(nextMode);
  });

  $('forgotPasswordBtn').addEventListener('click',()=>setMode('forgot'));

  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const emailValue = $('email').value.trim();
    const passwordValue = $('password').value;

    if (mode === 'forgot') {
      if (!emailValue || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
        setAlert('Please enter a valid email address.', 'danger');
        return;
      }
    } else {
      if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return;
      }
    }

    const btn=$('submitBtn');
    btn.disabled=true;
    btn.innerHTML='<span class="spinner-border spinner-border-sm me-2"></span> Please wait';

    try {
      const endpoint = mode === 'signup' ? '/auth/register' : (mode === 'forgot' ? '/auth/forgot-password' : '/auth/login');
      const payload = { email: emailValue };
      if (mode !== 'forgot') {
        payload.password = passwordValue;
        if (mode === 'signup') payload.name = $('name').value.trim();
      }

      const r = await fetch(ElevateAuth.url(endpoint), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const raw = await r.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error('The Python API returned an invalid response. Make sure the Elevate backend is running.'); }

      if (!r.ok) {
        const msg = data.error || `Server error (${r.status})`;
        if (msg.toLowerCase().includes('too many requests')) {
          throw new Error('Too many requests. Please wait a moment and try again.');
        }
        throw new Error(msg);
      }

      if (mode === 'forgot') {
        setMode('login');
        setAlert(data.message || 'If that email belongs to an account, reset instructions will arrive shortly.', 'success');
        $('email').value = emailValue;
        return;
      }

      if (!data.token || !data.user) throw new Error('The account service returned an incomplete response. Check that the Python API is running.');
      ElevateAuth.setSession(data);
      location.href='dashboard.html';
    } catch (err) {
      let msg = err.message || 'Unable to connect to the account service.';
      if (err instanceof TypeError && /fetch/i.test(err.message)) {
        if (location.protocol === 'file:') {
          msg = 'This page was opened directly from a file. Serve the website through XAMPP/Apache or another local web server.';
        } else if (location.port && location.port !== '80' && location.port !== '443') {
          msg = `Could not connect to the Python API at ${ElevateAuth.url('/health')}. Start the backend with the documented Uvicorn command.`;
        } else {
          msg = 'Cannot reach the Elevate Python backend. Start it with the documented Uvicorn command and retry.';
        }
      }
      setAlert(msg, 'danger');
    } finally {
      btn.disabled=false;
      btn.innerHTML = mode === 'forgot' ? '<i class="bi bi-envelope-arrow-up me-1"></i> Send reset link' : (mode === 'signup' ? '<i class="bi bi-person-plus me-1"></i> Create account' : '<i class="bi bi-box-arrow-in-right me-1"></i> Sign in');
    }
  });

  setMode('login');
})();
