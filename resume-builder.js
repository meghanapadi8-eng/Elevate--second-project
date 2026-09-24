/* =====================================================================
   ELEVATE — RESUME BUILDER
   Professional editor: templates, live preview, ATS scoring, local AI
   assistance, multiple resumes, import/export and PDF generation.
===================================================================== */
(() => {
  const STORAGE_KEY = "elevate_resume_data";
  const RESUMES_KEY = "elevate_saved_resumes";
  const MAX_SAVED_RESUMES = 12;

  const blankExperience = () => ({ role: "", company: "", start: "", end: "", desc: "" });
  const blankEducation = () => ({ degree: "", school: "", start: "", end: "" });
  const blankProject = () => ({ name: "", link: "", desc: "" });

  const defaultState = () => ({
    id: createId(),
    fullName: "", jobTitle: "", email: "", phone: "", location: "",
    linkedin: "", website: "", summary: "",
    experience: [blankExperience()],
    education: [blankEducation()],
    skills: [],
    projects: [blankProject()],
    template: "classic",
    targetJobDescription: "",
    sectionOrder: ["summary", "experience", "education", "skills", "projects"],
    sectionVisibility: { summary: true, experience: true, education: true, skills: true, projects: true }
  });

  let state = loadCurrent();
  let activeTab = "personal";
  let score = 0;
  let syncTimer = null;
  const isSignedIn = () => !!window.ElevateAuth?.token();
  async function apiJSON(path, options={}) {
    if (!isSignedIn()) return null;
    try {
      const r=await window.ElevateAuth.request(path, options);
      if(r.status===401){window.ElevateAuth.clear();return null;}
      const d=await r.json(); return r.ok ? d : null;
    } catch(_) { return null; }
  }
  function queueServerSave() {
    if(!isSignedIn()) return;
    clearTimeout(syncTimer);
    syncTimer=setTimeout(async()=>{
      const payload={name:state.fullName || 'Untitled Resume', data:state};
      if(state.serverId) {
        await apiJSON(`/resumes/${encodeURIComponent(state.serverId)}`,{method:'PUT',body:JSON.stringify(payload)});
      } else {
        const d=await apiJSON('/resumes',{method:'POST',body:JSON.stringify(payload)});
        if(d?.id){state.serverId=d.id;localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
      }
    },700);
  }
  async function hydrateResumesFromServer() {
    if(!isSignedIn()) return;
    const d=await apiJSON('/resumes');
    if(!d?.resumes) return;
    const normalized=d.resumes.map(r=>normalizeState({...r.data,serverId:r.id,id:r.data?.id||createId()}));
    setSavedResumes(normalized);
    const serverCurrent=normalized.find(r=>String(r.serverId)===String(state.serverId));
    if(!serverCurrent && state.fullName){
      const match=normalized.find(r=>r.fullName===state.fullName && r.jobTitle===state.jobTitle);
      if(match){state=match;localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
    }
    renderResumeManager();renderPreview();updateScore();updateProgress();
  }

  function createId() {
    return "resume_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normalizeState(data) {
    const base = defaultState();
    return {
      ...base,
      ...data,
      id: data?.id || base.id,
      experience: Array.isArray(data?.experience) ? data.experience.map(e => ({ ...blankExperience(), ...e })) : base.experience,
      education: Array.isArray(data?.education) ? data.education.map(e => ({ ...blankEducation(), ...e })) : base.education,
      projects: Array.isArray(data?.projects) ? data.projects.map(p => ({ ...blankProject(), ...p })) : base.projects,
      skills: Array.isArray(data?.skills) ? data.skills.filter(Boolean) : [],
      template: ["classic", "modern", "minimal", "executive"].includes(data?.template) ? data.template : "classic",
      targetJobDescription: typeof data?.targetJobDescription === "string" ? data.targetJobDescription : "",
      sectionOrder: (() => {
        const allowed = ["summary", "experience", "education", "skills", "projects"];
        const incoming = Array.isArray(data?.sectionOrder) ? data.sectionOrder.filter(x => allowed.includes(x)) : [];
        return [...incoming, ...allowed.filter(x => !incoming.includes(x))];
      })(),
      sectionVisibility: { ...base.sectionVisibility, ...(data?.sectionVisibility || {}) }
    };
  }

  function loadCurrent() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalizeState(JSON.parse(raw)) : defaultState();
    } catch (_) { return defaultState(); }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    queueServerSave();
    const note = document.getElementById("autosaveNote");
    if (note) {
      note.textContent = "Saved just now";
      clearTimeout(note._t);
      note._t = setTimeout(() => note.textContent = "All changes saved automatically", 1800);
    }
    updateScore();
    updateProgress();
  }

  function getSavedResumes() {
    try {
      const data = JSON.parse(localStorage.getItem(RESUMES_KEY) || "[]");
      return Array.isArray(data) ? data.map(normalizeState) : [];
    } catch (_) { return []; }
  }

  function setSavedResumes(resumes) {
    localStorage.setItem(RESUMES_KEY, JSON.stringify(resumes.slice(0, MAX_SAVED_RESUMES)));
  }

  async function saveNamedResume() {
    const resumes = getSavedResumes().filter(r => r.id !== state.id);
    const copy = normalizeState({ ...state, id: state.id || createId() });
    if(isSignedIn()) {
      const d=await apiJSON('/resumes',{method:'POST',body:JSON.stringify({name:copy.fullName||'Untitled Resume',data:copy})});
      if(d?.id) copy.serverId=d.id;
    }
    resumes.unshift(copy); setSavedResumes(resumes);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(copy)); state=copy;
    renderResumeManager(); showToast(`“${copy.fullName || "Untitled resume"}” saved`, "bi-check-circle");
  }

  function newResume() {
    if (!confirm("Start a new resume? Your current resume will remain available if you saved it.")) return;
    state = defaultState();
    activeTab = "personal";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    initAll();
    showToast("New resume created", "bi-file-earmark-plus");
  }

  async function loadResume(id) {
    const found = getSavedResumes().find(r => r.id === id);
    if (!found) return;
    if(isSignedIn() && found.serverId){
      const d=await apiJSON(`/resumes/${encodeURIComponent(found.serverId)}`,{method:'GET'});
      if(d?.resume) Object.assign(found,normalizeState({...d.resume.data,serverId:d.resume.id,id:d.resume.data?.id||found.id}));
    }
    state = normalizeState(found);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    initAll();
    closeModal("resumeManagerModal");
    showToast("Resume loaded", "bi-folder2-open");
  }

  async function deleteSavedResume(id) {
    const resumes = getSavedResumes();
    const target = resumes.find(r => r.id === id);
    if (!target) return;
    if (isSignedIn() && target.serverId) await apiJSON(`/resumes/${encodeURIComponent(target.serverId)}`, {method:'DELETE'});
    setSavedResumes(resumes.filter(r => r.id !== id));
    renderResumeManager();
    showToast("Resume removed from your library", "bi-trash3");
  }

  async function duplicateSavedResume(id) {
    const resumes = getSavedResumes();
    const source = resumes.find(r => r.id === id);
    if (!source) return;
    const copy = normalizeState({ ...source, id: createId(), serverId: undefined, fullName: source.fullName ? `${source.fullName} — Copy` : "Untitled resume — Copy" });
    if (isSignedIn()) {
      const d = await apiJSON('/resumes', {method:'POST', body:JSON.stringify({name:copy.fullName || 'Untitled Resume', data:copy})});
      if (d?.id) copy.serverId = d.id;
    }
    resumes.unshift(copy);
    setSavedResumes(resumes);
    renderResumeManager();
    showToast("Resume duplicated", "bi-copy");
  }

  async function renameSavedResume(id) {
    const resumes = getSavedResumes();
    const resume = resumes.find(r => r.id === id);
    if (!resume) return;
    const nextName = prompt("Give this resume a name", resume.fullName || "Untitled resume");
    if (nextName === null) return;
    const cleanName = nextName.trim();
    if (!cleanName) { showToast("Resume name cannot be empty", "bi-exclamation-circle"); return; }
    resume.fullName = cleanName;
    if (isSignedIn() && resume.serverId) await apiJSON(`/resumes/${encodeURIComponent(resume.serverId)}`, {method:'PUT', body:JSON.stringify({name:cleanName, data:resume})});
    setSavedResumes(resumes);
    renderResumeManager();
    showToast("Resume renamed", "bi-pencil");
  }

  /* ---------------- Field bindings ---------------- */
  const simpleFields = ["fullName", "jobTitle", "email", "phone", "location", "linkedin", "website", "summary"];

  async function syncProfileIntoResume(force = false) {
    if (!isSignedIn()) { showToast("Sign in to sync your Elevate profile", "bi-person-lock"); return; }
    const btn = document.getElementById("syncProfileBtn");
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Syncing'; }
    try {
      const d = await apiJSON('/profile');
      if (!d?.profile) throw new Error("Could not load your profile.");
      const p = d.profile;
      const pref = p.preferences || {};
      const map = { fullName: window.ElevateAuth.user()?.name || "", email: window.ElevateAuth.user()?.email || "", phone: p.phone || "", location: p.location || "", linkedin: p.linkedin || "", website: p.website || "", jobTitle: pref.role || p.headline || "", summary: p.bio || "" };
      let changed = 0;
      Object.entries(map).forEach(([key, value]) => {
        if (!value) return;
        if (force || !String(state[key] || '').trim()) { state[key] = value; changed++; }
      });
      if ((force || !state.skills.length) && Array.isArray(p.skills) && p.skills.length) { state.skills = [...new Set(p.skills.map(String).map(x=>x.trim()).filter(Boolean))].slice(0,30); changed++; }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      bindSimpleFields(); renderSkills(); renderPreview(); updateScore(); updateProgress(); save();
      showToast(changed ? `Profile synced — ${changed} field${changed===1?'':'s'} updated` : "Your resume already has the profile details", "bi-person-check");
    } catch (e) { showToast(e.message || "Profile sync failed", "bi-exclamation-triangle"); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-person-check"></i> Sync profile'; } }
  }

  function bindProfileSync() {
    const btn = document.getElementById("syncProfileBtn");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => syncProfileIntoResume(true));
    if (isSignedIn()) syncProfileIntoResume(false);
  }

  function bindTargetJobDescription() {
    const el = document.getElementById("targetJobDescription");
    if (!el) return;
    el.value = state.targetJobDescription || "";
    if (el.dataset.bound) return;
    el.dataset.bound = "1";
    el.addEventListener("input", () => {
      state.targetJobDescription = el.value;
      updateScore();
      save();
    });
  }

  function bindSimpleFields() {
    simpleFields.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = state[id] || "";
      if (el.dataset.bound) { updateFieldMeta(el); return; }
      el.dataset.bound = "1";
      el.addEventListener("input", () => {
        state[id] = el.value;
        renderPreview();
        save();
        updateFieldMeta(el);
      });
      updateFieldMeta(el);
    });
  }

  function updateFieldMeta(el) {
    const counter = document.querySelector(`[data-counter-for="${el.id}"]`);
    if (counter) counter.textContent = `${el.value.length}/${el.maxLength || 500}`;
  }

  /* ---------------- Tabs + progress ---------------- */
  function bindTabs() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => activateTab(btn.dataset.tab));
    });
  }

  function activateTab(tab) {
    activeTab = tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".tab-pane").forEach(p => p.classList.toggle("active", p.dataset.pane === tab));
    const pane = document.querySelector(`.tab-pane[data-pane="${tab}"]`);
    if (pane) pane.scrollIntoView({ block: "nearest" });
  }

  /* ---------------- Dynamic lists ---------------- */
  function renderExperience() {
    const wrap = document.getElementById("experienceList");
    if (!wrap) return;
    wrap.innerHTML = "";
    state.experience.forEach((exp, i) => {
      const item = document.createElement("div");
      item.className = "dynamic-item";
      item.innerHTML = `
        <div class="item-heading"><span class="item-number">${i + 1}</span><strong>Experience ${i + 1}</strong><button type="button" class="remove-item" data-i="${i}" aria-label="Remove experience"><i class="bi bi-x-lg"></i></button></div>
        <div class="row-2">
          <div class="field"><label>Role / Title</label><input class="input" data-f="role" data-i="${i}" value="${esc(exp.role)}" placeholder="e.g. Frontend Developer"></div>
          <div class="field"><label>Company</label><input class="input" data-f="company" data-i="${i}" value="${esc(exp.company)}" placeholder="e.g. Acme Corp"></div>
        </div>
        <div class="row-2">
          <div class="field"><label>Start Date</label><input class="input" data-f="start" data-i="${i}" value="${esc(exp.start)}" placeholder="Jan 2024"></div>
          <div class="field"><label>End Date</label><input class="input" data-f="end" data-i="${i}" value="${esc(exp.end)}" placeholder="Present"></div>
        </div>
        <div class="field"><div class="label-row"><label>Description & achievements</label><button type="button" class="mini-ai" data-ai-exp="${i}"><i class="bi bi-stars"></i> Improve bullets</button></div><textarea class="input" rows="4" data-f="desc" data-i="${i}" placeholder="One achievement per line. Example: Increased conversions by 24% by redesigning the checkout flow.">${esc(exp.desc)}</textarea></div>`;
      wrap.appendChild(item);
    });
    bindDynamicFields(wrap, state.experience, renderExperience);
    wrap.querySelectorAll("[data-ai-exp]").forEach(btn => btn.addEventListener("click", () => improveExperience(+btn.dataset.aiExp)));
  }

  function renderEducation() {
    const wrap = document.getElementById("educationList");
    if (!wrap) return;
    wrap.innerHTML = "";
    state.education.forEach((ed, i) => {
      const item = document.createElement("div");
      item.className = "dynamic-item";
      item.innerHTML = `
        <div class="item-heading"><span class="item-number">${i + 1}</span><strong>Education ${i + 1}</strong><button type="button" class="remove-item" data-i="${i}" aria-label="Remove education"><i class="bi bi-x-lg"></i></button></div>
        <div class="row-2">
          <div class="field"><label>Degree / Course</label><input class="input" data-f="degree" data-i="${i}" value="${esc(ed.degree)}" placeholder="e.g. B.Tech Computer Science"></div>
          <div class="field"><label>School / University</label><input class="input" data-f="school" data-i="${i}" value="${esc(ed.school)}" placeholder="e.g. Delhi University"></div>
        </div>
        <div class="row-2">
          <div class="field"><label>Start Year</label><input class="input" data-f="start" data-i="${i}" value="${esc(ed.start)}" placeholder="2021"></div>
          <div class="field"><label>End Year</label><input class="input" data-f="end" data-i="${i}" value="${esc(ed.end)}" placeholder="2025"></div>
        </div>`;
      wrap.appendChild(item);
    });
    bindDynamicFields(wrap, state.education, renderEducation);
  }

  function renderProjects() {
    const wrap = document.getElementById("projectList");
    if (!wrap) return;
    wrap.innerHTML = "";
    state.projects.forEach((p, i) => {
      const item = document.createElement("div");
      item.className = "dynamic-item";
      item.innerHTML = `
        <div class="item-heading"><span class="item-number">${i + 1}</span><strong>Project ${i + 1}</strong><button type="button" class="remove-item" data-i="${i}" aria-label="Remove project"><i class="bi bi-x-lg"></i></button></div>
        <div class="row-2">
          <div class="field"><label>Project Name</label><input class="input" data-f="name" data-i="${i}" value="${esc(p.name)}" placeholder="e.g. Portfolio Website"></div>
          <div class="field"><label>Link (optional)</label><input class="input" data-f="link" data-i="${i}" value="${esc(p.link)}" placeholder="github.com/you/project"></div>
        </div>
        <div class="field"><div class="label-row"><label>Description</label><button type="button" class="mini-ai" data-ai-project="${i}"><i class="bi bi-stars"></i> Improve description</button></div><textarea class="input" rows="3" data-f="desc" data-i="${i}" placeholder="What it does, your contribution and technologies used.">${esc(p.desc)}</textarea></div>`;
      wrap.appendChild(item);
    });
    bindDynamicFields(wrap, state.projects, renderProjects);
    wrap.querySelectorAll("[data-ai-project]").forEach(btn => btn.addEventListener("click", () => improveProject(+btn.dataset.aiProject)));
  }

  function bindDynamicFields(wrap, collection, rerender) {
    wrap.querySelectorAll("[data-f]").forEach(el => {
      el.addEventListener("input", () => {
        collection[+el.dataset.i][el.dataset.f] = el.value;
        renderPreview(); save();
      });
    });
    wrap.querySelectorAll(".remove-item").forEach(btn => {
      btn.addEventListener("click", () => {
        collection.splice(+btn.dataset.i, 1);
        if (!collection.length) collection.push(collection === state.experience ? blankExperience() : collection === state.education ? blankEducation() : blankProject());
        rerender(); renderPreview(); save();
      });
    });
  }

  function bindAddButtons() {
    const add = (id, item, render) => {
      const btn = document.getElementById(id);
      if (!btn || btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => { item(); render(); renderPreview(); save(); });
    };
    add("addExperience", () => state.experience.push(blankExperience()), renderExperience);
    add("addEducation", () => state.education.push(blankEducation()), renderEducation);
    add("addProject", () => state.projects.push(blankProject()), renderProjects);
  }

  /* ---------------- Skills ---------------- */
  function renderSkillChips() {
    const wrap = document.getElementById("skillChips");
    if (!wrap) return;
    wrap.innerHTML = state.skills.map((s, i) => `<span class="skill-chip">${esc(s)} <button type="button" data-i="${i}" aria-label="Remove ${esc(s)}"><i class="bi bi-x"></i></button></span>`).join("");
    wrap.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
      state.skills.splice(+btn.dataset.i, 1); renderSkillChips(); renderPreview(); save();
    }));
  }

  function bindSkills() {
    const input = document.getElementById("skillInput");
    const addBtn = document.getElementById("addSkillBtn");
    if (!input || input.dataset.bound) return;
    input.dataset.bound = "1";
    const commit = () => {
      const val = input.value.trim().replace(/\s+/g, " ");
      if (val && !state.skills.some(s => s.toLowerCase() === val.toLowerCase())) {
        state.skills.push(val); renderSkillChips(); renderPreview(); save();
      }
      input.value = "";
    };
    addBtn.addEventListener("click", commit);
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); commit(); } });
  }

  function bindQuickSkills() {
    document.querySelectorAll("[data-skill]").forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        const skill = btn.dataset.skill;
        if (skill && !state.skills.some(s => s.toLowerCase() === skill.toLowerCase())) {
          state.skills.push(skill);
          renderSkillChips(); renderPreview(); save();
        }
      });
    });
  }

  /* ---------------- Templates ---------------- */
  function bindTemplateSwitch() {
    document.querySelectorAll(".tpl-btn").forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => setTemplate(btn.dataset.tpl));
    });
  }

  function setTemplate(template) {
    state.template = template;
    document.getElementById("resumePaper").className = "resume-paper " + template;
    document.querySelectorAll(".tpl-btn").forEach(b => b.classList.toggle("active", b.dataset.tpl === template));
    save();
  }

  /* ---------------- Preview ---------------- */
  function esc(str) {
    return String(str || "").replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));
  }

  function linkify(value) {
    const clean = String(value || "").trim();
    if (!clean) return "";
    return `<a href="${esc(/^https?:\/\//i.test(clean) ? clean : "https://" + clean)}" target="_blank" rel="noopener">${esc(clean.replace(/^https?:\/\//i, ""))}</a>`;
  }

  function bulletText(text) {
    return esc(text).split(/\n+/).filter(Boolean).map(line => `<li>${line.replace(/^[-•*]\s*/, "")}</li>`).join("");
  }

  function renderPreview() {
    const el = document.getElementById("resumePreview");
    if (!el) return;
    const hasContent = state.fullName || state.jobTitle || state.summary || state.experience.some(e => e.role || e.company || e.desc) || state.education.some(e => e.degree || e.school) || state.skills.length || state.projects.some(p => p.name);
    if (!hasContent) {
      el.innerHTML = `<div class="rz-empty"><i class="bi bi-file-earmark-text"></i><strong>Your resume preview</strong><span>Start filling the form and your professional resume will appear here.</span></div>`;
      return;
    }

    const contactBits = [
      state.email && `<span><i class="bi bi-envelope"></i>${esc(state.email)}</span>`,
      state.phone && `<span><i class="bi bi-telephone"></i>${esc(state.phone)}</span>`,
      state.location && `<span><i class="bi bi-geo-alt"></i>${esc(state.location)}</span>`,
      state.linkedin && `<span><i class="bi bi-linkedin"></i>${linkify(state.linkedin)}</span>`,
      state.website && `<span><i class="bi bi-globe2"></i>${linkify(state.website)}</span>`
    ].filter(Boolean).join("");

    const experienceHtml = state.experience.filter(e => e.role || e.company || e.desc).map(e => `
      <div class="rz-entry"><div class="rz-entry-top"><div><strong>${esc(e.role) || "Role"}</strong><div class="rz-entry-sub">${esc(e.company)}</div></div><div class="rz-entry-date">${esc(e.start)} ${e.start || e.end ? "–" : ""} ${esc(e.end)}</div></div>
      ${e.desc ? `<ul class="rz-bullets">${bulletText(e.desc)}</ul>` : ""}</div>`).join("");

    const educationHtml = state.education.filter(e => e.degree || e.school).map(e => `<div class="rz-entry"><div class="rz-entry-top"><div><strong>${esc(e.degree) || "Degree"}</strong><div class="rz-entry-sub">${esc(e.school)}</div></div><div class="rz-entry-date">${esc(e.start)} ${e.start || e.end ? "–" : ""} ${esc(e.end)}</div></div></div>`).join("");
    const projectsHtml = state.projects.filter(p => p.name || p.desc).map(p => `<div class="rz-entry"><div class="rz-entry-top"><div><strong>${esc(p.name) || "Project"}</strong>${p.link ? ` <span class="rz-entry-sub">— ${linkify(p.link)}</span>` : ""}</div></div>${p.desc ? `<p>${esc(p.desc)}</p>` : ""}</div>`).join("");
    const skillsHtml = state.skills.length ? `<div class="rz-skill-row">${state.skills.map(s => `<span>${esc(s)}</span>`).join("")}</div>` : "";

    const sectionHtml = {
      summary: state.summary ? `<div class="rz-section"><h5>Professional Summary</h5><p class="rz-summary">${esc(state.summary)}</p></div>` : "",
      experience: experienceHtml ? `<div class="rz-section"><h5>Experience</h5>${experienceHtml}</div>` : "",
      education: educationHtml ? `<div class="rz-section"><h5>Education</h5>${educationHtml}</div>` : "",
      skills: skillsHtml ? `<div class="rz-section"><h5>Skills</h5>${skillsHtml}</div>` : "",
      projects: projectsHtml ? `<div class="rz-section"><h5>Projects</h5>${projectsHtml}</div>` : ""
    };
    const orderedSections = state.sectionOrder.map(key => state.sectionVisibility[key] === false ? "" : sectionHtml[key]).join("");
    el.innerHTML = `<div class="rz-header"><div class="rz-name">${esc(state.fullName) || "Your Name"}</div>${state.jobTitle ? `<div class="rz-title">${esc(state.jobTitle)}</div>` : ""}${contactBits ? `<div class="rz-contact">${contactBits}</div>` : ""}</div>${orderedSections}`;
  }

  function updateProgress() {
    const checks = [
      state.fullName, state.jobTitle, state.email, state.phone, state.location,
      state.linkedin || state.website, state.summary,
      state.experience.some(e => e.role || e.company || e.desc),
      state.education.some(e => e.degree || e.school), state.skills.length >= 1,
      state.projects.some(p => p.name || p.desc)
    ];
    const percent = Math.round(checks.filter(Boolean).length / checks.length * 100);
    const el = document.getElementById("builderProgress");
    if (el) el.textContent = `${percent}% complete`;
  }

  /* ---------------- ATS score ---------------- */
  function calculateScore() {
    const checks = [];
    let points = 0;
    const add = (value, label, weight, detail = "") => {
      if (value) points += weight;
      checks.push({ label, ok: !!value, weight, detail });
    };
    const experienceEntries = state.experience.filter(e => e.role || e.company || e.desc);
    const educationEntries = state.education.filter(e => e.degree || e.school);
    const projectEntries = state.projects.filter(p => p.name || p.desc);
    const allText = `${state.jobTitle} ${state.summary} ${state.skills.join(" ")} ${experienceEntries.map(e => `${e.role} ${e.company} ${e.desc}`).join(" ")} ${projectEntries.map(p => `${p.name} ${p.desc}`).join(" ")}`.toLowerCase();
    const actionWords = /\b(led|built|created|improved|increased|reduced|delivered|managed|developed|designed|optimized|launched|implemented|automated|achieved|grew|saved)\b/i;
    const quantified = /\b\d+(?:\.\d+)?\s*(%|percent|x|k|m|b|users|clients|projects|hours|days|months|years)\b/i.test(allText) || /\b(increased|reduced|grew|saved|improved|achieved)\b.{0,80}\b\d+\b/i.test(allText);
    add(!!state.fullName.trim(), "Full name", 6, "Use your real professional name.");
    add(!!state.jobTitle.trim(), "Target role", 7, "Add the role you are applying for.");
    add(/^\S+@\S+\.\S+$/.test(state.email.trim()), "Professional email", 6, "Use a simple, professional email address.");
    add(!!state.phone.trim(), "Phone number", 4, "Add a reachable phone number.");
    add(!!state.location.trim(), "Location", 2, "City and country are enough.");
    add(!!(state.linkedin.trim() || state.website.trim()), "Professional link", 3, "Add LinkedIn, portfolio or GitHub.");
    add(state.summary.trim().length >= 80 && state.summary.trim().length <= 500, "Focused summary", 9, "Aim for a concise 80–180 character summary.");
    add(experienceEntries.some(e => e.role && e.company && e.desc.trim().length >= 40), "Detailed experience", 13, "Include role, company and evidence of impact.");
    add(experienceEntries.some(e => e.desc.split(/\n/).filter(Boolean).length >= 2), "Achievement bullets", 7, "Use at least two bullets per relevant role.");
    add(educationEntries.some(e => e.degree && e.school), "Education", 7, "Add your degree/course and institution.");
    add(state.skills.length >= 6, "6+ relevant skills", 9, "Add specific skills relevant to your target role.");
    add(projectEntries.some(p => p.name && p.desc), "Project evidence", 6, "Add projects that demonstrate practical ability.");
    add(actionWords.test(allText), "Action-oriented language", 5, "Start bullets with strong verbs such as built, led or improved.");
    add(quantified, "Measurable impact", 8, "Add numbers, percentages, scale or time saved where truthful.");
    add(state.sectionOrder.length === 5 && new Set(state.sectionOrder).size === 5, "Clear resume structure", 4, "Keep the main sections organized and readable.");

    let keywordMatch = null;
    if (state.targetJobDescription.trim()) {
      const stop = new Set("the and for with from that this your you our are was were have has will into about their they them using use used not but can job role work team skills experience years required preferred plus looking who to of in on a an as or be by at it we i”.".split(/\s+/));
      const jdWords = state.targetJobDescription.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || [];
      const candidates = [...new Set(jdWords.filter(w => !stop.has(w) && !/^\d+$/.test(w)))].slice(0, 80);
      const matched = candidates.filter(w => allText.includes(w));
      keywordMatch = { matched, missing: candidates.filter(w => !allText.includes(w)), total: candidates.length, percent: candidates.length ? Math.round(matched.length / candidates.length * 100) : 0 };
      add(keywordMatch.percent >= 40, `Job keyword match (${keywordMatch.percent}%)`, 4, "Tailor your resume to the target job description.");
    }
    return { score: Math.min(100, points), checks, keywordMatch };
  }
  function updateScore() {
    const result = calculateScore();
    score = result.score;
    const value = document.getElementById("atsScoreValue");
    const ring = document.getElementById("atsScoreRing");
    const label = document.getElementById("atsScoreLabel");
    if (value) value.textContent = score;
    if (ring) ring.style.setProperty("--score", `${score * 3.6}deg`);
    if (label) label.textContent = score >= 85 ? "Excellent" : score >= 70 ? "Strong" : score >= 50 ? "Good start" : "Needs work";
  }

  async function openScoreModal() {
    const result = calculateScore();
    const body = document.getElementById("scoreDetails");
    if (!body) return;
    const missing = result.checks.filter(c => !c.ok).sort((a,b) => b.weight - a.weight);
    const keyword = result.keywordMatch;
    const allText = `${state.jobTitle} ${state.summary} ${state.skills.join(" ")} ${state.experience.map(e => `${e.role} ${e.company} ${e.desc}`).join(" ")} ${state.projects.map(p => `${p.name} ${p.desc}`).join(" ")}`.toLowerCase();
    const category = {
      contact: Math.min(100, (state.fullName?30:0)+(state.email?25:0)+(state.phone?20:0)+(state.location?10:0)+((state.linkedin||state.website)?15:0)),
      summary: Math.min(100, Math.round(Math.min(1, state.summary.trim().length/120)*100)),
      experience: Math.min(100, (state.experience.some(e=>e.role&&e.company)?40:0)+(state.experience.some(e=>e.desc.trim().length>=40)?35:0)+(/\d/.test(allText)?25:0)),
      education: state.education.some(e=>e.degree&&e.school)?100:0,
      skills: Math.min(100, state.skills.length*12),
      projects: state.projects.some(p=>p.name&&p.desc)?100:0,
      keywords: keyword ? keyword.percent : 100,
      formatting: 100
    };
    const labels={contact:'Contact',summary:'Summary',experience:'Experience',education:'Education',skills:'Skills',projects:'Projects',keywords:'Keywords',formatting:'Formatting'};
    const categoryHtml=Object.entries(category).map(([k,v])=>`<div class="ats-category"><div><span>${labels[k]}</span><strong>${v}%</strong></div><div class="ats-category-bar"><span style="width:${v}%"></span></div></div>`).join('');
    const keywordBlock = keyword ? `<div class="keyword-analysis"><div class="keyword-analysis-head"><div><span class="eyebrow-small">JOB TARGETING</span><strong>${keyword.percent}% keyword coverage</strong></div><span>${keyword.matched.length}/${keyword.total} matched</span></div><div class="keyword-bar"><span style="width:${keyword.percent}%"></span></div>${keyword.missing.length ? `<div class="keyword-missing"><strong>Missing terms to review:</strong> ${keyword.missing.slice(0, 12).map(esc).join(", ")}</div>` : `<div class="keyword-good"><i class="bi bi-check-circle-fill"></i> Strong keyword coverage for this job description.</div>`}</div>` : `<div class="keyword-analysis empty-keyword"><i class="bi bi-bullseye"></i><div><strong>Target a specific job</strong><span>Paste a job description in the Job targeting box for job-specific keyword analysis.</span></div></div>`;
    body.innerHTML = `<div class="score-modal-top"><div class="score-big">${result.score}<small>/100</small></div><div><strong>${result.score >= 85 ? "Excellent ATS readiness" : result.score >= 70 ? "Strong ATS foundation" : result.score >= 50 ? "Good foundation" : "Room to improve"}</strong><p>ATS readiness is based on content quality, structure, evidence, keywords and formatting.</p></div></div><div class="ats-category-grid">${categoryHtml}</div>${keywordBlock}<div class="score-priority"><strong>Highest-impact improvements</strong>${(missing.length ? missing.slice(0, 4) : [{label:"Keep your resume targeted",detail:"Review the job description and tailor your strongest evidence."}]).map(c => `<div><i class="bi bi-arrow-up-right-circle"></i><span><strong>${esc(c.label)}</strong><small>${esc(c.detail || "")}</small></span></div>`).join("")}</div><div class="score-checks">${result.checks.map(c => `<div class="score-check ${c.ok ? "ok" : "missing"}"><i class="bi ${c.ok ? "bi-check-circle-fill" : "bi-circle"}"></i><span>${esc(c.label)}</span><em>${c.ok ? "Complete" : "Improve"}</em></div>`).join("")}</div><div class="d-flex gap-2 justify-content-end mt-3"><button class="btn btn-outline-primary btn-sm" id="deepAtsBtn"><i class="bi bi-stars"></i> Deep AI analysis</button></div>`;
    document.getElementById('deepAtsBtn')?.addEventListener('click', async (e)=>{
      const btn=e.currentTarget; btn.disabled=true; btn.innerHTML='<span class="spinner-border spinner-border-sm me-1"></span> Analyzing…';
      try{
        if(!window.ElevateAuth?.token()) throw new Error('Sign in to use AI ATS analysis.');
        const r=await window.ElevateAuth.request('/ats-analyze',{method:'POST',body:JSON.stringify({resume:state,jobDescription:state.targetJobDescription||''})});
        const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'AI ATS analysis failed.');
        const a=d.analysis||{};
        const aiScores=Object.entries(a.sectionScores||{}).map(([k,v])=>`<div class="ats-category"><div><span>${labels[k]||k}</span><strong>${Number(v)}%</strong></div><div class="ats-category-bar"><span style="width:${Math.max(0,Math.min(100,Number(v)))}%"></span></div></div>`).join('');
        body.insertAdjacentHTML('afterbegin',`<div class="ai-ats-result"><div class="ai-ats-head"><span class="eyebrow-small">AI ATS REVIEW</span><strong>${Number(a.score||0)}/100</strong></div><p>${esc(a.summary||'Analysis complete.')}</p><div class="ats-category-grid">${aiScores}</div>${(a.issues||[]).length?`<h6>Priority issues</h6><ul>${a.issues.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}${(a.keywordGaps||[]).length?`<h6>Keyword gaps</h6><p>${a.keywordGaps.slice(0,15).map(esc).join(', ')}</p>`:''}</div>`);
        btn.remove();
      }catch(err){ showToast(err.message,'bi-exclamation-triangle'); btn.disabled=false; btn.innerHTML='<i class="bi bi-stars"></i> Deep AI analysis'; }
    });
    openModal("scoreModal");
  }

  /* ---------------- Resume layout controls ---------------- */
  const sectionLabels = { summary: "Professional Summary", experience: "Experience", education: "Education", skills: "Skills", projects: "Projects" };

  function renderSectionManager() {
    const wrap = document.getElementById("sectionManagerList");
    if (!wrap) return;
    wrap.innerHTML = state.sectionOrder.map((key, i) => `<div class="section-manager-row"><span class="section-drag"><i class="bi bi-grip-vertical"></i></span><span class="section-manager-name"><strong>${sectionLabels[key]}</strong><small>${state.sectionVisibility[key] === false ? "Hidden from resume" : "Visible in resume"}</small></span><button class="icon-btn" type="button" data-section-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move ${sectionLabels[key]} up"><i class="bi bi-chevron-up"></i></button><button class="icon-btn" type="button" data-section-down="${i}" ${i === state.sectionOrder.length - 1 ? "disabled" : ""} aria-label="Move ${sectionLabels[key]} down"><i class="bi bi-chevron-down"></i></button><button class="section-visibility ${state.sectionVisibility[key] === false ? "is-hidden" : ""}" type="button" data-section-toggle="${key}" aria-label="Toggle ${sectionLabels[key]}"><i class="bi ${state.sectionVisibility[key] === false ? "bi-eye-slash" : "bi-eye"}"></i></button></div>`).join("");
    wrap.querySelectorAll("[data-section-up]").forEach(btn => btn.addEventListener("click", () => moveSection(+btn.dataset.sectionUp, -1)));
    wrap.querySelectorAll("[data-section-down]").forEach(btn => btn.addEventListener("click", () => moveSection(+btn.dataset.sectionDown, 1)));
    wrap.querySelectorAll("[data-section-toggle]").forEach(btn => btn.addEventListener("click", () => toggleSection(btn.dataset.sectionToggle)));
  }

  function moveSection(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= state.sectionOrder.length) return;
    [state.sectionOrder[index], state.sectionOrder[target]] = [state.sectionOrder[target], state.sectionOrder[index]];
    renderSectionManager(); renderPreview(); save();
  }

  function toggleSection(key) {
    state.sectionVisibility[key] = state.sectionVisibility[key] === false;
    renderSectionManager(); renderPreview(); save();
  }

  /* ---------------- AI assistance ---------------- */
  async function requestAI(task, payload) {
    if (!window.ElevateAuth?.token()) {
      showToast("Sign in to use AI writing assistance", "bi-person-lock");
      return null;
    }
    try {
      const response = await window.ElevateAuth.request('/ai', {
        method: 'POST',
        body: JSON.stringify({ task, payload })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'AI request failed.');
      return data.text || null;
    } catch (error) {
      showToast(error.message || 'AI request failed', 'bi-exclamation-triangle');
      return null;
    }
  }

  async function generateSummary() {
    const buttons = [...document.querySelectorAll('[data-ai-summary]')];
    buttons.forEach(b => { b.disabled = true; b.dataset.originalText = b.innerHTML; b.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Generating…'; });
    const text = await requestAI('summary', { resume: state });
    buttons.forEach(b => { b.disabled = false; b.innerHTML = b.dataset.originalText || 'Generate summary'; });
    if (!text) return;
    state.summary = text.replace(/^\s*summary:\s*/i, '').trim();
    syncSimpleField('summary');
    renderPreview(); save(); activateTab('personal');
    showToast('AI summary generated', 'bi-stars');
  }

  async function improveExperience(index) {
    const exp = state.experience[index];
    if (!exp) return;
    const button = document.querySelector(`[data-ai-exp="${index}"]`);
    if (button) { button.disabled = true; button.dataset.originalText = button.innerHTML; button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Improving…'; }
    const text = await requestAI('experience_bullet', { resume: state, item: exp });
    if (button) { button.disabled = false; button.innerHTML = button.dataset.originalText || 'Improve bullets'; }
    if (!text) return;
    exp.desc = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => line.replace(/^[-•*]\s*/, '• ')).join('\n');
    renderExperience(); renderPreview(); save();
    showToast('AI experience bullets improved', 'bi-stars');
  }

  async function improveProject(index) {
    const project = state.projects[index];
    if (!project) return;
    const button = document.querySelector(`[data-ai-project="${index}"]`);
    if (button) { button.disabled = true; button.dataset.originalText = button.innerHTML; button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Improving…'; }
    const text = await requestAI('project_description', { resume: state, item: project });
    if (button) { button.disabled = false; button.innerHTML = button.dataset.originalText || 'Improve description'; }
    if (!text) return;
    project.desc = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => line.replace(/^[-•*]\s*/, '• ')).join('\n');
    renderProjects(); renderPreview(); save();
    showToast('AI project description improved', 'bi-stars');
  }

  function bindAiButtons() {
    document.querySelectorAll('[data-ai-summary]').forEach(btn => btn.addEventListener('click', generateSummary));
  }

  /* ---------------- Import / export ---------------- */
  function exportData() {
    const blob = new Blob([JSON.stringify({ app: "Elevate Resume Builder", version: 2, exportedAt: new Date().toISOString(), resume: state }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(state.fullName || "elevate-resume").trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "resume"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Resume data exported", "bi-download");
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const incoming = parsed.resume || parsed;
        if (!incoming || typeof incoming !== "object") throw new Error("Invalid file");
        state = normalizeState(incoming);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        initAll();
        showToast("Resume imported successfully", "bi-upload");
      } catch (_) { showToast("That file is not a valid Elevate resume", "bi-exclamation-circle"); }
    };
    reader.readAsText(file);
  }

  /* ---------------- Resume manager ---------------- */
  function renderResumeManager() {
    const wrap = document.getElementById("savedResumeList");
    if (!wrap) return;
    const resumes = getSavedResumes();
    if (!resumes.length) {
      wrap.innerHTML = `<div class="empty-manager"><i class="bi bi-folder2-open"></i><strong>No saved resumes yet</strong><span>Use “Save Resume” to keep a version here.</span></div>`;
      return;
    }
    wrap.innerHTML = resumes.map(r => `<div class="saved-resume-card"><div class="saved-resume-icon"><i class="bi bi-file-earmark-person"></i></div><div class="saved-resume-info"><strong>${esc(r.fullName || "Untitled resume")}</strong><span>${esc(r.jobTitle || "No target role")} · ${esc(r.template)} template</span></div><div class="saved-resume-actions"><button class="btn btn-primary btn-sm" data-load-resume="${r.id}"><i class="bi bi-folder2-open"></i> Open</button><button class="btn btn-outline-primary btn-sm" data-rename-resume="${r.id}" aria-label="Rename resume"><i class="bi bi-pencil"></i></button><button class="btn btn-outline-primary btn-sm" data-duplicate-resume="${r.id}" aria-label="Duplicate resume"><i class="bi bi-copy"></i></button><button class="icon-btn danger-icon" data-delete-resume="${r.id}" aria-label="Delete resume"><i class="bi bi-trash"></i></button></div></div>`).join("");
    wrap.querySelectorAll("[data-load-resume]").forEach(btn => btn.addEventListener("click", () => loadResume(btn.dataset.loadResume)));
    wrap.querySelectorAll("[data-rename-resume]").forEach(btn => btn.addEventListener("click", () => renameSavedResume(btn.dataset.renameResume)));
    wrap.querySelectorAll("[data-duplicate-resume]").forEach(btn => btn.addEventListener("click", () => duplicateSavedResume(btn.dataset.duplicateResume)));
    wrap.querySelectorAll("[data-delete-resume]").forEach(btn => btn.addEventListener("click", () => { if (confirm("Delete this saved resume?")) deleteSavedResume(btn.dataset.deleteResume); }));
  }

  /* ---------------- PDF ---------------- */
  async function downloadPdf() {
    if (!state.fullName.trim()) { showToast("Add your name before downloading", "bi-exclamation-circle"); activateTab("personal"); return; }
    const button = document.getElementById("downloadBtn");
    const paper = document.getElementById("resumePaper");
    if (!window.html2canvas || !window.jspdf) { showToast("PDF tools could not be loaded. Check your internet connection.", "bi-exclamation-circle"); return; }
    const original = button.innerHTML;
    try {
      button.disabled = true;
      button.innerHTML = '<i class="bi bi-hourglass-split"></i> Creating PDF...';
      const canvas = await window.html2canvas(paper, { scale: 2, useCORS: true, backgroundColor: "#fff", logging: false, scrollX: 0, scrollY: -window.scrollY, windowWidth: paper.scrollWidth, windowHeight: paper.scrollHeight });
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      const pageWidth = 210, pageHeight = 297, margin = 10, contentWidth = pageWidth - margin * 2, contentHeight = pageHeight - margin * 2;
      const pxPerMm = canvas.width / contentWidth, pageCanvasHeight = Math.floor(contentHeight * pxPerMm);
      let sourceY = 0, pageNumber = 0;
      while (sourceY < canvas.height) {
        const sliceHeight = Math.min(pageCanvasHeight, canvas.height - sourceY);
        const pageCanvas = document.createElement("canvas"); pageCanvas.width = canvas.width; pageCanvas.height = sliceHeight;
        const ctx = pageCanvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, pageCanvas.width, sliceHeight);
        if (pageNumber > 0) pdf.addPage();
        pdf.addImage(pageCanvas.toDataURL("image/jpeg", 0.95), "JPEG", margin, margin, contentWidth, sliceHeight / pxPerMm, undefined, "FAST");
        sourceY += sliceHeight; pageNumber++;
      }
      const name = state.fullName.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "resume";
      pdf.save(`${name}-resume.pdf`);
      showToast("PDF downloaded successfully", "bi-check-circle");
    } catch (error) { console.error("PDF generation failed:", error); showToast("Could not create the PDF. Please try again.", "bi-exclamation-circle"); }
    finally { button.disabled = false; button.innerHTML = original; }
  }

  /* ---------------- Modals / actions ---------------- */
  function openModal(id) { const modal = document.getElementById(id); if (modal) { modal.classList.add("open"); modal.setAttribute("aria-hidden", "false"); } }
  function closeModal(id) { const modal = document.getElementById(id); if (modal) { modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); } }

  function bindActions() {
    document.getElementById("clearBtn")?.addEventListener("click", () => {
      if (!confirm("Clear all resume data? This cannot be undone.")) return;
      state = defaultState(); localStorage.removeItem(STORAGE_KEY); initAll(); showToast("Resume cleared", "bi-trash");
    });
    document.getElementById("newResumeBtn")?.addEventListener("click", newResume);
    document.getElementById("saveResumeBtn")?.addEventListener("click", saveNamedResume);
    document.getElementById("downloadBtn")?.addEventListener("click", downloadPdf);
    document.getElementById("customizeBtn")?.addEventListener("click", () => { renderSectionManager(); openModal("layoutModal"); });
    document.getElementById("atsScoreCard")?.addEventListener("click", openScoreModal);
    document.getElementById("atsScoreCard")?.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openScoreModal(); } });
    document.getElementById("savedResumesBtn")?.addEventListener("click", () => { renderResumeManager(); openModal("resumeManagerModal"); });
    bindTargetJobDescription();
    document.getElementById("exportBtn")?.addEventListener("click", exportData);
    document.getElementById("importBtn")?.addEventListener("click", () => document.getElementById("importFile")?.click());
    document.getElementById("importFile")?.addEventListener("change", e => { importData(e.target.files[0]); e.target.value = ""; });
    document.querySelectorAll("[data-close-modal]").forEach(btn => btn.addEventListener("click", () => closeModal(btn.dataset.closeModal)));
    document.querySelectorAll(".modal-backdrop").forEach(backdrop => backdrop.addEventListener("click", e => { if (e.target === backdrop) closeModal(backdrop.parentElement.id); }));
    document.addEventListener("keydown", e => { if (e.key === "Escape") document.querySelectorAll(".modal.open").forEach(m => closeModal(m.id)); });
  }

  function initAll() {
    bindProfileSync();
    bindSimpleFields();
    bindTargetJobDescription();
    renderExperience(); renderEducation(); renderProjects(); renderSkillChips();
    setTemplateWithoutSave(state.template);
    renderPreview(); updateScore(); renderResumeManager(); activateTab(activeTab);
  }

  function setTemplateWithoutSave(template) {
    const paper = document.getElementById("resumePaper");
    if (paper) paper.className = "resume-paper " + template;
    document.querySelectorAll(".tpl-btn").forEach(b => b.classList.toggle("active", b.dataset.tpl === template));
  }

  function showToast(message, icon = "bi-check-circle") {
    if (typeof window.showToast === "function") { window.showToast(message, icon); return; }
    const toast = document.createElement("div"); toast.className = "builder-toast"; toast.innerHTML = `<i class="bi ${icon}"></i>${esc(message)}`; document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 250); }, 2500);
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindTabs(); bindAddButtons(); bindSkills(); bindQuickSkills(); bindTemplateSwitch(); bindActions(); bindAiButtons(); initAll();
  });
})();
