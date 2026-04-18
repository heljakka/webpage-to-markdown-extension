# Implementation Log

## Summary

Built a Manifest V3 Chrome extension that converts the active webpage into Markdown from a popup UI.

## What Was Added

- `manifest.json`
  - Declares the extension, popup entrypoint, and required permissions: `activeTab`, `downloads`, `scripting`, and `storage`.
- `popup.html`
  - Adds the popup interface with conversion controls, status messaging, Markdown output, and copy/download actions.
- `popup.css`
  - Styles the popup UI.
- `popup.js`
  - Handles popup behavior:
    - restores and saves formatting options
    - injects the content script into the active tab
    - requests conversion
    - copies Markdown to the clipboard
    - downloads Markdown as a `.md` file
    - reports success and error states to the user
- `content.js`
  - Implements the page-to-Markdown conversion logic.
- `README.md`
  - Documents loading and using the extension.

## Converter Behavior Implemented

- Detects a likely main content root using common content selectors such as `main`, `article`, and `[role="main"]`, then scores fallback containers if needed.
- Removes common clutter before conversion, including scripts, styles, forms, nav/aside regions, hidden elements, and containers that look like footers, sidebars, ads, share blocks, or related-content sections.
- Resolves relative links and image URLs to absolute URLs.
- Converts the extracted DOM into Markdown, including support for:
  - headings
  - paragraphs
  - blockquotes
  - fenced code blocks
  - inline code
  - ordered and unordered lists
  - links
  - images
  - figures and figcaptions
  - tables
- Appends readable content from accessible iframes under an `Embedded Content` section.
- Skips inaccessible cross-origin iframes and reports how many were skipped.

## Popup Features Implemented

- One-click conversion from the active tab
- Configurable heading style:
  - ATX (`#`)
  - Setext (`=` / `-`)
- Configurable unordered list marker:
  - `-`
  - `*`
  - `+`
- Copy converted Markdown to clipboard
- Download converted Markdown as a `.md` file
- Inline status messages for:
  - conversion in progress
  - success
  - clipboard copy success/failure
  - download success/failure
  - unsupported or blocked pages

## Notes

- The requested Turndown-based behavior was implemented with a self-contained Markdown serializer in `content.js` rather than a vendored `TurndownService` build, because there was no existing local Turndown copy in this workspace.
- Chrome internal pages and pages that block extension access cannot be converted.
- Only same-origin or otherwise accessible iframes can be read by the extension.

## Verification Performed

- Ran `node --check popup.js`
- Ran `node --check content.js`

## Remaining Manual Verification

- Load the folder as an unpacked extension in Chrome.
- Test the extension on a few real pages:
  - a normal article page
  - a page with figures/images
  - a page containing iframes
  - a page with tables/code blocks
