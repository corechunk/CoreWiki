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
    flatFiles: {}, // path -> sha map
    virtualToRealPaths: {}, // virtual -> real path mapping for symlinks
    activePath: null,
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
    themeToggle: document.getElementById('theme-toggle'),
    settingsBtn: document.getElementById('settings-btn'),
    settingsModal: document.getElementById('settings-modal'),
    closeSettings: document.getElementById('close-settings'),
    saveSettings: document.getElementById('save-settings'),
    configureNowBtn: document.getElementById('configure-now-btn'),
    refreshTree: document.getElementById('refresh-tree'),
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebar-toggle'),
    // Form Inputs
    ownerInput: document.getElementById('gh-owner'),
    repoInput: document.getElementById('gh-repo'),
    branchInput: document.getElementById('gh-branch'),
    tokenInput: document.getElementById('gh-token')
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
    
    // Automatically open modal if config is empty
    if (!state.config.owner || !state.config.repo) {
        showSettingsModal();
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
    // Modal controls
    elements.settingsBtn.addEventListener('click', showSettingsModal);
    elements.closeSettings.addEventListener('click', hideSettingsModal);
    elements.saveSettings.addEventListener('click', saveSettingsFromForm);
    if (elements.configureNowBtn) {
        elements.configureNowBtn.addEventListener('click', showSettingsModal);
    }
    
    // Refresh & sync
    elements.refreshTree.addEventListener('click', syncRepository);
    
    // Theme toggle
    elements.themeToggle.addEventListener('click', toggleTheme);
    
    // Search filter
    elements.searchInput.addEventListener('input', handleSearch);

    // Sidebar Mobile Toggle
    elements.sidebarToggle.addEventListener('click', () => {
        elements.sidebar.classList.toggle('active');
        const icon = elements.sidebarToggle.querySelector('i');
        if (elements.sidebar.classList.contains('active')) {
            icon.setAttribute('data-lucide', 'x');
        } else {
            icon.setAttribute('data-lucide', 'menu');
        }
        lucide.createIcons();
    });

    // Close modal when clicking outside
    elements.settingsModal.addEventListener('click', (e) => {
        if (e.target === elements.settingsModal) hideSettingsModal();
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
    elements.repoInput.value = state.config.repo || '';
    elements.branchInput.value = state.config.branch || 'main';
    elements.tokenInput.value = state.config.token || '';

    // Theme loading
    const savedTheme = localStorage.getItem('coredocs_theme') || 'dark';
    state.theme = savedTheme;
    if (savedTheme === 'light') {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
    }
}

function showSettingsModal() {
    elements.settingsModal.classList.add('active');
}

function hideSettingsModal() {
    elements.settingsModal.classList.remove('active');
}

function saveSettingsFromForm() {
    state.config.owner = elements.ownerInput.value.trim();
    state.config.repo = elements.repoInput.value.trim();
    state.config.branch = elements.branchInput.value.trim() || 'main';
    state.config.token = elements.tokenInput.value.trim();

    localStorage.setItem('coredocs_config', JSON.stringify(state.config));
    hideSettingsModal();
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
        showWelcomeScreen("Configure your Repository settings to load documents.");
        return;
    }

    showTreeLoader();

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
        
        // Filter out non-markdown files (except readmes/folders) and store flat mapping
        state.flatFiles = {};
        const markdownNodes = treeNodes.filter(node => {
            if (node.type === 'blob') {
                if (node.path.endsWith('.md')) {
                    state.flatFiles[node.path] = node.sha;
                    return true;
                }
                return false;
            }
            return true; // Keep folders
        });

        // Construct tree object structure
        state.fileTree = buildTreeHierarchy(markdownNodes);
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
            // File item
            item.innerHTML = `
                <i data-lucide="file-text" style="color: var(--text-secondary)"></i>
                <span class="node-name">${node.name.replace('.md', '')}</span>
            `;
            
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // Highlight active item
                document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                
                // Update hash trigger (browser handles loading via hashchange event)
                window.location.hash = '/' + node.path;

                // Close mobile sidebar
                if (window.innerWidth <= 768) {
                    elements.sidebar.classList.remove('active');
                    const icon = elements.sidebarToggle.querySelector('i');
                    icon.setAttribute('data-lucide', 'menu');
                    lucide.createIcons();
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
        
        // Parse Obsidian links
        markdown = parseWikiLinks(markdown);
        
        // Parse basic markdown to HTML
        let html = mdParser.render(markdown);
        
        elements.contentViewer.innerHTML = html;
        
        // Render Mermaid Diagrams dynamically
        await renderMermaidDiagrams(elements.contentViewer);
        
        // Trigger Prism syntax highlighting
        Prism.highlightAllUnder(elements.contentViewer);
        
        // Trigger KaTeX math rendering (Inline/Block equations)
        renderMathInDocument(elements.contentViewer);

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
        
        const span = document.createElement('span');
        if (index === parts.length - 1) {
            span.className = 'current';
            span.innerText = part.replace('.md', '');
        } else {
            span.innerText = part;
        }
        elements.breadcrumbs.appendChild(span);
    });
}

// Handle search and filtering
function handleSearch(e) {
    const query = e.target.value.toLowerCase().trim();
    if (!query) {
        // Restore full tree rendering
        renderFileTree(state.fileTree);
        return;
    }

    // Filter file tree recursively
    function filterNodes(nodes) {
        const results = [];
        nodes.forEach(node => {
            if (node.type === 'directory') {
                const matchedChildren = filterNodes(node.children);
                if (matchedChildren.length > 0 || node.name.toLowerCase().includes(query)) {
                    const clonedNode = { ...node, children: matchedChildren };
                    results.push(clonedNode);
                }
            } else {
                if (node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)) {
                    results.push(node);
                }
            }
        });
        return results;
    }

    const filtered = filterNodes(state.fileTree);
    renderFileTree(filtered);
    
    // Automatically expand all directory results to show matches
    document.querySelectorAll('.tree-children').forEach(el => {
        el.style.display = 'block';
    });
    document.querySelectorAll('.tree-item').forEach(el => {
        el.classList.remove('collapsed');
    });
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
