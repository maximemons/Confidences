/**
 * Mini moteur Markdown, sans dépendance, pensé pour les confidences.
 *
 * Sécurité : tout le texte saisi est échappé AVANT d'être transformé, donc
 * aucune balise HTML écrite par l'auteur n'est interprétée. Les liens ne sont
 * acceptés qu'avec les protocoles http(s), mailto et tel.
 *
 * Syntaxe prise en charge :
 *   # Titre … ###### Titre      **gras** / __gras__      *italique* / _italique_
 *   ~~barré~~      ==surligné==      `code`      [texte](https://lien)
 *   https://lien-nu      - liste / * liste / + liste      1. liste numérotée
 *   > citation      --- (séparateur)      ``` bloc de code ```      \* (échappement)
 * Un simple retour à la ligne est conservé (comme avant, en texte brut).
 */

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE_RE = /^\s{0,3}>/;
const SAFE_URL_RE = /^(https?:\/\/|mailto:|tel:)/i;

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function indentOf(line) {
  return /^\s*/.exec(line)[0].replace(/\t/g, "    ").length;
}

function startsBlock(line) {
  return FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line) || LIST_RE.test(line);
}

function dedent(lines) {
  const min = Math.min(...lines.filter((l) => l.trim()).map(indentOf));
  if (!Number.isFinite(min) || min === 0) return lines;
  return lines.map((l) => l.replace(/\t/g, "    ").slice(Math.min(min, indentOf(l))));
}

/* ---------------- Inline ---------------- */

function renderInline(src) {
  const tokens = [];
  const keep = (html) => `\u0000${tokens.push(html) - 1}\u0000`;

  let s = src;
  // Échappements : \* \_ \# etc. deviennent du texte littéral.
  s = s.replace(/\\([\\`*_{}\[\]()#+\-.!~=>|])/g, (_, ch) => keep(escapeHtml(ch)));
  // Code en ligne : son contenu n'est jamais interprété.
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, __, code) => keep(`<code>${escapeHtml(code.trim())}</code>`));

  s = escapeHtml(s);

  const link = (url, label) => {
    // `url` est déjà échappé (pas de guillemet possible dans l'attribut).
    const raw = url.replace(/&amp;/g, "&");
    if (!SAFE_URL_RE.test(raw)) return null;
    // Les balises sont protégées pour que « _blank » ne soit pas pris pour de l'italique.
    return `${keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">`)}${label}${keep("</a>")}`;
  };

  // [texte](url "titre optionnel")
  s = s.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+&quot;[^)]*?&quot;)?\s*\)/g, (match, label, url) => link(url, label) ?? match);
  // <https://…> et liens nus
  s = s.replace(/&lt;((?:https?:\/\/|mailto:)[^\s&]+(?:&amp;[^\s&]+)*)&gt;/g, (match, url) => link(url, keep(url)) ?? match);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)'"])/g, (match, pre, url) => {
    const a = link(url, keep(url));
    return a ? pre + a : match;
  });

  s = s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?![\w])/g, "$1<strong>$2</strong>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
    .replace(/==(?=\S)([\s\S]*?\S)==/g, "<mark>$1</mark>")
    .replace(/\*(?=[^\s*])([^*]*?[^\s*]|[^\s*])\*/g, "<em>$1</em>")
    .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_]|[^\s_])_(?![\w])/g, "$1<em>$2</em>");

  // Restaure les fragments protégés (plusieurs passes : ils peuvent s'imbriquer).
  let prev;
  do {
    prev = s;
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
  } while (s !== prev);
  return s;
}

/* ---------------- Blocs ---------------- */

function parseList(lines, start) {
  const first = LIST_RE.exec(lines[start]);
  const baseIndent = indentOf(lines[start]);
  const ordered = /\d/.test(first[2]);
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  let i = start;
  let sawBlank = false;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && (indentOf(lines[j]) > baseIndent + 1 || (LIST_RE.test(lines[j]) && indentOf(lines[j]) >= baseIndent))) {
        sawBlank = true;
        i = j;
        continue;
      }
      break;
    }

    const m = LIST_RE.exec(line);
    const indent = indentOf(line);

    if (m && indent <= baseIndent + 1) {
      if (/\d/.test(m[2]) !== ordered) break; // autre type de liste : on s'arrête
      items.push({ text: [m[3]], children: [] });
      sawBlank = false;
      i++;
      continue;
    }
    if (indent < baseIndent) break;

    const item = items[items.length - 1];
    if (indent > baseIndent + 1) {
      if (!m && !sawBlank && item.children.length === 0) item.text.push(line.trim());
      else item.children.push(line);
      i++;
      continue;
    }
    // Ligne non indentée qui prolonge le texte de l'élément (« paresseuse »).
    if (!sawBlank && !startsBlock(line)) {
      if (item.children.length) item.children.push(line);
      else item.text.push(line.trim());
      i++;
      continue;
    }
    break;
  }

  const tag = ordered ? "ol" : "ul";
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : "";
  const body = items
    .map((it) => {
      const text = it.text.map(renderInline).join("<br>");
      const children = it.children.length ? parseBlocks(dedent(it.children)) : "";
      return `<li>${text}${children}</li>`;
    })
    .join("");
  return { html: `<${tag}${startAttr}>${body}</${tag}>`, next: i };
}

function parseBlocks(lines) {
  let html = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    let m;

    if (!line.trim()) {
      i++;
      continue;
    }

    if ((m = FENCE_RE.exec(line))) {
      const fence = m[1];
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
      i++; // fence fermante (ou fin du texte)
      html += `<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`;
      continue;
    }

    if ((m = HEADING_RE.exec(line))) {
      const level = m[1].length;
      html += `<h${level}>${renderInline(m[2])}</h${level}>`;
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      html += "<hr>";
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const buf = [];
      while (i < lines.length && lines[i].trim() && (QUOTE_RE.test(lines[i]) || !startsBlock(lines[i]))) {
        buf.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i++;
      }
      html += `<blockquote>${parseBlocks(buf)}</blockquote>`;
      continue;
    }

    if (LIST_RE.test(line)) {
      const res = parseList(lines, i);
      html += res.html;
      i = res.next;
      continue;
    }

    const buf = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) buf.push(lines[i++].trim());
    html += `<p>${buf.map(renderInline).join("<br>")}</p>`;
  }

  return html;
}

/** Convertit du Markdown en HTML sûr (aucun HTML saisi n'est conservé). */
export function markdownToHtml(src) {
  const text = String(src || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "");
  return parseBlocks(text.split("\n"));
}
