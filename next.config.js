/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  images: {
    domains: [
      'avatars.githubusercontent.com',
      'oepdvanqkqvacmcqdkxe.supabase.co',
      'media.tenor.com'
    ],
  },
  // Ensure proper output for production
  output: 'standalone'
}

module.exports = nextConfig 