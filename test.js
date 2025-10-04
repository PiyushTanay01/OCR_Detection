// file: test.js
import 'dotenv/config';
import fetch from "node-fetch";

const API_KEY = process.env.GEMINI_API_KEY;

async function main() {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": API_KEY
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: "Hello from Gemini 2.0 via Node.js!" }]
        }
      ]
    })
  });

  const data = await response.json();
  console.log("✅ Gemini 2.0 response:", data);
}

main();
