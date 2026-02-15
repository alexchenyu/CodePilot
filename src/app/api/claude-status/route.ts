import { NextResponse } from 'next/server';
import { findAgentBinary, getAgentVersion } from '@/lib/platform';

export async function GET() {
  try {
    const agentPath = findAgentBinary();
    if (!agentPath) {
      return NextResponse.json({ connected: false, version: null });
    }
    const version = await getAgentVersion(agentPath);
    return NextResponse.json({ connected: !!version, version });
  } catch {
    return NextResponse.json({ connected: false, version: null });
  }
}
