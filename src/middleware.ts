import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, hashPassword } from '@/lib/auth';

function isAuthEnabled(): boolean {
  return !!process.env.ACCESS_PASSWORD;
}

function verifyToken(token: string): boolean {
  const password = process.env.ACCESS_PASSWORD || '';
  return token === hashPassword(password);
}

export function middleware(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Allow the login page and login API through
  if (pathname === '/login' || pathname === '/api/auth/login') {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg')
  ) {
    return NextResponse.next();
  }

  // Check auth cookie
  const authCookie = request.cookies.get(COOKIE_NAME);
  if (authCookie && verifyToken(authCookie.value)) {
    return NextResponse.next();
  }

  // API requests get 401
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Redirect to login page
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirect', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image).*)',
  ],
};
