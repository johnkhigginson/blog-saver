import sanitizeHtml from "sanitize-html";

// Sanitizer for migrated blog post HTML before it is rendered with
// dangerouslySetInnerHTML on the PUBLIC blog. Blogger content is third-party
// HTML, so we strip scripts, event handlers, and unsafe URL schemes — but keep
// the formatting, images, embedded videos, and inline styling a real recipe
// post relies on, so nothing of the original post is visually lost.
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags, // includes p, div, span, ul/ol/li, table, blockquote, h3-h6, a, b/i/em/strong, etc.
    "img",
    "h1",
    "h2",
    "figure",
    "figcaption",
    "font", // old Blogger markup
    "iframe", // embedded video (restricted to known hosts below)
    "picture",
    "source",
    "video",
    "audio",
    "details",
    "summary",
  ],
  allowedAttributes: {
    a: ["href", "name", "target", "rel", "title"],
    img: ["src", "srcset", "alt", "title", "width", "height", "loading"],
    iframe: ["src", "width", "height", "allow", "allowfullscreen", "frameborder", "title"],
    video: ["src", "controls", "width", "height", "poster"],
    audio: ["src", "controls"],
    source: ["src", "srcset", "type", "media"],
    font: ["color", "size", "face"],
    // Preserve light formatting/layout on common tags.
    "*": ["style", "class", "align", "dir", "id"],
  },
  // Whitelist of safe inline CSS so styled posts keep their look without
  // allowing dangerous values.
  allowedStyles: {
    "*": {
      color: [/.*/],
      "background-color": [/.*/],
      "text-align": [/^(left|right|center|justify)$/],
      "font-weight": [/.*/],
      "font-style": [/.*/],
      "font-size": [/.*/],
      "font-family": [/.*/],
      "text-decoration": [/.*/],
      width: [/^\d+(\.\d+)?(px|em|rem|%)$/],
      "max-width": [/^\d+(\.\d+)?(px|em|rem|%)$/],
      height: [/^\d+(\.\d+)?(px|em|rem|%)$/],
      margin: [/.*/],
      padding: [/.*/],
      float: [/^(left|right|none)$/],
    },
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  // Only allow video embeds from trusted hosts.
  allowedIframeHostnames: [
    "www.youtube.com",
    "youtube.com",
    "www.youtube-nocookie.com",
    "player.vimeo.com",
    "vimeo.com",
    "drive.google.com",
  ],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow" }),
  },
};

export function sanitizeBlogHtml(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, OPTIONS);
}
