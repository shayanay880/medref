
import { GoogleGenAI, Schema, Type } from "@google/genai";
import { AppSettings, SectionOutline, ExtractedChunkData, GlossaryEntry, GroundingSource } from "../types";
import { SYSTEM_INSTRUCTION, MODELS, DEFAULT_MODEL_ID } from "../constants";

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

// --- UTILITIES ---

/**
 * Exponential backoff helper to handle transient 500/XHR/RateLimit errors.
 */
async function callWithRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const isTransient = err?.message?.includes('500') || 
                        err?.message?.includes('xhr') || 
                        err?.message?.includes('429') ||
                        err?.message?.includes('deadline') ||
                        err?.message?.includes('fetch');
                        
    if (retries > 0 && isTransient) {
      console.warn(`Transient error detected. Retrying in ${delay}ms... (${retries} retries left)`, err);
      await new Promise(resolve => setTimeout(resolve, delay));
      return callWithRetry(fn, retries - 1, delay * 2);
    }
    throw err;
  }
}

// --- CONFIGURATION HELPERS ---

const getModelConfig = (modelId: string) => {
  const modelDef = MODELS.find(m => m.id === modelId) || MODELS[0];
  return {
    modelName: modelDef.id,
    thinkingBudget: modelDef.thinkingBudget
  };
};

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
          summary: { type: Type.STRING },
          charStart: { type: Type.NUMBER },
          charEnd: { type: Type.NUMBER },
          priority: { type: Type.STRING }
        },
        required: ["id", "title", "summary", "priority"]
      }
    }
  },
  required: ["sections"]
};

const CHUNK_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    clinicalPearls: { type: Type.ARRAY, items: { type: Type.STRING } },
    managementSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
    quantitativeData: { type: Type.ARRAY, items: { type: Type.STRING } },
    diagnosticCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
    criticalPitfalls: { type: Type.ARRAY, items: { type: Type.STRING } },
    memoryAids: { type: Type.ARRAY, items: { type: Type.STRING } },
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
    glossaryTerms: { type: Type.ARRAY, items: { type: Type.STRING } },
    extraContent: { type: Type.ARRAY, items: { type: Type.STRING } },
    chunkMarkdown: { type: Type.STRING }
  },
  required: ["clinicalPearls", "managementSteps", "quantitativeData", "diagnosticCriteria", "criticalPitfalls", "memoryAids", "activeRecallQuestions", "glossaryTerms", "chunkMarkdown"]
};

const FINAL_OUTPUT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    titleAndRoadmap: { type: Type.STRING },
    tldr: { type: Type.STRING },
    pathophysiology: { type: Type.STRING },
    stepwiseTeaching: { type: Type.STRING },
    numbers: { type: Type.STRING },
    algorithm: { type: Type.STRING },
    pitfalls: { type: Type.STRING },
    memory: { type: Type.STRING },
    activeRecall: { type: Type.STRING },
    glossaryEntries: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          term: { type: Type.STRING },
          englishTerm: { type: Type.STRING },
          definition: { type: Type.STRING }
        },
        required: ["term", "definition"]
      }
    }
  },
  required: ["titleAndRoadmap", "tldr", "pathophysiology", "stepwiseTeaching", "numbers", "algorithm", "pitfalls", "memory", "activeRecall", "glossaryEntries"]
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

export const getAi = () => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Check your environment settings.");
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

const withSystemInstruction = (prompt: string) => {
  return `${SYSTEM_INSTRUCTION.trim()}\n\n${prompt.trim()}`;
};

// --- PROMPT BUILDERS ---

export const buildChunkPrompt = (chunkIndex: number, totalChunks: number, settings: AppSettings) => {
  const translationPrompt = settings.includeTranslation 
    ? "Append a short English gloss in parentheses after key terms." 
    : "Do not add English glosses.";

  return withSystemInstruction(`
      You are "MedRef Tutor Elite". Processing Chunk ${chunkIndex + 1}/${totalChunks}.
      Extract DETAILED clinical data. Do NOT simplify. 
      STRICT MODE: ${!settings.includeExtra ? "ON" : "OFF"}.
      ${translationPrompt}
      Return JSON only.
    `);
};

export const buildSynthesisPrompt = (
  aggregatedData: string, 
  settings: AppSettings, 
  studyGoalTitle?: string, 
  studyTags: string[] = []
) => {
  const densityGuidance = settings.highlightDensity === 'Low' 
    ? "HIGHLIGHT DENSITY: Low (sparse markers, max 2-3 red markers). Prioritize only the most critical numbers or a subset of numbers." 
    : settings.highlightDensity === 'High' 
      ? "HIGHLIGHT DENSITY: High (liberal emphasis). Apply highlights liberally to all relevant terms and numbers." 
      : "HIGHLIGHT DENSITY: Medium.";

  return withSystemInstruction(`
      Merge extracted medical data into a cohesive Persian-first study guide.
      Study Goal (Title): ${studyGoalTitle || 'General Mastery'}. Tags: ${studyTags.join(', ')}.
      ${settings.includeTranslation ? "Provide English helper terms in parentheses." : "Persian-first narrative."}
      ${densityGuidance}
      ${!settings.includeExtra ? "no خارج از متن or [[EXTRA]] labels allowed. Use only source material." : "extras allowed inline with [[EXTRA]] tags."}
      
      CORE MISSION: Focus heavily on the Study Goal. If the input data contains unrelated branches, compress or omit non-goal material.
      Return JSON only.
      
      DATA:
      ${aggregatedData}
    `);
};

// --- API ACTIONS ---

export const generateOutline = async (
  text: string,
  studyTitle?: string,
  studyTags?: string[],
  modelId: string = DEFAULT_MODEL_ID
): Promise<SectionOutline[]> => {
  return callWithRetry(async () => {
    const ai = getAi();
    const { modelName } = getModelConfig(modelId);
    
    // For outlining, we use a conservative budget as it's a lighter task, 
    // but we scale it slightly for Pro to allow better planning.
    const thinkingBudget = modelName.includes('pro') ? 8192 : 4000;

    const prompt = withSystemInstruction(`Generate a medical study outline for: ${studyTitle || 'Text'}. Tags: ${studyTags?.join(', ') || ''}`);
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt + "\n\nTEXT:\n" + text.slice(0, 40000),
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: OUTLINE_SCHEMA,
        thinkingConfig: { thinkingBudget }
      }
    });
    if (!response.text) throw new Error("Failed to generate outline");
    return JSON.parse(response.text).sections;
  });
};

export const processChunk = async (
  chunkText: string,
  chunkIndex: number,
  totalChunks: number,
  settings: AppSettings,
  focusSections?: SectionOutline[]
): Promise<ExtractedChunkData> => {
  return callWithRetry(async () => {
    const ai = getAi();
    const prompt = buildChunkPrompt(chunkIndex, totalChunks, settings);
    const { modelName } = getModelConfig(settings.selectedModel);
    
    // Extraction needs precision but not necessarily deep chain-of-thought for every chunk.
    // However, Pro can handle complexity better.
    const thinkingBudget = modelName.includes('pro') ? 2048 : 0;
    
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt + "\n\nCHUNK TEXT:\n" + chunkText,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: CHUNK_SCHEMA,
        thinkingConfig: { thinkingBudget }
      }
    });
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
  });
};

export const stitchFinalOutput = async (
  outline: SectionOutline[],
  chunkResults: ExtractedChunkData[],
  settings: AppSettings,
  originalTextSample: string,
  studyGoalTitle?: string,
  studyTags: string[] = []
): Promise<{ markdown: string; glossaryEntries: GlossaryEntry[]; groundingSources?: GroundingSource[] }> => {
  return callWithRetry(async () => {
    const ai = getAi();
    const { modelName, thinkingBudget } = getModelConfig(settings.selectedModel);
    
    // Optimize aggregated data to stay under token limits
    const aggregatedData = chunkResults.map(c => {
      return `[Chunk ${c.chunkId}] 
        PEARLS: ${c.tldrPoints.slice(0, 10).join('; ')}
        ALGO: ${c.algorithmSteps.slice(0, 5).join('; ')}
        NUMS: ${c.numbers.slice(0, 10).join('; ')}
        PITFALLS: ${c.pitfalls.slice(0, 5).join('; ')}`;
    }).join("\n\n");

    const synthPrompt = buildSynthesisPrompt(aggregatedData, settings, studyGoalTitle, studyTags);

    const response = await ai.models.generateContent({
      model: modelName,
      contents: synthPrompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: FINAL_OUTPUT_SCHEMA,
        thinkingConfig: { thinkingBudget },
        tools: [{ googleSearch: {} }]
      }
    });

    if (!response.text) throw new Error("Failed to stitch output");
    const final = JSON.parse(response.text);

    const groundingSources: GroundingSource[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks) {
      chunks.forEach((chunk: any) => {
        if (chunk.web) {
          groundingSources.push({ uri: chunk.web.uri, title: chunk.web.title });
        }
      });
    }
    const uniqueSources = Array.from(new Map(groundingSources.map(s => [s.uri, s])).values());

    const glossaryEntries = final.glossaryEntries || [];
    let finalMarkdown = `
## 1) عنوان + نقشه راه (Roadmap)
${final.titleAndRoadmap}
## 2) نسخه‌ی خیلی ساده (TL;DR)
${final.tldr}
## 3) پاتوفیزیولوژی به زبان ساده (The "Why")
${final.pathophysiology}
## 4) آموزش مرحله‌ای (Step-by-Step Teaching)
${final.stepwiseTeaching}
## 5) آمار و ارقام (Numbers & Cutoffs)
${final.numbers}
## 6) الگوریتم "اگر/آنگاه" (IF/THEN Logic)
${final.algorithm}
## 7) دام‌های تشخیصی (Diagnostic Pitfalls)
${final.pitfalls}
## 8) ابزارهای حافظه (Mnemonics)
${final.memory}
## 9) مرور فعال (Active Recall)
${final.activeRecall}
`;

    if (settings.autoIncludeGlossary && glossaryEntries.length) {
      const glossaryMarkdown = glossaryEntries.map((e: any, i: number) => `${i + 1}. ${e.term}${e.englishTerm ? ' ('+e.englishTerm+')' : ''}: ${e.definition}`).join('\n');
      finalMarkdown += `\n\n## 10) واژه‌نامه سریع (Glossary)\n${glossaryMarkdown}\n`;
    }

    return { markdown: finalMarkdown, glossaryEntries, groundingSources: uniqueSources };
  });
};

export const resolveConflictValues = async (
  conflicts: ConflictEvidence[]
): Promise<ConflictResolutionItem[]> => {
  return callWithRetry(async () => {
    const ai = getAi();
    // Default to a safe Flash model for conflict resolution to keep it fast
    const modelName = DEFAULT_MODEL_ID;
    
    const serialized = conflicts.map((c, i) => `#${i + 1} ${c.contextLabel}: ${c.values.join(' vs ')}`).join('\n');
    const response = await ai.models.generateContent({
      model: modelName,
      contents: withSystemInstruction(`Resolve medical value conflicts using Google Search:\n${serialized}`),
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: CONFLICT_RESOLUTION_SCHEMA,
        thinkingConfig: { thinkingBudget: 4000 },
        tools: [{ googleSearch: {} }]
      }
    });
    if (!response.text) throw new Error('Failed to resolve conflicts');
    return JSON.parse(response.text);
  });
};

export const generateMedicalTutorial = async () => ({ markdownOutput: "Use pipeline." });
