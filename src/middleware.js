import { NextResponse } from 'next/server';

export function middleware(req) {
  // Hanya kunci folder yang berawalan /admin
  if (req.nextUrl.pathname.startsWith('/admin')) {
    const basicAuth = req.headers.get('authorization');

    if (basicAuth) {
      // Decode user:password base64
      const authValue = basicAuth.split(' ')[1];
      const [user, pwd] = atob(authValue).split(':');

      // GANTI PASSWORD DAN USERNAME SESUAI KEINGINAN DI ENVIRONMENT VARIABLE
      // Atau hardcode di sini untuk sementara
      const validUser = process.env.ADMIN_USERNAME || 'admin';
      const validPass = process.env.ADMIN_PASSWORD || 'rahasia123';

      if (user === validUser && pwd === validPass) {
        return NextResponse.next();
      }
    }

    // Jika gagal login atau belum login
    return new NextResponse('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Secure Admin Area"',
      },
    });
  }

  return NextResponse.next();
}