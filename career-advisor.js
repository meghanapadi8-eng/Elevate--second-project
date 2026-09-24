/* =====================================================================
   ELEVATE — AI CAREER ADVISOR (rule-based quiz)
===================================================================== */
(() => {
  const questions = [
    {
      q: "Which activity sounds most enjoyable to you?",
      options: [
        { text: "Solving logical puzzles and building things", tags: { tech: 2 } },
        { text: "Designing something visually appealing", tags: { design: 2 } },
        { text: "Persuading or presenting ideas to people", tags: { business: 2 } },
        { text: "Analysing numbers and finding patterns", tags: { data: 2 } },
      ]
    },
    {
      q: "In a group project, you're usually the one who…",
      options: [
        { text: "Writes the code or builds the prototype", tags: { tech: 2 } },
        { text: "Creates the visuals or the pitch deck", tags: { design: 1, business: 1 } },
        { text: "Leads the plan and coordinates the team", tags: { business: 2 } },
        { text: "Double-checks facts and figures", tags: { data: 2 } },
      ]
    },
    {
      q: "Which subject did you enjoy most in school/college?",
      options: [
        { text: "Computer Science / Mathematics", tags: { tech: 2, data: 1 } },
        { text: "Art / Media / Communication", tags: { design: 2 } },
        { text: "Economics / Commerce", tags: { business: 2 } },
        { text: "Statistics / Research methods", tags: { data: 2 } },
      ]
    },
    {
      q: "What kind of impact do you want your work to have?",
      options: [
        { text: "Build products people use every day", tags: { tech: 2 } },
        { text: "Make things beautiful and intuitive", tags: { design: 2 } },
        { text: "Grow a business or brand", tags: { business: 2 } },
        { text: "Uncover insights that drive decisions", tags: { data: 2 } },
      ]
    },
    {
      q: "Pick a tool you'd be excited to master:",
      options: [
        { text: "A programming language / framework", tags: { tech: 2 } },
        { text: "Figma / Adobe Creative Suite", tags: { design: 2 } },
        { text: "CRM / marketing & sales platforms", tags: { business: 2 } },
        { text: "Excel / SQL / Python for analysis", tags: { data: 2 } },
      ]
    },
    {
      q: "Your ideal workday involves mostly:",
      options: [
        { text: "Deep, focused problem solving", tags: { tech: 1, data: 1 } },
        { text: "Creative exploration and iteration", tags: { design: 2 } },
        { text: "Meetings, pitching, and relationship building", tags: { business: 2 } },
        { text: "Digging through data and reports", tags: { data: 2 } },
      ]
    },
  ];

  const results = {
    tech: {
      title: "Software & Technology",
      desc: "You lean toward building and problem-solving — a great fit for engineering and technical product roles where logic and craftsmanship matter.",
      skills: ["Programming fundamentals (JS/Python)", "Git & version control", "Data structures & algorithms", "Cloud basics (AWS/Azure)"],
      roles: ["Frontend Developer", "Backend Developer", "QA Engineer", "Product Engineer"]
    },
    design: {
      title: "Design & Creative",
      desc: "You're drawn to visual thinking and craft — consider paths that blend creativity with user-centred problem solving.",
      skills: ["UI/UX fundamentals", "Figma prototyping", "Typography & color theory", "Design systems"],
      roles: ["UI/UX Designer", "Graphic Designer", "Brand Designer", "Product Designer"]
    },
    business: {
      title: "Business & Management",
      desc: "You enjoy leading, persuading and building — roles in business, sales or management could suit your strengths well.",
      skills: ["Communication & negotiation", "Project management basics", "Digital marketing", "Financial literacy"],
      roles: ["Business Analyst", "Marketing Associate", "Sales Executive", "Product Manager"]
    },
    data: {
      title: "Data & Analytics",
      desc: "You're analytical and detail-oriented — a strong match for roles that turn numbers and information into decisions.",
      skills: ["Excel & SQL", "Data visualisation", "Statistics fundamentals", "Python for data analysis"],
      roles: ["Data Analyst", "Business Intelligence Analyst", "Research Analyst", "Junior Data Scientist"]
    }
  };

  let current = 0;
  let selected = null;
  const answers = [];

  const quizQuestion = document.getElementById("quizQuestion");
  const quizOptions = document.getElementById("quizOptions");
  const quizStep = document.getElementById("quizStep");
  const quizProgress = document.getElementById("quizProgress");
  const nextBtn = document.getElementById("quizNext");
  const backBtn = document.getElementById("quizBack");
  const quizWrap = document.getElementById("quizWrap");
  const resultWrap = document.getElementById("resultWrap");

  function renderQuestion() {
    const item = questions[current];
    quizQuestion.textContent = item.q;
    quizStep.textContent = `Question ${current + 1} of ${questions.length}`;
    quizProgress.style.width = `${(current / questions.length) * 100}%`;
    backBtn.disabled = current === 0;

    quizOptions.innerHTML = "";
    item.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option-btn";
      btn.textContent = opt.text;
      if (answers[current] === i) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        selected = i;
        answers[current] = i;
        [...quizOptions.children].forEach(c => c.classList.remove("selected"));
        btn.classList.add("selected");
        nextBtn.disabled = false;
      });
      quizOptions.appendChild(btn);
    });

    selected = answers[current] ?? null;
    nextBtn.disabled = selected === null;
    nextBtn.innerHTML = current === questions.length - 1
      ? 'See My Result <i class="bi bi-check-lg"></i>'
      : 'Next <i class="bi bi-arrow-right"></i>';
  }

  function computeResult() {
    const score = { tech: 0, design: 0, business: 0, data: 0 };
    answers.forEach((ansIndex, qIndex) => {
      const opt = questions[qIndex].options[ansIndex];
      Object.entries(opt.tags).forEach(([tag, val]) => score[tag] += val);
    });
    const top = Object.entries(score).sort((a, b) => b[1] - a[1])[0][0];
    return results[top];
  }

  function showResult() {
    const r = computeResult();
    const scoreMap = { tech: 88, design: 84, business: 86, data: 89 };
    const selectedTags = { tech: 0, design: 0, business: 0, data: 0 };
    answers.forEach((ansIndex, qIndex) => Object.entries(questions[qIndex].options[ansIndex].tags).forEach(([tag, val]) => selectedTags[tag] += val));
    const winner = Object.entries(selectedTags).sort((a, b) => b[1] - a[1])[0][0];
    const fit = scoreMap[winner] || 85;
    quizWrap.classList.add("hidden");
    resultWrap.classList.remove("hidden");
    quizProgress.style.width = "100%";
    document.getElementById("resultTitle").textContent = r.title;
    document.getElementById("resultDesc").textContent = r.desc;
    document.getElementById("resultSkills").innerHTML = r.skills.map(s => `<li>${s}</li>`).join("");
    document.getElementById("resultRoles").innerHTML = r.roles.map(s => `<li>${s}</li>`).join("");
    document.getElementById("matchScore").textContent = `${fit}%`;
    document.getElementById("matchFill").style.width = `${fit}%`;
    const careerData = { title: r.title, roles: r.roles, skills: r.skills, fit, savedAt: Date.now() };
    localStorage.setItem("elevateCareerResult", JSON.stringify(careerData));
    if(window.ElevateAuth?.token()) window.ElevateAuth.request('/career',{method:'POST',body:JSON.stringify({data:careerData})}).catch(()=>{});
    document.getElementById("resultJobsBtn").href = `job-search.html?role=${encodeURIComponent(r.roles[0])}`;
  }

  nextBtn.addEventListener("click", () => {
    if (selected === null) return;
    if (current < questions.length - 1) {
      current++;
      renderQuestion();
    } else {
      showResult();
    }
  });

  backBtn.addEventListener("click", () => {
    if (current > 0) { current--; renderQuestion(); }
  });

  document.getElementById("retakeBtn").addEventListener("click", () => {
    current = 0; answers.length = 0; selected = null;
    resultWrap.classList.add("hidden");
    quizWrap.classList.remove("hidden");
    renderQuestion();
    showToast("Quiz restarted", "bi-arrow-repeat");
  });

  renderQuestion();
})();
