import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';

// Token diambil dari environment variable (nanti di-set di Vercel)
const token = process.env.TELEGRAM_BOT_TOKEN;

// Inisialisasi bot
// polling: false sangat PENTING karena kita pakai webhook (serverless)
const bot = token ? new TelegramBot(token, { polling: false }) : null;

export async function POST(req) {
    if (!bot) {
        return NextResponse.json({ error: 'Bot token not found' }, { status: 500 });
    }

    try {
        // Parse data pesan yang dikirim Telegram
        const body = await req.json();

        // Cek apakah ada pesan (message)
        if (body.message) {
            const chatId = body.message.chat.id;
            const text = body.message.text;

            // --- LOGIC BOT ANDA DI SINI ---
            
            // Contoh 1: Respon Command /start
            if (text === '/start') {
                await bot.sendMessage(chatId, 'Halo! Bot Next.js siap digunakan.');
            } 
            // Contoh 2: Echo (Balas pesan apapun selain command)
            else if (text) {
                await bot.sendMessage(chatId, `Anda menulis: ${text}`);
            }
        }

        // Return OK ke Telegram agar tidak dikirim ulang
        return NextResponse.json({ status: 'ok' });

    } catch (error) {
        console.error('Error:', error);
        return NextResponse.json({ error: 'Error processing update' }, { status: 500 });
    }
}

// Handle method GET (opsional, cuma buat cek di browser kalau route aktif)
export async function GET() {
    return NextResponse.json({ status: 'Telegram Bot API is running' });
}