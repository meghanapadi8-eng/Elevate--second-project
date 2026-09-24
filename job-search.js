/* =====================================================================
   ELEVATE — JOB SEARCH (live listings + platform deep-links)
===================================================================== */
(() => {
  let jobs = [];
  let loadingJobs = false;
  let lastSearch = { what: "", where: "", type: "" };

  const grid = document.getElementById("jobGrid");
  const noResults = document.getElementById("noResults");
  const resultsCount = document.getElementById("resultsCount");
  const savedToggle = document.getElementById("savedToggle");
  const savedCount = document.getElementById("savedCount");
  const trackerToggle = document.getElementById("trackerToggle");
  const applicationCount = document.getElementById("applicationCount");
  let showingSaved = false;
  let showingApplications = false;
  let savedJobs = JSON.parse(localStorage.getItem("elevateSavedJobs") || "[]");
  let applications = JSON.parse(localStorage.getItem("elevateApplications") || "[]");
  let activeJob = null;
  let profile = null;

  function iconFor(type) {
    return type === "internship" ? "bi-mortarboard" : type === "part-time" ? "bi-clock" : "bi-briefcase";
  }

  function updateSavedCount() { savedCount.textContent = savedJobs.length; }
  function updateApplicationCount() { applicationCount.textContent = applications.length; }
  function applicationFor(job) { return applications.find(a => jobKey(a) === jobKey(job)); }
  function saveApplications() { localStorage.setItem("elevateApplications", JSON.stringify(applications)); updateApplicationCount(); }
  const signedIn = () => !!window.ElevateAuth?.token();
  async function api(path, options={}) { if(!signedIn()) return null; try { const r=await window.ElevateAuth.request(path, options); if(r.status===401){window.ElevateAuth.clear();return null;} const d=await r.json(); return r.ok?d:null; } catch(_) { return null; } }
  async function hydrateCloudData() {
    if(!signedIn()) return;
    const [jobsData, appsData] = await Promise.all([api('/jobs'), api('/applications')]);
    if(jobsData?.jobs) { savedJobs = jobsData.jobs.map(x=>x.data || {}).filter(Boolean); localStorage.setItem('elevateSavedJobs', JSON.stringify(savedJobs)); }
    if(appsData?.applications) { applications = appsData.applications.map(x=>({...(x.data||{}), status:(x.data||{}).status || 'Applied', jobKey:x.jobKey, serverId:x.id})); localStorage.setItem('elevateApplications', JSON.stringify(applications)); }
    updateSavedCount(); updateApplicationCount(); render(showingApplications?applications:(showingSaved?savedJobs:jobs));
  }

  function jobKey(job) { return `${job.title}|${job.company}`; }

  function getResumeForMatching() {
    try {
      const resume = JSON.parse(localStorage.getItem("elevate_resume_data") || "null");
      if (!resume) return null;
      if (profile) {
        resume.skills = [...new Set([...(resume.skills || []), ...(profile.skills || [])])];
        resume.jobTitle = resume.jobTitle || profile.preferences?.role || profile.headline || "";
        resume.summary = resume.summary || profile.bio || "";
      }
      return resume;
    } catch (_) { return null; }
  }

  function getJobMatch(job) {
    const resume = getResumeForMatching();
    if (!resume) return null;
    const haystack = [resume.jobTitle, resume.summary, ...(resume.skills || []), ...(resume.experience || []).map(x => `${x.role || ""} ${x.desc || ""}`), ...(resume.projects || []).map(x => `${x.name || ""} ${x.desc || ""}`)].join(" ").toLowerCase();
    const words = `${job.title} ${job.company} ${job.description || ""}`.toLowerCase().split(/[^a-z0-9+#.]+/).filter(w => w.length > 2);
    const unique = [...new Set(words)];
    const matched = unique.filter(w => haystack.includes(w));
    const roleWords = (resume.jobTitle || "").toLowerCase().split(/[^a-z0-9+#.]+/).filter(w => w.length > 2);
    const roleBoost = roleWords.some(w => job.title.toLowerCase().includes(w)) ? 20 : 0;
    const base = Math.round((matched.length / Math.max(unique.length, 1)) * 60) + roleBoost + Math.min((resume.skills || []).length * 2, 20);
    return Math.min(98, Math.max(45, base));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
  }

  function formatPosted(value) {
    if (!value) return "Date not listed";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
    if (days === 0) return "Today";
    if (days === 1) return "1 day ago";
    if (days < 30) return `${days} days ago`;
    return d.toLocaleDateString(undefined, {day:"numeric", month:"short", year:"numeric"});
  }

  function render(list) {
    grid.innerHTML = "";
    noResults.classList.toggle("hidden", list.length > 0);
    resultsCount.textContent = list.length
      ? `Showing ${list.length} ${showingSaved ? "saved" : "live"} opening${list.length > 1 ? "s" : ""}`
      : "No live jobs found";

    list.forEach(job => {
      const card = document.createElement("div");
      card.className = "job-card";
      const match = getJobMatch(job);
      card.innerHTML = `
        <div class="job-card-top">
          <div class="job-card-logo"><i class="bi ${iconFor(job.type)}"></i></div>
          <div class="d-flex align-items-center gap-2 flex-wrap justify-content-end"><span class="job-type-tag ${job.type === "internship" ? "internship" : ""}">${escapeHtml(job.type.replace("-", " "))}</span>${match ? `<span class="job-type-tag match-tag">${match}% match</span>` : ""}</div>
        </div>
        <h4>${escapeHtml(job.title)}</h4>
        <div class="job-card-company">${escapeHtml(job.company)}</div>
        <div class="job-card-meta">
          <span><i class="bi bi-geo-alt"></i> ${escapeHtml(job.location === "remote" ? "Remote" : cap(job.location))}</span>
          <span><i class="bi bi-clock-history"></i> ${escapeHtml(formatPosted(job.posted))}</span>
        </div>
        <div class="job-card-footer">
          <span class="job-card-salary">${escapeHtml(job.salary)}</span>
          <div class="job-actions"><button class="btn btn-outline-primary btn-sm details-btn">Details</button><button class="btn btn-primary btn-sm prepare-btn">Prepare <i class="bi bi-magic"></i></button><button class="icon-btn save-btn" title="Save job" aria-label="Save job"><i class="bi bi-bookmark"></i></button><button class="btn btn-primary btn-sm apply-btn">Apply <i class="bi bi-arrow-up-right"></i></button></div>
        </div>
      `;
      const saveBtn = card.querySelector(".save-btn");
      const isSaved = savedJobs.some(j => jobKey(j) === jobKey(job));
      saveBtn.classList.toggle("saved", isSaved);
      saveBtn.innerHTML = `<i class="bi ${isSaved ? "bi-bookmark-fill" : "bi-bookmark"}"></i>`;
      saveBtn.addEventListener("click", async () => {
        const idx = savedJobs.findIndex(j => jobKey(j) === jobKey(job));
        if (idx >= 0) { savedJobs.splice(idx, 1); showToast("Job removed from saved", "bi-bookmark"); }
        else { savedJobs.push(job); showToast("Job saved", "bi-bookmark-fill"); }
        localStorage.setItem("elevateSavedJobs", JSON.stringify(savedJobs));
        if(signedIn()) {
          if(idx >= 0) await api(`/jobs/${encodeURIComponent(jobKey(job))}`, {method:'DELETE'});
          else await api('/jobs', {method:'POST', body:JSON.stringify({jobKey:jobKey(job), data:job})});
        }
        updateSavedCount();
        if (showingSaved) render(savedJobs); else render(list);
      });

      card.querySelector(".details-btn").addEventListener("click", () => openJobDetails(job));
      card.querySelector(".prepare-btn").addEventListener("click", () => openApplicationWorkspace(job));
      card.querySelector(".apply-btn").addEventListener("click", () => {
        trackApplication(job, "Applied");
        showToast(`Application tracked for ${job.title}`, "bi-kanban");
        if (job.url) window.open(job.url, "_blank", "noopener"); else window.open(`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(job.title)}`, "_blank", "noopener");
      });
      const tracked = applicationFor(job);
      if (tracked) {
        const wrap = document.createElement("div"); wrap.className = "application-tracker-row";
        wrap.innerHTML = `<span class="application-status-badge">Tracked</span><select class="application-status-select" aria-label="Application status"><option>Applied</option><option>Interview</option><option>Offer</option><option>Rejected</option></select>`;
        wrap.querySelector("select").value = tracked.status;
        wrap.querySelector("select").addEventListener("change", async e => { tracked.status = e.target.value; tracked.updatedAt = Date.now(); saveApplications(); if(signedIn()) await api('/applications',{method:'POST',body:JSON.stringify({jobKey:jobKey(job),data:{...tracked,status:tracked.status}})}); showToast(`Application moved to ${tracked.status}`, "bi-kanban"); if (showingApplications) render(applications); });
        card.appendChild(wrap);
      }
      grid.appendChild(card);
    });
  }


  async function trackApplication(job, status = "Saved") {
    const existing = applicationFor(job);
    if (existing) existing.status = status;
    else applications.push({ ...job, status, appliedAt: Date.now() });
    saveApplications();
    if(signedIn()) await api('/applications',{method:'POST',body:JSON.stringify({jobKey:jobKey(job),data:{...job,status,appliedAt:existing?.appliedAt||Date.now()}})});
  }


  function getResumeData() {
    try { return JSON.parse(localStorage.getItem('elevate_resume_data') || 'null'); } catch (_) { return null; }
  }

  function showMatchAnalysis(analysis, job) {
    const modalBody = document.getElementById('jobModalBody');
    const score = Number(analysis.score || 0);
    const matched = Array.isArray(analysis.matched) ? analysis.matched : [];
    const missing = Array.isArray(analysis.missing) ? analysis.missing : [];
    const ai = analysis.ai || {};
    const strengths = Array.isArray(ai.strengths) ? ai.strengths : matched.slice(0, 6).map(x => `Matched keyword: ${x}`);
    const gaps = Array.isArray(ai.gaps) ? ai.gaps : missing.slice(0, 6).map(x => `Consider addressing: ${x}`);
    const recommendations = Array.isArray(analysis.recommendations) ? analysis.recommendations : [];
    modalBody.innerHTML = `
      <div class="match-analysis-head">
        <div><span class="eyebrow-small">RESUME MATCH</span><h4>${escapeHtml(job.title)}</h4><p>${escapeHtml(job.company)}</p></div>
        <div class="match-score-large">${score}<small>/100</small></div>
      </div>
      <div class="match-progress"><span style="width:${Math.max(0,Math.min(100,score))}%"></span></div>
      <div class="job-detail-grid"><div><small>Keyword coverage</small><strong>${Number(analysis.keywordCoverage || 0)}%</strong></div><div><small>Matched keywords</small><strong>${matched.length}</strong></div><div><small>Gaps found</small><strong>${missing.length}</strong></div></div>
      <div class="match-columns">
        <div><h5><i class="bi bi-check-circle"></i> Strengths</h5><ul>${(strengths.length ? strengths : ['Your resume has a useful starting point for this role.']).map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>
        <div><h5><i class="bi bi-exclamation-circle"></i> Gaps</h5><ul>${(gaps.length ? gaps : ['No major gaps were detected.']).map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>
      </div>
      <div class="match-recommendations"><h5>Recommended next steps</h5>${(recommendations.length ? recommendations : ['Review the job requirements and tailor your strongest evidence.']).map(x=>`<div><i class="bi bi-arrow-right-circle"></i>${escapeHtml(x)}</div>`).join('')}</div>`;
  }

  async function analyzeJob(job) {
    const resume = getResumeData();
    if (!resume) { showToast('Build a resume first to analyze your match', 'bi-file-earmark-person'); return; }
    if (!signedIn()) { showToast('Sign in to use AI job analysis', 'bi-person-lock'); return; }
    const body = document.getElementById('jobModalBody');
    body.innerHTML = `<div class="job-analysis-loading text-center py-4"><div class="spinner-border mb-3"></div><h5>Analyzing your resume…</h5><p>Comparing your experience and skills with this job.</p></div>`;
    try {
      const response = await window.ElevateAuth.request('/job-match', {method:'POST', body:JSON.stringify({resume, job, profile})});
      const data = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(data.error || 'Could not analyze this job.');
      showMatchAnalysis(data.analysis || {}, job);
    } catch (e) { body.innerHTML = `<div class="job-api-state"><i class="bi bi-exclamation-triangle"></i><h4>Analysis unavailable</h4><p>${escapeHtml(e.message)}</p></div>`; }
  }

  async function tailorResume(job) {
    const resume = getResumeData();
    if (!resume) { showToast('Build a resume first', 'bi-file-earmark-person'); return; }
    if (!signedIn()) { showToast('Sign in to tailor your resume', 'bi-person-lock'); return; }
    const button = document.getElementById('tailorJobBtn');
    if (button) { button.disabled = true; button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Tailoring…'; }
    try {
      const response = await window.ElevateAuth.request('/ai', {method:'POST', body:JSON.stringify({task:'tailor_resume', payload:{resume, job, jobDescription:job.description || ''}})});
      const data = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(data.error || 'Could not tailor your resume.');
      let tailored; try { tailored = JSON.parse(data.text); } catch (_) { throw new Error('The AI returned an invalid tailored resume. Please try again.'); }
      const cloned = {...resume, ...tailored, id:'resume_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7), serverId:undefined, targetJobDescription:job.description || resume.targetJobDescription || '', fullName:resume.fullName || '', template:resume.template || 'classic'};
      const name = `${job.title} — ${job.company}`.slice(0,120);
      if (signedIn()) {
        const saveResponse = await window.ElevateAuth.request('/resumes', {method:'POST', body:JSON.stringify({name, data:cloned})});
        const saved = await saveResponse.json().catch(()=>({}));
        if (!saveResponse.ok) throw new Error(saved.error || 'Could not save tailored resume.');
        cloned.serverId = saved.id;
      }
      localStorage.setItem('elevate_resume_data', JSON.stringify(cloned));
      const saved = JSON.parse(localStorage.getItem('elevate_saved_resumes') || '[]');
      saved.unshift(cloned); localStorage.setItem('elevate_saved_resumes', JSON.stringify(saved.slice(0,12)));
      showToast('Tailored resume created', 'bi-magic');
      setTimeout(()=>location.href='resume-builder.html', 350);
    } catch(e) { showToast(e.message || 'Could not tailor your resume', 'bi-exclamation-triangle'); }
    finally { if (button) { button.disabled=false; button.innerHTML='<i class="bi bi-magic"></i> Tailor my resume'; } }
  }

  function openApplicationWorkspace(job) {
    const enriched = {...job, match:getJobMatch(job)};
    localStorage.setItem("elevateActiveJob", JSON.stringify(enriched));
    window.location.href = "application-workspace.html";
  }

  function openJobDetails(job) {
    activeJob = job;
    const modal = document.getElementById("jobDetailsModal");
    document.getElementById("jobModalTitle").textContent = job.title;
    const description = escapeHtml(job.description || "No description was provided by the job source.");
    const sourceLink = job.url ? `<a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="${escapeHtml(job.url)}">View full listing <i class="bi bi-box-arrow-up-right"></i></a>` : "";
    document.getElementById("jobModalBody").innerHTML = `
      <div class="job-detail-head"><strong>${escapeHtml(job.company)}</strong><span>${escapeHtml(cap(job.location))} · ${escapeHtml((job.type || "other").replace("-", " "))}</span></div>
      <div class="job-detail-grid"><div><small>Compensation</small><strong>${escapeHtml(job.salary || "Not listed")}</strong></div><div><small>Posted</small><strong>${escapeHtml(formatPosted(job.posted))}</strong></div><div><small>Match</small><strong>${getJobMatch(job) ? getJobMatch(job)+"%" : "Build a resume"}</strong></div></div>
      <div class="job-detail-copy"><h5>Job description</h5><p>${description}</p></div>
      <div class="job-detail-actions">${sourceLink}<button class="btn btn-outline-primary btn-sm" id="analyzeJobBtn"><i class="bi bi-stars"></i> Analyze with my resume</button><button class="btn btn-primary btn-sm" id="prepareJobBtn"><i class="bi bi-magic"></i> Prepare application</button><button class="btn btn-primary btn-sm" id="tailorJobBtn"><i class="bi bi-magic"></i> Tailor my resume</button></div>`;
    document.getElementById('analyzeJobBtn')?.addEventListener('click', () => analyzeJob(job));
    document.getElementById('prepareJobBtn')?.addEventListener('click', () => openApplicationWorkspace(job));
    document.getElementById('tailorJobBtn')?.addEventListener('click', () => tailorResume(job));
    if (window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).show();
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  async function loadJobs() {
    const kw = document.getElementById("jobKeyword").value.trim();
    const loc = document.getElementById("jobLocation").value;
    const type = document.getElementById("jobType").value;
    lastSearch = { what: kw, where: loc, type };
    if (showingSaved || showingApplications) { render(showingApplications ? applications : savedJobs); return; }
    loadingJobs = true;
    grid.innerHTML = `<div class="job-loading-state"><div class="spinner-border" role="status" aria-label="Loading"></div><p>Finding live opportunities…</p></div>`;
    noResults.classList.add("hidden");
    try {
      const qs = new URLSearchParams({what: kw, where: loc, type, page: "1", limit: "20"});
      const response = await fetch(`api/index.php/job-search?${qs.toString()}`, {headers:{Accept:"application/json"}});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load live jobs.");
      jobs = Array.isArray(data.jobs) ? data.jobs : [];
      render(jobs);
      resultsCount.textContent = jobs.length ? `Showing ${jobs.length} live opening${jobs.length > 1 ? "s" : ""}` : "No live jobs found";
    } catch (error) {
      jobs = [];
      grid.innerHTML = `<div class="job-api-state"><i class="bi bi-cloud-slash"></i><h4>Live job search isn't configured yet</h4><p>${escapeHtml(error.message)}</p><small>Once the job provider credentials are configured on the PHP server, live listings will appear here.</small></div>`;
      resultsCount.textContent = "Live job search unavailable";
      noResults.classList.add("hidden");
    } finally { loadingJobs = false; updatePlatformLinks(kw.toLowerCase(), loc); }
  }

  function applyFilters() {
    if (showingSaved || showingApplications) { render(showingApplications ? applications : savedJobs); return; }
    loadJobs();
  }

  function updatePlatformLinks(kw, loc) {
    const q = kw || "jobs for freshers";
    const l = loc && loc !== "remote" ? loc : "";
    document.getElementById("linkLinkedIn").href = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(q)}${l ? `&location=${encodeURIComponent(l)}` : ""}`;
    document.getElementById("linkIndeed").href = `https://in.indeed.com/jobs?q=${encodeURIComponent(q)}${l ? `&l=${encodeURIComponent(l)}` : ""}`;
    document.getElementById("linkNaukri").href = `https://www.naukri.com/${encodeURIComponent(q.replace(/\s+/g,'-'))}-jobs${l ? `-in-${encodeURIComponent(l.replace(/\s+/g,'-'))}` : ""}`;
    document.getElementById("linkGlassdoor").href = `https://www.glassdoor.co.in/Job/jobs.htm?sc.keyword=${encodeURIComponent(q)}`;
  }

  document.getElementById("searchBtn").addEventListener("click", applyFilters);
  document.getElementById("clearFiltersBtn").addEventListener("click", () => {
    document.getElementById("jobKeyword").value = "";
    document.getElementById("jobLocation").value = "";
    document.getElementById("jobType").value = "";
    showingSaved = false;
    showingApplications = false;
    savedToggle.classList.remove("active");
    trackerToggle.classList.remove("active");
    applyFilters();
  });
  savedToggle.addEventListener("click", () => {
    showingSaved = !showingSaved; showingApplications = false;
    savedToggle.classList.toggle("active", showingSaved); trackerToggle.classList.remove("active");
    render(showingSaved ? savedJobs : jobs);
  });
  trackerToggle.addEventListener("click", () => {
    showingApplications = !showingApplications; showingSaved = false;
    trackerToggle.classList.toggle("active", showingApplications); savedToggle.classList.remove("active");
    render(showingApplications ? applications : jobs);
  });
  document.getElementById('analyzeFromModal')?.addEventListener('click', () => { if (activeJob) analyzeJob(activeJob); });
  document.getElementById("trackFromModal")?.addEventListener("click", () => {
    if (!activeJob) return;
    trackApplication(activeJob, "Applied");
    showToast("Application added to your tracker", "bi-kanban");
    if (window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(document.getElementById("jobDetailsModal")).hide();
  });
  document.getElementById("jobKeyword").addEventListener("keydown", (e) => { if (e.key === "Enter") applyFilters(); });
  document.getElementById("jobLocation").addEventListener("change", applyFilters);
  document.getElementById("jobType").addEventListener("change", applyFilters);

  const params = new URLSearchParams(location.search);
  const role = params.get("role");
  if (role) document.getElementById("jobKeyword").value = role;
  async function hydrateProfile() {
    if (!signedIn()) return;
    try {
      const d = await api('/profile');
      profile = d?.profile || null;
      const targetRole = profile?.preferences?.role || profile?.headline || "";
      if (!role && targetRole && !document.getElementById("jobKeyword").value.trim()) document.getElementById("jobKeyword").value = targetRole;
    } catch (_) {}
  }
  updateSavedCount(); updateApplicationCount();
  if (role) document.getElementById("jobKeyword").value = role;
  hydrateProfile().finally(() => { hydrateCloudData(); loadJobs(); });
  updatePlatformLinks(role || "", "");
})();
