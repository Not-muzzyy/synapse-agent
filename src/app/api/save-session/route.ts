import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import Groq from 'groq-sdk';
import { studySessionMutex } from '@/utils/mutex';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { messages, sessionId } = await req.json();

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'No messages to save' }, { status: 400 });
    }

    const sessionData: any = {
      timestamp: new Date().toISOString(),
      transcript: messages,
    };

    // Generate Session Summary
    let summary = "Session saved manually. Review your notes and come back anytime.";
    try {
      const summaryCompletion = await groq.chat.completions.create({
        messages: [
          ...messages,
          { role: 'system', content: 'The study session was exited early by the user. Write a short, encouraging 2-3 sentence recap of what the student learned so far. Do not use markdown formatting.' }
        ] as any,
        model: 'llama-3.1-8b-instant',
        temperature: 0.5,
        max_tokens: 150,
      });
      if (summaryCompletion.choices[0]?.message?.content) {
        summary = summaryCompletion.choices[0].message.content;
      }
    } catch (sumErr) {
      console.error('Failed to generate summary on manual save', sumErr);
    }

    sessionData.summary = summary;

    console.log('\n=== SESSION SAVED (MANUAL EXIT) ===');
    console.log(JSON.stringify(sessionData, null, 2));
    console.log('===================================\n');

    // Persist to study_sessions.json safely with a lock
    await studySessionMutex.runExclusive(async () => {
      try {
        const filePath = path.join(process.cwd(), 'study_sessions.json');
        let existingData = [];
        try {
          const fileContent = await fs.readFile(filePath, 'utf8');
          existingData = JSON.parse(fileContent);
        } catch (readErr) {
          // File doesn't exist yet
        }
        
        sessionData.id = sessionId;
        const existingIndex = existingData.findIndex((s: any) => s.id === sessionId || (!s.id && s.timestamp === sessionId));
        if (existingIndex !== -1) {
          existingData[existingIndex] = sessionData;
        } else {
          existingData.push(sessionData);
        }
        
        await fs.writeFile(filePath, JSON.stringify(existingData, null, 2));
      } catch (fsErr) {
        console.error('Failed to write study_sessions.json', fsErr);
      }
    });

    return NextResponse.json({ success: true, summary });
  } catch (error: any) {
    console.error('Error in save-session route:', error);
    return NextResponse.json({ error: error.message || 'Something went wrong' }, { status: 500 });
  }
}
