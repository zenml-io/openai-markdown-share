# ChatGPT → GitHub Gist

Tampermonkey userscript to **add a "Share" button** to <https://chat.openai.com>, converting the conversation into Markdown and saving it as a **private GitHub Gist**.

---
## Installation (2 mins)
1. **Install [Tampermonkey](https://www.tampermonkey.net/)** in your browser.
2. Click its toolbar icon → *Create a new script* → paste the contents of **`tampermonkey_script.js`** (this repo) → **Save**.
3. Refresh any open ChatGPT tab; a **"Share"** button now appears in the chat interface.

---
## First‑use setup
The first time you press **Share** the script will prompt for a **GitHub Personal‑Access Token (PAT)**:
1. Visit <https://github.com/settings/tokens/new?scopes=gist&description=ChatGPTShare>  
2. Tick the **"gist"** scope (✱the only permission required✱).  
3. Generate, copy, and paste the token into the prompt.  
4. The token is stored locally via Tampermonkey's `GM_setValue`; **never sent anywhere except GitHub**.

You can update/clear the PAT later via Tampermonkey's *Storage* panel or by running `localStorage.removeItem('github_pat')` in DevTools.

---
## Usage
1. Chat as usual on ChatGPT.  
2. Click **Share**.  
   * A status banner appears ("Preparing… → Uploading…").  
   * A new tab opens with your **private Gist** containing `chatgpt_conversation.md`.

The Markdown format mirrors:
```md
# ChatGPT Conversation

## 🧑 User
…
---

## 🤖 Assistant
…
---
```
Use GitHub's *Download ZIP* or *Raw* to retrieve the file, or share the Gist URL.

---
## FAQ
### Does this leak my chat to any third party?
Only to **GitHub**, and only after **you explicitly press Share**. The script runs entirely in‑browser, scraping the DOM you can already see.

### Can I make the Gist public?
In `tampermonkey_script.js` change `public: false` to `true` inside `uploadGist()`.

### Where's the code that extracts the messages?
See `scrapeConversation()` in the userscript. It identifies messages using the data attributes in the ChatGPT DOM to determine if they are from the user or assistant.

---
## Uninstall
*Disable* the userscript from Tampermonkey or simply delete it. Stored PATs can
be purged via Tampermonkey's *Storage* tab.
