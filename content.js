(() => {
  if (globalThis.__markdownConverterContentScriptReady) {
    return;
  }

  globalThis.__markdownConverterContentScriptReady = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "convert-page") {
      return undefined;
    }

    try {
      const result = convertCurrentPage(message.options || {});
      sendResponse(result);
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return true;
  });

  function convertCurrentPage(options) {
    const normalizedOptions = normalizeOptions(options);
    const sourceRoot = extractPrimaryRoot(document);

    if (!sourceRoot) {
      return {
        ok: false,
        error: "Unable to find meaningful content on this page."
      };
    }

    const clonedRoot = sourceRoot.cloneNode(true);
    prepareRoot(clonedRoot, document.baseURI);

    const mainMarkdown = serializeBlockChildren(clonedRoot, normalizedOptions).trim();
    const iframeSummary = extractIframeMarkdown(normalizedOptions);
    const title = cleanText(document.title) || "page";
    const hasDuplicateTitle = isLikelySameText(
      title,
      sourceRoot.querySelector("h1")?.textContent || ""
    );

    let markdown = "";

    if (!hasDuplicateTitle && title) {
      markdown += formatHeading(title, 1, normalizedOptions.headingStyle);
      markdown += "\n\n";
    }

    markdown += mainMarkdown;

    if (iframeSummary.sections.length > 0) {
      markdown = markdown.trim();
      markdown += "\n\n";
      markdown += formatHeading("Embedded Content", 2, normalizedOptions.headingStyle);
      markdown += "\n\n";
      markdown += iframeSummary.sections.join("\n\n");
    }

    markdown = cleanupMarkdown(markdown);

    if (!markdown) {
      return {
        ok: false,
        error: "The page did not contain enough readable content to convert."
      };
    }

    return {
      ok: true,
      title,
      markdown,
      wordCount: countWords(markdown),
      includedIframeCount: iframeSummary.sections.length,
      skippedIframeCount: iframeSummary.skippedCount
    };
  }

  function normalizeOptions(options) {
    const headingStyle = options.headingStyle === "setext" ? "setext" : "atx";
    const bulletMarker = ["-", "*", "+"].includes(options.bulletMarker)
      ? options.bulletMarker
      : "-";

    return { headingStyle, bulletMarker };
  }

  function extractPrimaryRoot(doc) {
    const preferredSelectors = [
      "main",
      "article",
      "[role='main']",
      ".post-content",
      ".article-content",
      ".entry-content",
      ".main-content",
      ".content"
    ];

    const preferredCandidates = uniqueElements(
      preferredSelectors.flatMap((selector) => Array.from(doc.querySelectorAll(selector)))
    )
      .filter(isCandidateReadable)
      .sort((left, right) => scoreCandidate(right) - scoreCandidate(left));

    if (preferredCandidates.length > 0) {
      return preferredCandidates[0];
    }

    const fallbackCandidates = Array.from(
      doc.querySelectorAll("article, section, div")
    )
      .filter(isCandidateReadable)
      .sort((left, right) => scoreCandidate(right) - scoreCandidate(left));

    return fallbackCandidates[0] || doc.body;
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements));
  }

  function isCandidateReadable(element) {
    const text = cleanText(element.textContent);
    if (text.length < 180) {
      return false;
    }

    const density = calculateLinkDensity(element, text.length);
    return density < 0.55;
  }

  function scoreCandidate(element) {
    const textLength = cleanText(element.textContent).length;
    const paragraphCount = element.querySelectorAll("p").length;
    const headingCount = element.querySelectorAll("h1, h2, h3").length;
    const imageCount = element.querySelectorAll("img, figure").length;
    const linkDensity = calculateLinkDensity(element, textLength);

    return (
      textLength +
      paragraphCount * 120 +
      headingCount * 80 +
      imageCount * 35 -
      Math.floor(textLength * linkDensity * 0.65)
    );
  }

  function calculateLinkDensity(element, totalTextLength) {
    if (!totalTextLength) {
      return 1;
    }

    const linkTextLength = Array.from(element.querySelectorAll("a"))
      .map((link) => cleanText(link.textContent).length)
      .reduce((sum, length) => sum + length, 0);

    return linkTextLength / totalTextLength;
  }

  function prepareRoot(root, baseUrl) {
    const disposableSelectors = [
      "script",
      "style",
      "noscript",
      "template",
      "iframe",
      "canvas",
      "svg",
      "video",
      "audio",
      "form",
      "button",
      "input",
      "select",
      "textarea",
      "aside",
      "nav",
      "dialog",
      "[hidden]",
      "[aria-hidden='true']"
    ];

    root.querySelectorAll(disposableSelectors.join(", ")).forEach((node) => node.remove());

    const clutterPattern =
      /(comment|footer|sidebar|advert|promo|breadcrumb|share|social|cookie|subscribe|newsletter|related|recommend|pagination|utility|toolbar|rail|banner)/i;

    root.querySelectorAll("*").forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }

      const signature = `${node.className || ""} ${node.id || ""}`.trim();
      const inlineStyle = node.getAttribute("style") || "";

      if (clutterPattern.test(signature) || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(inlineStyle)) {
        node.remove();
        return;
      }

      if (node.tagName.toLowerCase() === "a" && !node.textContent?.trim() && !node.querySelector("img")) {
        node.remove();
      }
    });

    root.querySelectorAll("img").forEach((image) => {
      const source = resolveImageSource(image, baseUrl);
      if (source) {
        image.setAttribute("data-md-src", source);
      }
    });

    root.querySelectorAll("a[href]").forEach((anchor) => {
      const href = resolveUrl(anchor.getAttribute("href"), baseUrl);
      if (href) {
        anchor.setAttribute("data-md-href", href);
      }
    });
  }

  function resolveImageSource(image, baseUrl) {
    const candidates = [
      image.currentSrc,
      image.getAttribute("src"),
      image.getAttribute("data-src"),
      image.getAttribute("data-original"),
      extractFirstSrcFromSrcset(image.getAttribute("srcset")),
      extractFirstSrcFromSrcset(image.getAttribute("data-srcset"))
    ];

    const firstCandidate = candidates.find(Boolean);
    return resolveUrl(firstCandidate, baseUrl);
  }

  function extractFirstSrcFromSrcset(srcset) {
    if (!srcset) {
      return "";
    }

    return srcset
      .split(",")
      .map((item) => item.trim().split(/\s+/)[0])
      .find(Boolean) || "";
  }

  function resolveUrl(value, baseUrl) {
    if (!value) {
      return "";
    }

    try {
      return new URL(value, baseUrl).href;
    } catch (_error) {
      return value;
    }
  }

  function extractIframeMarkdown(options) {
    const sections = [];
    let skippedCount = 0;

    Array.from(document.querySelectorAll("iframe")).forEach((frame, index) => {
      try {
        const frameDocument = frame.contentDocument;

        if (!frameDocument?.body) {
          return;
        }

        const root = extractPrimaryRoot(frameDocument);
        if (!root) {
          return;
        }

        const clone = root.cloneNode(true);
        prepareRoot(clone, frameDocument.baseURI || frame.src || document.baseURI);

        const markdown = serializeBlockChildren(clone, options).trim();
        if (!markdown) {
          return;
        }

        const label = cleanText(
          frame.getAttribute("title") ||
            frame.getAttribute("aria-label") ||
            frameDocument.title ||
            `Iframe ${index + 1}`
        );

        sections.push(
          `${formatHeading(label, 3, options.headingStyle)}\n\n${markdown}`
        );
      } catch (_error) {
        skippedCount += 1;
      }
    });

    return { sections, skippedCount };
  }

  function serializeBlockChildren(node, options) {
    const blocks = [];

    Array.from(node.childNodes).forEach((child) => {
      const markdown = serializeNode(child, options, 0).trim();
      if (markdown) {
        blocks.push(markdown);
      }
    });

    return blocks.join("\n\n");
  }

  function serializeNode(node, options, listDepth) {
    if (node.nodeType === Node.TEXT_NODE) {
      return normalizeTextNode(node.textContent);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = node.tagName.toLowerCase();

    switch (tag) {
      case "h1":
        return formatHeading(serializeInlineChildren(node, options).trim(), 1, options.headingStyle);
      case "h2":
        return formatHeading(serializeInlineChildren(node, options).trim(), 2, options.headingStyle);
      case "h3":
        return formatHeading(serializeInlineChildren(node, options).trim(), 3, options.headingStyle);
      case "h4":
        return formatHeading(serializeInlineChildren(node, options).trim(), 4, options.headingStyle);
      case "h5":
        return formatHeading(serializeInlineChildren(node, options).trim(), 5, options.headingStyle);
      case "h6":
        return formatHeading(serializeInlineChildren(node, options).trim(), 6, options.headingStyle);
      case "p":
        return serializeInlineChildren(node, options).trim();
      case "blockquote":
        return serializeBlockquote(node, options);
      case "pre":
        return serializeCodeBlock(node);
      case "ul":
        return serializeList(node, options, false, listDepth);
      case "ol":
        return serializeList(node, options, true, listDepth);
      case "figure":
        return serializeFigure(node, options);
      case "img":
        return serializeImage(node);
      case "table":
        return serializeTable(node, options);
      case "hr":
        return "---";
      case "br":
        return "  \n";
      case "section":
      case "article":
      case "main":
      case "div":
      case "body":
      case "header":
      case "footer":
        return serializeContainer(node, options);
      default:
        if (isBlockElement(tag)) {
          return serializeBlockChildren(node, options);
        }
        return serializeInlineElement(node, options, listDepth);
    }
  }

  function serializeInlineChildren(node, options) {
    return cleanupInline(
      Array.from(node.childNodes)
        .map((child) => serializeNode(child, options, 0))
        .join("")
    );
  }

  function serializeContainer(node, options) {
    const hasBlockChildren = Array.from(node.children).some((child) =>
      isBlockElement(child.tagName.toLowerCase())
    );

    if (!hasBlockChildren) {
      return serializeInlineChildren(node, options);
    }

    return serializeBlockChildren(node, options);
  }

  function serializeInlineElement(node, options, listDepth) {
    const tag = node.tagName.toLowerCase();

    switch (tag) {
      case "strong":
      case "b":
        return wrapInline("**", serializeInlineChildren(node, options));
      case "em":
      case "i":
        return wrapInline("_", serializeInlineChildren(node, options));
      case "s":
      case "strike":
      case "del":
        return wrapInline("~~", serializeInlineChildren(node, options));
      case "code":
        return serializeInlineCode(node.textContent || "");
      case "a":
        return serializeLink(node, options);
      case "img":
        return serializeImage(node);
      case "span":
      case "small":
      case "mark":
      case "abbr":
      case "cite":
      case "time":
      case "u":
      case "sup":
      case "sub":
        return serializeInlineChildren(node, options);
      default:
        return Array.from(node.childNodes)
          .map((child) => serializeNode(child, options, listDepth))
          .join("");
    }
  }

  function wrapInline(wrapper, value) {
    const cleaned = cleanupInline(value).trim();
    return cleaned ? `${wrapper}${cleaned}${wrapper}` : "";
  }

  function serializeInlineCode(value) {
    const cleaned = value.replace(/\n+/g, " ").trim();
    if (!cleaned) {
      return "";
    }

    const longestFence = Math.max(
      1,
      ...Array.from(cleaned.matchAll(/`+/g), (match) => match[0].length)
    );
    const fence = "`".repeat(longestFence + 1);
    return `${fence}${cleaned}${fence}`;
  }

  function serializeCodeBlock(node) {
    const code = node.querySelector("code");
    const text = (code?.textContent || node.textContent || "").replace(/\n+$/, "");
    if (!text.trim()) {
      return "";
    }

    const languageClass = code?.className || "";
    const languageMatch = languageClass.match(/language-([a-z0-9_-]+)/i);
    const language = languageMatch ? languageMatch[1] : "";

    return `\`\`\`${language}\n${text}\n\`\`\``;
  }

  function serializeBlockquote(node, options) {
    const content = serializeBlockChildren(node, options).trim();
    if (!content) {
      return "";
    }

    return content
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  }

  function serializeList(node, options, ordered, listDepth) {
    return Array.from(node.children)
      .filter((child) => child.tagName?.toLowerCase() === "li")
      .map((child, index) => serializeListItem(child, options, ordered, listDepth, index))
      .filter(Boolean)
      .join("\n");
  }

  function serializeListItem(node, options, ordered, listDepth, index) {
    const inlineParts = [];
    const nestedParts = [];

    Array.from(node.childNodes).forEach((child) => {
      const tag = child.nodeType === Node.ELEMENT_NODE ? child.tagName.toLowerCase() : "";

      if (tag === "ul" || tag === "ol") {
        const nestedMarkdown = serializeList(child, options, tag === "ol", listDepth + 1);
        if (nestedMarkdown) {
          nestedParts.push(nestedMarkdown);
        }
        return;
      }

      const markdown = serializeNode(child, options, listDepth);

      if (markdown.trim()) {
        inlineParts.push(markdown);
      }
    });

    const prefix = ordered ? `${index + 1}. ` : `${options.bulletMarker} `;
    const indent = "  ".repeat(listDepth);
    const content = cleanupInline(inlineParts.join(" ")).trim() || "Item";
    const firstLine = `${indent}${prefix}${content}`;

    if (nestedParts.length === 0) {
      return firstLine;
    }

    return `${firstLine}\n${nestedParts.join("\n")}`;
  }

  function serializeFigure(node, options) {
    const images = Array.from(node.querySelectorAll("img"));
    const caption = cleanText(node.querySelector("figcaption")?.textContent || "");

    if (images.length === 0) {
      return serializeBlockChildren(node, options);
    }

    const imageMarkdown = images
      .map((image) => serializeImage(image, caption))
      .filter(Boolean)
      .join("\n\n");

    if (!caption || images.length === 1) {
      return imageMarkdown;
    }

    return `${imageMarkdown}\n\n*${escapeMarkdownText(caption)}*`;
  }

  function serializeImage(node, caption = "") {
    const src = node.getAttribute("data-md-src") || node.getAttribute("src");
    if (!src) {
      return "";
    }

    const alt = cleanText(node.getAttribute("alt") || caption || "Image");
    const title = cleanText(caption || node.getAttribute("title") || "");
    const escapedAlt = escapeMarkdownText(alt);
    const escapedTitle = title ? ` "${title.replace(/"/g, '\\"')}"` : "";

    return `![${escapedAlt}](${src}${escapedTitle})`;
  }

  function serializeLink(node, options) {
    const href = node.getAttribute("data-md-href") || node.getAttribute("href");
    const text = cleanupInline(serializeInlineChildren(node, options)).trim() || href;

    if (!href || href.startsWith("javascript:")) {
      return text;
    }

    return `[${text}](${href})`;
  }

  function serializeTable(node, options) {
    const rows = Array.from(node.querySelectorAll("tr"))
      .map((row) =>
        Array.from(row.children)
          .filter((cell) => ["th", "td"].includes(cell.tagName.toLowerCase()))
          .map((cell) => cleanupInline(serializeInlineChildren(cell, options)).trim())
      )
      .filter((row) => row.length > 0);

    if (rows.length === 0) {
      return "";
    }

    const columnCount = Math.max(...rows.map((row) => row.length));
    const normalizedRows = rows.map((row) => {
      const padded = [...row];
      while (padded.length < columnCount) {
        padded.push("");
      }
      return padded.map((cell) => cell.replace(/\|/g, "\\|"));
    });

    const hasExplicitHeader = Array.from(node.querySelectorAll("thead th")).length > 0;
    const header = normalizedRows[0];
    const bodyRows = hasExplicitHeader ? normalizedRows.slice(1) : normalizedRows.slice(1);

    const lines = [];
    lines.push(`| ${header.join(" | ")} |`);
    lines.push(`| ${new Array(columnCount).fill("---").join(" | ")} |`);

    if (bodyRows.length === 0) {
      return lines.join("\n");
    }

    bodyRows.forEach((row) => {
      lines.push(`| ${row.join(" | ")} |`);
    });

    return lines.join("\n");
  }

  function formatHeading(text, level, style) {
    const cleaned = cleanText(text);
    if (!cleaned) {
      return "";
    }

    if (style === "setext" && level <= 2) {
      const underline = level === 1 ? "=" : "-";
      return `${cleaned}\n${underline.repeat(Math.max(cleaned.length, 3))}`;
    }

    return `${"#".repeat(level)} ${cleaned}`;
  }

  function normalizeTextNode(text) {
    if (!text) {
      return "";
    }

    const hasLeadingWhitespace = /^\s/.test(text);
    const hasTrailingWhitespace = /\s$/.test(text);
    const collapsed = text.replace(/\s+/g, " ").trim();

    if (!collapsed) {
      return hasLeadingWhitespace || hasTrailingWhitespace ? " " : "";
    }

    let output = escapeMarkdownText(collapsed);

    if (hasLeadingWhitespace) {
      output = ` ${output}`;
    }

    if (hasTrailingWhitespace) {
      output = `${output} `;
    }

    return output;
  }

  function cleanupInline(value) {
    return value
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function cleanupMarkdown(value) {
    return value
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  }

  function cleanText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function escapeMarkdownText(value) {
    return value.replace(/([\\`*_{}\[\]()#+!|>])/g, "\\$1");
  }

  function isBlockElement(tag) {
    return new Set([
      "address",
      "article",
      "aside",
      "blockquote",
      "details",
      "div",
      "dl",
      "fieldset",
      "figcaption",
      "figure",
      "footer",
      "form",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "header",
      "li",
      "main",
      "nav",
      "ol",
      "p",
      "pre",
      "section",
      "table",
      "ul"
    ]).has(tag);
  }

  function isLikelySameText(left, right) {
    const normalize = (value) => cleanText(value).toLowerCase();
    return normalize(left) && normalize(left) === normalize(right);
  }

  function countWords(value) {
    const words = value.match(/\b[\p{L}\p{N}'’-]+\b/gu);
    return words ? words.length : 0;
  }
})();
