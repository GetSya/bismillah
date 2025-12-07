import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '@/lib/supabase';

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

export async function POST(req) {
  try {
    const { orderId, telegramId, accountCredentials } = await req.json();

    // 1. Update Status Order di Database
    const { error } = await supabase
      .from('orders')
      .update({ 
        status: 'completed', 
        admin_notes: accountCredentials 
      })
      .eq('id', orderId);

    if (error) throw error;

    // 2. Kirim Pesan ke Telegram User
    const message = `
✅ **PESANAN SELESAI!**

Terima kasih sudah menunggu. Berikut detail pesanan Anda:

📦 **Info Akun / Kode Voucher:**
\`${accountCredentials}\`

(Klik teks di atas untuk menyalin)

Jangan lupa order lagi ya! ⭐
    `;

    await bot.sendMessage(telegramId, message, { parse_mode: 'Markdown' });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Gagal memproses order' }, { status: 500 });
  }
}