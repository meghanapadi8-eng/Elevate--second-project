(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
  const element = id => document.getElementById(id);
  const readStored = key => {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  };
  const resume = () => readStored('elevate_resume_data') || {};
  const profile = () => readStored('elevate_profile_cache') || {};
  const applications = () => readStored('elevateApplications') || [];
  const careerResult = () => readStored('elevateCareerResult') || {};

  function localContext() {
    const userProfile = profile();
    const userResume = resume();
    const userApplications = applications();
    const assessment = careerResult();
    const profileScore = Math.round([
      userProfile.headline,
      userProfile.location,
      userProfile.phone,
      userProfile.bio,
      userProfile.website,
      userProfile.linkedin,
      userProfile.skills?.length,
      userProfile.preferences?.role,
      userProfile.preferences?.workMode
    ].filter(Boolean).length / 9 * 100);
    const resumeScore = Math.round([
      userResume.fullName,
      userResume.jobTitle,
      userResume.email,
      userResume.phone,
      userResume.location,
      userResume.summary,
      (userResume.experience || []).length,
      (userResume.education || []).length,
      (userResume.skills || []).length,
      (userResume.projects || []).length
    ].filter(Boolean).length * 10);

    return {
      profile: profileScore,
      resume: resumeScore,
      applications: userApplications.length,
      interviews: userApplications.filter(item => item.status === 'Interview').length,
      offers: userApplications.filter(item => item.status === 'Offer').length,
      role: assessment.roles?.[0] || userProfile.preferences?.role || userResume.jobTitle || 'your target role',
      skills: [...new Set([
        ...(assessment.skills || []),
        ...(userProfile.skills || []),
        ...(userResume.skills || [])
      ])].slice(0, 6),
      assessment
    };
  }

  function renderContext() {
    const context = localContext();
    element('context').innerHTML = [
      ['Profile', `${context.profile}%`],
      ['Resume', `${context.resume}%`],
      ['Applications', context.applications],
      ['Interviews', context.interviews]
    ].map(([label, value]) => `<div class="context-pill"><strong>${escapeHtml(value)}</strong><span>${label}</span></div>`).join('');

    element('momentum').textContent = `${Math.round((
      context.profile +
      context.resume +
      Math.min(100, context.applications * 12) +
      Math.min(100, context.interviews * 20)
    ) / 4)}%`;
    element('momentumHint').textContent = context.role === 'your target role'
      ? 'Add a target role for sharper recommendations.'
      : `Focused on ${context.role}.`;
  }

  function createLocalPlan() {
    const context = localContext();
    const assessedSkills = context.assessment.skills || [];
    const suggestedSkills = assessedSkills.length
      ? assessedSkills.slice(0, 3).map((name, index) => ({
        name,
        reason: `Build this skill to support your ${context.role} career direction.`,
        level: 45 + index * 10
      }))
      : [
        { name: 'Role-specific keywords', reason: 'Use accurate language that matches your target role.', level: 45 },
        { name: 'Achievement storytelling', reason: 'Explain the impact of your real experience clearly.', level: 40 },
        { name: 'Interview communication', reason: 'Practice structured answers for role-related questions.', level: 35 }
      ];

    return {
      priorities: [
        {
          title: `Build toward ${context.role}`,
          detail: 'Align your resume, skills and next steps with the direction from your career assessment.'
        },
        {
          title: 'Build a focused job pipeline',
          detail: context.applications < 5
            ? 'Target a manageable set of high-fit roles instead of mass applying.'
            : 'Review open applications and follow up consistently.'
        },
        {
          title: 'Prepare for conversion',
          detail: context.interviews
            ? 'Practice role-specific stories before your next interview.'
            : 'Prepare concise examples that connect your experience to the roles you want.'
        }
      ],
      skills: suggestedSkills,
      weeks: [
        { title: 'Week 1', text: `Review your career assessment and tailor your profile and resume for ${context.role}.` },
        { title: 'Week 2', text: 'Apply to high-fit roles and tailor each application with truthful, relevant details.' },
        { title: 'Week 3', text: 'Practice interviews and work on the most important role-related skill.' },
        { title: 'Week 4', text: 'Review outcomes, follow up and refine your career direction and strategy.' }
      ],
      strategy: [
        'Prioritize fit over application volume.',
        'Use assessment suggestions as a starting point, not as a substitute for your own judgment.',
        'Track outcomes so you can make evidence-based adjustments.'
      ],
      notes: [
        'This plan combines your career assessment with information stored in Elevate.',
        'Recommendations must not invent credentials, experience or achievements.'
      ],
      ai: false
    };
  }

  function render(plan) {
    element('empty').classList.add('d-none');
    element('plan').classList.remove('d-none');
    element('priorities').innerHTML = (plan.priorities || []).slice(0, 5).map((item, index) =>
      `<div class="priority-item"><span class="priority-num">${index + 1}</span><div><strong>${escapeHtml(item.title || item.action)}</strong><span>${escapeHtml(item.detail || item.why || '')}</span></div></div>`
    ).join('');
    element('skills').innerHTML = (plan.skills || []).slice(0, 6).map(item =>
      `<div class="skill-item"><strong>${escapeHtml(item.name || item.skill)}</strong><span>${escapeHtml(item.reason || 'Priority skill')}</span><div class="skill-bar"><i style="width:${Math.max(8, Math.min(100, Number(item.level || item.priority || 40)))}%"></i></div></div>`
    ).join('');
    element('weeks').innerHTML = (plan.weeks || plan.roadmap || []).slice(0, 4).map(item =>
      `<div class="week-item"><strong>${escapeHtml(item.title || item.week)}</strong><p class="mb-0 mt-2">${escapeHtml(item.text || item.action || item.focus || '')}</p></div>`
    ).join('');
    element('strategy').innerHTML = (plan.strategy || []).map(item =>
      `<div class="strategy-item"><i class="bi bi-check2-circle text-primary me-2"></i>${escapeHtml(typeof item === 'string' ? item : item.text || item.action)}</div>`
    ).join('');
    element('notes').innerHTML = (plan.notes || []).map(item =>
      `<div class="note-item"><i class="bi bi-shield-check text-primary me-2"></i>${escapeHtml(typeof item === 'string' ? item : item.text)}</div>`
    ).join('');
  }

  async function generate() {
    const button = element('generateBtn');
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Building plan…';

    try {
      let plan;
      let usedServer = false;
      if (window.ElevateAuth?.token()) {
        try {
          const response = await window.ElevateAuth.request('/career-plan', {
            method: 'POST',
            body: JSON.stringify({
              context: {
                profile: profile(),
                resume: resume(),
                applications: applications(),
                careerResult: careerResult()
              }
            })
          });
          plan = response.plan;
          usedServer = true;
        } catch {
          plan = createLocalPlan();
          showToast('Server plan unavailable; a personalized plan was saved in this browser.', 'bi-info-circle');
        }
      } else {
        plan = createLocalPlan();
      }

      if (!plan?.priorities?.length) plan = createLocalPlan();
      localStorage.setItem('elevateCareerPlan', JSON.stringify(plan));
      render(plan);
      if (usedServer) {
        showToast(plan.ai ? 'AI career plan generated' : 'Career plan generated with guided recommendations', plan.ai ? 'bi-stars' : 'bi-compass');
      } else if (!window.ElevateAuth?.token()) {
        showToast('Personalized career plan saved in this browser', 'bi-compass');
      }
    } finally {
      button.disabled = false;
      button.innerHTML = '<i class="bi bi-magic me-1"></i> Regenerate my plan';
    }
  }

  renderContext();
  const savedPlan = readStored('elevateCareerPlan');
  if (savedPlan) render(savedPlan);
  element('generateBtn').addEventListener('click', generate);
  element('emptyGenerate').addEventListener('click', generate);
})();
