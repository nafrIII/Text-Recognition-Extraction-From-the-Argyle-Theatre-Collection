const posterDatabase = (window.POSTER_DATA || []).map((poster) => ({
  ...poster,
  extracted_text: poster.extracted_text || "",
}));

const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const resultsTitle = document.getElementById("resultsTitle");
const resultsDescription = document.getElementById("resultsDescription");
const resultsList = document.getElementById("resultsList");
const trendingList = document.getElementById("trendingList");
const recentList = document.getElementById("recentList");
const filterToggle = document.getElementById("filterToggle");
const filterDropdown = document.getElementById("filterDropdown");
const filterChips = [...document.querySelectorAll(".filter-chip")];
const topicButtons = [...document.querySelectorAll("#trendingList button")];

const RECENT_SEARCHES_KEY = "historic-poster-recent-searches";
const MAX_RECENT_SEARCHES = 5;
let activeCategory = "";

function loadRecentSearches() {
  try {
    const value = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!value) {
      return [];
    }

    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveRecentSearches(searches) {
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches));
  } catch {
    // Ignore storage failures so the search UI still works.
  }
}

function renderRecentSearches(searches) {
  if (!searches.length) {
    recentList.innerHTML = `
      <li class="empty-recent">
        <span>Your searches will appear here.</span>
      </li>
    `;
    return;
  }

  recentList.innerHTML = searches
    .map(
      (search) => `
        <li class="recent-search-item">
          <button type="button" class="recent-search-button" data-search="${escapeHtml(search)}">
            <span>${escapeHtml(search)}</span>
            <span class="recent-remove-icon" data-remove-search="${escapeHtml(search)}" aria-hidden="true">&times;</span>
          </button>
        </li>
      `
    )
    .join("");
}

function storeRecentSearch(query) {
  const normalized = query.trim();
  if (!normalized) {
    return;
  }

  const existing = loadRecentSearches().filter(
    (item) => item.toLowerCase() !== normalized.toLowerCase()
  );
  const next = [normalized, ...existing].slice(0, MAX_RECENT_SEARCHES);
  saveRecentSearches(next);
  renderRecentSearches(next);
}

function removeRecentSearch(query) {
  const normalized = query.trim().toLowerCase();
  const next = loadRecentSearches().filter(
    (item) => item.toLowerCase() !== normalized
  );
  saveRecentSearches(next);
  renderRecentSearches(next);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightText(text, query) {
  const escaped = escapeHtml(text || "");

  if (!query) {
    return escaped;
  }

  const pattern = new RegExp(`(${escapeRegExp(query)})`, "gi");
  return escaped.replace(pattern, "<mark>$1</mark>");
}

function createSnippet(text, query) {
  const source = String(text || "");
  if (!query) {
    return `${source.slice(0, 150)}...`;
  }

  const lowerText = source.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);

  if (matchIndex === -1) {
    return `${source.slice(0, 160)}...`;
  }

  const start = Math.max(0, matchIndex - 50);
  const end = Math.min(source.length, matchIndex + query.length + 90);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < source.length ? "..." : "";
  return `${prefix}${source.slice(start, end)}${suffix}`;
}

function buildSearchableText(poster) {
  return [
    poster.title,
    poster.performance_date,
    poster.source_file,
    poster.extracted_text,
    (poster.entities || []).join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

function localKeywordSearch(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  return posterDatabase
    .map((poster) => {
      const searchable = buildSearchableText(poster);
      let score = 0;

      if ((poster.title || "").toLowerCase().includes(normalized)) {
        score += 8;
      }
      if (((poster.entities || []).join(" ")).toLowerCase().includes(normalized)) {
        score += 5;
      }
      if (searchable.includes(normalized)) {
        score += 3;
      }

      return { ...poster, query_score: score };
    })
    .filter((poster) => poster.query_score > 0)
    .sort((left, right) => right.query_score - left.query_score);
}

function renderEmptyState(query) {
  resultsList.innerHTML = `
    <article class="result-item empty-state">
      <div>
        <h4>No posters found</h4>
        <p>No matches were returned for "${escapeHtml(query)}". Try a performer, mood, act type, venue clue, or date phrase.</p>
      </div>
    </article>
  `;
}

function renderResults(records, query) {
  if (!records.length) {
    renderEmptyState(query);
    return;
  }

  resultsList.innerHTML = records
    .map((poster) => {
      const snippet = highlightText(createSnippet(poster.extracted_text, query), query);
      const fullText = highlightText(poster.extracted_text, query);
      const metadata = [
        poster.accession_id ? `<span class="pill">${escapeHtml(poster.accession_id)}</span>` : "",
        poster.source_file ? `<span class="pill">${escapeHtml(poster.source_file)}</span>` : "",
        poster.performance_date ? `<span class="pill">${escapeHtml(poster.performance_date)}</span>` : "",
        Number.isFinite(Number(poster.act_count)) && Number(poster.act_count) > 0
          ? `<span class="pill">${poster.act_count} extracted acts</span>`
          : "",
      ]
        .filter(Boolean)
        .join("");
      const entities = (poster.entities || [])
        .map((entity) => `<span class="pill">${highlightText(entity, query)}</span>`)
        .join("");
      const citationData = encodeURIComponent(poster.citation || "");
      return `
        <article class="result-item">
          <div class="poster-preview">
            <div class="poster-image">
              <img src="${escapeHtml(poster.image_path)}" alt="${escapeHtml(poster.title)}">
            </div>
            <p class="poster-caption">${escapeHtml(poster.source_file)}</p>
          </div>
          <div class="result-body">
            <h4>${highlightText(poster.title, query)}</h4>
            <div class="metadata-row">${metadata}</div>
            <p class="snippet">${snippet}</p>
            <p class="full-text">${fullText}</p>
            <div class="entity-row">${entities}</div>
            <div class="citation-row">
              <a class="citation-link" href="data:text/plain;charset=utf-8,${citationData}" download="${poster.id}-citation.txt">Download Citation</a>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function updateQuerySummary(query, count, searchMeta = {}) {
  const normalized = query.trim();

  if (!normalized) {
    resultsTitle.textContent = "User poster archive";
    resultsDescription.textContent =
      "Shared archive records are available below with SQL-backed search results.";
    return;
  }

  resultsTitle.textContent = normalized;
  if (searchMeta.mode === "sql") {
    resultsDescription.textContent =
      `${count} archive record${count === 1 ? "" : "s"} matched directly from the shared poster database using SQL exact matching.`;
    return;
  }

  if (searchMeta.mode === "semantic") {
    resultsDescription.textContent =
      `${count} archive record${count === 1 ? "" : "s"} matched through semantic similarity because no direct SQL match was found.`;
    return;
  }

  resultsDescription.textContent =
    `${count} archive record${count === 1 ? "" : "s"} matched using SQLite exact matching across the shared poster database.`;
}

function updateTopicVisibility(query) {
  const normalized = query.trim().toLowerCase();

  [...trendingList.querySelectorAll("li")].forEach((item) => {
    const matches = item.textContent.toLowerCase().includes(normalized);
    item.classList.toggle("hidden", Boolean(normalized) && !matches);
  });
}

async function fetchSearchResults(query, category = "") {
  const response = await fetch(
    `/api/search?q=${encodeURIComponent(query)}&category=${encodeURIComponent(category)}`
  );
  if (!response.ok) {
    throw new Error(`Search request failed with ${response.status}`);
  }
  return response.json();
}

function getEffectiveQuery(query) {
  const base = query.trim();
  if (!activeCategory) {
    return base;
  }
  return [base, activeCategory].filter(Boolean).join(" ");
}

function getDisplayQuery(query) {
  const parts = [];
  const base = query.trim();
  if (base) {
    parts.push(base);
  }
  if (activeCategory) {
    parts.push(activeCategory);
  }
  return parts.join(" / ");
}

function setActiveCategory(category) {
  activeCategory = category;
  filterChips.forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.category === category);
  });
}

function setFilterDropdownOpen(isOpen) {
  filterDropdown.classList.toggle("hidden", !isOpen);
  filterToggle.setAttribute("aria-expanded", String(isOpen));
}

async function runSearch(query, options = {}) {
  const { persist = false } = options;
  const effectiveQuery = getEffectiveQuery(query);
  const displayQuery = getDisplayQuery(query);

  if (!effectiveQuery.trim()) {
    try {
      const data = await fetchSearchResults("", activeCategory);
      const records = (data.records || []).length ? data.records : posterDatabase.slice(0, 8);
      updateQuerySummary("", records.length, { mode: "idle" });
      updateTopicVisibility("");
      renderResults(records, "");
    } catch {
      const records = posterDatabase.slice(0, 8);
      updateQuerySummary("", records.length, { mode: "idle" });
      updateTopicVisibility("");
      renderResults(records, "");
    }
    return;
  }

  try {
    const data = await fetchSearchResults(query.trim(), activeCategory);
    updateQuerySummary(displayQuery, data.count || 0, {
      mode: data.mode,
      reason: data.reason || "",
      debug: data.debug || "",
    });
    updateTopicVisibility(displayQuery);
    renderResults(data.records || [], effectiveQuery);
  } catch {
    const fallbackRecords = localKeywordSearch(effectiveQuery);
    updateQuerySummary(displayQuery, fallbackRecords.length, {
      mode: "keyword",
      reason: "Backend unavailable, so the interface used local keyword fallback.",
    });
    updateTopicVisibility(displayQuery);
    renderResults(fallbackRecords, effectiveQuery);
  }

  if (persist) {
    storeRecentSearch(query);
  }
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(searchInput.value, { persist: true });
});

searchInput.addEventListener("input", (event) => {
  runSearch(event.target.value);
});

topicButtons.forEach((button) => {
  button.addEventListener("click", () => {
    searchInput.value = button.textContent;
    runSearch(button.textContent, { persist: true });
  });
});

recentList.addEventListener("click", (event) => {
  const removeIcon = event.target.closest(".recent-remove-icon");
  if (removeIcon) {
    removeRecentSearch(removeIcon.dataset.removeSearch || "");
    return;
  }

  const searchButton = event.target.closest(".recent-search-button");
  if (!searchButton) {
    return;
  }

  const search = searchButton.dataset.search || searchButton.textContent;
  searchInput.value = search;
  runSearch(search, { persist: true });
});

filterToggle.addEventListener("click", () => {
  const isOpen = filterDropdown.classList.contains("hidden");
  setFilterDropdownOpen(isOpen);
});

filterDropdown.addEventListener("click", (event) => {
  const chip = event.target.closest(".filter-chip");
  if (!chip) {
    return;
  }

  setActiveCategory(chip.dataset.category || "");
  setFilterDropdownOpen(false);
  runSearch(searchInput.value);
});

document.addEventListener("click", (event) => {
  if (
    filterDropdown.classList.contains("hidden") ||
    filterDropdown.contains(event.target) ||
    filterToggle.contains(event.target)
  ) {
    return;
  }

  setFilterDropdownOpen(false);
});

renderRecentSearches(loadRecentSearches());
setActiveCategory("");
setFilterDropdownOpen(false);
const initialRecords = posterDatabase.slice(0, 8);
updateQuerySummary("", initialRecords.length, { mode: "idle" });
renderResults(initialRecords, "");
runSearch("");
