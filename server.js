import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import * as fs from 'fs';
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
const port = 3000;
const upload = multer({ dest:'uploads/'});

const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = "gemini-2.0-flash";

const AMOUNT_SCHEMA = {
  type: "object",
  properties: {
    currency: {
      type: "string",
      description: "Three-letter currency code (e.g., INR, USD).",
    },
    ocr_confidence: {
      type: "number",
      description: "Overall confidence (0–1) for OCR/extraction step.",
    },
    amounts: {
      type: "array",
      description: "List of financial amounts extracted, normalized, and classified.",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["total_bill", "paid", "due", "discount", "tax", "subtotal", "other"],
            description: "Classification of the amount based on context.",
          },
          value: {
            type: "number",
            description: "Normalized numeric value, corrected for OCR errors.",
          },
          source: {
            type: "string",
            description: "Raw text snippet (provenance) where this amount was found.",
          },
          confidence: {
            type: "number",
            description: "Confidence (0–1) that this classification is correct.",
          },
        },
        required: ["type", "value", "source", "confidence"],
      },
    },
    status: {
      type: "string",
      enum: ["ok", "no_amounts_found", "document_too_noisy"],
      description: "Processing status. 'ok' if successful, otherwise guardrail.",
    },
  },
  required: ["currency", "amounts", "status", "ocr_confidence"],
};

function fileToGenerativePart(filePath, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
      mimeType,
    },
  };
}

app.post('/api/v1/detect-amounts', upload.single('document'), async (req, res) => {
  const filePath = req.file?.path;

  if (!filePath) {
    return res.status(400).json({ status: "error", reason: "No document file uploaded." });
  }

  const mimeType = req.file?.mimetype || "image/jpeg";

  try {
    const imagePart = fileToGenerativePart(filePath, mimeType);

    const prompt = `
      Analyze the attached image, which is a medical bill or financial receipt.
      Perform the following steps and return the result as a single JSON object strictly following the provided schema:

      1. OCR/Extraction: Extract all relevant text and amounts, handling OCR errors. Provide an overall "ocr_confidence".
      2. Normalization: Convert extracted tokens into clean numeric 'value' fields.
      3. Classification: Classify each amount into the required 'type' and provide a per-item 'confidence'.
      4. Provenance: Include the raw text snippet for the 'source' field.

      If the document is too blurry, crumpled, or has no amounts, return 'status' = 'document_too_noisy' or 'no_amounts_found'
      with empty arrays for amounts, but ensure all other required fields exist.
    `;

    const modelInstance = ai.getGenerativeModel({ model: MODEL_NAME });

    // ✅ FIXED generateContent structure
    const response = await modelInstance.generateContent({
      contents: [
        {
          role: "user",
          parts: [imagePart, { text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: AMOUNT_SCHEMA,
        temperature: 0.1,
      },
    });

    let rawText = response.response?.text() ?? response.text?.() ?? "";

    if (!rawText) {
      return res.status(500).json({
        status: "error",
        reason: "Model returned an empty response.",
      });
    }

    rawText = rawText.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");

    let structuredResult;
    try {
      structuredResult = JSON.parse(rawText);
    } catch (e) {
      return res.status(500).json({
        status: "error",
        reason: "Invalid JSON returned by model.",
        raw_model_output: rawText,
      });
    }

    res.json(structuredResult);

  } catch (error) {
    console.error("❌ Error processing document with Gemini:", error);
    res.status(500).json({
      status: "error",
      reason: "Internal processing error: " + error.message,
    });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

app.listen(port, () => {
  console.log(`✅ Server listening at http://localhost:${port}`);
});