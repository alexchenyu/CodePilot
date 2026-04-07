import { NextResponse } from 'next/server';
import { fetchCliModels } from '@/lib/cli-models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const models = await fetchCliModels();

    if (!models) {
      return NextResponse.json(
        { error: 'Cursor Agent CLI not found' },
        { status: 503 },
      );
    }

    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch models';
    console.error('[GET /api/models]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
