import { NextResponse } from 'next/server';
import { analyzeSyntheticLogs } from '@/lib/syntheticLogs';

const ALLOWED_WINDOWS = new Set([5, 10, 30]);

export async function POST(request: Request) {
  const body = await parseRequest(request);
  const minutes = typeof body.minutes === 'number' ? body.minutes : Number(body.minutes);
  const window = ALLOWED_WINDOWS.has(minutes) ? minutes : 10;
  const payload = analyzeSyntheticLogs(window);
  return NextResponse.json(payload);
}

const parseRequest = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    return await request.json();
  } catch (error) {
    return {};
  }
};
