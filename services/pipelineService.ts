import { ExtractedChunkData, SectionOutline } from '../types';

// Optimized for Gemini 3 Pro (Large Context Window)
// Increased from 8k to 32k to improve coherence and reduce API calls.
const CHUNK_SIZE_CHARS = 32000;
const OVERLAP_CHARS = 1000;

export const splitTextIntoChunks = (text: string): { text: string; start: number; end: number }[] => {
  const chunks: { text: string; start: number; end: number }[] = [];
  let startIndex = 0;

  // If text is small enough, just return one chunk
  if (text.length <= CHUNK_SIZE_CHARS) {
    return [{ text, start: 0, end: text.length }];
  }

  while (startIndex < text.length) {
    let endIndex = startIndex + CHUNK_SIZE_CHARS;

    if (endIndex >= text.length) {
      endIndex = text.length;
    } else {
      // Look for the last period or newline within the window to split cleanly
      const lookbackWindow = text.slice(startIndex, endIndex);
      const lastPeriod = lookbackWindow.lastIndexOf('.');
      const lastNewline = lookbackWindow.lastIndexOf('\n');
      
      // Try to split at a paragraph or sentence boundary
      const splitPoint = Math.max(lastPeriod, lastNewline);
      
      if (splitPoint > CHUNK_SIZE_CHARS * 0.7) { // Only if split is reasonably far (70% of chunk)
         endIndex = startIndex + splitPoint + 1;
      }
    }

    chunks.push({
      text: text.slice(startIndex, endIndex),
      start: startIndex,
      end: endIndex
    });

    // Move start index, considering overlap (unless we hit the end)
    startIndex = endIndex;
    if (startIndex < text.length) {
        startIndex = Math.max(0, startIndex - OVERLAP_CHARS);
    }
  }

  return chunks;
};

export const createInitialPipeline = (text: string) => {
    return splitTextIntoChunks(text);
};

const normalizeText = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const extractKeywords = (text: string): string[] => {
  return normalizeText(text)
    .split(' ')
    .filter(word => word.length > 3);
};

export const calculateCoverageReport = (
  outline: SectionOutline[],
  chunkResults: ExtractedChunkData[],
  finalMarkdown?: string
): Record<string, number> => {
  const corpus = normalizeText(
    [
      ...chunkResults.map(chunk => chunk.chunkMarkdown),
      ...chunkResults.flatMap(chunk => [
        ...chunk.tldrPoints,
        ...chunk.algorithmSteps,
        ...chunk.numbers,
        ...chunk.diagnosticPatterns,
        ...chunk.pitfalls,
        ...chunk.memoryAids,
        ...chunk.glossaryTerms,
        ...chunk.activeRecallQuestions.map(q => `${q.question} ${q.answer}`),
        ...chunk.extraContent
      ]),
      finalMarkdown || ''
    ].join(' ')
  );

  return outline.reduce<Record<string, number>>((acc, section) => {
    const keywords = extractKeywords(`${section.title} ${section.summary}`);
    if (keywords.length === 0) {
      acc[section.id] = 0;
      return acc;
    }

    const matchCount = keywords.filter(keyword => corpus.includes(keyword)).length;
    const percent = Math.min(100, Math.round((matchCount / keywords.length) * 100));
    acc[section.id] = percent;
    return acc;
  }, {});
};