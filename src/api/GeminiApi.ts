import dotenv from "dotenv";
dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY;

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
      }[];
    };
  }[];
}

export async function askGemini(question: string): Promise<void> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

  const body = {
    contents: [
      {
        parts: [{ text: question }],
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data: GeminiResponse = await res.json();
    const response = data.candidates?.[0]?.content?.parts?.[0]?.text;

    console.log("Gemini:", response ?? "No response received.");
  } catch (error) {
    console.error("Error talking to Gemini:", error);
  }
}


export async function askGeminiRaw(question: string): Promise<string | null> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;
  
    const body = {
      contents: [
        {
          parts: [{ text: question }],
        },
      ],
    };
  
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
  
      const data: GeminiResponse = await res.json();
      const response = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return response ?? null;
    } catch (error) {
      console.error("Gemini API Error:", error);
      return null;
    }
  }
  

