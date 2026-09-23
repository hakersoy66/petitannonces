import { NextResponse } from 'next/server';

export function GET(request: Request) {
  return NextResponse.redirect(new URL('/downloads/petitannonces-android-test.apk', request.url), { status: 302 });
}

