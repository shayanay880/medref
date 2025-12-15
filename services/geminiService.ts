import { GoogleGenAI, Schema, Type } from "@google/genai";
import { AppSettings, SectionOutline, ExtractedChunkData, PipelineState, OutlineResult } from "../types";
import { MODEL_NAME, SYSTEM_INSTRUCTION } from "../constants";
import { splitTextIntoChunks } from "./pipelineService";

// --- SCHEMAS ---

const OUTLINE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          title: { type: Type.STRING },
          summary: { type: Type.STRING }
        },
        required: ["id", "title", "summary"]
      }
    }
  },
  required: ["sections"]
};

// Exam Mode Chunk Schema: Extracts ingredients for the final recipe
const CHUNK_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    clinicalPearls: { type: Type.ARRAY, items: { type: Type.STRING }, description: "High-yield resident-level facts" },
    managementSteps: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Detailed actions, drugs, doses, criteria" },
    quantitativeData: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Every single number, dose, or cutoff found" },
    diagnosticCriteria: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Signs, symptoms, gold standard tests" },
    criticalPitfalls: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Life threats and common errors" },
    memoryAids: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Mnemonics" },
    activeRecallQuestions: { 
      type: Type.ARRAY, 
      items: { 
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING },
          answer: { type: Type.STRING }
        },
        required: ["question", "answer"]
      } 
    },
    glossaryTerms: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Key terms (Persian - English)" },
    extraContent: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Only if strict mode off" },
    chunkMarkdown: { 
      type: Type.STRING, 
      description: "A comprehensive, detailed subsection for this chunk. Do not summarize; explain fully." 
    }
  },
  required: ["clinicalPearls", "managementSteps", "quantitativeData", "diagnosticCriteria", "criticalPitfalls", "memoryAids", "activeRecallQuestions", "glossaryTerms", "chunkMarkdown"]
};

// Final Output Schema to ensure all mandatory sections are present
const FINAL_OUTPUT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    titleAndRoadmap: { type: Type.STRING, description: "Markdown bullets for title and roadmap." },
    tldr: { type: Type.STRING, description: "Markdown bullets (6-10) in Persian-first tone." },
    stepwiseTeaching: { type: Type.STRING, description: "Markdown sections with stepwise teaching." },
    numbers: { type: Type.STRING, description: "Markdown list/table of numbers with hl-yellow." },
    algorithm: { type: Type.STRING, description: "Markdown IF/THEN flow." },
    pitfalls: { type: Type.STRING, description: "Markdown bullets of pitfalls." },
    memory: { type: Type.STRING, description: "Mnemonic + one-sentence rule." },
    activeRecall: { type: Type.STRING, description: "Markdown Q&A list." },
    glossary: { type: Type.STRING, description: "Bilingual glossary bullets (FA term — EN gloss)." },
    extras: { type: Type.STRING, description: "Extra items if allowed (each line starts with [EXTRA])." }
  },
  required: ["titleAndRoadmap", "tldr", "stepwiseTeaching", "numbers", "algorithm", "pitfalls", "memory", "activeRecall", "glossary"]
};

// --- API CLIENT ---

const assertSystemInstruction = () => {
  if (!SYSTEM_INSTRUCTION || !SYSTEM_INSTRUCTION.trim()) {
    throw new Error("SYSTEM_INSTRUCTION is missing or empty");
  }
};

const withSystemInstruction = (prompt: string) => {
  assertSystemInstruction();
  // We double-bag the system instruction in the prompt text as a fallback/reinforcement
  return `${SYSTEM_INSTRUCTION.trim()}\n\n${prompt.trim()}`;
};

const logSystemInstructionUsage = (label: string) => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
    console.info(`[Gemini] ${label} prompt includes system instruction:`, true);
  }
};

assertSystemInstruction();

const getAi = () => {
  // Use process.env.API_KEY exclusively as per guidelines.
  // Assumes API_KEY is available in process.env (provided by build system/Vite).
  const key = process.env.API_KEY;

  if (!key) {
    throw new Error(
      "API Key is missing. process.env.API_KEY must be defined."
    );
  }
  return new GoogleGenAI({ apiKey: key });
};

// --- PHASE A: OUTLINE ---

const OUTLINE_WINDOW_CHARS = 40000;

const normalizeTitle = (title: string) => title.replace(/\s+/g, " ").trim().toLowerCase();

const dedupeSections = (sections: SectionOutline[]): SectionOutline[] => {
  const merged = new Map<string, SectionOutline>();

  sections.forEach((section, idx) => {
    const key = normalizeTitle(section.title);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...section, id: section.id || `section-${idx + 1}` });
      return;
    }

    if ((section.summary || '').length > (existing.summary || '').length) {
      merged.set(key, { ...existing, summary: section.summary });
    }
  });

  return Array.from(merged.values()).map((section, idx) => ({
    ...section,
    id: section.id || `section-${idx + 1}`
  }));
};

const generateOutlineForSlice = async (text: string): Promise<SectionOutline[]> => {
  const ai = getAi();
  const prompt = withSystemInstruction(`
  Analyze the provided medical text (Chief Resident Level).
  Create a detailed table of contents.
  For each major clinical concept (Pathophysiology, Diagnosis, Management, etc.), create a section.
  Ensure NO critical section is skipped.
  `);

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [
      { role: 'user', parts: [{ text: prompt + "\n\nTEXT:\n" + text.slice(0, OUTLINE_WINDOW_CHARS) }] }
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: OUTLINE_SCHEMA
    }
  });

  logSystemInstructionUsage('outline');

  if (!response.text) throw new Error("Failed to generate outline");
  return JSON.parse(response.text).sections;
};

export const generateOutline = async (text: string): Promise<OutlineResult> => {
  if (text.length <= OUTLINE_WINDOW_CHARS) {
    const outline = await generateOutlineForSlice(text);
    return { outline };
  }

  const chunks = splitTextIntoChunks(text);
  const sections: SectionOutline[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkSections = await generateOutlineForSlice(chunks[i].text);
    chunkSections.forEach((section, idx) => {
      sections.push({
        ...section,
        id: section.id || `chunk-${i + 1}-section-${idx + 1}`
      });
    });
  }

  const outline = dedupeSections(sections);
  return {
    outline,
    notice: `Outline generated across ${chunks.length} chunks due to length; section titles were deduplicated to cover late-document topics.`
  };
};

// --- PHASE B: CHUNK PROCESSING ---

export const buildChunkPrompt = (
  chunkIndex: number,
  totalChunks: number,
  settings: AppSettings
) => {
  const isStrict = !settings.includeExtra;
  
  const translationHint = settings.includeTranslation
    ? "After each Persian bullet, append a short English gloss in parentheses." : "Stay Persian-first with no added English hints.";

  return withSystemInstruction(`
  You are "MedRef Tutor (FA/EN)". Processing chunk ${chunkIndex + 1} of ${totalChunks} from a medical reference.

  MISSION: Preserve every clinical fact while making the Persian phrasing clearer for study. Never change numbers or dosing.
  LANGUAGE: Persian-first with English key terms in parentheses on first use. ${translationHint}

  STRICT MODE: ${isStrict ? "ON (No خارج از متن. Do not add extra facts.)" : "OFF (You may add brief context in extraContent)"}

  EXTRACTION FIELDS:
  - 'managementSteps': Every decision node, drug, dose, timing.
  - 'quantitativeData': Every number (dose, cutoff, time window, score values).
  - 'chunkMarkdown': A concise Persian teaching subsection that stays faithful to the chunk.
  - 'extraContent': Only if STRICT MODE is OFF.

  Return JSON only.
  `);
};

export const processChunk = async (
  chunkText: string, 
  chunkIndex: number, 
  totalChunks: number,
  settings: AppSettings,
  sourceStart: number,
  sourceEnd: number
): Promise<ExtractedChunkData> => {
  const ai = getAi();
  
  const prompt = buildChunkPrompt(chunkIndex, totalChunks, settings);

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [
      { role: 'user', parts: [{ text: prompt + "\n\nCHUNK TEXT:\n" + chunkText }] }
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: CHUNK_SCHEMA,
      thinkingConfig: { thinkingBudget: 2048 } // Tuned for reliability on extraction
    }
  });

  logSystemInstructionUsage(`chunk-${chunkIndex + 1}`);

  if (!response.text) throw new Error(`Failed to process chunk ${chunkIndex}`);
  const result = JSON.parse(response.text);
  
  return {
    chunkId: chunkIndex,
    sourceStart,
    sourceEnd,
    tldrPoints: result.clinicalPearls || [],
    algorithmSteps: result.managementSteps || [],
    numbers: result.quantitativeData || [],
    diagnosticPatterns: result.diagnosticCriteria || [],
    pitfalls: result.criticalPitfalls || [],
    memoryAids: result.memoryAids || [],
    activeRecallQuestions: result.activeRecallQuestions || [],
    glossaryTerms: result.glossaryTerms || [],
    extraContent: result.extraContent || [],
    chunkMarkdown: result.chunkMarkdown || ""
  };
};

// --- PHASE C: STITCHING (SYNTHESIS) ---

export const buildSynthesisPrompt = (
  aggregatedData: string,
  glossaryList: string,
  settings: AppSettings,
  originalTextSample: string
) => {
  const studyLoad = settings.outputLength;
  const activeRecallCount = studyLoad === 'Light' ? 5 : studyLoad === 'Deep' ? 10 : 8;
  const includeTranslation = settings.includeTranslation;
  const highlightCaps = {
    Low: { red: 3, yellow: 8, blue: 4 },
    Medium: { red: 6, yellow: 14, blue: 8 }
  }[settings.highlightDensity];

  return withSystemInstruction(`
  You are "MedRef Tutor (FA/EN)": a source-grounded medical educator for a medical student/GP.
  Goal: teach first, not translate first. Persian-first stance: Persian is primary. Keep essential medical terms in English in parentheses on first use.
  Keep drug names, acronyms, scores, units in English where helpful.

  STRICT MODE: ${settings.includeExtra ? "OFF (extras allowed)" : "ON (no خارج از متن)"}
  STUDY LOAD: ${studyLoad} (Light=core, Standard=core+explanation+algorithm+active recall, Deep=adds reasoning/pitfalls)
  HIGHLIGHT DENSITY: ${settings.highlightDensity} (Low=sparser spans; Medium=normal coverage)
  TRANSLATION FLAG: ${includeTranslation ? "ON (add concise English helper after each Persian bullet)" : "OFF (Persian-first only)"}

  HIGHLIGHTING RULES (MAX CAP ACROSS WHOLE ANSWER):
  - <span class="hl-red">...</span> = Critical actions/red flags (max ${highlightCaps.red})
  - <span class="hl-yellow">...</span> = Numbers/thresholds/doses/times (max ${highlightCaps.yellow})
  - <span class="hl-blue">...</span> = Key terms/definitions/pitfalls (max ${highlightCaps.blue})
  Use short spans only, never whole sentences.

  OUTPUT FORMAT (Markdown, exact order):
  1) عنوان + نقشه راه — 3-6 bullets on what will be learned.
  2) نسخه‌ی خیلی ساده (TL;DR) — 6-10 bullets, tutor tone. ${includeTranslation ? "After each Persian bullet, append a brief English helper prefixed with 'EN:'" : "Persian-first only."}
  3) آموزش مرحله‌ای (Step-by-step Teaching) — short blocks with headings; allow one analogy if natural.
  4) عددها و آستانه‌ها (Numbers & Cutoffs) — compact bullets/mini-table; WRAP ALL numbers with <span class=\"hl-yellow\">.
  5) الگوریتم عملی (IF/THEN) — clear decision path; include drug names/doses if present.
  6) دام‌ها و اشتباهات رایج (Pitfalls) — 5-8 bullets.
  7) حافظه‌سازی (Memory Tools) — one mnemonic OR say no mnemonic and give alternative memory method; include one-sentence rule.
  8) مرور فعال (Active Recall) — ${activeRecallCount} questions. Each question must include "پاسخ کوتاه: ...". Keep answers concise.
  9) واژه‌نامه (FA/EN Glossary) — bullet list "[FA term] — [EN gloss]"; apply highlight spans when defining pivotal terms.
  10) ➕ افزوده (خارج از متن) — Only if strict mode is OFF; each line starts with [EXTRA]; otherwise leave empty.

  SOURCE DISCIPLINE:
  - Source text is the ground truth; preserve all numbers/thresholds/doses/timings exactly.
  - If any content is added beyond the source, place it ONLY in the extras section.

  INPUT DATA (from extraction):
  ${aggregatedData}

  GLOSSARY TERMS (aggregated FA/EN pairs):
  ${glossaryList}
  `);
};

export const stitchFinalOutput = async (
  outline: SectionOutline[],
  chunkResults: ExtractedChunkData[],
  settings: AppSettings,
  originalTextSample: string
): Promise<string> => {
  const ai = getAi();

  // 1. Aggregate Metadata
  const glossaryList = Array.from(new Set(chunkResults.flatMap(c => c.glossaryTerms))).join(" | ");
  
  const aggregatedData = chunkResults.map(c => `
  [CHUNK ${c.chunkId}]
  Pearls: ${c.tldrPoints.join(' | ')}
  Management: ${c.algorithmSteps.join(' | ')}
  Numbers: ${c.numbers.join(' | ')}
  Dx: ${c.diagnosticPatterns.join(' | ')}
  Pitfalls: ${c.pitfalls.join(' | ')}
  Memory: ${c.memoryAids.join(' | ')}
  Glossary: ${c.glossaryTerms.join(' | ')}
  Q&A: ${c.activeRecallQuestions.map(q => `Q: ${q.question} A: ${q.answer}`).join(' | ')}
  ${!settings.includeExtra ? '' : `Extra: ${c.extraContent.join(' | ')}`}
  `).join("\n");

  const synthPrompt = buildSynthesisPrompt(aggregatedData, glossaryList, settings, originalTextSample);

  const synthResponse = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [{ role: 'user', parts: [{ text: synthPrompt }] }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: FINAL_OUTPUT_SCHEMA,
      thinkingConfig: { thinkingBudget: 8192 } // Increased for complex synthesis
    }
  });

  logSystemInstructionUsage('stitch');

  if (!synthResponse.text) throw new Error("Failed to stitch output");
  const final = JSON.parse(synthResponse.text);

  // 2. Assembly
  let finalMarkdown = `
## 0) تنظیمات خروجی
- Strict Mode: ${settings.includeExtra ? 'OFF' : 'ON'}
- Study Load: ${settings.outputLength}
- Legend: <span class="hl-red">Red</span> / <span class="hl-yellow">Yellow</span> / <span class="hl-blue">Blue</span>
- Model: ${MODEL_NAME}

<div class="chunk-separator"></div>

## 1) عنوان + نقشه راه
${final.titleAndRoadmap}

## 2) نسخه‌ی خیلی ساده (TL;DR)
${final.tldr}

## 3) آموزش مرحله‌ای (Step-by-step Teaching)
${final.stepwiseTeaching}

## 4) عددها و آستانه‌ها (Numbers & Cutoffs)
${final.numbers}

## 5) الگوریتم عملی (IF/THEN)
${final.algorithm}

## 6) دام‌ها و اشتباهات رایج (Pitfalls)
${final.pitfalls}

## 7) حافظه‌سازی (Memory Tools)
${final.memory}

## 8) مرور فعال (Active Recall)
${final.activeRecall}

## 9) واژه‌نامه (FA/EN Glossary)
${final.glossary}
`;

  if (settings.includeExtra && final.extras) {
    finalMarkdown += `
## 10) ➕ افزوده (خارج از متن)
${final.extras}
`;
  } else if (!settings.includeExtra) {
    // Optional: Keep section empty or remove logic if preferred, keeping as requested in prompt "otherwise leave empty"
    finalMarkdown += `
## 10) ➕ افزوده (خارج از متن)
`;
  }

  // Always append detailed markdown chunks if Standard OR Deep, to ensure "not too short"
  // For "Light", we skip. For "Standard", we add them in a "Details" section.
  if (settings.outputLength !== 'Light') {
    finalMarkdown += `\n\n<div class="chunk-separator"></div>\n\n# شرح تفصیلی (Detailed Reference)\n\n`;
    chunkResults.forEach((chunk, idx) => {
       finalMarkdown += `### بخش ${idx + 1}: ${outline[idx]?.title || 'Part ' + (idx+1)}\n${chunk.chunkMarkdown}\n\n`;
    });
  }

  return finalMarkdown;
};

// --- LEGACY WRAPPER ---
export const generateMedicalTutorial = async () => {
  return { markdownOutput: "Use pipeline." };
};