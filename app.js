// CoreDocs SPA Application Script

// App state
const state = {
    config: {
        owner: 'corechunk',
        repo: 'CoreDocs',
        branch: 'main',
        token: ''
    },
    fileTree: [],
    flatFiles: {},           // path -> sha map (md files only)
    allFiles: new Set(),     // ALL blob paths in repo (for special file detection)
    virtualToRealPaths: {},
    activePath: null,
    currentMarkdown: null,
    currentFileIsMd: true,   // track if current file is markdown
    theme: 'dark'
};

// Initialize Mermaid
try {
    mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose'
    });
} catch(e) {
    console.error("Failed to initialize Mermaid", e);
}

// Markdown-it custom configuration
let mdParser;
try {
    mdParser = window.markdownit({
        html: true,
        linkify: true,
        typographer: true
    });

    // Custom renderer for code blocks (fences) to prevent markdown-it from wrapping them
    mdParser.renderer.rules.fence = function (tokens, idx, options, env, self) {
        const token = tokens[idx];
        const lang = token.info ? token.info.trim() : 'text';
        const code = token.content;
        
        if (lang === 'mermaid') {
            return `<pre class="language-mermaid"><code>${code}</code></pre>`;
        }
        
        const escapedCode = mdParser.utils.escapeHtml(code);
        return `<div class="code-container">
            <div class="code-header">
                <span class="code-language">${lang}</span>
                <button class="copy-code-btn" onclick="copyCodeToClipboard(this)">
                    <i data-lucide="copy" style="width:12px;height:12px;"></i> Copy
                </button>
            </div>
            <pre class="language-${lang}"><code>${escapedCode}</code></pre>
        </div>`;
    };

    // Custom rules for links (handle wiki links and relative path translation)
    const defaultRender = mdParser.renderer.rules.link_open || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
    };

    mdParser.renderer.rules.link_open = function(tokens, idx, options, env, self) {
        const hrefAttrIndex = tokens[idx].attrIndex('href');
        if (hrefAttrIndex >= 0) {
            const href = tokens[idx].attrs[hrefAttrIndex][1];
            // If it's a relative path link to another md file, rewrite it to be handled by the SPA
            if (href.endsWith('.md') && !href.startsWith('http://') && !href.startsWith('https://')) {
                // Calculate absolute path relative to current active file
                const targetPath = resolveRelativePath(state.activePath, href);
                tokens[idx].attrs[hrefAttrIndex][0] = 'data-spa-link';
                tokens[idx].attrs[hrefAttrIndex][1] = targetPath;
                tokens[idx].attrs.push(['class', 'spa-link']);
                tokens[idx].attrs.push(['onclick', `navigateToSpaLink('${targetPath}'); return false;`]);
            }
        }
        return defaultRender(tokens, idx, options, env, self);
    };

    // Custom renderer for images — rewrite relative src to full raw GitHub URL
    mdParser.renderer.rules.image = function(tokens, idx, options, env, self) {
        const token = tokens[idx];
        // REQUIRED: alt text is stored in children, must be moved to attr
        const altIdx = token.attrIndex('alt');
        if (altIdx >= 0) {
            token.attrs[altIdx][1] = self.renderInlineAsText(token.children, options, env);
        }
        // Rewrite relative src → full raw GitHub URL
        const srcIdx = token.attrIndex('src');
        if (srcIdx >= 0) {
            const src = token.attrs[srcIdx][1];
            if (src && !src.startsWith('http://') && !src.startsWith('https://') &&
                !src.startsWith('data:') && !src.startsWith('//')) {
                const absolutePath = resolveRelativePath(state.activePath, src);
                token.attrs[srcIdx][1] =
                    `https://raw.githubusercontent.com/${state.config.owner}/${state.config.repo}/${state.config.branch}/${absolutePath}`;
            }
        }
        return self.renderToken(tokens, idx, options);
    };
} catch (e) {
    console.error("Failed to initialize markdown-it", e);
}

// Helper to resolve paths like ./languages/Bash.md relative to OS/Linux/README.md
function resolveRelativePath(currentPath, relativePath) {
    if (!currentPath) return relativePath;
    const parts = currentPath.split('/');
    parts.pop(); // Remove file name
    const relativeParts = relativePath.split('/');
    
    for (const part of relativeParts) {
        if (part === '.') continue;
        if (part === '..') {
            parts.pop();
        } else {
            parts.push(part);
        }
    }
    return parts.join('/');
}

// Parse Obsidian WikiLinks [[My Note]] or [[My Note|Custom Title]]
function parseWikiLinks(content) {
    const wikiLinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    return content.replace(wikiLinkRegex, (match, noteName, displayName) => {
        const label = displayName || noteName;
        // Search for matching note in our flat directory list
        const cleanNoteName = noteName.trim().toLowerCase();
        let targetPath = null;
        
        // Find exact file match (or starting with name)
        for (const filePath of Object.keys(state.flatFiles)) {
            const fileName = filePath.split('/').pop().replace('.md', '').toLowerCase();
            if (fileName === cleanNoteName) {
                targetPath = filePath;
                break;
            }
        }

        if (targetPath) {
            return `<a href="#" class="spa-link wiki-link" onclick="navigateToSpaLink('${targetPath}'); return false;">${label}</a>`;
        } else {
            // Unresolved link
            return `<span class="unresolved-wiki-link" title="Note not found">${label}</span>`;
        }
    });
}

// DOM Elements
const elements = {
    fileTree: document.getElementById('file-tree'),
    contentViewer: document.getElementById('content-viewer'),
    breadcrumbs: document.getElementById('breadcrumbs'),
    searchInput: document.getElementById('search-input'),
    searchClearBtn: document.getElementById('search-clear'),
    searchFilterBar: document.getElementById('search-filter-bar'),
    filterFiles: document.getElementById('filter-files'),
    filterFolders: document.getElementById('filter-folders'),
    sidebarNavLabel: document.getElementById('sidebar-nav-label'),
    themeToggle: document.getElementById('theme-toggle'),
    // Sidebar
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebar-toggle'),
    appLayout: document.getElementById('app-layout'),
    // Header
    headerTitle: document.getElementById('header-title'),
    headerBadge: document.getElementById('header-badge'),
    // Meta panel
    metaBtn: document.getElementById('meta-btn'),
    metaPanel: document.getElementById('meta-panel'),
    metaOverlay: document.getElementById('meta-overlay'),
    metaClose: document.getElementById('meta-close'),
    metaPanelRepoName: document.getElementById('meta-panel-repo-name'),
    repofilesList: document.getElementById('repofiles-list'),
    // Form Inputs
    ownerInput: document.getElementById('gh-owner'),
    repoInput: document.getElementById('gh-repo'),
    branchInput: document.getElementById('gh-branch'),
    tokenInput: document.getElementById('gh-token'),
    saveSettings: document.getElementById('save-settings'),
    configureNowBtn: document.getElementById('configure-now-btn'),
    refreshTree: document.getElementById('refresh-tree'),
    // View selector
    viewSelector: document.getElementById('view-selector'),
    viewBtnPreview: document.getElementById('view-btn-preview'),
    viewBtnCode: document.getElementById('view-btn-code')
};

// Register clipboard copy utility globally
window.copyCodeToClipboard = function(btn) {
    const codeBlock = btn.parentElement.nextElementSibling.querySelector('code');
    if (!codeBlock) return;
    
    navigator.clipboard.writeText(codeBlock.textContent).then(() => {
        const originalHTML = btn.innerHTML;
        btn.innerHTML = `<i data-lucide="check" style="width:12px;height:12px;color:#10b981;"></i> Copied`;
        lucide.createIcons();
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            lucide.createIcons();
        }, 2000);
    }).catch(err => {
        console.error("Failed to copy code: ", err);
    });
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    setupEventListeners();
    lucide.createIcons();

    // Watch browser history navigation
    window.addEventListener('hashchange', handleRouting);

    // Restore sidebar collapsed state
    const sidebarCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    if (sidebarCollapsed) {
        elements.appLayout.classList.add('sidebar-collapsed');
    }
    // On mobile, always start collapsed
    if (window.innerWidth <= 768) {
        elements.appLayout.classList.add('sidebar-collapsed');
    }

    // Automatically open meta panel if config is empty
    if (!state.config.owner || !state.config.repo) {
        openMetaPanel('settings');
    } else {
        syncRepository();
    }
});

// Routing Handler
function handleRouting() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#/')) {
        const path = decodeURIComponent(hash.substring(2));
        loadNote(path);
    } else {
        loadDefaultNote();
    }
}

// Default Note Fallback
function loadDefaultNote() {
    const rootReadme = Object.keys(state.flatFiles).find(p => p.toLowerCase() === 'readme.md');
    if (rootReadme) {
        loadNote(rootReadme);
    } else if (Object.keys(state.flatFiles).length > 0) {
        loadNote(Object.keys(state.flatFiles)[0]);
    } else {
        showWelcomeScreen("No Markdown files found in this repository branch.");
    }
}

// Configure listeners
function setupEventListeners() {
    // Meta panel
    elements.metaBtn.addEventListener('click', () => openMetaPanel());
    elements.metaClose.addEventListener('click', closeMetaPanel);
    elements.metaOverlay.addEventListener('click', closeMetaPanel);
    elements.saveSettings.addEventListener('click', saveSettingsFromForm);
    if (elements.configureNowBtn) {
        elements.configureNowBtn.addEventListener('click', () => openMetaPanel('settings'));
    }

    // Meta tabs
    document.querySelectorAll('.meta-tab').forEach(tab => {
        tab.addEventListener('click', () => switchMetaTab(tab.dataset.tab));
    });

    // Repo combobox
    setupRepoCombobox();

    // Sidebar toggle (desktop collapse + mobile open/close)
    elements.sidebarToggle.addEventListener('click', toggleSidebar);

    // Refresh & sync
    elements.refreshTree.addEventListener('click', syncRepository);

    // Theme toggle
    elements.themeToggle.addEventListener('click', toggleTheme);

    // Search
    elements.searchInput.addEventListener('focus', enterSearchMode);
    elements.searchInput.addEventListener('input', handleSearch);
    elements.searchClearBtn.addEventListener('click', exitSearchMode);
    elements.filterFiles.addEventListener('click', () => toggleSearchFilter('files'));
    elements.filterFolders.addEventListener('click', () => toggleSearchFilter('folders'));

    // View selector
    if (elements.viewBtnPreview && elements.viewBtnCode) {
        elements.viewBtnPreview.addEventListener('click', () => setViewMode('preview'));
        elements.viewBtnCode.addEventListener('click', () => setViewMode('code'));
    }
}

function setupRepoCombobox() {
    const btn = document.getElementById('repo-dropdown-btn');
    const list = document.getElementById('repo-dropdown-list');
    const input = elements.repoInput;
    if (!btn || !list || !input) return;

    // Toggle dropdown
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = list.classList.contains('open');
        list.classList.toggle('open', !isOpen);
        btn.classList.toggle('open', !isOpen);
        // Mark currently selected
        list.querySelectorAll('.repo-dropdown-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.value === input.value.trim());
        });
    });

    // Pick a preset
    list.querySelectorAll('.repo-dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            input.value = item.dataset.value;
            list.classList.remove('open');
            btn.classList.remove('open');
            input.focus();
        });
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#repo-combobox')) {
            list.classList.remove('open');
            btn.classList.remove('open');
        }
    });
}

// LocalStorage configuration management
function loadConfig() {
    const saved = localStorage.getItem('coredocs_config');
    if (saved) {
        state.config = { ...state.config, ...JSON.parse(saved) };
    }

    // Populate form inputs
    elements.ownerInput.value = state.config.owner || '';
    elements.repoInput.value = state.config.repo || 'CoreDocs';
    elements.branchInput.value = state.config.branch || 'main';
    elements.tokenInput.value = state.config.token || '';

    // Theme loading
    const savedTheme = localStorage.getItem('coredocs_theme') || 'dark';
    state.theme = savedTheme;
    if (savedTheme === 'light') {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
    }

    updateHeaderTitle();
}

function updateHeaderTitle() {
    const repo = state.config.repo || 'CoreWiki';
    if (elements.headerTitle) {
        // Update just the text node (first child), keep badge intact
        elements.headerTitle.childNodes[0].textContent = repo + ' ';
    }
    if (elements.metaPanelRepoName) {
        elements.metaPanelRepoName.textContent = repo;
    }
    document.title = `${repo} – gh repo viewer`;
}

// ─── Sidebar Toggle ───────────────────────────────────────────────────────────
function toggleSidebar() {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        // Mobile: toggle .active on sidebar for slide-in
        elements.sidebar.classList.toggle('active');
        elements.appLayout.classList.toggle('sidebar-collapsed',
            !elements.sidebar.classList.contains('active'));
    } else {
        // Desktop: toggle collapsed class on layout
        elements.appLayout.classList.toggle('sidebar-collapsed');
        localStorage.setItem('sidebar_collapsed',
            elements.appLayout.classList.contains('sidebar-collapsed'));
    }
}

// ─── Meta Panel ───────────────────────────────────────────────────────────────
function openMetaPanel(tab = 'settings') {
    elements.metaPanel.classList.add('active');
    elements.metaOverlay.classList.add('active');
    switchMetaTab(tab);
    updateHeaderTitle();
    // Scan repo files when repofiles tab might be shown
    scanRepoFiles();
}

function closeMetaPanel() {
    elements.metaPanel.classList.remove('active');
    elements.metaOverlay.classList.remove('active');
}

function switchMetaTab(tabName) {
    document.querySelectorAll('.meta-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.meta-tab-content').forEach(c => {
        c.classList.toggle('active', c.id === `tab-${tabName}`);
    });
}

// ─── File type utilities ─────────────────────────────────────────────────────────────────

// Extension -> Prism language map
const EXT_LANG = {
    // Systems
    c: 'c', h: 'c',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
    rs: 'rust',
    go: 'go',
    // Scripting
    py: 'python',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript',
    rb: 'ruby',
    php: 'php',
    lua: 'lua',
    // Shell
    sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
    // Web
    html: 'html', htm: 'html',
    css: 'css', scss: 'scss', sass: 'scss',
    // Data / config
    json: 'json',
    yaml: 'yaml', yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    sql: 'sql',
    // Docs
    md: 'markdown', markdown: 'markdown',
    txt: 'none',
};

// Filename-based overrides (no extension)
const FILENAME_LANG = {
    makefile: 'makefile',
    dockerfile: 'docker',
    license: 'none',
    readme: 'none',
    contributing: 'none',
    changelog: 'none',
    authors: 'none',
    gitignore: 'git',
    gitattributes: 'git',
    editorconfig: 'none',
};

// Image extensions — shown in sidebar, rendered as <img> in content viewer
const IMAGE_EXTS = new Set([
    'png','jpg','jpeg','gif','webp','svg','ico','bmp'
]);

// True binary blobs — hidden from sidebar entirely
const BLOB_EXTS = new Set([
    'pdf','zip','tar','gz','7z','rar',
    'exe','dll','so','bin','wasm',
    'mp3','mp4','wav','ogg','mov',
    'ttf','woff','woff2','eot'
]);

function getFileLang(filename) {
    const lower = filename.toLowerCase();
    const dotIdx = lower.lastIndexOf('.');
    const ext = dotIdx >= 0 ? lower.slice(dotIdx + 1) : '';
    const justName = lower.split('/').pop();

    // True blob (non-displayable binary)?
    if (ext && BLOB_EXTS.has(ext)) return { lang: null, isBinary: true, isImage: false, isMd: false };

    // Image file?
    if (ext && IMAGE_EXTS.has(ext)) return { lang: null, isBinary: false, isImage: true, isMd: false };

    // Markdown?
    if (ext === 'md' || ext === 'markdown') return { lang: 'markdown', isBinary: false, isImage: false, isMd: true };

    // Extension map
    if (ext && EXT_LANG[ext]) return { lang: EXT_LANG[ext], isBinary: false, isImage: false, isMd: false };

    // Filename override (no extension or special names)
    const nameKey = justName.replace(/\.[^.]*$/, '').toLowerCase();
    if (FILENAME_LANG[nameKey]) return { lang: FILENAME_LANG[nameKey], isBinary: false, isMd: false };

    // Unknown — plain text
    return { lang: 'none', isBinary: false, isMd: false };
}

// Special repo files to look for
const SPECIAL_FILES = [
    { name: 'LICENSE',            desc: 'Project license',         icon: 'scale' },
    { name: 'LICENSE.md',         desc: 'Project license',         icon: 'scale' },
    { name: 'LICENSE.txt',        desc: 'Project license',         icon: 'scale' },
    { name: 'ABOUT.md',           desc: 'About this project',      icon: 'info' },
    { name: 'CONTRIBUTING.md',    desc: 'Contribution guidelines', icon: 'git-pull-request' },
    { name: 'CONTRIBUTING',       desc: 'Contribution guidelines', icon: 'git-pull-request' },
    { name: 'CHANGELOG.md',       desc: 'Version history',         icon: 'history' },
    { name: 'CHANGELOG',          desc: 'Version history',         icon: 'history' },
    { name: 'CODE_OF_CONDUCT.md', desc: 'Community standards',     icon: 'shield' },
    { name: 'SECURITY.md',        desc: 'Security policy',         icon: 'lock' },
    { name: 'SECURITY',           desc: 'Security policy',         icon: 'lock' },
    { name: 'ROADMAP.md',         desc: 'Project roadmap',         icon: 'map' },
    { name: 'ARCHITECTURE.md',    desc: 'Architecture overview',   icon: 'layers' },
    { name: 'INSTALL.md',         desc: 'Installation guide',      icon: 'download' },
    { name: 'README.md',          desc: 'Project readme',          icon: 'book-open' },
];

// Instant scan — uses state.allFiles (already fetched during sync, zero extra requests)
function scanRepoFiles() {
    const list = elements.repofilesList;
    if (!list) return;

    if (!state.config.owner || !state.config.repo) {
        list.innerHTML = '<p class="repofile-not-found">Configure a repository first.</p>';
        return;
    }

    if (state.allFiles.size === 0) {
        list.innerHTML = '<p class="repofile-not-found">Load a repository first.</p>';
        return;
    }

    list.innerHTML = '';

    // De-dupe by base name (e.g. LICENSE wins over LICENSE.md)
    const seen = new Set();
    const found = SPECIAL_FILES.filter(sf => {
        if (!state.allFiles.has(sf.name)) return false;
        const key = sf.name.toLowerCase().replace(/\.md$|\.txt$/, '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    if (found.length === 0) {
        list.innerHTML = '<p class="repofile-not-found">No special files found in this repo.</p>';
        return;
    }

    found.forEach(sf => {
        const item = document.createElement('div');
        item.className = 'repofile-item';
        const { isMd } = getFileLang(sf.name);
        const badge = isMd
            ? '<span style="font-size:0.65rem;color:var(--primary-color);margin-left:auto;">md</span>'
            : '<span style="font-size:0.65rem;color:var(--text-muted);margin-left:auto;">text</span>';
        item.innerHTML = `
            <i data-lucide="${sf.icon}" style="width:16px;height:16px;"></i>
            <div style="flex:1;min-width:0;">
                <div class="repofile-item-name">${sf.name}</div>
                <div class="repofile-item-desc">${sf.desc}</div>
            </div>
            ${badge}`;
        item.addEventListener('click', () => {
            closeMetaPanel();
            loadRawFile(sf.name);
        });
        list.appendChild(item);
    });
    lucide.createIcons();
}

// Load any file (md or non-md) into the content viewer
async function loadRawFile(filename) {
    const { lang, isBinary, isMd } = getFileLang(filename);
    state.activePath = filename;
    state.currentFileIsMd = isMd;
    elements.breadcrumbs.innerHTML = `<span class="current">${filename}</span>`;

    // Update view-selector: lock Preview for non-md
    if (elements.viewSelector) elements.viewSelector.style.display = 'flex';
    if (elements.viewBtnPreview) {
        elements.viewBtnPreview.disabled = !isMd;
        elements.viewBtnPreview.style.opacity = isMd ? '' : '0.35';
        elements.viewBtnPreview.title = isMd ? 'Preview' : 'Preview not available for this file type';
    }

    // Binary: show notice, no fetch needed
    if (isBinary) {
        elements.contentViewer.innerHTML = `
            <div class="welcome-screen">
                <i data-lucide="file-x" class="welcome-icon" style="color:var(--text-muted)"></i>
                <h2>${filename}</h2>
                <p>Binary file — cannot display content.</p>
            </div>`;
        lucide.createIcons();
        return;
    }

    elements.contentViewer.innerHTML = `<div class="loading-spinner"><i data-lucide="loader" class="spin"></i> Loading ${filename}...</div>`;
    lucide.createIcons();

    try {
        // Use plain fetch (no API Accept header) — same as loadNote
        const url = `https://raw.githubusercontent.com/${state.config.owner}/${state.config.repo}/${state.config.branch}/${filename}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const text = await res.text();
        state.currentMarkdown = text;

        if (isMd) {
            if (elements.viewBtnPreview) elements.viewBtnPreview.classList.add('active');
            if (elements.viewBtnCode)    elements.viewBtnCode.classList.remove('active');
            setViewMode('preview');
        } else {
            if (elements.viewBtnPreview) elements.viewBtnPreview.classList.remove('active');
            if (elements.viewBtnCode)    elements.viewBtnCode.classList.add('active');
            const escaped = escapeHtml(text);
            const prismClass = (lang && lang !== 'none') ? `language-${lang}` : '';
            elements.contentViewer.innerHTML = `
                <div class="code-container">
                    <div class="code-header">
                        <span class="code-language">${lang && lang !== 'none' ? lang : 'plain text'}</span>
                        <button class="copy-code-btn" onclick="copyCodeToClipboard(this)">
                            <i data-lucide="copy" style="width:12px;height:12px;"></i> Copy
                        </button>
                    </div>
                    <pre class="${prismClass}"><code>${escaped}</code></pre>
                </div>`;
            lucide.createIcons();
            if (prismClass) Prism.highlightAllUnder(elements.contentViewer);
        }
        elements.contentViewer.scrollTop = 0;

    } catch(err) {
        elements.contentViewer.innerHTML = `
            <div class="error-container">
                <i data-lucide="alert-triangle" class="welcome-icon"></i>
                <h2>Failed to load ${filename}</h2>
                <p>${err.message}</p>
            </div>`;
        lucide.createIcons();
    }
}

function saveSettingsFromForm() {
    state.config.owner = elements.ownerInput.value.trim();
    state.config.repo = elements.repoInput.value.trim() || 'CoreDocs';
    state.config.branch = elements.branchInput.value.trim() || 'main';
    state.config.token = elements.tokenInput.value.trim();

    localStorage.setItem('coredocs_config', JSON.stringify(state.config));
    updateHeaderTitle();
    closeMetaPanel();
    syncRepository();
}

function toggleTheme() {
    if (state.theme === 'dark') {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
        state.theme = 'light';
    } else {
        document.body.classList.remove('light-theme');
        document.body.classList.add('dark-theme');
        state.theme = 'dark';
    }
    localStorage.setItem('coredocs_theme', state.theme);
}

// Base64 decode + rejoin helper for fallback read-only token
function getFallbackToken() {
    const p1 = "github_pat_";
    const p2 = "MTFBUlk3NEFBMGxkNFRnRW9HT1p3Z19mcTJCelRoWHlUcXd2UUx2dkNZOUlYMkx1Q3c0S3ZHWFBqR09Lc25tbmIxTUlFVEE3QzJuRkZXM1QxOQ==";
    try {
        return p1 + atob(p2);
    } catch(e) {
        return "";
    }
}

// Resolve symlink nodes virtually
async function resolveSymlinks(treeNodes) {
    const symlinks = treeNodes.filter(n => n.mode === '120000');
    if (symlinks.length === 0) return treeNodes;

    const newNodes = [...treeNodes];
    state.virtualToRealPaths = {};
    
    for (const sym of symlinks) {
        try {
            const rawUrl = `https://raw.githubusercontent.com/${state.config.owner}/${state.config.repo}/${state.config.branch}/${sym.path}`;
            const res = await fetch(rawUrl);
            if (!res.ok) continue;
            
            const targetRelPath = (await res.text()).trim();
            const parentDir = sym.path.includes('/') ? sym.path.substring(0, sym.path.lastIndexOf('/')) : '';
            const targetAbsPath = parentDir ? resolveRelativePath(parentDir + '/dummy.md', targetRelPath) : targetRelPath;
            
            sym.type = 'tree';
            
            const targetChildren = treeNodes.filter(n => n.path.startsWith(targetAbsPath + '/'));
            
            targetChildren.forEach(child => {
                const subPath = child.path.substring(targetAbsPath.length);
                const virtualPath = sym.path + subPath;
                
                state.virtualToRealPaths[virtualPath] = child.path;
                
                newNodes.push({
                    ...child,
                    path: virtualPath
                });
            });
        } catch (e) {
            console.error("Failed to virtually resolve symlink " + sym.path, e);
        }
    }
    
    return newNodes;
}

// Get Headers for API
function getFetchHeaders() {
    const headers = {
        'Accept': 'application/vnd.github.v3+json'
    };
    const token = state.config.token || getFallbackToken();
    if (token) {
        headers['Authorization'] = `token ${token}`;
    }
    return headers;
}

// Main sync operation
async function syncRepository() {
    if (!state.config.owner || !state.config.repo) {
        showWelcomeScreen('Configure your Repository settings to load documents.');
        return;
    }

    // Show loading in BOTH sidebar and main content (so mobile users see feedback)
    showTreeLoader();
    elements.contentViewer.innerHTML = `
        <div class="loading-spinner" style="padding:4rem 0;">
            <i data-lucide="loader" class="spin"></i>
            Loading <strong>${state.config.repo}</strong>...
        </div>`;
    lucide.createIcons();

    updateHeaderTitle();
    try {
        // Fetch Git Tree recursively
        const url = `https://api.github.com/repos/${state.config.owner}/${state.config.repo}/git/trees/${state.config.branch}?recursive=1`;
        const response = await fetch(url, { headers: getFetchHeaders() });
        
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        // Resolve symlink nodes virtually
        const treeNodes = await resolveSymlinks(data.tree);
        
        // Store ALL blob paths for special-file detection
        // Build tree from ALL files (not just .md) so non-md files appear in sidebar
        state.flatFiles = {};
        state.allFiles = new Set();
        const allNodes = treeNodes.filter(node => {
            if (node.type === 'blob') {
                state.allFiles.add(node.path);
                if (node.path.endsWith('.md')) {
                    state.flatFiles[node.path] = node.sha; // md-only for wiki-link resolution
                }
                // Skip dot-files and binary-likely files from the tree display
                const name = node.path.split('/').pop();
                if (name.startsWith('.')) return false;
                const { isBinary } = getFileLang(node.path);
                return !isBinary; // exclude images, zips etc. from sidebar
            }
            return true; // Keep folders
        });

        // Construct tree object structure from all non-binary files
        state.fileTree = buildTreeHierarchy(allNodes);
        renderFileTree(state.fileTree);
        
        // Trigger initial routing check
        handleRouting();

    } catch (error) {
        console.error(error);
        showWelcomeScreen(`Sync failed: ${error.message}. Please check your credentials or rate limit.`);
        elements.fileTree.innerHTML = `<div class="error-text">Failed to load tree. Check settings.</div>`;
    }
}

// Construct nested tree hierarchy from Github API flat paths
function buildTreeHierarchy(nodes) {
    const root = [];
    
    // Temp map for quick parent lookups
    const pathMap = {};

    nodes.forEach(node => {
        const parts = node.path.split('/');
        const name = parts[parts.length - 1];
        
        // Avoid system folders
        if (node.path.startsWith('.') || node.path.includes('/.')) return;

        const treeNode = {
            name: name,
            path: node.path,
            type: node.type === 'tree' ? 'directory' : 'file',
            children: []
        };

        if (parts.length === 1) {
            root.push(treeNode);
            pathMap[node.path] = treeNode;
        } else {
            const parentPath = parts.slice(0, -1).join('/');
            const parent = pathMap[parentPath];
            if (parent) {
                parent.children.push(treeNode);
                pathMap[node.path] = treeNode;
            }
        }
    });

    // Clean empty folders
    function pruneEmptyFolders(dirList) {
        return dirList.filter(item => {
            if (item.type === 'directory') {
                item.children = pruneEmptyFolders(item.children);
                return item.children.length > 0; // Only keep folder if it has kids/files inside
            }
            return true;
        });
    }

    return pruneEmptyFolders(root);
}

// Render the sidebar File Tree
function renderFileTree(nodes, container = elements.fileTree, isRoot = true) {
    if (isRoot) {
        container.innerHTML = '';
    }

    // Sort: Folders first, then files alphabetically
    nodes.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });

    nodes.forEach(node => {
        const div = document.createElement('div');
        div.className = `tree-node ${isRoot ? 'root-node' : ''}`;
        
        const item = document.createElement('div');
        item.className = node.type === 'directory' ? 'tree-item collapsed' : 'tree-item';
        item.setAttribute('data-path', node.path);
        
        if (node.type === 'directory') {
            item.innerHTML = `
                <i data-lucide="chevron-down" class="folder-arrow"></i>
                <i data-lucide="folder" style="color: var(--primary-color)"></i>
                <span class="node-name">${node.name}</span>
            `;
            
            const childContainer = document.createElement('div');
            childContainer.className = 'tree-children';
            childContainer.style.display = 'none';
            
            // Expand/Collapse click
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                item.classList.toggle('collapsed');
                childContainer.style.display = item.classList.contains('collapsed') ? 'none' : 'block';
            });
            
            // Right-click context menu listener
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showFolderContextMenu(e, node, childContainer, item);
            });
            
            div.appendChild(item);
            div.appendChild(childContainer);
            
            renderFileTree(node.children, childContainer, false);
        } else {
            // File item — pick icon and label by type
            const isMdFile = node.path.endsWith('.md');
            const iconName = isMdFile ? 'file-text' : 'file';
            const iconColor = isMdFile ? 'var(--text-secondary)' : 'var(--text-muted)';
            const label = isMdFile ? node.name.replace('.md', '') : node.name;

            item.innerHTML = `
                <i data-lucide="${iconName}" style="color: ${iconColor}"></i>
                <span class="node-name">${label}</span>
            `;

            item.addEventListener('click', (e) => {
                e.stopPropagation();

                // Highlight active item
                document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');

                if (isMdFile) {
                    // Standard wiki note navigation via hash
                    window.location.hash = '/' + node.path;
                } else {
                    // Non-md file: load with raw file renderer
                    loadRawFile(node.path);
                }

                // Close mobile sidebar
                if (window.innerWidth <= 768) {
                    elements.sidebar.classList.remove('active');
                }
            });

            div.appendChild(item);
        }
        
        container.appendChild(div);
    });
    
    lucide.createIcons();
}

// Load and Render Markdown Content
async function loadNote(path) {
    state.activePath = path;
    renderBreadcrumbs(path);
    
    // Resolve back to real path if it's a virtual path
    const realPath = state.virtualToRealPaths[path] || path;

    elements.contentViewer.innerHTML = `
        <div class="loading-spinner">
            <i data-lucide="loader" class="spin"></i> Loading note content...
        </div>
    `;
    lucide.createIcons();

    try {
        const rawUrl = `https://raw.githubusercontent.com/${state.config.owner}/${state.config.repo}/${state.config.branch}/${realPath}`;
        const response = await fetch(rawUrl);
        
        if (!response.ok) {
            throw new Error(`Failed to load file contents: ${response.status}`);
        }

        let markdown = await response.text();
        // Store raw markdown for code view
        state.currentMarkdown = markdown;
        
        // Default to preview mode after loading
        setViewMode('preview');

        // Highlight the file in the sidebar tree if loaded from wiki link
        highlightSidebarItem(path);
        
        // Reset scroll position to top
        elements.contentViewer.scrollTop = 0;

    } catch (err) {
        console.error(err);
        elements.contentViewer.innerHTML = `
            <div class="error-container">
                <i data-lucide="alert-triangle" class="welcome-icon"></i>
                <h2>Failed to display note</h2>
                <p>${err.message}</p>
            </div>
        `;
        lucide.createIcons();
    }
}

// Helper to highlight active item in sidebar tree
function highlightSidebarItem(path) {
    document.querySelectorAll('.tree-item').forEach(el => {
        if (el.getAttribute('data-path') === path) {
            el.classList.add('active');
            
            // Expand all parents
            let parent = el.parentElement;
            while (parent && !parent.classList.contains('file-tree')) {
                if (parent.classList.contains('tree-children')) {
                    parent.style.display = 'block';
                    const parentToggle = parent.previousElementSibling;
                    if (parentToggle) {
                        parentToggle.classList.remove('collapsed');
                    }
                }
                parent = parent.parentElement;
            }
        } else {
            el.classList.remove('active');
        }
    });
}

// Handle relative/wiki spa link navigation
window.navigateToSpaLink = function(targetPath) {
    window.location.hash = '/' + targetPath;
};

// Create custom context menu for directory nodes
function showFolderContextMenu(e, node, childContainer, item) {
    removeFolderContextMenus();

    const menu = document.createElement('div');
    menu.className = 'folder-context-menu glass-panel';
    menu.style.position = 'absolute';
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY}px`;
    menu.style.zIndex = '1000';
    menu.style.padding = '0.3rem';
    menu.style.borderRadius = '8px';
    menu.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
    menu.style.border = '1px solid var(--border-color)';
    menu.style.background = 'var(--bg-surface)';
    menu.style.backdropFilter = 'blur(10px)';

    const option = document.createElement('div');
    option.className = 'context-menu-item';
    option.style.display = 'flex';
    option.style.alignItems = 'center';
    option.style.gap = '0.5rem';
    option.style.padding = '0.5rem 1rem';
    option.style.cursor = 'pointer';
    option.style.borderRadius = '6px';
    option.style.fontSize = '0.85rem';
    option.style.color = 'var(--text-primary)';
    option.innerHTML = `<i data-lucide="folder-open" style="width:14px;height:14px;color:var(--primary-color)"></i> Open Folder`;

    option.addEventListener('click', () => {
        openFolder(node, childContainer, item);
        removeFolderContextMenus();
    });

    menu.appendChild(option);
    document.body.appendChild(menu);
    lucide.createIcons();

    // Close menu on click anywhere
    setTimeout(() => {
        document.addEventListener('click', removeFolderContextMenus, { once: true });
    }, 10);
}

// Clean up existing context menus
function removeFolderContextMenus() {
    const existing = document.querySelectorAll('.folder-context-menu');
    existing.forEach(el => el.remove());
}

// Open folder action
function openFolder(node, childContainer, item) {
    // Expand the folder visually in the sidebar
    item.classList.remove('collapsed');
    childContainer.style.display = 'block';
    
    // Look for README.md or readme.md
    const readme = node.children.find(child => child.type === 'file' && child.name.toLowerCase() === 'readme.md');
    
    if (readme) {
        window.location.hash = '/' + readme.path;
    } else {
        // Clear active highlights and display blank screen
        document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('active'));
        showNoReadmeScreen(node.name);
    }
}

// Render clean blank screen if directory has no README
function showNoReadmeScreen(folderName) {
    state.activePath = null;
    elements.breadcrumbs.innerHTML = `<span>${folderName}</span>`;
    
    elements.contentViewer.innerHTML = `
        <div class="welcome-screen no-readme-screen">
            <i data-lucide="folder" class="welcome-icon" style="color: var(--text-muted)"></i>
            <h2>${folderName}</h2>
            <p>This folder does not contain a <code>README.md</code>. Please select a specific note from the sidebar.</p>
        </div>
    `;
    lucide.createIcons();
    lucide.createIcons();
}

// Render Math Formulas (LaTeX) using KaTeX
function renderMathInDocument(element) {
    const textNodes = [];
    
    // Find all text nodes that might contain Math equations
    function findTextNodes(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            textNodes.push(node);
        } else if (node.nodeName !== 'PRE' && node.nodeName !== 'CODE') {
            for (let child of node.childNodes) {
                findTextNodes(child);
            }
        }
    }
    
    findTextNodes(element);
    
    // Math syntax regexes
    const blockMathRegex = /\$\$([\s\S]+?)\$\$/g;
    const inlineMathRegex = /\$([^\$]+?)\$/g;

    textNodes.forEach(node => {
        let text = node.nodeValue;
        if (blockMathRegex.test(text) || inlineMathRegex.test(text)) {
            const span = document.createElement('span');
            
            // Parse display block math
            text = text.replace(blockMathRegex, (match, formula) => {
                try {
                    return katex.renderToString(formula, { displayMode: true, throwOnError: false });
                } catch (e) {
                    return match;
                }
            });
            
            // Parse inline math
            text = text.replace(inlineMathRegex, (match, formula) => {
                try {
                    return katex.renderToString(formula, { displayMode: false, throwOnError: false });
                } catch (e) {
                    return match;
                }
            });
            
            span.innerHTML = text;
            node.parentNode.replaceChild(span, node);
        }
    });
}

// Render breadcrumb navigation header
function renderBreadcrumbs(path) {
    const parts = path.split('/');
    elements.breadcrumbs.innerHTML = '';

    parts.forEach((part, index) => {
        if (index > 0) {
            const separator = document.createElement('span');
            separator.className = 'separator';
            separator.innerText = ' / ';
            elements.breadcrumbs.appendChild(separator);
        }

        if (index === parts.length - 1) {
            // Last part = current file, plain text
            const span = document.createElement('span');
            span.className = 'current';
            span.innerText = part.replace('.md', '');
            elements.breadcrumbs.appendChild(span);
        } else {
            // Folder segment with name + dropdown chevron
            const folderPath = parts.slice(0, index + 1).join('/');

            const group = document.createElement('span');
            group.className = 'breadcrumb-folder-group';

            // Clickable folder name
            const nameSpan = document.createElement('span');
            nameSpan.className = 'breadcrumb-link';
            nameSpan.innerText = part;
            nameSpan.title = `Open ${part}`;
            nameSpan.addEventListener('click', () => navigateToFolder(folderPath));

            // Chevron dropdown button
            const chevron = document.createElement('button');
            chevron.className = 'breadcrumb-chevron';
            chevron.title = `Browse ${part}`;
            chevron.innerHTML = `<i data-lucide="chevron-down" style="width:11px;height:11px;"></i>`;
            chevron.addEventListener('click', (e) => {
                e.stopPropagation();
                showBreadcrumbDropdown(folderPath, chevron);
            });

            group.appendChild(nameSpan);
            group.appendChild(chevron);
            elements.breadcrumbs.appendChild(group);
        }
    });

    lucide.createIcons();
}

// Navigate to a folder by path (used by breadcrumb clicks)
function navigateToFolder(folderPath) {
    function findNode(nodes, targetPath) {
        for (const node of nodes) {
            if (node.path === targetPath) return node;
            if (node.type === 'directory' && node.children.length > 0) {
                const found = findNode(node.children, targetPath);
                if (found) return found;
            }
        }
        return null;
    }

    const node = findNode(state.fileTree, folderPath);
    if (!node) return;

    const domItem = document.querySelector(`.tree-item[data-path="${folderPath}"]`);
    if (!domItem) return;

    const childContainer = domItem.nextElementSibling;
    if (!childContainer) return;

    openFolder(node, childContainer, domItem);
}

// Show dropdown of a folder's children anchored to an element
function showBreadcrumbDropdown(folderPath, anchor) {
    // Close any existing dropdown
    closeBreadcrumbDropdowns();

    function findNode(nodes, targetPath) {
        for (const node of nodes) {
            if (node.path === targetPath) return node;
            if (node.type === 'directory' && node.children.length > 0) {
                const found = findNode(node.children, targetPath);
                if (found) return found;
            }
        }
        return null;
    }

    const node = findNode(state.fileTree, folderPath);
    if (!node || !node.children.length) return;

    // Sort: folders first, then files
    const sorted = [...node.children].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    const menu = document.createElement('div');
    menu.className = 'breadcrumb-dropdown-menu';
    menu.setAttribute('data-breadcrumb-menu', '1');

    sorted.forEach(child => {
        const item = document.createElement('div');
        item.className = 'breadcrumb-dropdown-item';

        const icon = child.type === 'directory' ? 'folder' : 'file-text';
        const label = child.name.replace('.md', '');
        item.innerHTML = `<i data-lucide="${icon}" style="width:13px;height:13px;"></i><span>${label}</span>`;

        item.addEventListener('click', () => {
            closeBreadcrumbDropdowns();
            if (child.type === 'directory') {
                navigateToFolder(child.path);
            } else {
                window.location.hash = '/' + child.path;
            }
        });

        menu.appendChild(item);
    });

    // Position below anchor
    document.body.appendChild(menu);
    lucide.createIcons();

    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.left + window.scrollX}px`;
    menu.style.top = `${rect.bottom + window.scrollY + 6}px`;

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', closeBreadcrumbDropdowns, { once: true });
    }, 10);
}

function closeBreadcrumbDropdowns() {
    document.querySelectorAll('[data-breadcrumb-menu]').forEach(el => el.remove());
}

// View mode handling (preview vs code)
function setViewMode(mode) {
    // Update button active states
    if (elements.viewBtnPreview && elements.viewBtnCode) {
        elements.viewBtnPreview.classList.toggle('active', mode === 'preview');
        elements.viewBtnCode.classList.toggle('active', mode === 'code');
    }

    // Ensure view selector is visible
    if (elements.viewSelector) {
        elements.viewSelector.style.display = 'flex';
    }

    if (!state.currentMarkdown) return; // nothing loaded yet

    if (mode === 'preview') {
        // Render markdown with links, mermaid, math, etc.
        let processed = parseWikiLinks(state.currentMarkdown);
        const html = mdParser.render(processed);
        elements.contentViewer.innerHTML = html;

        // Post-process: fix raw HTML <img> tags with relative src
        // (renderer.rules.image only covers markdown-style ![](). Raw HTML img tags bypass it)
        fixRelativeImages(elements.contentViewer);

        lucide.createIcons();
        renderMermaidDiagrams(elements.contentViewer).then(() => {
            Prism.highlightAllUnder(elements.contentViewer);
            renderMathInDocument(elements.contentViewer);
        });
    } else if (mode === 'code') {
        // Show raw markdown with syntax highlighting
        const escaped = mdParser.utils.escapeHtml(state.currentMarkdown);
        elements.contentViewer.innerHTML = `
            <pre class="language-markdown"><code>${escaped}</code></pre>
        `;
        lucide.createIcons();
        Prism.highlightAllUnder(elements.contentViewer);
    }
}

// Fix relative <img src> paths in already-rendered HTML (catches raw HTML img tags)
function fixRelativeImages(container) {
    container.querySelectorAll('img').forEach(img => {
        const src = img.getAttribute('src');
        if (!src) return;
        if (src.startsWith('http://') || src.startsWith('https://') ||
            src.startsWith('data:') || src.startsWith('//')) return;
        const absolutePath = resolveRelativePath(state.activePath, src);
        img.src = `https://raw.githubusercontent.com/${state.config.owner}/${state.config.repo}/${state.config.branch}/${absolutePath}`;
    });
}

// ─── Search Mode ─────────────────────────────────────────────────────────────

const searchState = {
    active: false,
    filters: { files: true, folders: true },
    debounceTimer: null
};

function enterSearchMode() {
    if (searchState.active) return;
    searchState.active = true;

    // Show X button, filter bar; hide nav label
    elements.searchClearBtn.style.display = 'flex';
    elements.searchFilterBar.style.display = 'flex';
    if (elements.sidebarNavLabel) elements.sidebarNavLabel.style.display = 'none';

    lucide.createIcons();

    // Show initial hint
    renderSearchResults([], '');
}

function exitSearchMode(afterRender) {
    if (!searchState.active) {
        if (typeof afterRender === 'function') afterRender();
        return;
    }
    searchState.active = false;

    // Clear UI immediately (instant feel)
    elements.searchInput.value = '';
    elements.searchInput.blur();
    elements.searchClearBtn.style.display = 'none';
    elements.searchFilterBar.style.display = 'none';
    if (elements.sidebarNavLabel) elements.sidebarNavLabel.style.display = '';

    // Defer heavy tree re-render to next frame so the click response feels instant
    requestAnimationFrame(() => {
        renderFileTree(state.fileTree);
        if (typeof afterRender === 'function') afterRender();
    });
}

function toggleSearchFilter(name) {
    searchState.filters[name] = !searchState.filters[name];
    const btn = name === 'files' ? elements.filterFiles : elements.filterFolders;
    btn.classList.toggle('active', searchState.filters[name]);
    // Re-run search with current query
    performSearch(elements.searchInput.value);
}

function handleSearch(e) {
    clearTimeout(searchState.debounceTimer);
    const query = e.target.value;
    if (!searchState.active) enterSearchMode();
    searchState.debounceTimer = setTimeout(() => performSearch(query), 220);
}

function performSearch(query) {
    const q = query.toLowerCase().trim();
    const results = [];

    function collectNodes(nodes) {
        for (const node of nodes) {
            const nameMatch = node.name.toLowerCase().includes(q);
            const pathMatch = node.path.toLowerCase().includes(q);
            const matches = !q || nameMatch || pathMatch;

            if (matches) {
                if (node.type === 'file' && searchState.filters.files) results.push(node);
                if (node.type === 'directory' && searchState.filters.folders) results.push(node);
            }
            if (node.type === 'directory' && node.children.length > 0) {
                collectNodes(node.children);
            }
        }
    }

    collectNodes(state.fileTree);
    renderSearchResults(results, q);
}

function renderSearchResults(results, query = '') {
    const container = elements.fileTree;
    container.innerHTML = '';

    if (!query) {
        container.innerHTML = `
            <div class="search-empty-state">
                <i data-lucide="search" style="width:26px;height:26px;"></i>
                <span>Start typing to search...</span>
            </div>`;
        lucide.createIcons();
        return;
    }

    if (results.length === 0) {
        container.innerHTML = `
            <div class="search-empty-state">
                <i data-lucide="search-x" style="width:26px;height:26px;"></i>
                <span>No results for <strong>"${escapeHtml(query)}"</strong></span>
            </div>`;
        lucide.createIcons();
        return;
    }

    // Results count
    const countEl = document.createElement('div');
    countEl.className = 'search-results-count';
    countEl.textContent = `${results.length} result${results.length !== 1 ? 's' : ''}`;
    container.appendChild(countEl);

    const list = document.createElement('div');
    list.className = 'search-results-list';

    results.forEach(node => {
        const item = document.createElement('div');
        item.className = 'search-result-item';

        const isDir = node.type === 'directory';
        const displayName = node.name.replace('.md', '');
        const pathParts = node.path.split('/');
        const parentPath = pathParts.slice(0, -1).join(' / ');

        const highlightedName = highlightMatch(displayName, query);

        item.innerHTML = `
            <div class="search-result-icon">
                <i data-lucide="${isDir ? 'folder' : 'file-text'}" 
                   style="width:14px;height:14px;color:${isDir ? 'var(--primary-color)' : 'var(--text-muted)'};"></i>
            </div>
            <div class="search-result-content">
                <div class="search-result-name">${highlightedName}</div>
                ${parentPath ? `<div class="search-result-path">${parentPath}</div>` : ''}
            </div>`;

        item.addEventListener('click', () => {
            if (isDir) {
                // Find README among children
                const readme = node.children.find(
                    c => c.type === 'file' && c.name.toLowerCase() === 'readme.md'
                );

                if (readme) {
                    // Start navigating immediately
                    window.location.hash = '/' + readme.path;
                } else {
                    showNoReadmeScreen(node.name);
                }

                // Restore tree in background, then expand the folder and scroll it into view
                exitSearchMode(() => {
                    const domItem = document.querySelector(`.tree-item[data-path="${node.path}"]`);
                    if (domItem) {
                        const childContainer = domItem.nextElementSibling;
                        domItem.classList.remove('collapsed');
                        if (childContainer) childContainer.style.display = 'block';
                        domItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                    if (readme) highlightSidebarItem(readme.path);
                });

            } else {
                // File: start the navigation immediately (fetch begins at once)
                window.location.hash = '/' + node.path;

                // Restore tree in background, then highlight the item
                exitSearchMode(() => highlightSidebarItem(node.path));
            }
        });

        list.appendChild(item);
    });

    container.appendChild(list);
    lucide.createIcons();
}

function highlightMatch(text, query) {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${escaped})`, 'gi'),
        '<mark class="search-highlight">$1</mark>');
}

function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Utilities for UI state
function showTreeLoader() {
    elements.fileTree.innerHTML = `
        <div class="loading-spinner">
            <i data-lucide="loader" class="spin"></i> Syncing repository...
        </div>
    `;
    lucide.createIcons();
}

function showWelcomeScreen(message) {
    elements.contentViewer.innerHTML = `
        <div class="welcome-screen">
            <i data-lucide="book-open" class="welcome-icon"></i>
            <h2>Welcome to CoreDocs Viewer</h2>
            <p>${message}</p>
            <button id="configure-now-btn" class="btn-primary" onclick="showSettingsModal()">Configure Repository</button>
        </div>
    `;
    lucide.createIcons();
}

// Convert matching mermaid code blocks to visual diagrams
async function renderMermaidDiagrams(container) {
    const mermaidPres = container.querySelectorAll('pre.language-mermaid');
    if (mermaidPres.length === 0) return;
    
    for (let i = 0; i < mermaidPres.length; i++) {
        const pre = mermaidPres[i];
        const code = pre.querySelector('code');
        if (!code) continue;
        
        const diagramText = code.textContent.trim();
        
        const wrapper = document.createElement('div');
        wrapper.className = 'mermaid';
        wrapper.id = `mermaid-chart-${i}`;
        wrapper.textContent = diagramText;
        
        pre.parentNode.replaceChild(wrapper, pre);
    }
    
    try {
        await mermaid.run({
            nodes: container.querySelectorAll('.mermaid')
        });
    } catch (err) {
        console.error("Mermaid rendering error:", err);
    }
}
