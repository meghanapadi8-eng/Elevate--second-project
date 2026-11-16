/* =====================================================================
   ELEVATE — SHARED SITE SCRIPT
===================================================================== */

document.addEventListener("DOMContentLoaded", () => {

  /* Accessibility: keyboard-friendly skip link */
  const main = document.querySelector("main, #home");
  if (main && !document.querySelector(".skip-link")) {
    if (!main.id) main.id = "main-content";
    const skip = document.createElement("a");
    skip.className = "skip-link";
    skip.href = "#" + main.id;
    skip.textContent = "Skip to main content";
    document.body.prepend(skip);
  }

  /* Mobile nav toggle */
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      links.classList.toggle("open");
      const icon = toggle.querySelector("i");
      const open = links.classList.contains("open");
      toggle.setAttribute("aria-expanded", open);
      if (icon) icon.className = open ? "bi bi-x-lg" : "bi bi-list";
    });
    links.querySelectorAll("a").forEach(a => a.addEventListener("click", () => {
      links.classList.remove("open");
      const icon = toggle.querySelector("i");
      if (icon) icon.className = "bi bi-list";
    }));
  }

  /* Highlight active nav link based on current page */
  const current = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a[data-page]").forEach(a => {
    if (a.dataset.page === current) a.classList.add("active");
  });

  /* Header shadow on scroll */
  const header = document.querySelector(".site-header");
  if (header) {
    const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* Scroll-reveal animation */
  const revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(el => io.observe(el));
  }

  /* Smooth-scroll for on-page anchors */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      if (id.length > 1) {
        const target = document.querySelector(id);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    });
  });


  /* Persistent light/dark theme */
  const themeToggle = document.getElementById("themeToggle");
  const savedTheme = localStorage.getItem("elevate-theme");
  const applyTheme = (theme) => {
    const dark = theme === "dark";
    document.body.classList.toggle("theme-dark", dark);
    if (themeToggle) {
      themeToggle.innerHTML = dark
        ? '<i class="bi bi-sun-fill"></i><span class="visually-hidden">Switch to light mode</span>'
        : '<i class="bi bi-moon-stars"></i><span class="visually-hidden">Switch to dark mode</span>';
      themeToggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      themeToggle.setAttribute("title", dark ? "Switch to light mode" : "Switch to dark mode");
    }
  };
  applyTheme(savedTheme === "dark" ? "dark" : "light");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const next = document.body.classList.contains("theme-dark") ? "light" : "dark";
      localStorage.setItem("elevate-theme", next);
      applyTheme(next);
    });
  }

  /* Reading progress + accessible back-to-top control */
  const progress = document.createElement("div");
  progress.className = "scroll-progress";
  progress.setAttribute("aria-hidden", "true");
  document.body.appendChild(progress);

  const topButton = document.createElement("button");
  topButton.className = "back-to-top";
  topButton.type = "button";
  topButton.setAttribute("aria-label", "Back to top");
  topButton.title = "Back to top";
  topButton.innerHTML = '<i class="bi bi-arrow-up"></i>';
  document.body.appendChild(topButton);

  const updateScrollUI = () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const percent = scrollable > 0 ? Math.min(100, Math.max(0, window.scrollY / scrollable * 100)) : 0;
    progress.style.width = percent + "%";
    topButton.classList.toggle("show", window.scrollY > 420);
  };
  window.addEventListener("scroll", updateScrollUI, { passive: true });
  updateScrollUI();
  topButton.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  /* Lightweight command palette — press / or Ctrl/Cmd + K */
  if (!document.querySelector(".command-palette")) {
    const palette = document.createElement("div");
    palette.className = "command-palette";
    palette.innerHTML = `<div class="command-backdrop"></div><div class="command-dialog" role="dialog" aria-modal="true" aria-label="Quick navigation"><div class="command-head"><i class="bi bi-search"></i><input id="commandInput" autocomplete="off" placeholder="Search Elevate tools..." aria-label="Search Elevate tools"><kbd>Esc</kbd></div><div class="command-results" id="commandResults"></div></div>`;
    document.body.appendChild(palette);
    const items=[
      ["Resume Builder","Build or edit your ATS-friendly resume","resume-builder.html","bi-file-earmark-person"],
      ["Job Search","Find live opportunities and track applications","job-search.html","bi-briefcase"],
      ["Career","Explore career directions and build a 30-day plan","career-advisor.html","bi-compass"],
      ["Letter Generator","Create a polished application letter","letter-generator.html","bi-envelope-paper"],
      ["Dashboard","Open your career workspace","dashboard.html","bi-grid-1x2"],
      ["Launch Center","Run final QA and deployment readiness checks","launch-center.html","bi-rocket-takeoff"]
    ];
    const input=palette.querySelector("#commandInput"), results=palette.querySelector("#commandResults");
    const render=(q="")=>{const filtered=items.filter(x=>(x[0]+x[1]).toLowerCase().includes(q.toLowerCase()));results.innerHTML=filtered.map((x,i)=>`<a class="command-item" href="${x[2]}"><span class="command-item-icon"><i class="bi ${x[3]}"></i></span><span><strong>${x[0]}</strong><small>${x[1]}</small></span><i class="bi bi-arrow-up-right"></i></a>`).join("")||'<div class="command-empty">No matching tool found.</div>';};
    const open=()=>{palette.classList.add("show");render();setTimeout(()=>input.focus(),30);};
    const close=()=>{palette.classList.remove("show");};
    render();
    document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();open();} else if(e.key==="/" && !/[input|textarea|select]/i.test(e.target.tagName)){e.preventDefault();open();} else if(e.key==="Escape") close();});
    palette.querySelector(".command-backdrop").addEventListener("click",close);
    input.addEventListener("input",()=>render(input.value));
  }

  /* Footer year */
  document.querySelectorAll(".current-year").forEach(el => el.textContent = new Date().getFullYear());
});

/* Global toast helper, available to every page script */
function showToast(message, icon = "bi-check-circle-fill") {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<i class="bi ${icon}"></i><span>${message}</span>`;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 2600);
}
