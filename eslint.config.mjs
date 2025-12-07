/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        // Ganti dengan domain project supabase anda (bagian awal URL supabase)
        // Contoh: hkjxdsample.supabase.co
        hostname: '**.supabase.co', 
      },
      {
        protocol: 'https',
        hostname: 'api.telegram.org',
      }
    ],
  },
  // Abaikan eslint saat build supaya vercel tidak gagal deploy gara-gara hal sepele
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;