import { CONFIG } from '../core/config';

/**
 * Extract language tag from content if present
 *
 * @param content The content to extract the language tag from
 * @returns Object containing the extracted tag and the remaining content
 */
export const extractLanguageTag = (content: string): { tag: string | null; content: string } => {
  if (!CONFIG.handleLanguageTags) {
    return { tag: null, content };
  }

  // 1. Check for common formats: ```language, ```language:, or [language]
  const langRegexes = [
    /^```(\w+)[\s:]?\s*\n([\s\S]+)$/, // ```language followed by newline
    /^\[(\w+)\]\s*\n([\s\S]+)$/, // [language] followed by newline
  ];

  for (const regex of langRegexes) {
    const match = content.match(regex);
    if (match) {
      const tag = match[1].toLowerCase();
      // Verify it's likely a language tag, not just random text in backticks
      if (CONFIG.knownLanguages.includes(tag)) {
        return { tag, content: match[2] };
      }
    }
  }

  // 2. Check for language comments
  const commentRegexes = [
    /^\/\/\s*language:\s*(\w+)\s*\n([\s\S]+)$/i, // // language: python
    /^#\s*language:\s*(\w+)\s*\n([\s\S]+)$/i, // # language: python
    /^<!--\s*language:\s*(\w+)\s*-->\s*\n([\s\S]+)$/i, // <!-- language: html -->
  ];

  for (const regex of commentRegexes) {
    const match = content.match(regex);
    if (match) {
      const tag = match[1].toLowerCase();
      if (CONFIG.knownLanguages.includes(tag)) {
        return { tag, content: match[2] };
      }
    }
  }

  // 3. Look for language hints in the first few lines
  const lines = content.split('\n');
  const checkLines = Math.min(CONFIG.maxLinesAfterLangTag, lines.length);

  for (let i = 0; i < checkLines; i++) {
    const line = lines[i].trim().toLowerCase();

    // Check for shebang in first line
    if (i === 0 && line.startsWith('#!')) {
      if (line.includes('python')) return { tag: 'python', content };
      if (line.includes('node')) return { tag: 'javascript', content };
      if (line.includes('bash') || line.includes('/sh')) return { tag: 'bash', content };
      if (line.includes('ruby')) return { tag: 'ruby', content };
    }

    // Check for language-specific patterns
    if (line.includes('<?php')) return { tag: 'php', content };
    if (line.includes('<!doctype html>') || line.includes('<html')) return { tag: 'html', content };
    if (line.match(/^(import|from)\s+[\w.]+\s+import/)) return { tag: 'python', content };
    if (line.match(/^(const|let|var)\s+\w+\s*=/)) return { tag: 'javascript', content };
    if (line.match(/^function\s+\w+\(/)) return { tag: 'javascript', content };
    if (line.match(/^package\s+\w+;?/)) return { tag: 'java', content };
    if (line.match(/^using\s+[\w.]+;/)) return { tag: 'csharp', content };
    if (line.match(/^#include\s+[<"][\w.]+[>"]/)) return { tag: 'c', content };
  }

  return { tag: null, content };
};
