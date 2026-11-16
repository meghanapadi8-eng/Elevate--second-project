(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const TOKEN_KEY='elevate_auth_token';
  const USER_KEY='elevate_auth_user';
  const API_BASE=window.ELEVATE_API_BASE||'http://127.0.0.1:8000';
  const api=(path, options={})=>fetch(`${API_BASE}${path}`,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  window.ElevateAuth={
    url:path=>`${API_BASE}${path.startsWith('/')?path:`/${path}`}`,
    token:()=>localStorage.getItem(TOKEN_KEY),
    user:()=>{try{return JSON.parse(localStorage.getItem(USER_KEY)||'null')}catch{return null}},
    async request(path,options={}){const token=this.token(); return api(path,{...options,headers:{...(options.headers||{}),...(token?{Authorization:`Bearer ${token}`}:{})}})},
    setSession(data){localStorage.setItem(TOKEN_KEY,data.token);localStorage.setItem(USER_KEY,JSON.stringify(data.user));},
    clear(){localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(USER_KEY);},
    async logout(){const token=this.token();if(token){try{await api('/auth/logout',{method:'POST',headers:{Authorization:`Bearer ${token}`}})}catch{}}this.clear();location.href='index.html';},
    updateNav(){const user=this.user(); document.querySelectorAll('[data-auth-slot]').forEach(el=>{el.innerHTML=user?`<div class="dropdown"><button class="btn btn-outline-primary btn-sm dropdown-toggle" data-bs-toggle="dropdown"><i class="bi bi-person-circle"></i> ${escapeHtml(String(user.name).split(' ')[0])}</button><ul class="dropdown-menu dropdown-menu-end"><li><a class="dropdown-item" href="dashboard.html"><i class="bi bi-grid me-2"></i>Dashboard</a></li><li><a class="dropdown-item" href="profile.html"><i class="bi bi-person-vcard me-2"></i>Profile</a></li><li><a class="dropdown-item" href="copilot.html"><i class="bi bi-stars me-2"></i>AI Copilot</a></li><li><a class="dropdown-item" href="interview.html"><i class="bi bi-mic me-2"></i>Interview Prep</a></li><li><a class="dropdown-item" href="launch-center.html"><i class="bi bi-rocket-takeoff me-2"></i>Launch Center</a></li><li><button class="dropdown-item" data-auth-logout><i class="bi bi-box-arrow-right me-2"></i>Sign out</button></li></ul></div>`:`<a class="btn btn-outline-primary btn-sm" href="login.html"><i class="bi bi-person"></i> Sign in</a>`;}); document.querySelectorAll('[data-auth-logout]').forEach(b=>b.addEventListener('click',()=>this.logout()));}
  };
  document.addEventListener('DOMContentLoaded',()=>window.ElevateAuth.updateNav());
})();
