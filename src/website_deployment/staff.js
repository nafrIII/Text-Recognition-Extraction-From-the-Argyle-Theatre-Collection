const staffSearchForm = document.getElementById("staffSearchForm");
const staffSearchInput = document.getElementById("staffSearchInput");
const staffFilterToggle = document.getElementById("staffFilterToggle");
const staffFilterDropdown = document.getElementById("staffFilterDropdown");
const staffFilterChips = [...document.querySelectorAll("#staffFilterDropdown .filter-chip")];
const uploadForm = document.getElementById("uploadForm");
const posterImage = document.getElementById("posterImage");
const uploadTrigger = document.getElementById("uploadTrigger");
const uploadRemove = document.getElementById("uploadRemove");
const uploadPreview = document.getElementById("uploadPreview");
const uploadFilename = document.getElementById("uploadFilename");
const uploadStatus = document.getElementById("uploadStatus");
const staffSummary = document.getElementById("staffSummary");
const staffResultsTitle = document.getElementById("staffResultsTitle");
const staffResultsDescription = document.getElementById("staffResultsDescription");
const staffResultsList = document.getElementById("staffResultsList");
const staffRecentSearches = document.getElementById("staffRecentSearches");

const STAFF_RECENT_KEY = "staff-poster-recent-searches";
const MAX_RECENT = 6;
let activeCategory = "";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightText(text, query) {
  const source = escapeHtml(text || "");
  if (!query) {
    return source;
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.replace(new RegExp(`(${escaped})`, "gi"), "<mark>$1</mark>");
}

function createSnippet(text, query) {
  const source = String(text || "");
  if (!query) {
    return `${source.slice(0, 160)}...`;
  }
  const index = source.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) {
    return `${source.slice(0, 180)}...`;
  }
  const start = Math.max(0, index - 60);
  const end = Math.min(source.length, index + query.length + 100);
  return `${start > 0 ? "..." : ""}${source.slice(start, end)}${end < source.length ? "..." : ""}`;
}

function loadRecentSearches() {
  try {
    const raw = window.localStorage.getItem(STAFF_RECENT_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveRecentSearches(searches) {
  try {
    window.localStorage.setItem(STAFF_RECENT_KEY, JSON.stringify(searches));
  } catch {
    // Ignore storage failures.
  }
}

function renderRecentSearches(searches) {
  if (!searches.length) {
    staffRecentSearches.innerHTML = `
      <li class="empty-recent">
        <span>Recent staff searches appear here.</span>
      </li>
    `;
    return;
  }

  staffRecentSearches.innerHTML = searches
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

  const next = [
    normalized,
    ...loadRecentSearches().filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
  ].slice(0, MAX_RECENT);
  saveRecentSearches(next);
  renderRecentSearches(next);
}

function removeRecentSearch(query) {
  const next = loadRecentSearches().filter((item) => item.toLowerCase() !== query.trim().toLowerCase());
  saveRecentSearches(next);
  renderRecentSearches(next);
}

function setDropdownOpen(open) {
  staffFilterDropdown.classList.toggle("hidden", !open);
  staffFilterToggle.setAttribute("aria-expanded", String(open));
}

function setActiveCategory(category) {
  activeCategory = category;
  staffFilterChips.forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.category === category);
  });
}

function getEffectiveSearch(query) {
  return [query.trim(), activeCategory].filter(Boolean).join(" ");
}

function renderEmptyState(query) {
  staffResultsList.innerHTML = `
    <article class="result-item empty-state">
      <div>
        <h4>No archive posters found</h4>
        <p>No SQL matches were returned for "${escapeHtml(query)}". Try exact titles, categories, performer names, or citation text.</p>
      </div>
    </article>
  `;
}

function renderResults(records, query) {
  if (!records.length) {
    renderEmptyState(query);
    return;
  }

  staffResultsList.innerHTML = records
    .map((record) => {
      const categories = String(record.categories || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => `<span class="pill">${highlightText(item, query)}</span>`)
        .join("");
      const entities = (record.entities || [])
        .map((item) => `<span class="pill">${highlightText(item, query)}</span>`)
        .join("");
      const snippet = highlightText(createSnippet(record.extracted_text, query), query);
      const citationData = encodeURIComponent(record.citation || "");
      const image = record.image_path
        ? `<div class="poster-image"><img src="${escapeHtml(record.image_path)}" alt="${escapeHtml(record.title)}"></div>`
        : `<div class="poster-image poster-placeholder">No image uploaded</div>`;

      return `
        <article class="result-item">
          <div class="poster-preview">
            ${image}
            <p class="poster-caption">${escapeHtml(record.source_file || "Uploaded record")}</p>
          </div>
          <div class="result-body">
            <h4>${highlightText(record.title, query)}</h4>
            <div class="metadata-row">
              <span class="pill">${escapeHtml(record.performance_date || "No date")}</span>
            </div>
            <div class="entity-row">${categories}${entities}</div>
            <p class="snippet">${snippet}</p>
            <p class="full-text">${highlightText(record.extracted_text, query)}</p>
            <div class="citation-row">
              <a class="citation-link" href="data:text/plain;charset=utf-8,${citationData}" download="staff-poster-${record.id}-citation.txt">Download Citation</a>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

async function fetchStaffResults(query, category) {
  const response = await fetch(`/api/staff/search?q=${encodeURIComponent(query)}&category=${encodeURIComponent(category)}`);
  if (!response.ok) {
    throw new Error(`Staff search failed with ${response.status}`);
  }
  return response.json();
}

async function runStaffSearch(query, options = {}) {
  const { persist = false } = options;
  const effectiveQuery = getEffectiveSearch(query);

  staffResultsTitle.textContent = query.trim() || activeCategory || "Staff poster database";

  try {
    const data = await fetchStaffResults(query, activeCategory);
    staffResultsDescription.textContent =
      `${data.count} archive record${data.count === 1 ? "" : "s"} matched using SQLite exact matching across the shared poster database.`;
    staffSummary.textContent =
      "Recent staff searches appear here and can be rerun against the shared archive instantly.";
    renderResults(data.records || [], effectiveQuery || query.trim());
  } catch (error) {
    staffResultsDescription.textContent = `Staff search failed: ${error.message}`;
    staffSummary.textContent =
      "Recent staff searches appear here and can be rerun against the shared archive instantly.";
    renderEmptyState(effectiveQuery || query.trim());
  }

  if (persist && query.trim()) {
    storeRecentSearch(query.trim());
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read selected image"));
    reader.readAsDataURL(file);
  });
}

function resetUploadPreview() {
  uploadPreview.src = "";
  uploadPreview.classList.add("hidden");
  uploadRemove.classList.add("hidden");
  uploadTrigger.classList.remove("has-image");
  uploadFilename.textContent = "No file selected";
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  uploadStatus.textContent = "Uploading poster into the shared SQLite archive...";

  try {
    const imageFile = posterImage.files?.[0];
    if (!imageFile) {
      throw new Error("Choose a poster image first");
    }
    const imageData = await readFileAsDataUrl(imageFile);

    const response = await fetch("/api/staff/posters", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_name: imageFile?.name || "",
        image_data: imageData,
        source_file: imageFile?.name || "",
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Upload failed");
    }

    uploadStatus.textContent = `Uploaded poster record #${payload.record.id} successfully into the shared archive.`;
    uploadForm.reset();
    resetUploadPreview();
    await runStaffSearch(staffSearchInput.value);
  } catch (error) {
    uploadStatus.textContent = `Upload failed: ${error.message}`;
  }
});

uploadTrigger.addEventListener("click", () => {
  posterImage.click();
});

posterImage.addEventListener("change", () => {
  const file = posterImage.files?.[0];
  if (!file) {
    resetUploadPreview();
    return;
  }

  uploadFilename.textContent = file.name;
  uploadRemove.classList.remove("hidden");
  uploadTrigger.classList.add("has-image");

  const reader = new FileReader();
  reader.onload = () => {
    uploadPreview.src = String(reader.result || "");
    uploadPreview.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

uploadRemove.addEventListener("click", (event) => {
  event.stopPropagation();
  posterImage.value = "";
  resetUploadPreview();
});

staffSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runStaffSearch(staffSearchInput.value, { persist: true });
});

staffSearchInput.addEventListener("input", (event) => {
  runStaffSearch(event.target.value);
});

staffFilterToggle.addEventListener("click", () => {
  setDropdownOpen(staffFilterDropdown.classList.contains("hidden"));
});

staffFilterDropdown.addEventListener("click", (event) => {
  const chip = event.target.closest(".filter-chip");
  if (!chip) {
    return;
  }

  setActiveCategory(chip.dataset.category || "");
  setDropdownOpen(false);
  runStaffSearch(staffSearchInput.value);
});

staffRecentSearches.addEventListener("click", (event) => {
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
  staffSearchInput.value = search;
  runStaffSearch(search, { persist: true });
});

document.addEventListener("click", (event) => {
  if (
    staffFilterDropdown.classList.contains("hidden") ||
    staffFilterDropdown.contains(event.target) ||
    staffFilterToggle.contains(event.target)
  ) {
    return;
  }

  setDropdownOpen(false);
});

renderRecentSearches(loadRecentSearches());
setActiveCategory("");
setDropdownOpen(false);
resetUploadPreview();
runStaffSearch("");
