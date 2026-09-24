/* =====================================================================
   ELEVATE — AI LETTER GENERATOR (template based)
===================================================================== */
(() => {
  let tone = "formal";
  let lastLetter = "";
  const draftKey = "elevateLetterDraft";

  document.querySelectorAll(".tone-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tone-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      tone = btn.dataset.tone;
    });
  });

  const openings = {
    formal: "I am writing to express my sincere interest in",
    friendly: "I hope this message finds you well — I'm excited to share my interest in",
    confident: "I am confident I would be a strong addition to"
  };
  const closings = {
    formal: "Thank you for considering my application. I look forward to the opportunity to discuss this further.",
    friendly: "Thanks so much for taking the time to read this — I'd love the chance to chat further!",
    confident: "I'm confident this role is the right next step for me, and I look forward to discussing how I can contribute."
  };

  function buildPoints(raw) {
    const items = raw.split(",").map(s => s.trim()).filter(Boolean);
    if (!items.length) return "";
    return items.map(i => `- ${i.charAt(0).toUpperCase() + i.slice(1)}`).join("\n");
  }

  function today() {
    return new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  function generate() {
    const type = document.getElementById("letterType").value;
    const name = document.getElementById("lName").value.trim() || "[Your Name]";
    const recipient = document.getElementById("lRecipient").value.trim() || "Hiring Manager";
    const org = document.getElementById("lOrg").value.trim() || "[Organisation]";
    const role = document.getElementById("lRole").value.trim() || "[Role / Program]";
    const pointsRaw = document.getElementById("lPoints").value.trim();
    const pointsList = buildPoints(pointsRaw);
    const opening = openings[tone];
    const closing = closings[tone];

    let body = "";

    if (type === "cover" || type === "internship") {
      body =
`${today()}

Dear ${recipient},

${opening} the ${role} position at ${org}. ${type === "internship" ? "As a student eager to grow through hands-on experience, I" : "I"} believe my background and enthusiasm make me a strong candidate for this opportunity.

${pointsList ? `A few highlights from my background:\n${pointsList}\n` : ""}
I am particularly drawn to ${org} because of the opportunity to contribute meaningfully while continuing to develop my skills. ${closing}

Sincerely,
${name}`;
    } else if (type === "sop") {
      body =
`Statement of Purpose

To the Admissions Committee at ${org},

${opening} the ${role} program at ${org}. My academic journey and personal experiences have shaped a strong motivation to pursue this field further.

${pointsList ? `Key experiences that shape my candidacy:\n${pointsList}\n` : ""}
I am confident that ${org}'s program will provide the environment I need to grow academically and professionally, and I am eager to contribute to its community in return.

${closing}

Warm regards,
${name}`;
    } else if (type === "resignation") {
      body =
`${today()}

Dear ${recipient},

I am writing to formally notify you of my resignation from my position at ${org}, effective two weeks from the date of this letter.

${pointsList ? `I'm grateful for the experience gained, particularly:\n${pointsList}\n` : "I am grateful for the opportunities for growth I've had during my time here.\n"}
I am committed to ensuring a smooth transition and am happy to assist in training a replacement or handing over responsibilities.

Thank you for the support and opportunities during my time at ${org}.

Sincerely,
${name}`;
    } else if (type === "recommendation") {
      body =
`${today()}

Dear ${recipient},

I hope you are doing well. I am reaching out to request a letter of recommendation in support of my application for ${role} at ${org}.

${pointsList ? `I thought it may help to recall a few relevant highlights:\n${pointsList}\n` : ""}
I truly value the guidance you've given me and believe your perspective would add great strength to my application. Please let me know if you need any additional information from me.

${closing}

Best regards,
${name}`;
    }

    lastLetter = body;
    const paper = document.getElementById("letterPaper");
    paper.innerHTML = "";
    paper.textContent = body;
    document.getElementById("letterMeta").textContent = `${body.trim().split(/\s+/).filter(Boolean).length} words`;
    localStorage.setItem(draftKey, JSON.stringify({ type, name, recipient, org, role, pointsRaw, tone, letter: body, savedAt: Date.now() }));
    showToast("Letter generated", "bi-magic");
  }

  document.getElementById("generateBtn").addEventListener("click", generate);
  async function generateWithAI() {
    if (!window.ElevateAuth?.token()) { showToast("Sign in to use AI letter generation", "bi-person-lock"); return; }
    const btn = document.getElementById("generateAiBtn");
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Generating…';
    let resume = {};
    try {
      const raw = localStorage.getItem("elevate_resume_data") || localStorage.getItem("elevateResumeData") || localStorage.getItem("resumeData");
      if (raw) resume = JSON.parse(raw);
    } catch (_) {}
    const payload = {
      resume,
      item: {
        type: document.getElementById("letterType").value,
        name: document.getElementById("lName").value.trim(),
        recipient: document.getElementById("lRecipient").value.trim(),
        organisation: document.getElementById("lOrg").value.trim(),
        role: document.getElementById("lRole").value.trim(),
        points: document.getElementById("lPoints").value.trim(),
        tone
      }
    };
    try {
      const response = await window.ElevateAuth.request('/ai', { method: 'POST', body: JSON.stringify({ task: 'cover_letter', payload }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'AI request failed.');
      lastLetter = data.text || '';
      document.getElementById("letterPaper").textContent = lastLetter;
      document.getElementById("letterMeta").textContent = `${lastLetter.trim().split(/\s+/).filter(Boolean).length} words`;
      localStorage.setItem(draftKey, JSON.stringify({ ...payload.item, letter: lastLetter, savedAt: Date.now() }));
      showToast("AI letter generated", "bi-stars");
    } catch (error) {
      showToast(error.message || "AI request failed", "bi-exclamation-triangle");
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  document.getElementById("generateAiBtn")?.addEventListener("click", generateWithAI);

  document.getElementById("useResumeBtn").addEventListener("click", () => {
    try {
      const raw = localStorage.getItem("elevate_resume_data") || localStorage.getItem("elevateResumeData") || localStorage.getItem("resumeData");
      if (!raw) { showToast("No saved resume found", "bi-info-circle"); return; }
      const r = JSON.parse(raw);
      const name = r.personal?.fullName || r.personalInfo?.fullName || r.name || "";
      const summary = r.personal?.summary || r.personalInfo?.summary || r.summary || "";
      if (name) document.getElementById("lName").value = name;
      if (summary) document.getElementById("lPoints").value = summary;
      document.getElementById("resumeStatus").textContent = "Resume details loaded";
      showToast("Resume details loaded", "bi-file-earmark-check");
    } catch (e) { showToast("Saved resume could not be read", "bi-exclamation-circle"); }
  });

  document.getElementById("saveLetterBtn").addEventListener("click", () => {
    if (!lastLetter) { showToast("Generate a letter first", "bi-exclamation-circle"); return; }
    const draft={letter:lastLetter,savedAt:Date.now(),type:document.getElementById("letterType")?.value||"cover",name:document.getElementById("lName")?.value||""};
    localStorage.setItem(draftKey, JSON.stringify(draft));
    if(window.ElevateAuth?.token()) window.ElevateAuth.request('/letters',{method:'POST',body:JSON.stringify({name:draft.name ? `${draft.name} Letter` : 'Untitled Letter',data:draft})}).catch(()=>{});
    showToast(window.ElevateAuth?.token()?"Letter saved to your account":"Letter saved in this browser", "bi-bookmark-fill");
  });

  const savedDraft = JSON.parse(localStorage.getItem(draftKey) || "null");
  if (savedDraft?.letter) {
    lastLetter = savedDraft.letter;
    document.getElementById("letterPaper").textContent = lastLetter;
    document.getElementById("letterMeta").textContent = `${lastLetter.trim().split(/\s+/).filter(Boolean).length} words`;
  }

  document.getElementById("copyBtn").addEventListener("click", () => {
    if (!lastLetter) { showToast("Generate a letter first", "bi-exclamation-circle"); return; }
    navigator.clipboard.writeText(lastLetter).then(() => showToast("Copied to clipboard", "bi-clipboard-check"));
  });

  document.getElementById("letterDownloadBtn").addEventListener("click", () => {
    if (!lastLetter) { showToast("Generate a letter first", "bi-exclamation-circle"); return; }
    const blob = new Blob([lastLetter], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "letter.txt";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Letter downloaded", "bi-download");
  });
})();


/* Elevate cloud letter sync: mirrors locally saved letters into PHP/MySQL for signed-in users. */
(() => {
  const originalSet = localStorage.setItem.bind(localStorage);
  const sync = async () => {
    if (!window.ElevateAuth?.token()) return;
    try {
      const raw = localStorage.getItem('elevateSavedLetters') || localStorage.getItem('elevateLetters') || '[]';
      const list = JSON.parse(raw); if (!Array.isArray(list)) return;
      for (const item of list.slice(0, 10)) {
        if (item.serverId) continue;
        const name = item.name || item.title || 'Untitled Letter';
        const r = await window.ElevateAuth.request('/letters', {method:'POST', body:JSON.stringify({name, data:item})});
        const d = await r.json().catch(()=>({})); if (r.ok && d.id) item.serverId=d.id;
      }
      originalSet('elevateLetters', JSON.stringify(list));
    } catch (_) {}
  };
  document.addEventListener('DOMContentLoaded', () => setTimeout(sync, 900));
})();
