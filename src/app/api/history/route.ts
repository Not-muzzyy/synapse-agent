import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'study_sessions.json');
    let existingData = [];
    
    try {
      const fileContent = await fs.readFile(filePath, 'utf8');
      existingData = JSON.parse(fileContent);
    } catch (readErr) {
      // File doesn't exist or is empty, return empty array
      return NextResponse.json({ sessions: [] });
    }

    // Sort by timestamp descending (newest first)
    existingData.sort((a: any, b: any) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    return NextResponse.json({ sessions: existingData });
  } catch (error: any) {
    console.error('Error fetching history:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}
