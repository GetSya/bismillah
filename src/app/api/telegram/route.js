import TelegramBot from 'node-telegram-bot-api';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase'; // Sesuaikan path import

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminId = process.env.ADMIN_ID; // Opsional: untuk notifikasi ke admin
const bot = new TelegramBot(token, { polling: false });

export async function POST(req) {
  try {
    const body = await req.json();

    // 1. Validasi pesan teks
    if (body.message && body.message.text) {
      const { chat, text, message_id } = body.message;
      const telegramId = chat.id;
      const firstName = chat.first_name || 'No Name';
      const username = chat.username || '';

      console.log(`[Pesan Masuk] ${firstName}: ${text}`);

      // --- LOGIKA SUPABASE ---

      // A. UPSERT USER
      // Kita simpan/update data user dulu agar tidak error Foreign Key
      const { error: userError } = await supabase
        .from('users')
        .upsert({
          telegram_id: telegramId,
          first_name: firstName,
          username: username
        }, { onConflict: 'telegram_id' });

      if (userError) {
        console.error('Error upsert user:', userError);
        // Lanjut saja, mungkin user sudah ada
      }

      // B. GET ATAU CREATE CHAT ROOM
      // Cek apakah room sudah ada untuk user ini
      let { data: room, error: roomError } = await supabase
        .from('chat_rooms')
        .select('id')
        .eq('user_id', telegramId)
        .single();

      // Jika room belum ada, buat baru
      if (!room) {
        const { data: newRoom, error: createRoomError } = await supabase
          .from('chat_rooms')
          .insert({ user_id: telegramId })
          .select()
          .single();
        
        if (createRoomError) throw createRoomError;
        room = newRoom;
      }

      // C. INSERT MESSAGE
      const { error: msgError } = await supabase
        .from('chat_messages')
        .insert({
          room_id: room.id,
          is_admin: false, // Karena ini pesan dari customer
          message_type: 'text',
          content: text,
          is_read: false
        });

      if (msgError) throw msgError;

      // --- END LOGIKA SUPABASE ---

      // (Opsional) Notifikasi ke Admin via Telegram kalau ada chat baru
      // if (adminId) {
      //   await bot.sendMessage(adminId, `📩 Pesan baru dari ${firstName}: \n"${text}"`);
      // }
      
      // (Opsional) Balasan otomatis ke User (Bot tidak boleh diam saja)
      // await bot.sendMessage(telegramId, 'Pesan diterima, admin akan segera membalas.');
    }

    return NextResponse.json({ message: 'Success' }, { status: 200 });
  } catch (error) {
    console.error('Error handling webhook:', error);
    // Tetap return 200 agar Telegram tidak spam retry jika error di sisi kita
    return NextResponse.json({ message: 'Error processed' }, { status: 200 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Active' });
}
