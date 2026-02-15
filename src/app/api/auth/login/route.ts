import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, COOKIE_MAX_AGE, hashPassword } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const password = process.env.ACCESS_PASSWORD;
  if (!password) {
    return NextResponse.json({ error: 'Auth not enabled' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const inputPassword = body.password as string;

    if (!inputPassword || inputPassword !== password) {
      return NextResponse.json({ error: 'Wrong password' }, { status: 403 });
    }

    const token = hashPassword(password);
    const response = NextResponse.json({ ok: true });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: request.nextUrl.protocol === 'https:',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });

    return response;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
