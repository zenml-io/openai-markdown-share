// ==UserScript==
// @name         ChatGPT ➜ Gist
// @namespace    https://github.com/strickvl/openai-markdown-chat-share
// @version      0.1
// @description  Add a "Share to GitHub Gist" button to chat.openai.com that captures the conversation in Markdown.
// @author       Alex Strick van Linschoten
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @icon         https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_log
// @connect      api.github.com
// @require      https://cdn.jsdelivr.net/npm/turndown@7.1.2/dist/turndown.min.js
// ==/UserScript==

/**
 * ChatGPT → GitHub Gist
 * -------------------------------------------------------------
 * v0.1
 */
(function () {
    "use strict";
  
    // DEBUG helper
    function debug(msg, obj) {
      if (obj) {
        console.log(`[ChatGPT Share] ${msg}`, obj);
        GM_log(`[ChatGPT Share] ${msg}`, JSON.stringify(obj));
      } else {
        console.log(`[ChatGPT Share] ${msg}`);
        GM_log(`[ChatGPT Share] ${msg}`);
      }
    }
  
    debug("Script loaded");
  
    /*───────────────────────────────────────────────*/
    /*  CONFIG & UTILITIES                          */
    /*───────────────────────────────────────────────*/
    async function getGitHubPAT() {
      let pat = GM_getValue("github_pat", "");
      if (!pat) {
        pat = prompt(
          "GitHub Personal‑Access Token (scope: gist) – stored **locally**:",
          ""
        );
        if (!pat) throw new Error("PAT not provided.");
        GM_setValue("github_pat", pat.trim());
      }
      return pat.trim();
    }
  
    // Configure TurndownService
    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      fence: "```"
    });
    
    // Global to collect citation links
    let citationLinks = [];
    let adjacentCitations = [];
    
    // Enhance link formatting with custom rule for better spacing
    turndown.addRule('links', {
      filter: ['a'],
      replacement: function (content, node) {
        // Get link URL and text
        const href = node.getAttribute('href');
        
        // Skip blob URLs (images)
        if (href && href.startsWith('blob:')) {
          return content;
        }
        
        // Don't process empty links
        if (!href || href === '#' || href === '') {
          return content;
        }
        
        // Check if this is a citation link (has a small badge class or is inline-flex)
        const isCitation = node.classList.contains('ms-1') || 
                           node.parentElement?.classList.contains('ms-1') ||
                           href.includes('#:~:text=') || 
                           node.innerHTML.includes('inline-flex');
        
        if (isCitation) {
          try {
            // Extract domain from URL for citation
            let domain = '';
            try {
              domain = href.includes('://') ? new URL(href).hostname : href;
            } catch (e) {
              domain = href.split('/')[2] || href;
            }
            
            // Look for adjacent citation siblings
            if (node.nextElementSibling && 
                node.nextElementSibling.tagName === 'A' && 
                (node.nextElementSibling.classList.contains('ms-1') || 
                 node.nextElementSibling.innerHTML.includes('inline-flex'))) {
              // This is part of a group of citations
              if (!adjacentCitations.length) {
                // Start a new group
                adjacentCitations.push({ domain, href });
                // Return a placeholder for the start of the group
                return `[[CITATION_GROUP_START]]`;
              } else {
                // Add to existing group
                adjacentCitations.push({ domain, href });
                return ''; // Don't output anything for middle elements
              }
            } else if (adjacentCitations.length > 0) {
              // This is the last element in a group
              adjacentCitations.push({ domain, href });
              
              // Create a group marker with all adjacent citations
              const groupId = citationLinks.length;
              citationLinks.push([...adjacentCitations]);
              
              // Reset the group tracking
              adjacentCitations = [];
              
              // Return a placeholder for the entire group
              return `[[CITATION_GROUP${groupId}]]`;
            } else {
              // This is a standalone citation
              const citationId = citationLinks.length;
              citationLinks.push({ domain, href });
              return `[[CITATION${citationId}]]`;
            }
          } catch (e) {
            // Fallback if parsing fails
            debug("Citation parsing error", e);
            return `[${content}](${href})`;
          }
        } else if (adjacentCitations.length > 0) {
          // If we were collecting citations but hit a non-citation link,
          // flush the collected citations
          const groupId = citationLinks.length;
          citationLinks.push([...adjacentCitations]);
          
          // Reset the group tracking
          adjacentCitations = [];
          
          // Return a placeholder for the group plus this link
          return `[[CITATION_GROUP${groupId}]][${content}](${href})`;
        }
        
        // Regular link formatting
        return `[${content}](${href})`;
      }
    });
    
    // Add a filter rule to handle the end of document and flush any pending citations
    turndown.addRule('documentEnd', {
      filter: function(node) {
        // Apply to body or last paragraph to ensure we catch the end
        return node.tagName === 'BODY' || node.tagName === 'DIV';
      },
      replacement: function(content) {
        // Check if we have any pending citations to flush
        if (adjacentCitations.length > 0) {
          const groupId = citationLinks.length;
          citationLinks.push([...adjacentCitations]);
          
          // Reset the collection
          adjacentCitations = [];
          
          // Add the placeholder at the end
          return content + `[[CITATION_GROUP${groupId}]]`;
        }
        
        return content;
      }
    });
    
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  
    /*───────────────────────────────────────────────*/
    /*  SCRAPE CHAT → MD                            */
    /*───────────────────────────────────────────────*/
    function scrapeConversation() {
      debug("Scraping conversation");
      
      // Try multiple selectors to find conversation turns
      const selectors = [
        'div[data-testid^="conversation-turn-"]',   // New format div
        'article[data-testid^="conversation-turn-"]', // New format article
        'div[data-message-author-role]',            // Elements with direct role attribute
        'article[data-message-author-role]',        // Articles with direct role attribute
        '.text-message',                            // Message containers
        '.min-h-[20px]',                            // Minimal height message containers
        '.markdown',                                // Markdown content containers
        'main .flex.flex-col.items-center > div'    // General conversation container children
      ];
      
      let blocks = [];
      
      // Try each selector until we find some conversation blocks
      for (const selector of selectors) {
        blocks = document.querySelectorAll(selector);
        debug(`Trying selector "${selector}" - found ${blocks.length} elements`);
        
        if (blocks.length > 0) {
          debug(`Using selector: ${selector}`);
          break;
        }
      }
      
      // Fallback: If no blocks found with specific selectors, try a more generic approach
      if (blocks.length === 0) {
        // Look for any elements that might contain markdown content or message text
        debug("Using fallback approach to find conversation elements");
        
        // First try to find the main conversation container
        const mainThread = document.querySelector('main div[class*="flex-col"]');
        if (mainThread) {
          // Look for direct children that are likely conversation turns
          blocks = mainThread.querySelectorAll(':scope > div');
          debug(`Found ${blocks.length} potential blocks via main thread approach`);
        }
        
        // If that didn't work, try to find all markdown elements and work backwards
        if (blocks.length === 0) {
          const markdownElements = document.querySelectorAll('.markdown');
          debug(`Found ${markdownElements.length} markdown elements`);
          
          if (markdownElements.length > 0) {
            // For each markdown element, find its closest conversation block container
            blocks = Array.from(markdownElements).map(el => {
              // Look for parent with a minimum height constraint (likely a message container)
              return el.closest('div[class*="min-h-"]') || el.closest('div[class*="flex"]') || el.parentElement;
            }).filter(el => el !== null);
            
            // Remove duplicates
            blocks = [...new Set(blocks)];
            debug(`Found ${blocks.length} unique conversation blocks via markdown elements`);
          }
        }
      }
      
      debug(`Found ${blocks.length} conversation blocks`);
      
      const msgs = [];
  
      blocks.forEach((block, index) => {
        // Reset citation collection for each block
        citationLinks = [];
        adjacentCitations = [];
        
        // Get the role information - multiple attempts based on possible DOM structures
        let role = block.getAttribute('data-message-author-role') ||
                   block.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role');
                   
        // If no role attribute is found, try to determine role based on content structure
        if (!role) {
          if (block.querySelector('.markdown') || block.classList.contains('markdown')) {
            role = 'assistant';
          } else if (block.querySelector('.whitespace-pre-wrap') || block.classList.contains('whitespace-pre-wrap')) {
            role = 'user';
          } else if (block.querySelectorAll('p, ul, ol, pre, code').length > 0) {
            // If it has rich text elements, it's likely the assistant
            role = 'assistant';
          } else {
            // Try to determine role by position (odd indices are assistant in typical chat)
            role = index % 2 === 0 ? 'user' : 'assistant';
          }
        }
        
        debug(`Block ${index} assigned role: ${role}`);
        
        let content = "";
        
        if (role === "assistant") {
          // Special case: Check for deep research results
          const deepResearchResult = block.querySelector('.deep-research-result');
          
          if (deepResearchResult) {
            debug(`Found deep research result in block ${index}`);
            content = turndown.turndown(deepResearchResult.innerHTML).trim();
            
            // Post-process to fix link formatting and spacing issues
            content = postProcessMarkdown(content);
            
            debug(`Extracted deep research content (length: ${content.length})`);
          } else {
            // Regular assistant messages have a markdown element
            const markdown = block.querySelector('.markdown') || block;
            if (markdown) {
              // Use innerHTML if it's a content container, or textContent if it's just text
              const hasRichContent = markdown.querySelectorAll('p, code, pre, ol, ul, table').length > 0;
              content = hasRichContent 
                ? turndown.turndown(markdown.innerHTML).trim() 
                : markdown.textContent.trim();
                
              content = postProcessMarkdown(content);
              debug(`Extracted assistant content (length: ${content.length})`);
            } else {
              debug(`Block ${index} (assistant) has no content element`);
            }
          }
          
          // Another special case: Check for content in the "border-token-border-sharp" container
          if (!content || content.length < 100) {
            const borderContainer = block.querySelector('.border-token-border-sharp');
            if (borderContainer) {
              const borderMarkdown = borderContainer.querySelector('.markdown');
              if (borderMarkdown) {
                // Reset citations for this section
                citationLinks = [];
                adjacentCitations = [];
                
                let borderContent = turndown.turndown(borderMarkdown.innerHTML).trim();
                borderContent = postProcessMarkdown(borderContent);
                debug(`Extracted border container content (length: ${borderContent.length})`);
                
                // If this is substantially longer than what we already have, use it
                if (borderContent.length > (content.length * 1.5)) {
                  content = borderContent;
                } else if (content) {
                  // Append if we already have some content
                  content += "\n\n---\n\n" + borderContent;
                } else {
                  content = borderContent;
                }
              }
            }
          }
        } else if (role === "user") {
          // User messages can be found in various containers
          const userContent = 
            block.querySelector('.whitespace-pre-wrap') || 
            block.querySelector('p') ||
            block;
            
          if (userContent) {
            // User content is typically plain text
            content = userContent.textContent.trim();
            debug(`Extracted user content (length: ${content.length})`);
          } else {
            debug(`Block ${index} (user) has no content element`);
          }
        }
        
        if (content) {
          msgs.push({ role, content });
        }
      });
  
      debug(`Extracted ${msgs.length} messages`);
      return msgs;
    }
    
    // Extract content from a deep research report
    function scrapeResearchReport(researchElement) {
      debug("Scraping research report");
      
      // Reset citation collection
      citationLinks = [];
      adjacentCitations = [];
      
      // Extract content
      let content = turndown.turndown(researchElement.innerHTML).trim();
      
      // Post-process to fix link formatting and spacing issues
      content = postProcessMarkdown(content);
      
      debug(`Extracted research content (length: ${content.length})`);
      
      return content;
    }
    
    // Share a research report
    async function shareResearchReport(researchElement) {
      debug("Sharing research report");
      
      try {
        banner("Preparing research report…", "info", 1500);
        
        // Get research content
        const content = scrapeResearchReport(researchElement);
        if (!content) {
          throw new Error("Could not extract research report content");
        }
        
        // Build markdown
        let md = "# ChatGPT Research Report\n\n";
        md += content;
        
        // Upload to Gist
        const pat = await getGitHubPAT();
        banner("Uploading Gist…", "info", 0);
        
        // Upload with research report title
        const url = await uploadGist(md, pat, "ChatGPT Research Report");
        banner("Gist created!", "success");
        window.open(url, "_blank");
      } catch (e) {
        console.error(e);
        banner(e.message, "error", 6000);
      }
    }
    
    // Post-process markdown to fix common link formatting issues
    function postProcessMarkdown(markdown) {
      if (!markdown) return "";
      
      // Fix spacing around links
      let processed = markdown
        // First, replace any group start markers (should be rare, but handle edge cases)
        .replace(/\[\[CITATION_GROUP_START\]\]/g, '')
        
        // Replace citation groups with properly formatted links
        .replace(/\[\[CITATION_GROUP(\d+)\]\]/g, (match, id) => {
          const group = citationLinks[parseInt(id, 10)];
          if (!group || !Array.isArray(group)) return match;
          
          // Format each citation and join them with spaces
          const citations = group.map(citation => {
            return `([${citation.domain}](${citation.href}))`;
          }).join(' ');
          
          return ` ${citations}`;
        })
        
        // Replace individual citations
        .replace(/\[\[CITATION(\d+)\]\]/g, (match, id) => {
          const citation = citationLinks[parseInt(id, 10)];
          // Handle both single citations and incorrectly formatted groups
          if (!citation) return match;
          if (Array.isArray(citation)) {
            const citations = citation.map(c => {
              return `([${c.domain}](${c.href}))`;
            }).join(' ');
            return ` ${citations}`;
          }
          return ` ([${citation.domain}](${citation.href}))`;
        })
        
        // Fix domain links without citation brackets
        .replace(/\[([a-z0-9-]+\.[a-z0-9-]+(?:\.[a-z0-9-]+)*)\]\((https?:\/\/[^\s)]+)\)/g, (match, domain, url) => {
          // Only add parentheses if this isn't already in parentheses
          if (match.startsWith('(') && match.endsWith(')')) return match;
          return `([${domain}](${url}))`;
        })
        
        // Fix URLs that are directly adjacent to words with no space
        .replace(/(\w)(\[.+?\]\(.+?\))/g, '$1 $2')
        
        // Ensure a space between sentences and links
        .replace(/\.(\[)/g, '. $1')
        
        // Add space after commas before links
        .replace(/,(\[)/g, ', $1')
        
        // Ensure space between links
        .replace(/\)(\[)/g, ') $1')
        
        // Remove any double parentheses
        .replace(/\(\((\[[^\]]+\]\([^)]+\))\)\)/g, '($1)')
        
        // Ensure space after links
        .replace(/\)([a-zA-Z0-9])/g, ') $1')
        
        // Remove any potential double spaces
        .replace(/  +/g, ' ');
                
      // Ensure proper spacing around parentheses with links
      processed = processed
        .replace(/\(\s+\(/g, '(')
        .replace(/\)\s+\)/g, ')')
        .replace(/\)\s*\(/g, ') (')
        .replace(/\(\s*\)/g, '()');
      
      return processed;
    }
  
    function toMarkdown(convo) {
      const out = ["# ChatGPT Conversation", ""];
      convo.forEach((t) => {
        const emoji = t.role === "user" ? "🧑" : "🤖";
        out.push(`## ${emoji} ${cap(t.role)}`, "", t.content, "", "---", "");
      });
      return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }
  
    /*───────────────────────────────────────────────*/
    /*  GITHUB GIST API                             */
    /*───────────────────────────────────────────────*/
    function uploadGist(markdown, pat, description = "ChatGPT Conversation") {
      debug("Uploading to GitHub Gist API");
      return new Promise((res, rej) => {
        GM_xmlhttpRequest({
          method: "POST",
          url: "https://api.github.com/gists",
          headers: {
            Authorization: `token ${pat}`,
            Accept: "application/vnd.github+json",
          },
          data: JSON.stringify({
            description: description,
            public: false,
            files: {
              chatgpt_conversation: {
                filename: "chatgpt_conversation.md",
                content: markdown,
              },
            },
          }),
          onload: (r) => {
            if (r.status >= 200 && r.status < 300) {
              debug("Gist created successfully");
              res(JSON.parse(r.responseText).html_url);
            }
            else {
              debug(`GitHub API error: ${r.status}`, r.responseText);
              rej(new Error(`GitHub API error (${r.status})`));
            }
          },
          onerror: (e) => {
            debug("Network error contacting GitHub", e);
            rej(new Error("Network error contacting GitHub"));
          },
        });
      });
    }
  
    /*───────────────────────────────────────────────*/
    /*  BANNER                                      */
    /*───────────────────────────────────────────────*/
    function banner(msg, kind = "info", dur = 4000) {
      debug(`Banner: ${msg} (${kind})`);
      const c = { info: "#2563eb", success: "#15803d", error: "#dc2626" }[kind];
      const el = Object.assign(document.createElement("div"), {
        textContent: msg,
      });
      el.style.cssText = `position:fixed;top:0;left:0;right:0;padding:8px 12px;font:14px system-ui,sans-serif;color:#fff;background:${c};z-index:99999;text-align:center`;
      document.body.appendChild(el);
      if (dur) setTimeout(() => el.remove(), dur);
    }
  
    /*───────────────────────────────────────────────*/
    /*  BUTTON CREATION                             */
    /*───────────────────────────────────────────────*/
    function createButton(idSuffix = "inline") {
      debug(`Creating button with suffix: ${idSuffix}`);
      const btn = document.createElement("button");
      btn.id = `chatgpt-share-btn-${idSuffix}`;
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M7.9 8.8h.4l4.9-5c.2-.2.2-.5 0-.7-.2-.2-.5-.2-.7 0L8 7.6 3.5 3.1c-.2-.2-.5-.2-.7 0-.2.2-.2.5 0 .7l4.9 5c0-.1.1 0 .2 0zm0 2.8h.4l4.9-5c.2-.2.2-.5 0-.7-.2-.2-.5-.2-.7 0L8 10.4l-4.5-4.5c-.2-.2-.5-.2-.7 0-.2.2-.2.5 0 .7l4.9 5c.1 0 .1.1.2 0z"></path></svg> Share`;
      btn.title = "Share this conversation as a GitHub Gist";
      btn.className = "chatgpt-share-btn"; // Use a class for styling
      
      btn.onclick = async () => {
        try {
          banner("Preparing conversation…", "info", 1500);
          const convo = scrapeConversation();
          if (!convo.length) throw new Error("No messages detected on screen.");
          const md = toMarkdown(convo);
          const pat = await getGitHubPAT();
          banner("Uploading Gist…", "info", 0);
          const url = await uploadGist(md, pat);
          banner("Gist created!", "success");
          window.open(url, "_blank");
        } catch (e) {
          console.error(e);
          banner(e.message, "error", 6000);
        }
      };
      return btn;
    }
    
    // Create share button for a research report
    function createResearchShareButton(researchElement, position = 'top') {
      debug(`Creating ${position} share button for research report`);
      
      // Create unique class for this button position
      const buttonClass = `chatgpt-research-share-btn-${position}`;
      
      // Check if this report already has a button in this position
      if (researchElement.querySelector(`.${buttonClass}`)) {
        return;
      }
      
      // Create the button
      const btn = document.createElement("button");
      btn.className = `chatgpt-research-share-btn ${buttonClass}`;
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>`;
      btn.title = "Share this research report to GitHub Gist";
      
      // Set position-specific styles
      let positionStyles = '';
      if (position === 'top') {
        positionStyles = `
          top: 8px;
          right: 8px;
        `;
      } else if (position === 'bottom') {
        positionStyles = `
          bottom: 8px;
          right: 8px;
        `;
      }
      
      // Style the button
      btn.style.cssText = `
        background: #19c37d;
        color: white;
        border: none;
        border-radius: 4px;
        width: 28px;
        height: 28px;
        padding: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        position: absolute;
        ${positionStyles}
        opacity: 0.8;
        transition: opacity 0.2s;
        z-index: 1000;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      `;
      
      // Add hover effect
      btn.addEventListener('mouseover', () => {
        btn.style.opacity = '1';
      });
      
      btn.addEventListener('mouseout', () => {
        btn.style.opacity = '0.8';
      });
      
      // Add click event
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await shareResearchReport(researchElement);
      });
      
      return btn;
    }
    
    // Add share buttons to research reports only (top and bottom)
    function addResearchShareButtons() {
      debug("Adding share buttons to research reports");
      
      // Find all deep research reports
      const researchReports = document.querySelectorAll('.deep-research-result');
      debug(`Found ${researchReports.length} research reports`);
      
      researchReports.forEach((report) => {
        // Make sure the report has a relative position for absolute positioning of the buttons
        if (!report.style.position || report.style.position === 'static') {
          report.style.position = 'relative';
        }
        
        // Check for existing buttons
        const hasTopButton = report.querySelector('.chatgpt-research-share-btn-top');
        const hasBottomButton = report.querySelector('.chatgpt-research-share-btn-bottom');
        
        // Add top button if needed
        if (!hasTopButton) {
          const topBtn = createResearchShareButton(report, 'top');
          if (topBtn) {
            report.appendChild(topBtn);
            debug("Added top share button to research report");
          }
        }
        
        // Add bottom button if needed
        if (!hasBottomButton) {
          const bottomBtn = createResearchShareButton(report, 'bottom');
          if (bottomBtn) {
            report.appendChild(bottomBtn);
            debug("Added bottom share button to research report");
          }
        }
      });
    }
  
    /*───────────────────────────────────────────────*/
    /*  TARGET CONTAINER DETECTION                  */
    /*───────────────────────────────────────────────*/
    function findButtonTarget() {
      debug("Finding button target");
      
      // Option 1: Try to find the trailing actions - best container for our button
      const trailingActions = document.querySelector('[data-testid="composer-trailing-actions"]');
      if (trailingActions) {
        debug("Found trailing actions container");
        return { 
          element: trailingActions, 
          method: 'prepend', 
          position: 'first-child'
        };
      }
      
      // Option 2: Try to find composer footer actions
      const composerActions = document.querySelector('[data-testid="composer-footer-actions"]');
      if (composerActions) {
        debug("Found composer actions container");
        return { 
          element: composerActions, 
          method: 'append', 
          position: 'relative'
        };
      }
      
      // Option 3: Try to add next to the textarea
      const textarea = document.getElementById('prompt-textarea');
      if (textarea && textarea.parentElement) {
        debug("Found textarea container");
        return { 
          element: textarea.parentElement.parentElement,
          method: 'append', 
          position: 'after-input'
        };
      }

      // Option 4: Try conversation header actions
      const headerActions = document.getElementById('conversation-header-actions');
      if (headerActions) {
        debug("Found conversation header actions");
        return { 
          element: headerActions, 
          method: 'append', 
          position: 'header'
        };
      }

      // Option 5: Use the floating button as fallback
      debug("No suitable target found, will use floating button");
      return null;
    }
  
    /*───────────────────────────────────────────────*/
    /*  INJECTION LOGIC                             */
    /*───────────────────────────────────────────────*/
    function dumpUIElements() {
      // Dump useful elements for debugging
      debug("Dumping UI Elements for debugging");
      
      // Look for IDs
      const elementsWithId = document.querySelectorAll("[id]");
      debug(`Found ${elementsWithId.length} elements with IDs`);
      if (elementsWithId.length < 50) { // Don't log too many
        const ids = Array.from(elementsWithId).map(el => el.id);
        debug("Element IDs:", ids);
      }
      
      // Look for important data-testid elements
      const testIdElements = document.querySelectorAll("[data-testid]");
      debug(`Found ${testIdElements.length} elements with data-testid`);
      if (testIdElements.length < 50) {
        const testIds = Array.from(testIdElements).map(el => el.getAttribute("data-testid"));
        debug("Test IDs:", testIds);
      }
      
      // Check for specific elements we're targeting
      const potentialTargets = [
        "composer-footer-actions",
        "composer-trailing-actions",
        "thread-bottom", 
        "thread-bottom-container",
        "conversation-turn"
      ];
      
      potentialTargets.forEach(id => {
        const el = document.querySelector(`[data-testid="${id}"], [data-testid^="${id}"]`);
        debug(`Element '${id}': ${el ? "Found" : "Not found"}`);
      });
      
      // Additional debugging info
      debug(`Found ${document.querySelectorAll('.deep-research-result').length} research reports`);
      debug(`Found ${document.querySelectorAll('.markdown').length} markdown elements`);
      
      // Debug conversation blocks
      debug(`Testing conversation block selectors`);
      const conversationSelectors = [
        'div[data-testid^="conversation-turn-"]',
        'article[data-testid^="conversation-turn-"]',
        'div[data-message-author-role]',
        'article[data-message-author-role]',
        '.min-h-[20px]',
        '.whitespace-pre-wrap'
      ];
      
      conversationSelectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          debug(`Selector "${selector}": ${elements.length} elements`);
        } catch (e) {
          debug(`Error with selector "${selector}": ${e.message}`);
        }
      });
    }
    
    function injectButton() {
      // Check if already injected
      if (document.querySelector(".chatgpt-share-btn")) {
        debug("Button already exists, skipping injection");
        return;
      }
      
      dumpUIElements();
      
      const target = findButtonTarget();
      if (target && target.element) {
        debug(`Injecting button with method: ${target.method}, position: ${target.position}`);
        const btn = createButton("inline");
        
        // Apply styling based on where we're inserting the button
        if (target.position === 'first-child') {
          btn.style.cssText = "margin-right: 8px; padding: 6px 12px; background: #19c37d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; display: flex; align-items: center; gap: 5px;";
          target.element.prepend(btn);
        } else if (target.position === 'relative') {
          btn.style.cssText = "margin-left: 8px; padding: 6px 12px; background: #19c37d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; display: flex; align-items: center; gap: 5px;";
          target.element.appendChild(btn);
        } else if (target.position === 'after-input') {
          btn.style.cssText = "position: absolute; right: 15px; top: 15px; padding: 6px 12px; background: #19c37d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; display: flex; align-items: center; gap: 5px; z-index: 1000;";
          target.element.appendChild(btn);
        } else if (target.position === 'header') {
          btn.style.cssText = "margin-left: 8px; padding: 6px 12px; background: #19c37d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; display: flex; align-items: center; gap: 5px;";
          target.element.appendChild(btn);
        }
      } else if (!document.querySelector("#chatgpt-share-btn-float")) {
        debug("Injecting floating button");
        // Fallback floating button (visible even if no target found)
        const floatBtn = createButton("float");
        floatBtn.style.cssText = "position: fixed; top: 12px; right: 12px; padding: 6px 12px; background: #19c37d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; display: flex; align-items: center; gap: 5px; z-index: 9999;";
        document.body.appendChild(floatBtn);
      }
      
      // Also add share buttons to research reports
      addResearchShareButtons();
    }
  
    // Add global styles for our buttons
    GM_addStyle(`
      .chatgpt-share-btn {
        background: #19c37d !important;
        color: white !important;
        border: none !important;
        border-radius: 4px !important;
        padding: 6px 12px !important;
        cursor: pointer !important;
        font-weight: 500 !important;
        display: flex !important;
        align-items: center !important;
        gap: 5px !important;
        font-size: 14px !important;
        line-height: 1.2 !important;
        white-space: nowrap !important;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24) !important;
        transition: all 0.3s cubic-bezier(.25,.8,.25,1) !important;
        z-index: 9999 !important;
      }
      
      .chatgpt-share-btn:hover {
        background: #15a36b !important;
        box-shadow: 0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23) !important;
      }
      
      .chatgpt-share-btn svg {
        width: 16px !important;
        height: 16px !important;
      }
      
      .chatgpt-research-share-btn {
        background: #19c37d !important;
        color: white !important;
        border: none !important;
        border-radius: 4px !important;
        width: 28px !important;
        height: 28px !important;
        padding: 6px !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        position: absolute !important;
        opacity: 0.8;
        transition: opacity 0.2s ease !important;
        z-index: 1000 !important;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
      }
      
      .chatgpt-research-share-btn:hover {
        opacity: 1 !important;
        background: #15a36b !important;
      }
      
      .chatgpt-research-share-btn svg {
        width: 12px !important;
        height: 12px !important;
      }
      
      /* Position-specific styles */
      .chatgpt-research-share-btn-top {
        top: 8px !important;
        right: 8px !important;
      }
      
      .chatgpt-research-share-btn-bottom {
        bottom: 8px !important;
        right: 8px !important;
      }
      
      /* Make sure research reports have position relative for button placement */
      .deep-research-result {
        position: relative !important;
        padding-bottom: 40px !important; /* Add padding to make room for bottom button */
      }
      
      /* Hide buttons by default, show on hover */
      .deep-research-result:not(:hover) .chatgpt-research-share-btn {
        opacity: 0.3 !important;
      }
      
      .deep-research-result:hover .chatgpt-research-share-btn {
        opacity: 0.9 !important;
      }
    `);
  
    // Delay initial injection to ensure DOM is loaded
    setTimeout(() => {
      debug("Starting initial injection");
      injectButton();
      
      // Observe SPA mutations + periodic retry (covers nav changes)
      debug("Setting up mutation observer");
      const obs = new MutationObserver((mutations) => {
        // Always check for new research reports
        addResearchShareButtons();
        
        // Only re-inject main button if not present
        if (!document.querySelector(".chatgpt-share-btn")) {
          debug(`Mutation observed (${mutations.length} changes) - button not found, re-injecting`);
          injectButton();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      
      // Regular retry as additional safety
      const retry = setInterval(() => {
        if (!document.querySelector(".chatgpt-share-btn")) {
          debug("Retry timer fired - button not found, re-injecting");
          injectButton();
        } else {
          debug("Button found, clearing retry interval");
          clearInterval(retry);
        }
        
        // Always try to add research share buttons
        addResearchShareButtons();
      }, 3000);
      
      // Clear retry after reasonable timeout
      setTimeout(() => {
        clearInterval(retry);
        debug("Cleared retry interval due to timeout");
      }, 30000);
      
    }, 2000);
  
})();