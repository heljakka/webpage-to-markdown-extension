# Markdown Converter for Chrome

Convert any webpage into Markdown with one click. This extension focuses on the main readable content, strips common page clutter, converts images and figures into Markdown image syntax, and appends content from accessible iframes at the end of the document.

## Features

- One-click conversion from the popup
- Main-content extraction with clutter removal
- Markdown image generation for `img` and `figure`
- Same-origin iframe capture appended under an `Embedded Content` section
- Configurable heading style and unordered list marker
- Copy-to-clipboard and `.md` download actions
- Inline status updates for success and failure cases

## Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this directory: `/home/ari/git/heljakka/web-to-markdown`

## How it works

- `popup.html`, `popup.css`, and `popup.js` provide the popup UI and actions.
- `content.js` is injected into the active tab on demand.
- The page converter selects the most likely content root, removes common clutter, normalizes links and images, serializes the DOM into Markdown, and appends readable iframe content when available.

## Notes

- Chrome internal pages like `chrome://extensions` cannot be converted.
- Cross-origin iframes are skipped because the extension cannot read them.
- The Markdown serializer is intentionally conservative and aims for readable output across varied page structures.
