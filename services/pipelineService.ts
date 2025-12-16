import { ExtractedChunkData, MasteryStatus, OutlineResult, SectionOutline, SectionMastery, SectionMasteryStatus } from '../types';

// Optimized for Gemini 3 Pro (Large Context Window)
// Increased from 8k to 32k to improve coherence and reduce API calls.
export const CHUNK_SIZE_CHARS = 32000;
export const OVERLAP_CHARS = 1000;

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
  chunkResults: ExtractedChunkData[]
): Record<string, { covered: boolean; chunkIds: number[] }> => {
  return outline.reduce<Record<string, { covered: boolean; chunkIds: number[] }>>((acc, section) => {
    const coveringChunks = chunkResults
      .filter((chunk) => chunk.coversOutlineIds?.includes(section.id))
      .map((chunk) => chunk.chunkId);

    const uniqueChunks = Array.from(new Set(coveringChunks));

    acc[section.id] = {
      covered: coveringChunks.length > 0,
      chunkIds: uniqueChunks
    };
    return acc;
  }, {});
};

const getSectionStatus = (score: number, completion: number): SectionMasteryStatus => {
  if (score >= 0.85) return 'mastered';
  if (completion > 0 || score > 0) return 'learning';
  return 'unstarted';
};

export const calculateSectionMastery = (
  outline: SectionOutline[],
  coverageReport: Record<string, { covered: boolean; chunkIds: number[] }>,
  chunkResults: ExtractedChunkData[],
  outlineResult?: OutlineResult
): MasteryStatus => {
  const sectionProgress = outline.reduce<Record<string, SectionMastery>>((acc, section) => {
    const coverage = coverageReport?.[section.id];
    const coveredChunks = coverage?.chunkIds?.length || 0;
    const expectedChunks = outlineResult?.chunkPlan?.filter((entry) => entry.outlineIds?.includes(section.id)).length || Math.max(coveredChunks, 1);
    const completion = Math.min(1, expectedChunks ? coveredChunks / expectedChunks : 0);
    const activeRecallCount = chunkResults
      .filter((chunk) => chunk.coversOutlineIds?.includes(section.id))
      .reduce((sum, chunk) => sum + (chunk.activeRecallQuestions?.length || 0), 0);
    const recallScore = Math.min(activeRecallCount / 5, 1);
    const masteryScore = Math.min(1, completion * 0.6 + recallScore * 0.4);
    const status = getSectionStatus(masteryScore, completion);

    acc[section.id] = {
      sectionId: section.id,
      title: section.title,
      completion,
      masteryScore,
      activeRecallCount,
      coveredChunks,
      expectedChunks,
      status
    };
    return acc;
  }, {});

  const totalSections = outline.length || 1;
  const score = Object.values(sectionProgress).reduce((sum, section) => sum + section.masteryScore, 0) / totalSections;
  const completedSections = Object.values(sectionProgress).filter((section) => section.status === 'mastered').length;

  return {
    score,
    completedSections,
    totalSections: outline.length,
    sectionProgress
  };
};