import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { marked } from "marked";
import hljs from "highlight.js";
import mermaid from "mermaid";
import { sampleMarkdown } from "./sampleMarkdown";
import { detectContentType, type DetectionResult } from "./contentDetector";
import { fixMermaidInDocument } from "./mermaidFixer";

// ===== Mermaid Initialize =====
mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "loose",
  fontFamily: "sans-serif",
  gitGraph: {
    showBranches: true,
    showCommitLabel: true,
    mainBranchName: "main",
    rotateCommitLabel: false,
  },
});

// ===== Unique ID Generator =====
let mermaidIdCounter = 0;
function nextMermaidId() {
  mermaidIdCounter += 1;
  return `mermaid-diagram-${Date.now()}-${mermaidIdCounter}`;
}

// ===== Marked Configuration =====
const renderer = new marked.Renderer();

const originalCode = renderer.code;
renderer.code = function (codeToken) {
  if (!codeToken) return originalCode.call(this, codeToken);

  const lang = (codeToken.lang || "").trim().toLowerCase();
  const text = codeToken.text || "";

  if (lang === "mermaid") {
    const id = nextMermaidId();
    const encoded = btoa(encodeURIComponent(text));
    return `<div class="mermaid-placeholder" data-mermaid-id="${id}" data-mermaid-source="${encoded}"><div class="mermaid-loading"><div class="spinner"></div>Rendering diagram...</div></div>`;
  }

  let highlighted: string;
  try {
    if (lang && hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(text, { language: lang }).value;
    } else {
      highlighted = hljs.highlightAuto(text).value;
    }
  } catch {
    highlighted = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  return `<pre><code class="hljs language-${lang || "text"}">${highlighted}</code></pre>`;
};

marked.setOptions({
  renderer,
  gfm: true,
  breaks: false,
});

// ===== View Modes =====
type ViewMode = "split" | "editor" | "preview";

// ===== App Component =====
export function App() {
  const [markdownText, setMarkdownText] = useState(sampleMarkdown);
  const [htmlContent, setHtmlContent] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const [showFixPanel, setShowFixPanel] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);

  // ===== SMART DETECTION =====
  const detection: DetectionResult = useMemo(
    () => detectContentType(markdownText),
    [markdownText]
  );

  // ===== AUTO-FIX + PROCESS =====
  const fixResult = useMemo(() => {
    const isRawMermaid = detection.type === "mermaid";
    return fixMermaidInDocument(markdownText, isRawMermaid);
  }, [markdownText, detection.type]);

  // The processed text after auto-fixes
  const processedText = fixResult.output;
  const appliedFixes = fixResult.fixes;
  const hasAutoFixes = appliedFixes.length > 0;

  // Show fix panel when fixes are applied
  useEffect(() => {
    if (hasAutoFixes) {
      setShowFixPanel(true);
    }
  }, [hasAutoFixes]);

  // Parse markdown to HTML
  const parseMarkdown = useCallback((md: string) => {
    try {
      const result = marked.parse(md);
      if (typeof result === "string") {
        setHtmlContent(result);
      }
    } catch {
      setHtmlContent("<p style='color:red;'>Error parsing markdown</p>");
    }
  }, []);

  // Debounced parsing (uses processedText, not raw input)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      parseMarkdown(processedText);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [processedText, parseMarkdown]);

  // Render Mermaid diagrams after HTML is injected
  useEffect(() => {
    if (!previewRef.current) return;

    const placeholders = previewRef.current.querySelectorAll(".mermaid-placeholder");
    if (placeholders.length === 0) return;

    const renderDiagrams = async () => {
      for (const el of Array.from(placeholders)) {
        const id = el.getAttribute("data-mermaid-id");
        const encoded = el.getAttribute("data-mermaid-source");
        if (!id || !encoded) continue;

        // Skip if already rendered
        if (el.classList.contains("mermaid-rendered")) continue;
        el.classList.add("mermaid-rendered");

        try {
          const source = decodeURIComponent(atob(encoded));
          const { svg } = await mermaid.render(id, source);
          el.innerHTML = `<div class="mermaid-container animate-fade-in">${svg}</div>`;
        } catch (err: unknown) {
          const errMsg =
            err instanceof Error ? err.message : String(err);
          el.innerHTML = `<div class="mermaid-error"><div class="mermaid-error-title">⚠️ Mermaid Error</div><div class="mermaid-error-body">${errMsg
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")}</div><div class="mermaid-error-hint">💡 <strong>Tip:</strong> Check diagram type capitalization (e.g. <code>gitGraph</code> not <code>gitgraph</code>) and ensure <code>tag:</code> is on the same line as <code>commit</code>.</div></div>`;
        }
      }
    };

    const timer = window.setTimeout(renderDiagrams, 50);
    return () => clearTimeout(timer);
  }, [htmlContent]);

  // Stats
  const lines = markdownText.split("\n").length;
  const words = markdownText.trim() ? markdownText.trim().split(/\s+/).length : 0;
  const chars = markdownText.length;

  // Copy HTML
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(htmlContent);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = htmlContent;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
  };

  // Export HTML
  const handleExport = () => {
    const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>README Preview</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"><\/script>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1e293b; line-height: 1.75; }
  h1 { font-size: 2em; font-weight: 700; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; }
  h2 { font-size: 1.5em; font-weight: 700; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 32px; }
  h3 { font-size: 1.25em; font-weight: 600; margin-top: 24px; }
  code:not(pre code) { background: #f1f5f9; border: 1px solid #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; color: #dc2626; }
  pre { background: #1e1e2e; border-radius: 10px; overflow: hidden; border: 1px solid #313244; }
  pre code { display: block; padding: 20px; color: #cdd6f4; font-size: 13px; overflow-x: auto; background: transparent; border: none; }
  blockquote { border-left: 4px solid #6366f1; background: #f1f5f9; padding: 12px 20px; margin: 0 0 16px 0; border-radius: 0 8px 8px 0; }
  table { width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; margin-bottom: 16px; }
  th { background: #f8fafc; padding: 10px 16px; text-align: left; font-weight: 700; border-bottom: 2px solid #e2e8f0; }
  td { padding: 10px 16px; border-bottom: 1px solid #f1f5f9; }
  hr { border: none; height: 2px; background: linear-gradient(to right, #e2e8f0, #cbd5e1, #e2e8f0); margin: 32px 0; }
  a { color: #6366f1; text-decoration: none; }
  ul, ol { padding-left: 24px; }
  li { margin: 4px 0; }
  .mermaid { display: flex; justify-content: center; margin: 16px 0; padding: 24px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; }
</style>
</head>
<body>
${htmlContent.replace(/<div class="mermaid-placeholder"[^>]*data-mermaid-source="([^"]*)"[^>]*>[\s\S]*?<\/div>/g, (_match, encoded) => {
      try {
        const source = decodeURIComponent(atob(encoded));
        return `<div class="mermaid">\n${source}\n</div>`;
      } catch {
        return '<div>Error decoding diagram</div>';
      }
    })}
<script>mermaid.initialize({ startOnLoad: true, theme: 'default' });<\/script>
</body>
</html>`;

    const blob = new Blob([fullHTML], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "preview.html";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-screen bg-[#0f0f1a] text-white overflow-hidden">
      {/* ===== ERROR FIX BANNER ===== */}
      {showBanner && (
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-red-500/10 border-b border-amber-500/20">
          <div className="flex items-center gap-3 text-xs">
            <span className="flex-shrink-0 px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 font-bold text-[10px] uppercase tracking-wider border border-amber-500/30">
              Bug Fixed
            </span>
            <span className="text-amber-200/90">
              <strong className="text-amber-300">Error 1:</strong> <code className="px-1.5 py-0.5 bg-red-500/15 text-red-400 rounded text-[11px] font-mono border border-red-500/20">gitgraph</code> → <code className="px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 rounded text-[11px] font-mono border border-emerald-500/20">gitGraph</code> (camelCase)
              <span className="mx-2 text-slate-600">|</span>
              <strong className="text-amber-300">Error 2:</strong> <code className="px-1.5 py-0.5 bg-red-500/15 text-red-400 rounded text-[11px] font-mono border border-red-500/20">tag:</code> on separate line → <code className="px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 rounded text-[11px] font-mono border border-emerald-500/20">commit id: &quot;msg&quot; tag: &quot;v1.0&quot;</code> (same line)
            </span>
          </div>
          <button
            onClick={() => setShowBanner(false)}
            className="flex-shrink-0 p-1 rounded hover:bg-amber-500/20 text-amber-400/60 hover:text-amber-400 transition-colors"
            title="Dismiss"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ===== AUTO-FIX NOTIFICATION PANEL ===== */}
      {showFixPanel && hasAutoFixes && (
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-cyan-500/10 border-b border-emerald-500/20">
          <div className="flex items-center gap-3 text-xs">
            <span className="flex-shrink-0 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 font-bold text-[10px] uppercase tracking-wider border border-emerald-500/30 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Auto-Fixed
            </span>
            <div className="flex items-center gap-2 text-emerald-200/90 flex-wrap">
              {appliedFixes.map((fix, i) => (
                <span key={i} className="flex items-center gap-1">
                  <svg className="w-3 h-3 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>{fix}</span>
                  {i < appliedFixes.length - 1 && <span className="text-slate-600 ml-1">•</span>}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={() => setShowFixPanel(false)}
            className="flex-shrink-0 p-1 rounded hover:bg-emerald-500/20 text-emerald-400/60 hover:text-emerald-400 transition-colors"
            title="Dismiss"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ===== TOP TOOLBAR ===== */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 h-12 bg-[#1a1a2e] border-b border-[#2a2a40]">
        {/* Logo & Title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-sm font-semibold tracking-wide text-slate-200">
            MD → HTML Preview
          </h1>
          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot" />
            Live
          </span>

          {/* ===== DETECTION BADGE ===== */}
          <span className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full ${detection.bgColor} ${detection.color} text-[10px] font-bold uppercase tracking-wider border ${detection.borderColor}`}>
            <span>{detection.emoji}</span>
            <span>{detection.label}</span>
            {detection.mermaidBlockCount > 0 && (
              <span className="opacity-70">({detection.mermaidBlockCount})</span>
            )}
          </span>

          {/* Auto-fix indicator */}
          {hasAutoFixes && (
            <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-bold uppercase tracking-wider border border-emerald-500/20">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {appliedFixes.length} fix{appliedFixes.length > 1 ? "es" : ""}
            </span>
          )}
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center gap-1 bg-[#12121f] rounded-lg p-0.5 border border-[#2a2a40]">
          {([
            { mode: "editor" as ViewMode, icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z", label: "Editor" },
            { mode: "split" as ViewMode, icon: "M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7", label: "Split" },
            { mode: "preview" as ViewMode, icon: "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z", label: "Preview" },
          ]).map(({ mode, icon, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === mode
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-[#1a1a2e]"
              }`}
              title={label}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
              </svg>
              <span className="hidden md:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              copyFeedback
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-[#12121f] text-slate-400 hover:text-white border border-[#2a2a40] hover:border-indigo-500/50"
            }`}
          >
            {copyFeedback ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="hidden sm:inline">Copied!</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span className="hidden sm:inline">Copy HTML</span>
              </>
            )}
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-medium transition-all shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </header>

      {/* ===== MAIN CONTENT ===== */}
      <main className="flex-1 flex overflow-hidden">
        {/* EDITOR PANEL */}
        {(viewMode === "editor" || viewMode === "split") && (
          <div
            className={`flex flex-col bg-[#12121f] ${
              viewMode === "split" ? "w-1/2 border-r border-[#2a2a40]" : "w-full"
            }`}
          >
            {/* Editor Header */}
            <div className="flex items-center justify-between px-4 h-9 bg-[#16162a] border-b border-[#2a2a40]">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                </div>
                <span className="text-[11px] text-slate-500 font-mono ml-2">
                  {detection.type === "mermaid" ? "diagram.mmd" : "README.md"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* Content type indicator in editor header */}
                <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${detection.bgColor} ${detection.color} border ${detection.borderColor}`}>
                  {detection.emoji} {detection.label}
                </span>
                <span className="text-[10px] text-slate-600 font-mono">
                  {detection.type === "mermaid" ? "MERMAID" : detection.type === "mixed" ? "MD+MERMAID" : "MARKDOWN"}
                </span>
              </div>
            </div>
            {/* Textarea */}
            <textarea
              className="editor-textarea flex-1 w-full bg-transparent text-slate-300 p-4 placeholder-slate-600"
              value={markdownText}
              onChange={(e) => setMarkdownText(e.target.value)}
              placeholder="Type or paste your content here...&#10;&#10;Supports:&#10;• Standard Markdown (# headers, **bold**, etc.)&#10;• Raw Mermaid code (gitGraph, flowchart, etc.)&#10;• Markdown with ```mermaid blocks&#10;&#10;Auto-detects and auto-fixes common errors!"
              spellCheck={false}
            />
          </div>
        )}

        {/* PREVIEW PANEL */}
        {(viewMode === "preview" || viewMode === "split") && (
          <div
            className={`flex flex-col bg-white ${
              viewMode === "split" ? "w-1/2" : "w-full"
            }`}
          >
            {/* Preview Header */}
            <div className="flex items-center justify-between px-4 h-9 bg-slate-50 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <span className="text-[11px] text-slate-500 font-mono">Preview</span>
                {detection.mermaidBlockCount > 0 && (
                  <span className="text-[10px] text-purple-500 font-mono">
                    ({detection.mermaidBlockCount} diagram{detection.mermaidBlockCount > 1 ? "s" : ""})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {hasAutoFixes && (
                  <span className="text-[9px] text-emerald-600 font-bold uppercase tracking-wider bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                    🔧 {appliedFixes.length} auto-fix{appliedFixes.length > 1 ? "es" : ""}
                  </span>
                )}
                <span className="text-[10px] text-slate-400 font-mono">HTML</span>
              </div>
            </div>
            {/* HTML Preview */}
            <div className="flex-1 overflow-auto p-6 md:p-10">
              <div
                ref={previewRef}
                className="markdown-preview max-w-4xl mx-auto animate-fade-in"
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            </div>
          </div>
        )}
      </main>

      {/* ===== STATUS BAR ===== */}
      <footer className="flex-shrink-0 flex items-center justify-between px-4 h-7 bg-[#1a1a2e] border-t border-[#2a2a40] text-[10px] text-slate-500 font-mono">
        <div className="flex items-center gap-4">
          <span>Ln {lines}</span>
          <span>Words {words}</span>
          <span>Ch {chars}</span>
        </div>
        <div className="flex items-center gap-4">
          <span>UTF-8</span>
          {/* Detection type in status bar */}
          <span className={`flex items-center gap-1 ${detection.color}`}>
            <span>{detection.emoji}</span>
            <span>{detection.label}</span>
          </span>
          {hasAutoFixes && (
            <span className="flex items-center gap-1 text-emerald-400">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {appliedFixes.length} fix{appliedFixes.length > 1 ? "es" : ""}
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Smart Detect + Auto-Fix
          </span>
          <span>GFM</span>
        </div>
      </footer>
    </div>
  );
}
