# 🏛️ CoreDocs Viewer (Decoupled SPA)

A single-page application built for browsing and rendering systems engineering notes (Obsidian wikis) directly from a GitHub repository using the GitHub Git Trees API.

## Features
*   **Zero Repo Intrusion:** The wiki repository only contains raw Markdown files. No web framework configs or static HTML generation files.
*   **Dynamic Client-Side Sync:** Connects to any public (or private, via Personal Access Token) GitHub repository to fetch directory hierarchies.
*   **Aesthetics:** Premium, glassmorphic layout, customizable styling, and seamless theme support.
*   **Markdown Parsing:** Uses `markdown-it` to translate Markdown syntax into raw HTML.
*   **Wiki-Link resolution:** Automatically parses Obsidian-style `[[NoteName]]` or `[[NoteName|Custom Name]]` link tags.
*   **Syntax Highlighting:** Real-time client-side code block syntax highlighting powered by PrismJS.
*   **Math Equations:** Renders complex inline/block math equations using KaTeX.

## Local Development
To view or test the SPA locally, you can serve the directory using any local web server.

### Option A: Python HTTP Server (Zero Install)
Run this command in this directory:
```bash
python -m http.server 8000
```
Then visit `http://localhost:8000` in your web browser.

### Option B: Node.js http-server
If you have node installed, you can use:
```bash
npx http-server
```

## GitHub Pages Deployment
This repository is configured to be hosted directly on GitHub Pages.

1. **Push this code** to your repository on GitHub.
2. Go to **Settings** -> **Pages** in the repository navigation.
3. Under **Build and deployment**:
   * **Source**: *Deploy from a branch*
   * **Branch**: *main* (or your target branch) and select `/ (root)`.
4. Click **Save**.
5. Your Wiki browser will be live at `https://<your-username>.github.io/<your-repo-name>/`.
