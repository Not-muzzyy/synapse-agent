import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

function buildSystemPrompt(isHindi: boolean): string {
  return `You are Synapse, an AI study companion.
ROLE: You are an extremely concise, highly knowledgeable, and deeply adaptive tutor.

CRITICAL INSTRUCTION FOR YOUR VERY FIRST MESSAGE:
If the user's message history is empty, you MUST respond exactly with: "Hey, this is Synapse. What subject do you want to dive into today?" (or the Hindi equivalent if Hindi is selected).

VOICE & TEXT RULES (CRITICAL):
- Keep responses concise (ideally under 30-40 words) to prevent overwhelming the student.
- Do NOT use bullet points, numbered lists, or markdown formatting since the user might be listening via voice.
- Be honest: If you don't know something, say "I don't know" instead of hallucinating.
- Adapt your teaching style: Analyze how the user wants to study (e.g., direct answers, step-by-step, or Socratic method) and match their preferred style.

SUBJECTS: You are a generalist. You can help with Math, Science, History, Coding, Languages, and more.

QUIT RULE (CRITICAL):
If the student says they are done studying, want to end the session, or say goodbye, you MUST output ONLY a valid JSON object in this format (and NO other text):
{"session_complete": true, "message": "Great study session today! Let me know when you're ready to learn again."}

${isHindi ? 'LANGUAGE: Speak ONLY in natural conversational Hindi (Devanagari script). Be encouraging and supportive.' : 'LANGUAGE: Speak ONLY in natural English. Be encouraging and supportive.'}`;
}

export async function POST(req: Request) {
  try {
    const { messages, language, sessionId } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Messages array is required' },
        { status: 400 }
      );
    }

    const isHindi = language === 'hi';
    const systemPrompt = buildSystemPrompt(isHindi);

    const MAX_HISTORY = 12;
    let contextMessages = messages;
    if (messages.length > MAX_HISTORY) {
      contextMessages = [
        messages[0], 
        messages[1], 
        ...messages.slice(-(MAX_HISTORY - 2))
      ];
    }

    const allMessages = [
      { role: 'system', content: systemPrompt },
      ...contextMessages,
    ];

    const stream = await groq.chat.completions.create({
      messages: allMessages as any,
      model: 'llama-3.1-8b-instant',
      temperature: 0.7,
      max_tokens: 150,
      stream: true,
    });

    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            controller.enqueue(new TextEncoder().encode(content));
          }
        }
        controller.close();
      }
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache',
      }
    });
  } catch (error: any) {
    console.error('Error in chat route:', error);
    return NextResponse.json(
      { error: error.message || 'Something went wrong' },
      { status: 500 }
    );
  }
}
