import { GoogleGenAI, Schema, Type } from "@google/genai";
import { AppSettings, SectionOutline, ExtractedChunkData } from "../types";
import { MODEL_NAME, SYSTEM_INSTRUCTION } from "../constants";

export interface ConflictEvidence {
  contextLabel: string;
  values: string[];
  snippets: { value: string; context: string; source: string }[];
}

export interface ConflictResolutionItem {
  contextLabel: string;
  resolvedValue: string;
  rationale: string;
  sources: string[];
}

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
    extras: { type: Type.STRING, description: "Extra items if allowed (each line starts with [EXTRA])." }
  },
  required: ["titleAndRoadmap", "tldr", "stepwiseTeaching", "numbers", "algorithm", "pitfalls", "memory", "activeRecall"]
};

const CONFLICT_RESOLUTION_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      contextLabel: { type: Type.STRING },
      resolvedValue: { type: Type.STRING },
      rationale: { type: Type.STRING },
      sources: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ["contextLabel", "resolvedValue", "rationale", "sources"]
  }
};

// --- API CLIENT ---

const assertSystemInstruction = () => {
  if (!SYSTEM_INSTRUCTION || !SYSTEM_INSTRUCTION.trim()) {
    throw new Error("SYSTEM_INSTRUCTION is missing or empty");
  }
};

const withSystemInstruction = (prompt: string) => {
  assertSystemInstruction();
  return `${SYSTEM_INSTRUCTION.trim()}\n\n${prompt.trim()}`;
};

const logSystemInstructionUsage = (label: string) => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
    console.info(`[Gemini] ${label} prompt includes system instruction:`, true);
  }
};

assertSystemInstruction();

const getAi = () => {
  const key = process.env.API_KEY || (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_GEMINI_API_KEY : undefined);

  if (!key) {
    throw new Error(
      "API Key is missing. Set API_KEY environment variable."
    );
  }

  return new GoogleGenAI({ apiKey: key });
};

// --- PROMPT BUILDERS ---

export const buildChunkPrompt = (chunkIndex: number, totalChunks: number, settings: AppSettings) => {
  const isStrict = !settings.includeExtra;
  return `
  You are "MedRef Tutor (Chief Resident Mode)". Processing Chunk ${chunkIndex + 1}/${totalChunks}.

  TASK: Extract DETAILED clinical data.
  - Do NOT simplify.
  - Do NOT summarize away specific antibiotic regimens, dosage adjustments, or subtle inclusion criteria.
  - The user is a physician; they need the EXACT details.
  ${settings.includeTranslation ? "Append a short English gloss where helpful." : "Do not add English glosses."}

  TERMINOLOGY GUARDRAILS:
  - Subacute = ساب‌اکیوت
  - Acute = حاد
  - Chronic = مزمن
  
  STRICT MODE: ${isStrict ? "ON (Source text only)" : "OFF (Add context if needed)"}
  
  FIELDS:
  - 'managementSteps': Capture every decision node, drug name, and dose.
  - 'quantitativeData': Capture every number (sensitivity %, dosage mg/kg, hours).
  - 'chunkMarkdown': Write a dense, professional subsection.

  Return JSON only.
  `;
};

export const buildSynthesisPrompt = (
  aggregatedData: string, 
  glossary: string, // Kept for signature compatibility if needed, but not used in current prompt logic directly
  settings: AppSettings, 
  originalTextSample: string
) => {
  const studyLoad = settings.outputLength;
  const activeRecallCount = studyLoad === 'Light' ? 5 : studyLoad === 'Deep' ? 10 : 8;
  const includeTranslation = settings.includeTranslation;
  const highlightDensity = settings.highlightDensity;

  const highlightGuidance = {
    Low: {
      summary: 'Highlights: max 2-3 red, max 8 yellow, max 4 blue. Only mark the most critical phrases and a subset of numbers (~25%).',
      coverage: 'Use highlights sparingly—only the top-priority red flags or numbers.',
    },
    Medium: {
      summary: 'Highlights: max 6 red, max 14 yellow, max 8 blue. Wrap all key numbers and clear red flags.',
      coverage: 'Use highlights on all key numbers and the most salient concepts.',
    },
    High: {
      summary: 'Highlights: max 8 red, max 18 yellow, max 12 blue. Apply highlights liberally to emphasize nuance.',
      coverage: 'Use highlights on nearly every number and most important concepts.',
    },
  } as const;

  return `
  You are "MedRef Tutor (FA/EN)": a source-grounded medical educator for a medical student/GP.
  Goal: teach first, not translate first. Persian is primary. Keep essential medical terms in English in parentheses on first use.
  Keep drug names, acronyms, scores, units in English where helpful.

  STRICT MODE: ${settings.includeExtra ? "OFF (extras allowed)" : "ON (no خارج از متن)"}
  STUDY LOAD: ${studyLoad} (Light=core, Standard=core+explanation+algorithm+active recall, Deep=adds reasoning/pitfalls)
  TRANSLATION FLAG: ${includeTranslation ? "ON (add concise English helper after each Persian bullet)" : "OFF (Persian-first only)"}
  HIGHLIGHT DENSITY: ${highlightDensity}
  ${highlightGuidance[highlightDensity].summary}

  HIGHLIGHTING RULES:
  - [[R]]...[[/R]] = Critical actions/red flags
  - [[Y]]...[[/Y]] = Numbers/thresholds/doses/times
  - [[B]]...[[/B]] = Key terms/definitions/pitfalls
  - Avoid <span> tags or emoji markers. Use short spans only, never whole sentences.
  - ${highlightGuidance[highlightDensity].coverage}

  OUTPUT FORMAT (Markdown, exact order):
  1) عنوان + نقشه راه — 3-6 bullets on what will be learned.
  2) نسخه‌ی خیلی ساده (TL;DR) — 6-10 bullets, tutor tone. ${includeTranslation ? "After each Persian bullet, append a brief English helper prefixed with 'EN:'" : "Persian-first only."}
  3) آموزش مرحله‌ای (Step-by-step Teaching) — short blocks with headings; allow one analogy if natural.
  4) عددها و آستانه‌ها (Numbers & Cutoffs) — compact bullets/mini-table; WRAP ALL numbers with [[Y]]...[[/Y]].
  5) الگوریتم عملی (IF/THEN) — clear decision path; include drug names/doses if present.
  6) دام‌ها و اشتباهات رایج (Pitfalls) — 5-8 bullets.
  7) حافظه‌سازی (Memory Tools) — one mnemonic OR say no mnemonic and give alternative memory method; include one-sentence rule.
  8) مرور فعال (Active Recall) — ${activeRecallCount} questions. Each question must include "پاسخ کوتاه: ...". Keep answers concise.
  9) ➕ افزوده (خارج از متن) — Only if strict mode is OFF; each line starts with [EXTRA]; otherwise leave empty.

  SOURCE DISCIPLINE:
  - Source text is the ground truth; preserve all numbers/thresholds/doses/timings exactly.
  - If any content is added beyond the source, place it ONLY in the extras section.

  INPUT DATA (from extraction):
  ${aggregatedData}

  SOURCE SAMPLE (truncated):
  ${originalTextSample}
  `;
};

// --- PHASE A: OUTLINE ---

export const generateOutline = async (text: string): Promise<SectionOutline[]> => {
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
      { role: 'user', parts: [{ text: prompt + "\n\nTEXT:\n" + text.slice(0, 40000) }] }
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

// --- PHASE B: CHUNK PROCESSING ---

export const processChunk = async (
  chunkText: string, 
  chunkIndex: number, 
  totalChunks: number,
  settings: AppSettings
): Promise<ExtractedChunkData> => {
  const ai = getAi();
  
  const prompt = withSystemInstruction(buildChunkPrompt(chunkIndex, totalChunks, settings));

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
    sourceStart: 0,
    sourceEnd: 0,
    coversOutlineIds: [],
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

export const stitchFinalOutput = async (
  outline: SectionOutline[],
  chunkResults: ExtractedChunkData[],
  settings: AppSettings,
  originalTextSample: string
): Promise<string> => {
  const ai = getAi();
  
  // 1. Aggregate Metadata
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

  const synthPrompt = withSystemInstruction(buildSynthesisPrompt(aggregatedData, '', settings, originalTextSample));

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
`;

  if (settings.includeExtra && final.extras) {
    finalMarkdown += `
## 9) ➕ افزوده (خارج از متن)
${final.extras}
`;
  } else if (!settings.includeExtra) {
    finalMarkdown += `
## 9) ➕ افزوده (خارج از متن)
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

export const resolveConflictValues = async (
  conflicts: ConflictEvidence[]
): Promise<ConflictResolutionItem[]> => {
  if (!conflicts.length) return [];

  const ai = getAi();
  const serialized = conflicts
    .map((conflict, idx) => `#${idx + 1} ${conflict.contextLabel}\nValues: ${conflict.values.join(' | ')}\nSnippets: ${conflict.snippets
      .map((s) => `${s.value} — ${s.context} (source: ${s.source})`)
      .join(' || ')}`)
    .join('\n\n');

  const prompt = withSystemInstruction(`You are adjudicating conflicting numeric guidance from clinical sources. For each conflict, pick ONE reconciled value or range. Be cautious and source-grounded. Provide a one-sentence rationale and list the cited snippets you used. Respond in Persian if the context is Persian.

Conflicts:
${serialized}`);

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: CONFLICT_RESOLUTION_SCHEMA,
      thinkingConfig: { thinkingBudget: 1024 }
    }
  });

  logSystemInstructionUsage('conflict-resolution');

  if (!response.text) throw new Error('Failed to resolve conflicts');
  return JSON.parse(response.text);
};

// --- LEGACY WRAPPER ---
export const generateMedicalTutorial = async () => {
  return { markdownOutput: "Use pipeline." };
};