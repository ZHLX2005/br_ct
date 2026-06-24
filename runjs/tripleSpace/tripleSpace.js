let spaceCount = 0;
let lastSpaceTime = 0;
let activeNotebook = null;
let notesData = [];
let activeEscapeHandler = null;

const NOTES_STORAGE_KEY = "quickNotes";
const MAX_PREVIEW_NOTES = 6;

function loadNotes(callback) {
    chrome.storage.local.get([NOTES_STORAGE_KEY], (result) => {
        notesData = Array.isArray(result[NOTES_STORAGE_KEY]) ? result[NOTES_STORAGE_KEY] : [];
        if (callback) callback(notesData);
    });
}

function saveNotesToStorage(callback) {
    chrome.storage.local.set({ [NOTES_STORAGE_KEY]: notesData }, () => {
        if (callback) callback();
    });
}

function isEditableTarget(target) {
    return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function formatRelativeTime(isoString) {
    const date = new Date(isoString);
    const diff = Date.now() - date.getTime();

    if (diff < 60 * 1000) return "just now";
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} min ago`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))} h ago`;
    if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))} d ago`;

    return date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function truncateText(text, length) {
    if (!text) return "";
    return text.length > length ? `${text.slice(0, length)}...` : text;
}

function closeNotebook() {
    if (activeEscapeHandler) {
        document.removeEventListener("keydown", activeEscapeHandler);
        activeEscapeHandler = null;
    }
    if (activeNotebook && document.body.contains(activeNotebook)) {
        activeNotebook.remove();
    }
    activeNotebook = null;
}

function renderNotebookHistory(listEl, previewEl, emptyEl, textarea, saveButton) {
    const recentNotes = notesData.slice(0, MAX_PREVIEW_NOTES);
    listEl.innerHTML = "";

    if (notesData.length === 0) {
        emptyEl.hidden = false;
        previewEl.innerHTML = `
            <div class="capture-preview-meta">history preview</div>
            <div class="capture-preview-text is-empty">First note is still waiting. Press Ctrl/Cmd + Enter to save instantly.</div>
        `;
    } else {
        emptyEl.hidden = true;
        const latest = notesData[0];
        previewEl.innerHTML = `
            <div class="capture-preview-meta">${formatRelativeTime(latest.updatedAt || latest.createdAt)}</div>
            <div class="capture-preview-text">${escapeHtml(latest.content)}</div>
        `;
    }

    recentNotes.forEach((note) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "capture-history-item";
        item.innerHTML = `
            <span class="capture-history-time">${formatRelativeTime(note.updatedAt || note.createdAt)}</span>
            <span class="capture-history-text">${escapeHtml(truncateText(note.content, 72))}</span>
        `;

        item.addEventListener("click", () => {
            previewEl.innerHTML = `
                <div class="capture-preview-meta">${formatRelativeTime(note.updatedAt || note.createdAt)}</div>
                <div class="capture-preview-text">${escapeHtml(note.content)}</div>
            `;
        });

        listEl.appendChild(item);
    });

    const hasDraft = textarea.value.trim().length > 0;
    saveButton.disabled = !hasDraft;
}

function createNotebook() {
    closeNotebook();

    const overlay = document.createElement("div");
    overlay.className = "capture-notebook-overlay";

    const notebook = document.createElement("section");
    notebook.className = "capture-notebook";
    notebook.setAttribute("role", "dialog");
    notebook.setAttribute("aria-label", "Quick capture notebook");
    activeNotebook = overlay;

    notebook.innerHTML = `
        <button type="button" class="capture-close" aria-label="Close">×</button>
        <div class="capture-handle" aria-hidden="true">
            <span></span><span></span><span></span>
        </div>
        <div class="capture-left">
            <div class="capture-kicker">triple space</div>
            <h2 class="capture-title">Idea Notebook</h2>
            <p class="capture-subtitle">A small page for whatever appears for one second.</p>
            <label class="capture-input-shell">
                <span class="capture-input-label">quick capture</span>
                <textarea class="capture-input" placeholder="Write the thought before it fades." rows="6"></textarea>
            </label>
            <div class="capture-actions">
                <button type="button" class="capture-btn capture-btn-secondary">Close</button>
                <button type="button" class="capture-btn capture-btn-primary" disabled>Save note</button>
            </div>
            <div class="capture-shortcuts">Press Enter to save. Shift + Enter keeps a new line.</div>
        </div>
        <div class="capture-right">
            <div class="capture-preview-card">
                <div class="capture-preview-meta">history preview</div>
                <div class="capture-preview-text is-empty">Loading...</div>
            </div>
            <div class="capture-history-head">
                <span>recent pages</span>
                <span>${notesData.length} notes</span>
            </div>
            <div class="capture-history-empty" hidden>No previous notes yet.</div>
            <div class="capture-history-list"></div>
        </div>
    `;

    overlay.appendChild(notebook);
    document.body.appendChild(overlay);

    const closeButton = notebook.querySelector(".capture-close");
    const secondaryButton = notebook.querySelector(".capture-btn-secondary");
    const saveButton = notebook.querySelector(".capture-btn-primary");
    const textarea = notebook.querySelector(".capture-input");
    const previewEl = notebook.querySelector(".capture-preview-card");
    const listEl = notebook.querySelector(".capture-history-list");
    const emptyEl = notebook.querySelector(".capture-history-empty");
    const historyHead = notebook.querySelector(".capture-history-head span:last-child");

    function rerenderHistory() {
        historyHead.textContent = `${notesData.length} notes`;
        renderNotebookHistory(listEl, previewEl, emptyEl, textarea, saveButton);
    }

    function saveNote() {
        const content = textarea.value.trim();
        if (!content) {
            textarea.focus();
            return;
        }

        const now = new Date().toISOString();
        notesData.unshift({
            id: Date.now().toString(),
            content,
            createdAt: now,
            updatedAt: now
        });

        saveNotesToStorage(() => {
            notebook.classList.add("is-saved");
            textarea.value = "";
            rerenderHistory();
            setTimeout(() => notebook.classList.remove("is-saved"), 900);
            textarea.focus();
        });
    }

    closeButton.addEventListener("click", closeNotebook);
    secondaryButton.addEventListener("click", closeNotebook);
    saveButton.addEventListener("click", saveNote);

    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
            closeNotebook();
        }
    });

    textarea.addEventListener("input", rerenderHistory);
    textarea.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            saveNote();
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            closeNotebook();
        }
    });

    activeEscapeHandler = handleEscapeWhileOpen;
    document.addEventListener("keydown", activeEscapeHandler);

    function handleEscapeWhileOpen(event) {
        if (event.key === "Escape" && activeNotebook) {
            closeNotebook();
        }
    }

    rerenderHistory();
    setTimeout(() => textarea.focus(), 60);
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML.replace(/\n/g, "<br>");
}

document.addEventListener("keydown", (event) => {
    const now = Date.now();

    if (event.code === "Space") {
        if (isEditableTarget(event.target)) return;

        if (now - lastSpaceTime < 500) {
            spaceCount += 1;
        } else {
            spaceCount = 1;
        }
        lastSpaceTime = now;

        if (spaceCount === 3) {
            event.preventDefault();
            spaceCount = 0;
            loadNotes(() => createNotebook());
        }
    } else {
        spaceCount = 0;
    }
});

window.addEventListener("beforeunload", closeNotebook);

if (typeof window !== "undefined") {
    window.QuickNotes = {
        getNotes(callback) {
            loadNotes(() => callback(notesData));
        },
        addNote(content, callback) {
            loadNotes(() => {
                const now = new Date().toISOString();
                const note = {
                    id: Date.now().toString(),
                    content,
                    createdAt: now,
                    updatedAt: now
                };
                notesData.unshift(note);
                saveNotesToStorage(() => callback(note));
            });
        },
        updateNote(id, newContent, callback) {
            loadNotes(() => {
                const index = notesData.findIndex((note) => note.id === id);
                if (index === -1) return;
                notesData[index].content = newContent;
                notesData[index].updatedAt = new Date().toISOString();
                saveNotesToStorage(() => callback(notesData[index]));
            });
        },
        deleteNote(id, callback) {
            loadNotes(() => {
                const index = notesData.findIndex((note) => note.id === id);
                if (index === -1) {
                    callback(false);
                    return;
                }
                notesData.splice(index, 1);
                saveNotesToStorage(() => callback(true));
            });
        }
    };
}
