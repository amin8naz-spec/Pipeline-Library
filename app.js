// Инициализация IndexedDB
const db = new Dexie("AminPipelineLibrary");
db.version(1).stores({
    folders: "++id, name",
    files: "++id, name, type, blob, folderId, progress",
    progress: "fileId"
});

// Корневая папка "Все файлы" виртуальная, но для удобства создадим папку root в памяти
let currentFolderId = "root";
let currentFileId = null;
let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let zoom = 1.0;
let currentViewerType = null;
let currentOfficeScroll = 0;
let currentSheetName = null;

// Загружаем начальные данные
async function init() {
    await ensureRootFolder();
    await renderFolders();
    await renderFiles();
}

async function ensureRootFolder() {
    let root = await db.folders.where("name").equals("Корневая").first();
    if (!root) {
        await db.folders.add({ name: "Корневая" });
    }
}

async function renderFolders() {
    const folders = await db.folders.toArray();
    const list = document.getElementById("foldersList");
    list.innerHTML = '<li data-folder-id="root" class="folder-item">📁 Все файлы</li>';
    folders.forEach(folder => {
        const li = document.createElement("li");
        li.className = "folder-item";
        li.dataset.folderId = folder.id;
        li.innerHTML = `📂 ${folder.name}`;
        list.appendChild(li);
    });
    // выделение активной
    document.querySelectorAll(".folder-item").forEach(el => {
        if ((el.dataset.folderId === currentFolderId) || (currentFolderId === "root" && el.dataset.folderId === "root")) {
            el.classList.add("active");
        } else {
            el.classList.remove("active");
        }
        el.addEventListener("click", (e) => {
            currentFolderId = el.dataset.folderId;
            renderFolders();
            renderFiles();
        });
    });
}

async function renderFiles() {
    let files;
    if (currentFolderId === "root") {
        files = await db.files.toArray();
    } else {
        files = await db.files.where("folderId").equals(parseInt(currentFolderId)).toArray();
    }
    const container = document.getElementById("filesList");
    container.innerHTML = "";
    for (const file of files) {
        const card = document.createElement("div");
        card.className = "file-card";
        let icon = "📄";
        if (file.name.endsWith(".pdf")) icon = "📕";
        else if (file.name.endsWith(".docx")) icon = "📘";
        else if (file.name.endsWith(".xlsx")) icon = "📗";
        card.innerHTML = `
            <div class="file-icon">${icon}</div>
            <div class="file-name">${file.name}</div>
            <div class="file-meta">${(file.blob.size / 1024).toFixed(1)} KB</div>
            <button class="move-file-btn" data-id="${file.id}">📂 Переместить</button>
        `;
        card.addEventListener("click", (e) => {
            if (e.target.classList.contains("move-file-btn")) return;
            openFile(file);
        });
        const moveBtn = card.querySelector(".move-file-btn");
        moveBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            showMoveModal(file.id);
        });
        container.appendChild(card);
    }
}

document.getElementById("createFolderBtn").addEventListener("click", async () => {
    let name = prompt("Название папки:");
    if (name) {
        await db.folders.add({ name });
        renderFolders();
    }
});

document.getElementById("fileUpload").addEventListener("change", async (e) => {
    for (const file of e.target.files) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!["pdf", "docx", "xlsx"].includes(ext)) continue;
        const arrayBuffer = await file.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: file.type });
        const folderId = currentFolderId === "root" ? null : parseInt(currentFolderId);
        await db.files.add({
            name: file.name,
            type: ext,
            blob: blob,
            folderId: folderId,
            progress: {}
        });
    }
    renderFiles();
    e.target.value = "";
});

async function openFile(file) {
    currentFileId = file.id;
    const modal = document.getElementById("viewerModal");
    const bodyDiv = document.getElementById("viewerBody");
    bodyDiv.innerHTML = "";
    document.getElementById("prevPageBtn").style.display = "none";
    document.getElementById("nextPageBtn").style.display = "none";
    document.getElementById("pageInfo").style.display = "none";
    currentViewerType = file.type;
    
    if (file.type === "pdf") {
        await openPDF(file);
    } else if (file.type === "docx") {
        await openDOCX(file);
    } else if (file.type === "xlsx") {
        await openXLSX(file);
    }
    modal.style.display = "flex";
    restoreProgress(file.id);
}

async function openPDF(file) {
    const url = URL.createObjectURL(file.blob);
    const loadingTask = pdfjsLib.getDocument(url);
    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages;
    const savedProgress = await db.progress.where("fileId").equals(file.id).first();
    currentPage = savedProgress?.pageNumber || 1;
    zoom = 1;
    document.getElementById("prevPageBtn").style.display = "inline-block";
    document.getElementById("nextPageBtn").style.display = "inline-block";
    document.getElementById("pageInfo").style.display = "inline-block";
    renderPDFPage(currentPage);
    setupSwipeForPDF();
    
    document.getElementById("prevPageBtn").onclick = () => changePage(-1);
    document.getElementById("nextPageBtn").onclick = () => changePage(1);
}

async function renderPDFPage(pageNum) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: zoom });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    const renderContext = { canvasContext: context, viewport: viewport };
    await page.render(renderContext).promise;
    const body = document.getElementById("viewerBody");
    body.innerHTML = "";
    body.appendChild(canvas);
    document.getElementById("pageInfo").innerText = `${pageNum} / ${totalPages}`;
    // сохраняем прогресс
    await db.progress.put({ fileId: currentFileId, pageNumber: pageNum });
}

function changePage(delta) {
    let newPage = currentPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        renderPDFPage(currentPage);
    }
}

let touchStartX = 0;
function setupSwipeForPDF() {
    const viewerBody = document.getElementById("viewerBody");
    viewerBody.ontouchstart = (e) => {
        touchStartX = e.touches[0].clientX;
    };
    viewerBody.ontouchend = (e) => {
        const diff = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(diff) > 50) {
            if (diff > 0) changePage(-1);
            else changePage(1);
        }
    };
}

async function openDOCX(file) {
    const arrayBuffer = await file.blob.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
    const div = document.createElement("div");
    div.className = "doc-content";
    div.innerHTML = result.value;
    const body = document.getElementById("viewerBody");
    body.innerHTML = "";
    body.appendChild(div);
    // восстановление прокрутки
    const saved = await db.progress.where("fileId").equals(file.id).first();
    if (saved && saved.scrollTop) {
        setTimeout(() => { body.scrollTop = saved.scrollTop; }, 100);
    }
    body.onscroll = async () => {
        await db.progress.put({ fileId: file.id, scrollTop: body.scrollTop });
    };
    // зуминг через CSS
    setupZoomOffice(div);
}

async function openXLSX(file) {
    const arrayBuffer = await file.blob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const firstSheet = workbook.SheetNames[0];
    const html = XLSX.utils.sheet_to_html(workbook.Sheets[firstSheet]);
    const div = document.createElement("div");
    div.className = "excel-content";
    div.innerHTML = html;
    const body = document.getElementById("viewerBody");
    body.innerHTML = "";
    body.appendChild(div);
    const saved = await db.progress.where("fileId").equals(file.id).first();
    if (saved && saved.scrollTop) {
        setTimeout(() => { body.scrollTop = saved.scrollTop; }, 100);
    }
    body.onscroll = async () => {
        await db.progress.put({ fileId: file.id, scrollTop: body.scrollTop, sheetName: firstSheet });
    };
    setupZoomOffice(div);
}

function setupZoomOffice(element) {
    let zoomLevel = 1;
    document.getElementById("zoomInBtn").onclick = () => {
        zoomLevel += 0.1;
        element.style.fontSize = `${zoomLevel * 100}%`;
        document.getElementById("zoomLevel").innerText = `${Math.round(zoomLevel*100)}%`;
    };
    document.getElementById("zoomOutBtn").onclick = () => {
        zoomLevel = Math.max(0.5, zoomLevel - 0.1);
        element.style.fontSize = `${zoomLevel * 100}%`;
        document.getElementById("zoomLevel").innerText = `${Math.round(zoomLevel*100)}%`;
    };
}

document.getElementById("zoomInBtn").addEventListener("click", () => {
    if (currentViewerType === "pdf") {
        zoom += 0.2;
        renderPDFPage(currentPage);
        document.getElementById("zoomLevel").innerText = `${Math.round(zoom*100)}%`;
    }
});
document.getElementById("zoomOutBtn").addEventListener("click", () => {
    if (currentViewerType === "pdf") {
        zoom = Math.max(0.4, zoom - 0.2);
        renderPDFPage(currentPage);
        document.getElementById("zoomLevel").innerText = `${Math.round(zoom*100)}%`;
    }
});

document.getElementById("closeViewer").onclick = () => {
    document.getElementById("viewerModal").style.display = "none";
    pdfDoc = null;
};

async function restoreProgress(fileId) {
    const prog = await db.progress.where("fileId").equals(fileId).first();
    if (!prog) return;
    if (prog.pageNumber && currentViewerType === "pdf") {
        currentPage = prog.pageNumber;
        renderPDFPage(currentPage);
    }
}

async function showMoveModal(fileId) {
    const file = await db.files.get(fileId);
    if (!file) return;
    const folders = await db.folders.toArray();
    const select = document.getElementById("folderSelect");
    select.innerHTML = '<option value="root">Все файлы (без папки)</option>';
    folders.forEach(f => {
        select.innerHTML += `<option value="${f.id}">📁 ${f.name}</option>`;
    });
    const modal = document.getElementById("moveModal");
    modal.style.display = "flex";
    document.getElementById("confirmMoveBtn").onclick = async () => {
        const newFolderId = select.value === "root" ? null : parseInt(select.value);
        await db.files.update(fileId, { folderId: newFolderId });
        modal.style.display = "none";
        renderFiles();
    };
    document.getElementById("cancelMoveBtn").onclick = () => modal.style.display = "none";
}

init();