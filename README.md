# ChatGPT → GitHub Gist or Copy

Tampermonkey userscript to **add buttons** to
<https://chat.openai.com>, converting the conversation and research reports into Markdown and either
**copying to clipboard** or saving as **private GitHub Gists**.

## Why This Script Is Needed

In early May 2025, ChatGPT updated its interface and appears to have broken the built-in Markdown copying functionality. While ChatGPT does provide buttons to copy content, **links are now stripped from the copied Markdown**, severely reducing the usefulness of research reports and conversations with citations.

This script:
1. **Restores proper Markdown export** with all links and formatting intact
2. **Adds clipboard copying** for immediate use of complete Markdown
3. **Provides Gist export** (which was never available natively)

For anyone who needs to preserve the full value of ChatGPT's outputs including all links and citations, this script provides a simple solution.

---
## Installation (2 mins)
1. **Install [Tampermonkey](https://www.tampermonkey.net/)** in your browser.
2. Click its toolbar icon → *Create a new script* → paste the contents of **`tampermonkey_script.js`** (this repo) → **Save**.
3. Refresh any open ChatGPT tab; share buttons will appear in the chat interface.

---
## First‑use setup
The **Copy** buttons work immediately without any setup and don't require GitHub authentication.

For the **Gist** functionality, the first time you press any Gist button, the script will prompt for a **GitHub Personal‑Access Token (PAT)**:
1. Visit <https://github.com/settings/tokens/new?scopes=gist&description=ChatGPTShare>  
2. Tick the **"gist"** scope (✱the only permission required✱).  
3. Generate, copy, and paste the token into the prompt.  
4. The token is stored locally via Tampermonkey's `GM_setValue`; **never sent anywhere except GitHub**.

You can update/clear the PAT later via Tampermonkey's *Storage* panel or by running `localStorage.removeItem('github_pat')` in DevTools.

---
## Usage

### Main Chat Buttons
The script adds two buttons to the chat interface that export the entire conversation:

![Main Share Button Screenshot](share_button_bottom.png)

1. Chat as usual on ChatGPT.  
2. Two buttons are available at the bottom of the chat:
   * **Copy** (blue): Copies the conversation as Markdown to your clipboard.
     * A status banner appears ("Preparing markdown…").
     * The formatted Markdown is copied to your clipboard for immediate use.
   * **Gist** (green): Saves the conversation as a GitHub Gist.
     * A status banner appears ("Preparing… → Uploading…").
     * A new tab opens with your **private Gist** containing `chatgpt_conversation.md`.

### Research Report Buttons
When ChatGPT generates "deep research" reports, the script adds dedicated buttons at the top and bottom of each research report:

![Research Report Share Buttons Screenshot](research_share_buttons.png)

1. Hover over any research report section to see the buttons.
2. Two buttons are available at both the top and bottom of research reports:
   * **Copy** (blue): Copies just that research report as Markdown to your clipboard.
     * A status banner appears ("Preparing research report…").
     * The formatted research report Markdown is copied to your clipboard.
   * **Share** (green): Saves the research report as a GitHub Gist.
     * A status banner appears ("Preparing research report… → Uploading…").
     * A new tab opens with a **private Gist** containing just that research report.

The Markdown format for full conversations mirrors:
```md
# ChatGPT Conversation

## 🧑 User
…
---

## 🤖 Assistant
…
---
```

For research reports, the format is:
```md
# ChatGPT Research Report

[Content of the research report with formatting and links preserved]
```

When using the Copy button, you can immediately paste the Markdown anywhere you need it.

When using the Gist functionality, you can use GitHub's *Download ZIP* or *Raw* to retrieve the file, or share the Gist URL.

---
## FAQ
### Does this leak my chat to any third party?
- **Copy buttons**: No data is sent anywhere. The Markdown is copied directly to your clipboard within your browser.
- **Gist buttons**: Data is sent only to **GitHub**, and only after **you explicitly press a Gist button**. 

The script runs entirely in‑browser, scraping the DOM you can already see.

### Can I make the Gist public?
In `tampermonkey_script.js` change `public: false` to `true` inside `uploadGist()`.

### Where's the code that extracts the messages?
See `scrapeConversation()` in the userscript for full conversations and `scrapeResearchReport()` for individual research reports. The script identifies messages using data attributes in the ChatGPT DOM and handles special formatting like citation links.

### What are the different buttons for?
- **Copy Button** (blue): Instantly copies the Markdown to your clipboard without requiring GitHub authentication.
- **Gist Button** (green): Exports the content to a private GitHub Gist (requires GitHub PAT).
- **Research Report Buttons**: Small buttons that appear at the top and bottom of research reports, allowing you to copy or share just that specific research section without the rest of the conversation.

---
## Uninstall
*Disable* the userscript from Tampermonkey or simply delete it. Stored PATs can
be purged via Tampermonkey's *Storage* tab.
