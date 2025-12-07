import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '@/lib/supabase';

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

export async function POST(req) {
  try {
    const { orderId, telegramId, accountCredentials } = await req.json();

    console.log(`Processing Order ID: ${orderId} for User: ${telegramId}`);

    // --- LANGKAH 1: UPDATE DATABASE (PRIORITAS UTAMA) ---
    const { error: dbError } = await supabase
      .from('orders')
      .update({ 
        status: 'completed', 
        admin_notes: accountCredentials 
      })
      .eq('id', orderId);

    if (dbError) {
      console.error("Database Error:", dbError);
      return NextResponse.json({ success: false, error: dbError.message }, { status: 500 });
    }

    // --- LANGKAH 2: KIRIM NOTIFIKASI KE TELEGRAM (OPSIONAL) ---
    // Kita bungkus try-catch tersendiri, supaya kalau gagal kirim pesan, 
    // status order TETAP dianggap sukses (completed).
    if (bot && telegramId) {
      try {
        const message = `
✅ **PESANAN SELESAI!**

Terima kasih sudah menunggu. Berikut detail pesanan Anda:

📦 **Info Akun / Kode Voucher:**
\`${accountCredentials}\`

(Klik teks di atas untuk menyalin)

Jangan lupa order lagi ya! ⭐
        `;
        await bot.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
        console.log("Telegram notification sent.");
      } catch (botError) {
        console.error("Gagal kirim pesan Telegram (mungkin user block bot):", botError.message);
        // Kita tidak throw error di sini, agar frontend tetap menerima success
      }
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("General Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}