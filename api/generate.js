/* global process */
import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, userText, editorCode, language, customKey } = req.body;
  
  // Use the user's custom key if provided, otherwise fallback to the system key
  const apiKey = customKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ 
      error: 'API key missing', 
      code: 'MISSING_KEY' 
    });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: `You are NexIDE AI, an expert programming assistant embedded in a browser-based code editor. 
You help users write, debug, explain, and improve their code. 
When the user shares their code, analyze it carefully and provide specific, actionable help.`
    });

    // We emulate a stream for the frontend or just return the full response for simplicity
    // since Vercel Serverless (non-Edge) functions have a 10s default timeout
    const contextMessage = editorCode
      ? `\n\n[Current editor code (${language})]:\n\`\`\`${language}\n${editorCode}\n\`\`\``
      : '';

    const chat = model.startChat({
      history: messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    });

    const result = await chat.sendMessage(userText + contextMessage);
    const responseText = result.response.text();

    return res.status(200).json({ text: responseText });

  } catch (error) {
    console.error('Gemini API Error:', error);
    
    // Check for 429 quota exhaustion specifically
    if (error.status === 429 || error.message?.includes('429')) {
      return res.status(429).json({
        error: 'System API limit reached.',
        code: 'LIMIT_EXCEEDED'
      });
    }

    return res.status(500).json({ error: 'Failed to generate response' });
  }
}
