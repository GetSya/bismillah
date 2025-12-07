import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '@/lib/supabase';

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

export async function POST(req) {
    if (!bot) return NextResponse.json({ error: 'No Token' });

    try {
        const body = await req.json();
        
        // Handle Pesan Teks
        if (body.message?.text) {
            await handleTextMessage(body.message);
        } 
        // Handle Gambar (Bukti Transfer)
        else if (body.message?.photo) {
            await handlePhotoMessage(body.message);
        }

        return NextResponse.json({ status: 'ok' });
    } catch (error) {
        console.error('Error:', error);
        return NextResponse.json({ status: 'error' });
    }
}

// --- LOGIC HANDLER ---

async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const username = msg.from.username;

    // 1. Simpan/Update User ke DB
    await supabase.from('users').upsert({
        telegram_id: chatId,
        username: username,
        full_name: `${msg.from.first_name} ${msg.from.last_name || ''}`
    });

    // 2. Command: /start
    if (text === '/start') {
        await bot.sendMessage(chatId, 
            "Selamat datang di PremiumApp Store! 🛒\n\nKetik /katalog untuk melihat produk."
        );
    }

    // 3. Command: /katalog
    else if (text === '/katalog') {
        const { data: products } = await supabase.from('products').select('*').eq('is_active', true);
        
        if (!products || products.length === 0) {
            return bot.sendMessage(chatId, "Belum ada produk tersedia.");
        }

        let reply = "📦 **LIST APLIKASI PREMIUM** 📦\n\n";
        products.forEach((p) => {
            reply += `🔹 **${p.name}**\n`;
            reply += `💰 Rp ${p.price.toLocaleString()} / ${p.unit}\n`;
            reply += `📂 ${p.software_type}\n`;
            reply += `📝 ${p.description}\n`;
            reply += `👉 Cara Beli: Ketik /beli_${p.id}\n\n`;
        });
        
        await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    }

    // 4. Command: /beli_ID (Contoh: /beli_1)
    else if (text.startsWith('/beli_')) {
        const productId = text.split('_')[1];
        
        // Cek Produk
        const { data: product } = await supabase.from('products').select('*').eq('id', productId).single();
        
        if (!product) return bot.sendMessage(chatId, "Produk tidak ditemukan.");

        // Buat Order Baru (Status: Pending)
        const { data: order, error } = await supabase.from('orders').insert({
            user_id: chatId,
            product_id: productId,
            total_price: product.price,
            status: 'pending'
        }).select().single();

        if (error) return bot.sendMessage(chatId, "Gagal membuat pesanan.");

        await bot.sendMessage(chatId, 
            `✅ **Order Dibuat!**\n\nProduk: ${product.name}\nHarga: Rp ${product.price}\n\nSilakan transfer ke BCA 12345678 a/n Admin.\n\n📸 **PENTING:** Kirim FOTO bukti transfer di sini sekarang juga untuk diproses.`
        );
    }
}

async function handlePhotoMessage(msg) {
    const chatId = msg.chat.id;

    // 1. Cek apakah user punya order status 'pending'
    const { data: pendingOrder } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', chatId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!pendingOrder) {
        return bot.sendMessage(chatId, "Anda tidak memiliki pesanan pending. Silakan order dulu.");
    }

    // 2. Ambil File ID foto resolusi tertinggi (index terakhir)
    const photo = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;

    // 3. Dapatkan Link Download dari Telegram
    const fileLink = await bot.getFileLink(fileId);

    // 4. Upload ke Supabase Storage (Teknik Fetch Blob)
    const imageRes = await fetch(fileLink);
    const imageBlob = await imageRes.blob();
    const fileName = `proof_${pendingOrder.id}_${Date.now()}.jpg`;

    const { data: uploadData, error: uploadError } = await supabase
        .storage
        .from('payment-proofs')
        .upload(fileName, imageBlob, { contentType: 'image/jpeg' });

    if (uploadError) {
        return bot.sendMessage(chatId, "Gagal upload gambar. Coba lagi.");
    }

    // 5. Dapatkan Public URL
    const { data: { publicUrl } } = supabase.storage.from('payment-proofs').getPublicUrl(fileName);

    // 6. Update Order dengan URL Bukti & Ubah Status jadi 'paid'
    await supabase.from('orders').update({
        payment_proof_url: publicUrl,
        status: 'paid'
    }).eq('id', pendingOrder.id);

    await bot.sendMessage(chatId, "✅ Bukti transfer diterima! Admin akan segera memverifikasi dan mengirimkan akun Anda.");
}