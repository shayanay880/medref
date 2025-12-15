import { GoogleGenAI, Schema, Type } from "@google/genai";
import { AppSettings, SectionOutline, ExtractedChunkData, PipelineState } from "../types";
import { MODEL_NAME } from "../constants";

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
    algorithm: { type: Type.STRING, description: "Markdown: Detailed IF/THEN management flow with doses." },
    tldr: { type: Type.STRING, description: "Markdown: High-yield clinical pearls." },
    numbers: { type: Type.STRING, description: "Markdown: Table/List of ALL cutoffs/doses with hl-yellow." },
    diagnosis: { type: Type.STRING, description: "Markdown: Workup and differentials." },
    pitfalls: { type: Type.STRING, description: "Markdown: Red flags." },
    memory: { type: Type.STRING, description: "Markdown: Mnemonics." },
    activeRecall: { type: Type.STRING, description: "Markdown: Q&A." },
    glossary: { type: Type.STRING, description: "Markdown: Term list." },
    extra: { type: Type.STRING, description: "Markdown: Extra content." }
  },
  required: ["algorithm", "tldr", "numbers", "diagnosis", "pitfalls", "memory", "activeRecall", "glossary"]
};

// --- API CLIENT ---

const getAi = () => {
  const key = process.env.API_KEY;
  if (!key) {
    throw new Error("API Key is missing. Please check your environment configuration.");
  }
  return new GoogleGenAI({ apiKey: key });
};

// --- PHASE A: OUTLINE ---

export const generateOutline = async (text: string): Promise<SectionOutline[]> => {
  const ai = getAi();
  const prompt = `
  Analyze the provided medical text (Chief Resident Level).
  Create a detailed table of contents.
  For each major clinical concept (Pathophysiology, Diagnosis, Management, etc.), create a section.
  Ensure NO critical section is skipped.
  `;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [
      { role: 'user', parts: [{ text: prompt + "\n\nTEXT:\n" + text.slice(0, 40000) }] }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: OUTLINE_SCHEMA
    }
  });

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
  const isStrict = !settings.includeExtra;
  
  const prompt = `
  You are "MedRef Tutor (Chief Resident Mode)". Processing Chunk ${chunkIndex + 1}/${totalChunks}.
  
  TASK: Extract DETAILED clinical data. 
  - Do NOT simplify. 
  - Do NOT summarize away specific antibiotic regimens, dosage adjustments, or subtle inclusion criteria.
  - The user is a physician; they need the EXACT details.

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

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [
      { role: 'user', parts: [{ text: prompt + "\n\nCHUNK TEXT:\n" + chunkText }] }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: CHUNK_SCHEMA,
      thinkingConfig: { thinkingBudget: 2048 } // Tuned for reliability on extraction
    }
  });

  if (!response.text) throw new Error(`Failed to process chunk ${chunkIndex}`);
  const result = JSON.parse(response.text);
  
  return {
    chunkId: chunkIndex,
    sourceStart: 0,
    sourceEnd: 0,
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

  const synthPrompt = `
  You are "MedRef Tutor (Chief Resident Mode)".
  Synthesize a **comprehensive, high-density** study guide from the extracted data.
  
  AUDIENCE: Medical Residents/Physicians.
  TONE: Professional, Direct, High-Yield. NO "fluff".
  
  MANDATORY SECTIONS (Markdwon):
  1. **مدیریت و اورژانس (Clinical Algorithm)**: 
     - Detailed IF/THEN logic. 
     - Include "First 5 Minutes". 
     - **MUST** include specific drugs and dosages if in data.
  
  2. **نکات کلیدی (Pearls)**: 
     - 6-12 high-value bullet points.
  
  3. **اعداد و دوزها (Numbers)**: 
     - <span class="hl-yellow">WRAP ALL NUMBERS</span>.
     - Group by Doses / Scores / Epidemiology.
  
  4. **تشخیص (Diagnosis)**: 
     - Workup, Gold Standard, Differentials.
  
  5. **دام‌ها (Pitfalls)**.
  
  6. **حافظه‌سازی (Memory)**.
  
  7. **مرور فعال (Active Recall)**.
  
  8. **واژه‌نامه (Glossary)**.

  9. **Extra** (If available).

  TERMINOLOGY:
  - "Subacute" = "ساب‌اکیوت"
  - "Acute" = "حاد"
  
  INPUT DATA:
  ${aggregatedData}
  `;

  const synthResponse = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [{ role: 'user', parts: [{ text: synthPrompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: FINAL_OUTPUT_SCHEMA,
      thinkingConfig: { thinkingBudget: 8192 } // Increased for complex synthesis
    }
  });

  if (!synthResponse.text) throw new Error("Failed to stitch output");
  const final = JSON.parse(synthResponse.text);

  // 2. Assembly
  let finalMarkdown = `
# تنظیمات
- **Strict Mode**: ${settings.includeExtra ? 'OFF' : 'ON'}
- **Study Load**: ${settings.outputLength} (Resident Level)
- **Model**: ${MODEL_NAME}

<div class="chunk-separator"></div>

## 1) الگوریتم مدیریت و اورژانس (Clinical Algorithm)
${final.algorithm}

## 2) نکات کلیدی و مرور سریع (High-Yield Pearls)
${final.tldr}

## 3) اعداد، دوزها و آستانه‌ها (Numbers & Cutoffs)
${final.numbers}

## 4) تشخیص و افتراق (Diagnosis)
${final.diagnosis}

## 5) دام‌ها و اشتباهات رایج (Pitfalls)
${final.pitfalls}

## 6) حافظه‌سازی (Memory Tools)
${final.memory}

## 7) مرور فعال (Active Recall)
${final.activeRecall}

## 8) واژه‌نامه تخصصی (Glossary)
${final.glossary}
`;

  if (settings.includeExtra && final.extra) {
    finalMarkdown += `
## 9) ➕ افزوده (خارج از متن)
${final.extra}
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