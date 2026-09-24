(() => {
  const get = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  let resume = get('elevate_resume_data');
  let saved = get('elevate_saved_resumes') || [];
  let jobs = get('elevateSavedJobs') || [];
  let applications = get('elevateApplications') || [];
  let career = get('elevateCareerResult');
  let letters = get('elevateLetters') || [];
  const signedIn = () => !!window.ElevateAuth?.token();
  async function api(path){ if(!signedIn()) return null; try{ const r=await window.ElevateAuth.request(path); if(r.status===401){window.ElevateAuth.clear();return null;} const d=await r.json(); return r.ok?d:null;}catch(_){return null;} }
  const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  function resumeCompletion(r) {
    if (!r) return 0;
    const checks = [r.fullName,r.jobTitle,r.email,r.phone,r.location,r.summary,(r.experience||[]).some(x=>x.role||x.company||x.desc),(r.education||[]).some(x=>x.degree||x.school),(r.skills||[]).length,(r.projects||[]).some(x=>x.name||x.desc)];
    return Math.round(checks.filter(Boolean).length / checks.length * 100);
  }
  function ats(r) {
    if (!r) return null;
    let score=0; const add=(ok,pts)=>{if(ok)score+=pts};
    add(r.fullName,10); add(r.email,8); add(r.phone,6); add(r.location,4); add(r.jobTitle,7); add((r.summary||'').length>=80,10); add((r.experience||[]).some(x=>x.role&&x.company&&x.desc),15); add((r.education||[]).some(x=>x.degree&&x.school),10); add((r.skills||[]).length>=5,12); add((r.projects||[]).some(x=>x.name&&x.desc),8); add((r.linkedin||r.website),5); add((r.targetJobDescription||'').length>0,5); return Math.min(100,score);
  }
  function profileStrength(p){ if(!p) return 0; const fields=[p.headline,p.location,p.phone,p.website,p.linkedin,p.bio,p.skills?.length,p.preferences?.role,p.preferences?.workMode,p.preferences?.employment,p.preferences?.industries]; return Math.round(fields.filter(Boolean).length/fields.length*100); }
  function fmtDate(v){ try{return new Date(v.replace(' ','T')).toLocaleDateString(undefined,{month:'short',day:'numeric'});}catch{return '';}}
  function renderIntelligence(stats){
    const profile=get('elevate_profile_cache')||{}; const ps=profileStrength(profile); const rs=resumeCompletion(resume); const total=applications.length; const interviews=applications.filter(a=>['Interview','Offer'].includes(a.status)).length; const rate=total?Math.round(interviews/total*100):0; const momentum=Math.round(ps*.3+rs*.45+Math.min(rate*2,100)*.25);
    const el=id=>document.getElementById(id); if(!el('profileStrength')) return; el('profileStrength').textContent=ps+'%'; el('resumeReadiness').textContent=rs+'%'; el('matchRate').textContent=rate+'%'; el('momentumBar').style.width=momentum+'%'; el('momentumBadge').textContent=momentum>=80?'On track':momentum>=55?'Building':'Getting started'; el('momentumText').textContent=momentum>=80?'Your career workspace is in strong shape. Keep applying and refining based on job matches.':momentum>=55?'You have a solid foundation. Finish the highest-impact gaps to unlock better job matches.':'Start with your profile and resume — they power nearly every recommendation in Elevate.';
    const focus=[]; if(ps<85) focus.push(['bi-person-vcard','Strengthen your profile',`You're at ${ps}%. Add preferences and professional details.`,'profile.html']); if(rs<90) focus.push(['bi-file-earmark-check','Improve resume readiness',`Your resume is ${rs}% complete. Finish the highest-value sections.`,'resume-builder.html']); if(resume && ats(resume)<85) focus.push(['bi-shield-check','Raise ATS readiness',`Current readiness is ${ats(resume)}/100. Target the job before applying.`,'resume-builder.html#ats']); if(jobs.length===0) focus.push(['bi-search','Find your next opportunities','Search roles using your profile and resume context.','job-search.html']); else focus.push(['bi-send-check','Keep your pipeline moving',`${jobs.length} saved job${jobs.length===1?'':'s'} ready for review.`,'job-search.html']); if(!focus.length) focus.push(['bi-stars','Keep building momentum','Review recent applications and tailor your strongest matches.','job-search.html']); el('smartFocus').innerHTML=focus.slice(0,3).map(x=>`<a class="focus-item" href="${x[3]}"><i class="bi ${x[0]}"></i><div><strong>${esc(x[1])}</strong><span>${esc(x[2])}</span></div><i class="bi bi-chevron-right ms-auto"></i></a>`).join('');
    const recent=(stats?.recentActivity||[]); const icons={resume:'bi-file-earmark-text',letter:'bi-envelope-paper',profile:'bi-person-check'}; el('recentActivity').innerHTML=recent.length?recent.map(x=>`<div class="activity-item"><span class="activity-icon"><i class="bi ${icons[x.type]||'bi-clock-history'}"></i></span><div><strong>${esc(x.title)}</strong><span>${esc(x.type==='profile'?'Profile activity':x.type==='resume'?'Resume library':'Letter library')} · ${fmtDate(x.date)}</span></div></div>`).join(''):'<div class="empty-state">Your recent activity will appear here as you build your career workspace.</div>';
    const c=career||stats?.career?.data; const cs=el('careerSignal'); if(c){cs.innerHTML=`<strong>${esc(c.title||'Career direction')}</strong><p>Your advisor result can guide the roles and skills you prioritize next.</p><div class="signal-tags">${(c.skills||c.roles||[]).slice(0,5).map(x=>`<span>${esc(x)}</span>`).join('')}</div>`;} else cs.innerHTML='<div class="empty-state">Take the career advisor to create a personalized direction.</div>';
  }
  function renderDashboard(){
  const completion=resumeCompletion(resume); document.getElementById('completionScore').textContent=completion+'%'; document.getElementById('completionHint').textContent=completion>=90?'Ready for final review':completion>=60?'Good progress — keep going':'Start adding your details';
  const atsScore=ats(resume); document.getElementById('atsScore').textContent=atsScore === null?'—':atsScore+'/100'; document.getElementById('atsHint').textContent=atsScore===null?'Build your resume to see your score':atsScore>=80?'Strong ATS readiness': 'A few improvements can strengthen it';
  document.getElementById('savedJobs').textContent=jobs.length; document.getElementById('savedResumes').textContent=saved.length; document.getElementById('applicationTotal').textContent=applications.length; document.getElementById('letterTotal').textContent=letters.length; document.getElementById('applicationHint').textContent=applications.length ? `${applications.filter(a=>a.status==='Interview').length} in interview` : 'Start tracking applications';

  const actions=[];
  const profile= get('elevate_profile_cache');
  if (!profile || !profile.headline || !(profile.skills||[]).length) actions.push(['bi-person-vcard','Complete your career profile','Add your headline, skills and job preferences','profile.html']);
  if (!resume || completion<100) actions.push(['bi-file-earmark-person','Finish your resume',completion?`Resume is ${completion}% complete`:'Add your professional details','resume-builder.html']);
  if (resume && (atsScore||0)<85) actions.push(['bi-shield-check','Improve ATS readiness',`Current score: ${atsScore}/100`,'resume-builder.html#ats']);
  if (!career) actions.push(['bi-compass','Discover your career direction','Take the short career-fit assessment','career-advisor.html']);
  else actions.push(['bi-briefcase','Explore matching jobs',`Based on ${career.title || 'your latest result'}`,'job-search.html?role='+encodeURIComponent((career.roles||[''])[0])]);
  actions.push(['bi-envelope-paper','Prepare your next application','Create a polished letter from your resume','letter-generator.html']);
  document.getElementById('actionList').innerHTML=actions.slice(0,4).map(a=>`<a class="action-item" href="${a[3]}"><i class="bi ${a[0]}"></i><div><strong>${esc(a[1])}</strong><span>${esc(a[2])}</span></div><i class="bi bi-chevron-right"></i></a>`).join('');

  const careerCard=document.getElementById('careerCard');
  if(career){ careerCard.innerHTML=`<h3>${esc(career.title||'Career match')}</h3><p>Your latest career assessment suggests a strong direction for your next step.</p><div><span class="fit">${esc(career.fit||'—')}%</span> <span class="fit-label">fit score</span></div><div class="skill-row">${(career.skills||[]).slice(0,5).map(s=>`<span class="skill">${esc(s)}</span>`).join('')}</div>`; }
  else careerCard.innerHTML='<div class="empty-state"><strong>No career result yet.</strong><br>Take the advisor quiz to get a personalized direction.</div>';

  const resumeList=document.getElementById('resumeList');
  if(saved.length){ resumeList.innerHTML=saved.slice(0,5).map(r=>`<div class="resume-row"><i class="bi bi-file-earmark-richtext"></i><div><strong>${esc(r.fullName||'Untitled resume')}</strong><span>${esc(r.jobTitle||'Professional resume')}</span></div><a class="btn btn-outline-primary btn-sm" href="resume-builder.html">Open</a></div>`).join(''); }
  else resumeList.innerHTML='<div class="empty-state">No saved resume versions yet.<br><a href="resume-builder.html">Create your first resume</a></div>';

  const pipeline=document.getElementById('applicationPipeline');
  const statuses=['Applied','Interview','Offer','Rejected'];
  pipeline.innerHTML=statuses.map(status=>{ const list=applications.filter(a=>a.status===status); return `<div class="pipeline-column"><h4>${status}<span>${list.length}</span></h4>${list.slice(0,4).map(a=>`<div class="pipeline-job"><strong>${esc(a.title)}</strong><small>${esc(a.company)}</small></div>`).join('') || '<div class="pipeline-empty">No applications yet</div>'}</div>`; }).join('');
  }

  renderIntelligence(null);
  renderDashboard();
  (async()=>{
    if(!signedIn()) return;
    const [r,j,a,c,l,dash]=await Promise.all([api('/resumes'),api('/jobs'),api('/applications'),api('/career'),api('/letters'),api('/dashboard')]);
    if(r?.resumes){ saved=r.resumes.map(x=>({...x.data,serverId:x.id,id:x.data?.id||String(x.id)})); localStorage.setItem('elevate_saved_resumes',JSON.stringify(saved)); resume=saved[0]||resume; if(resume) localStorage.setItem('elevate_resume_data',JSON.stringify(resume)); }
    if(j?.jobs){ jobs=j.jobs.map(x=>x.data||{}); localStorage.setItem('elevateSavedJobs',JSON.stringify(jobs)); }
    if(a?.applications){ applications=a.applications.map(x=>({...x.data,status:x.data?.status||'Applied',jobKey:x.jobKey,serverId:x.id})); localStorage.setItem('elevateApplications',JSON.stringify(applications)); }
    if(c?.career){ career=c.career; localStorage.setItem('elevateCareerResult',JSON.stringify(career)); }
    if(l?.letters){ letters=l.letters.map(x=>({...x.data,serverId:x.id,name:x.name})); localStorage.setItem('elevateLetters',JSON.stringify(letters)); }
    renderIntelligence(dash?.stats||null);
    renderDashboard();
  })();
})();