import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '@/lib/supabase';

// Setup Token
const token = process.env.TELEGRAM_BOT_TOKEN;
// Polling false karena kita pakai Webhook (Vercel)
const bot = token ? new TelegramBot(token, { polling: false }) : null;

// Konfigurasi Nomor Rekening (Bisa juga diambil dari DB store_settings nanti)
const BANK_INFO = {
    bankName: "BCA",
    accNumber: "12345678",
    accName: "Admin Toko"
};

export async function POST(req) {
    if (!bot) return NextResponse.json({ error: 'No Token' });

    try {
        const body = await req.json();

        // 1. Handle Pesan Teks
        if (body.message?.text) {
            await handleTextMessage(body.message);
        }
        // 2. Handle Gambar (Bukti Transfer)
        else if (body.message?.photo) {
            await handlePhotoMessage(body.message);
        }

        return NextResponse.json({ status: 'ok' });
    } catch (error) {
        console.error('Main Error:', error);
        return NextResponse.json({ status: 'error', message: error.message });
    }
}

// ==========================================
// 🧠 LOGIC HANDLER (DENGAN TAMPILAN PRO)
// ==========================================

async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const username = msg.from.username || 'TanpaNama';
    const firstName = msg.from.first_name || 'Kak';

    // 1. Simpan/Update User ke DB
    // Penting: Cegah error Foreign Key saat insert order
    await supabase.from('users').upsert({
        telegram_id: chatId,
        username: username,
        full_name: `${firstName} ${msg.from.last_name || ''}`.trim()
    });

    // ------------------------------------------
    // A. Command: /start
    // ------------------------------------------
    if (text === '/start') {
        const welcomeMsg = `
👋 <b>Halo, ${firstName}!</b>

Selamat datang di <b>PremiumApp Store</b> 💎
Marketplace aplikasi premium terpercaya, cepat, dan bergaransi.

Apa yang ingin Anda cari hari ini?

🛒 <b>Menu Utama:</b>
/katalog - Lihat Daftar Produk
/status - Cek Status Pesanan Anda
/bantuan - Hubungi Admin
`;
        await bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'HTML' });
    }

    // ------------------------------------------
    // B. Command: /katalog
    // ------------------------------------------
    else if (text === '/katalog') {
        // Ambil produk aktif dari Supabase
        const { data: products } = await supabase
            .from('products')
            .select('*')
            .eq('is_active', true)
            .order('price', { ascending: true }); // Urutkan termurah

        if (!products || products.length === 0) {
            return bot.sendMessage(chatId, "🙏 Mohon maaf, stok produk sedang kosong.");
        }

        // Header Katalog
        let reply = "🛍️ <b>KATALOG PRODUK PREMIUM</b>\n";
        reply += "<i>Klik perintah di bawah untuk membeli</i>\n\n";

        // Looping Produk
        products.forEach((p) => {
            // Format Rupiah
            const price = new Intl.NumberFormat('id-ID').format(p.price);

            reply += `➖➖➖➖➖➖➖➖➖➖\n`;
            reply += `🔥 <b>${p.name.toUpperCase()}</b>\n`;
            reply += `🏷️ <b>Rp ${price}</b> / ${p.unit}\n`;
            reply += `📂 <i>${p.software_type}</i>\n\n`;
            
            // Tampilkan deskripsi jika ada
            if(p.description) {
                reply += `📝 ${p.description}\n`;
            }
            
            reply += `\n🛒 <b>Beli Sekarang:</b>\n/beli_${p.id}\n`;
        });
        
        reply += `➖➖➖➖➖➖➖➖➖➖`;

        await bot.sendMessage(chatId, reply, { parse_mode: 'HTML' });
    }

    // ------------------------------------------
    // C. Command: /beli_ID
    // ------------------------------------------
    else if (text.startsWith('/beli_')) {
        const productId = text.split('_')[1];

        // 1. Ambil Data Produk
        const { data: product } = await supabase
            .from('products')
            .select('*')
            .eq('id', productId)
            .single();

        if (!product) return bot.sendMessage(chatId, "⚠️ Produk tidak valid atau sudah dihapus.");

        // 2. Buat Order (Status: Pending)
        const { data: order, error } = await supabase.from('orders').insert({
            user_id: chatId,
            product_id: productId,
            total_price: product.price,
            status: 'pending'
        }).select().single();

        if (error) {
            console.error(error);
            return bot.sendMessage(chatId, "⚠️ Gagal membuat pesanan. Silakan coba lagi.");
        }

        const price = new Intl.NumberFormat('id-ID').format(product.price);

        // 3. Pesan Invoice & Instruksi Transfer (UX: Tap to Copy)
        const invoiceMsg = `
🧾 <b>TAGIHAN PEMBAYARAN</b>
<b>Order ID:</b> #${order.id}

📦 <b>Item:</b> ${product.name}
💰 <b>Total:</b> Rp ${price}
────────────────────

💳 <b>Metode Pembayaran:</b>
Silakan transfer ke rekening berikut:

<b>BANK ${BANK_INFO.bankName}</b>
<code class="language-text">${BANK_INFO.accNumber}</code>
A.N <b>${BANK_INFO.accName}</b>

<i>(Klik angka di atas untuk menyalin)</i>

────────────────────
📸 <b>LANGKAH SELANJUTNYA:</b>
Mohon <b>kirim FOTO/SCREENSHOT</b> bukti transfer di sini sekarang agar sistem memproses otomatis.
`;
        await bot.sendMessage(chatId, invoiceMsg, { parse_mode: 'HTML' });
    }
    
    // Default reply jika chat tidak dikenal
    else if (!text.startsWith('/')) {
       // Opsional: Echo atau diam
    }
}


// ------------------------------------------
// 🖼️ HANDLE PHOTO (BUKTI TRANSFER)
// ------------------------------------------
async function handlePhotoMessage(msg) {
    const chatId = msg.chat.id;

    // 1. Cari Order PENDING milik user ini
    // (Ambil yang paling baru dibuat)
    const { data: pendingOrder } = await supabase
        .from('orders')
        .select('*, products(name)')
        .eq('user_id', chatId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!pendingOrder) {
        return bot.sendMessage(chatId, "❌ <b>Maaf!</b>\nSaya tidak menemukan pesanan yang menunggu pembayaran. Silakan order ulang lewat /katalog.", {parse_mode:'HTML'});
    }

    // Informasi Proses
    const waitMsg = await bot.sendMessage(chatId, "⏳ <i>Mengupload bukti transfer...</i>", {parse_mode: 'HTML'});

    try {
        // 2. Ambil ID File Foto Terbesar
        const photo = msg.photo[msg.photo.length - 1];
        const fileId = photo.file_id;

        // 3. Dapatkan Link & Download Blob
        const fileLink = await bot.getFileLink(fileId);
        const imageRes = await fetch(fileLink);
        const imageBlob = await imageRes.blob();
        
        // 4. Buat nama file unik
        const timestamp = Date.now();
        const fileName = `proof_${pendingOrder.id}_${timestamp}.jpg`;

        // 5. Upload ke Supabase
        const { error: uploadError } = await supabase
            .storage
            .from('payment-proofs')
            .upload(fileName, imageBlob, { contentType: 'image/jpeg' });

        if (uploadError) throw uploadError;

        // 6. Ambil URL Publik
        const { data: { publicUrl } } = supabase.storage
            .from('payment-proofs')
            .getPublicUrl(fileName);

        // 7. Update Database: Set Paid & Simpan URL
        const { error: dbError } = await supabase
            .from('orders')
            .update({
                payment_proof_url: publicUrl,
                status: 'paid'
            })
            .eq('id', pendingOrder.id);

        if (dbError) throw dbError;

        // 8. Sukses! Hapus pesan loading & kirim konfirmasi
        await bot.deleteMessage(chatId, waitMsg.message_id);

        const successMsg = `
✅ <b>PEMBAYARAN DITERIMA!</b>
Terima kasih, bukti transfer berhasil diupload.

📋 <b>Info Pesanan:</b>
Order ID: #${pendingOrder.id}
Item: ${pendingOrder.products?.name}

👮‍♂️ <b>Status: Verifikasi Admin</b>
Mohon tunggu sebentar, Admin akan segera mengecek dan mengirimkan akun Premium Anda ke chat ini.

(Estimasi proses: 1-10 menit saat jam kerja)
        `;
        
        await bot.sendMessage(chatId, successMsg, { parse_mode: 'HTML' });

        // Opsional: Notifikasi ke Grup Admin jika punya (bot.sendMessage(ADMIN_GROUP_ID, ...))

    } catch (err) {
        console.error('Upload Error:', err);
        await bot.deleteMessage(chatId, waitMsg.message_id);
        await bot.sendMessage(chatId, "⚠️ <b>Gagal Upload</b>\nTerjadi kesalahan sistem. Mohon kirim ulang fotonya.", {parse_mode: 'HTML'});
    }
}