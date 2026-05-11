const STORAGE_KEY = "profesores_huinia_progress_v1";
const QUESTIONS_VERSION = "20260510-1";

const QUESTION_FILES = [
  "./questions/profesores_huinia.json"
];

let questions = [];
let progress = {};
let currentQuestion = null;
let currentShuffledOptions = [];
let currentCorrectIndex = null;
let answered = false;
let recentQuestionIds = [];
let failedQuestionFiles = [];

const RECENT_QUESTION_BLOCK_COUNT = 2;
const MASTERED_WEIGHT = 2;

async function init() {
  setLoadingState("Kraunami profesorės klausimai...", true);
  await loadQuestions();
  registerEvents();
  updateStats();
  renderVersion();
  renderLoadStatus();
  registerServiceWorker();
}

async function loadQuestions() {
  questions = [];
  failedQuestionFiles = [];

  for (const filePath of QUESTION_FILES) {
    try {
      const response = await fetch(`${filePath}?v=${QUESTIONS_VERSION}`, {
        cache: "no-store"
      });

      if (!response.ok) {
        console.error(`Nepavyko užkrauti failo: ${filePath}`);
        failedQuestionFiles.push(filePath);
        continue;
      }

      const data = await response.json();

      if (!Array.isArray(data)) {
        console.error(`Failas nėra JSON masyvas: ${filePath}`);
        failedQuestionFiles.push(filePath);
        continue;
      }

      const fileName = getFileNameWithoutExtension(filePath);

      const normalizedQuestions = data.map((q, index) => ({
        ...q,
        _uid: `${fileName}__${q.id ?? index + 1}`,
        _source: fileName
      }));

      questions = questions.concat(normalizedQuestions);

      console.log(`Užkrauta iš ${fileName}: ${normalizedQuestions.length} klausimų`);
    } catch (error) {
      console.error(`Klaida kraunant ${filePath}:`, error);
      failedQuestionFiles.push(filePath);
    }
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    progress = saved ? JSON.parse(saved) : {};
  } catch {
    progress = {};
  }

  const validQuestionIds = new Set(questions.map(q => q._uid));
  const cleanedProgress = {};

  for (const key in progress) {
    if (validQuestionIds.has(key)) {
      cleanedProgress[key] = progress[key];
    }
  }

  progress = cleanedProgress;

  for (const q of questions) {
    if (!progress[q._uid]) {
      progress[q._uid] = createEmptyProgress();
    }
  }

  saveProgress();

  console.log(`Viso užkrauta klausimų: ${questions.length}`);
}

function setLoadingState(message, disableStart) {
  const statusEl = document.getElementById("loadStatus");
  const startBtn = document.getElementById("startBtn");

  if (statusEl) {
    statusEl.textContent = message;
  }

  if (startBtn) {
    startBtn.disabled = disableStart;
  }
}

function renderLoadStatus() {
  if (questions.length === 0) {
    setLoadingState("Klausimų užkrauti nepavyko. Patikrink JSON failą ir perkrauk puslapį.", true);
    return;
  }

  if (failedQuestionFiles.length > 0) {
    setLoadingState(
      `Dalis klausimų neužsikrovė (${failedQuestionFiles.length} fail.). Testas veiks, bet ne su pilnu rinkiniu.`,
      false
    );
    return;
  }

  setLoadingState(`Užkrauta ${questions.length} klausimų. Profesorė pasiruošusi.`, false);
}

function getFileNameWithoutExtension(path) {
  const parts = path.split("/");
  const fileName = parts[parts.length - 1];
  return fileName.replace(".json", "");
}

function createEmptyProgress() {
  return {
    streak: 0,
    correctTotal: 0,
    wrongTotal: 0,
    seenTotal: 0,
    mastered: false
  };
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function rebuildFreshProgress() {
  const fresh = {};
  for (const q of questions) {
    fresh[q._uid] = createEmptyProgress();
  }
  return fresh;
}

function updateStats() {
  const total = questions.length;
  const mastered = questions.filter(q => progress[q._uid]?.mastered).length;
  const remaining = total - mastered;
  const percent = total === 0 ? 0 : Math.round((mastered / total) * 100);

  document.getElementById("masteredCount").textContent = mastered;
  document.getElementById("totalCount").textContent = total;
  document.getElementById("remainingCount").textContent = remaining;
  document.getElementById("progressText").textContent =
    `${mastered} / ${total} išmokta (${percent}%)`;
  document.getElementById("progressFill").style.width = `${percent}%`;
}

function getQuestionWeight(question) {
  const p = progress[question._uid];

  if (!p) return 7;

  if (p.mastered) {
    return MASTERED_WEIGHT;
  }

  let weight = 1;
  weight += p.wrongTotal * 4;
  weight += Math.max(0, 3 - p.streak) * 2;

  return weight;
}

function addToRecentQuestions(questionUid) {
  recentQuestionIds.push(questionUid);

  while (recentQuestionIds.length > RECENT_QUESTION_BLOCK_COUNT) {
    recentQuestionIds.shift();
  }
}

function pickRandomWeightedQuestion(pool) {
  const weighted = [];

  for (const q of pool) {
    const weight = getQuestionWeight(q);
    for (let i = 0; i < weight; i++) {
      weighted.push(q);
    }
  }

  if (weighted.length === 0) return null;
  return weighted[Math.floor(Math.random() * weighted.length)];
}

function pickNextQuestion() {
  if (questions.length === 0) return null;

  let filtered = questions.filter(q => !recentQuestionIds.includes(q._uid));

  if (filtered.length === 0) {
    filtered = questions;
  }

  return pickRandomWeightedQuestion(filtered);
}

function shuffleQuestionOptions(question) {
  const optionObjects = question.options.map((option, index) => ({
    text: option,
    isCorrect: index === question.correct
  }));

  for (let i = optionObjects.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [optionObjects[i], optionObjects[j]] = [optionObjects[j], optionObjects[i]];
  }

  const shuffledOptions = optionObjects.map(item => item.text);
  const correctIndex = optionObjects.findIndex(item => item.isCorrect);

  return {
    shuffledOptions,
    correctIndex
  };
}

function scrollToQuizTop() {
  const quizPanel = document.getElementById("quizPanel");
  if (!quizPanel) return;

  const top = quizPanel.getBoundingClientRect().top + window.scrollY - 8;
  window.scrollTo({
    top,
    behavior: "smooth"
  });
}

function startQuiz() {
  if (questions.length === 0) return;

  document.body.classList.add("quiz-active");
  document.getElementById("startPanel").classList.add("hidden");
  document.getElementById("quizPanel").classList.remove("hidden");
  showQuestion();
}

function showQuestion() {
  answered = false;
  currentQuestion = pickNextQuestion();

  if (!currentQuestion) {
    document.body.classList.remove("quiz-active");
    document.getElementById("quizPanel").classList.add("hidden");
    document.getElementById("startPanel").classList.remove("hidden");
    alert("Nepavyko parinkti klausimo.");
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  addToRecentQuestions(currentQuestion._uid);

  const shuffledData = shuffleQuestionOptions(currentQuestion);
  currentShuffledOptions = shuffledData.shuffledOptions;
  currentCorrectIndex = shuffledData.correctIndex;

  document.getElementById("questionCategory").textContent =
    currentQuestion.category || "Bakalaurinis";

  document.getElementById("questionTitle").textContent = currentQuestion.question;

  document.getElementById("questionCounter").textContent =
    `Matytas ${progress[currentQuestion._uid].seenTotal} kartus`;

  const answersContainer = document.getElementById("answersContainer");
  answersContainer.innerHTML = "";

  currentShuffledOptions.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-btn";

    const label = document.createElement("strong");
    label.textContent = `${String.fromCharCode(65 + index)}. `;

    button.appendChild(label);
    button.append(option);
    button.addEventListener("click", () => handleAnswer(index));

    answersContainer.appendChild(button);
  });

  document.getElementById("resultBox").classList.add("hidden");
  setTimeout(scrollToQuizTop, 80);
}

function handleAnswer(selectedIndex) {
  if (answered || !currentQuestion) return;
  answered = true;

  const p = progress[currentQuestion._uid];
  p.seenTotal += 1;

  const buttons = document.querySelectorAll(".answer-btn");
  const isCorrect = selectedIndex === currentCorrectIndex;

  buttons.forEach((btn, index) => {
    btn.disabled = true;

    if (index === currentCorrectIndex) {
      btn.classList.add("correct");
    } else if (index === selectedIndex) {
      btn.classList.add("wrong");
    } else {
      btn.classList.add("neutral");
    }
  });

  const resultTitle = document.getElementById("resultTitle");
  const resultExplanation = document.getElementById("resultExplanation");
  const correctAnswerText = document.getElementById("correctAnswerText");

  if (isCorrect) {
    p.correctTotal += 1;
    p.streak += 1;

    if (p.streak >= 3) {
      p.mastered = true;
    }

    resultTitle.textContent = "Teisingai";
    resultTitle.className = "result-title good";
  } else {
    p.wrongTotal += 1;
    p.streak = 0;
    p.mastered = false;

    resultTitle.textContent = "Neteisingai";
    resultTitle.className = "result-title bad";
  }

  resultExplanation.textContent = currentQuestion.explanation || "";
  correctAnswerText.textContent =
    `Teisingas atsakymas: ${currentShuffledOptions[currentCorrectIndex]}`;

  document.getElementById("resultBox").classList.remove("hidden");

  saveProgress();
  updateStats();

  setTimeout(scrollToQuizTop, 80);
}

function resetProgress() {
  if (!confirm("Ar tikrai nori ištrinti progresą?")) return;

  progress = rebuildFreshProgress();
  currentQuestion = null;
  currentShuffledOptions = [];
  currentCorrectIndex = null;
  answered = false;
  recentQuestionIds = [];

  saveProgress();
  updateStats();

  document.body.classList.remove("quiz-active");
  document.getElementById("quizPanel").classList.add("hidden");
  document.getElementById("startPanel").classList.remove("hidden");
  document.getElementById("answersContainer").innerHTML = "";
  document.getElementById("resultBox").classList.add("hidden");

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function backToStart() {
  document.body.classList.remove("quiz-active");
  document.getElementById("quizPanel").classList.add("hidden");
  document.getElementById("startPanel").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function registerEvents() {
  document.getElementById("startBtn").addEventListener("click", startQuiz);
  document.getElementById("nextBtn").addEventListener("click", showQuestion);
  document.getElementById("backBtn").addEventListener("click", backToStart);
  document.getElementById("menuBtn").addEventListener("click", backToStart);
  document.getElementById("resetBtn").addEventListener("click", resetProgress);
}

function renderVersion() {
  const versionEl = document.getElementById("appVersion");
  if (!versionEl) return;

  versionEl.textContent = `Versija: ${QUESTIONS_VERSION}`;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(error => {
      console.error("Nepavyko užregistruoti service worker:", error);
    });
  });
}

init();