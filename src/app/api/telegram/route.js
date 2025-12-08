import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '@/lib/supabase';

// ==========================================
// ⚙️ KONFIGURASI
// ==========================================
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

// Ganti URL ini dengan Link Gambar Logo Toko Anda
const LOGO_URL = 'https://i.imgur.com/LdOpxjJ.png'; 

const BANK_INFO = {
    bankName: "BCA",
    accNumber: "12345678",
    accName: "Admin Toko"
};

// Jumlah produk per halaman katalog
const ITEMS_PER_PAGE = 10;

// ==========================================
// 🚀 MAIN HANDLER (WEBHOOK)
// ==========================================
export async function POST(req) {
    if (!bot) return NextResponse.json({ error: 'No Token' });

    try {
        const body = await req.json();

        // 1. Handle Callback Query (Tombol Next/Prev Katalog)
        if (body.callback_query) {
            await handleCallbackQuery(body.callback_query);
        }
        // 2. Handle Pesan Teks
        else if (body.message?.text) {
            await handleTextMessage(body.message);
        }
        // 3. Handle Gambar (Bukti Transfer)
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
// 🧠 LOGIC HANDLER
// ==========================================

async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const username = msg.from.username || 'TanpaNama';
    const firstName = msg.from.first_name || 'Kak';

    // Update User ke DB
    await supabase.from('users').upsert({
        telegram_id: chatId,
        username: username,
        full_name: `${firstName} ${msg.from.last_name || ''}`.trim()
    });

    // ------------------------------------------
    // A. Command: /start (TAMPILAN UTAMA LENGKAP)
    // ------------------------------------------
    if (text === '/start') {
        const caption = `
👋 <b>Halo, ${firstName}!</b>
Selamat datang di <b>PremiumApp Store</b> 💎

╭───────────────────────╮
│  <b>PUSAT APLIKASI PREMIUM</b>  │
╰───────────────────────╯
Kami menyediakan akun premium legal, bergaransi, dan proses cepat.

📚 <b>PANDUAN PENGGUNAAN:</b>
1. Ketik /katalog untuk melihat produk.
2. Pilih produk yang diinginkan.
3. Lakukan transfer sesuai nominal.
4. Kirim bukti transfer (Screenshot) di sini.
5. Tunggu admin memproses akun Anda.

💳 <b>INFO PEMBAYARAN:</b>
Transfer hanya ke rekening resmi:
• <b>${BANK_INFO.bankName}:</b> <code>${BANK_INFO.accNumber}</code>
• <b>A.N:</b> ${BANK_INFO.accName}

ℹ️ <b>ABOUT US:</b>
• Jam Operasional: 08.00 - 22.00 WIB
• Garansi: Full Garansi (S&K Berlaku)

👇 <b>MULAI BELANJA:</b>
Silakan ketik /katalog atau klik menu di bawah.
`;
        
        // Mengirim Gambar Logo + Caption
        await bot.sendPhoto(chatId, LOGO_URL, {
            caption: caption,
            parse_mode: 'HTML'
        });
    }

    // ------------------------------------------
    // B. Command: /katalog (STYLE KARTU / BOX)
    // ------------------------------------------
    else if (text === '/katalog') {
        await sendCatalog(chatId, 1);
    }

    // ------------------------------------------
    // C. Command: /beli_ID
    // ------------------------------------------
    else if (text.startsWith('/beli_')) {
        await handleBuyCommand(chatId, text);
    }
}

// ==========================================
// 📦 KATALOG HANDLER (BOX STYLE)
// ==========================================

async function sendCatalog(chatId, page) {
    // 1. Ambil semua produk aktif
    const { data: products, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });

    if (!products || products.length === 0) {
        return bot.sendMessage(chatId, "🙏 Stok produk sedang kosong.");
    }

    // 2. Hitung Pagination
    const totalProducts = products.length;
    const totalPages = Math.ceil(totalProducts / ITEMS_PER_PAGE);
    
    // Pastikan page valid
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;

    const startIdx = (page - 1) * ITEMS_PER_PAGE;
    const endIdx = startIdx + ITEMS_PER_PAGE;
    const currentProducts = products.slice(startIdx, endIdx);

    // 3. Buat Tampilan BOX (ASCII ART)
    // Menggunakan tag <code> agar font monospace dan rapi di HP
    let message = `<b>🛒 KATALOG PRODUK</b>\n`;
    message += `<i>Ketik /beli_ID untuk memesan</i>\n\n`;
    
    message += `<code class="language-text">`;
    message += `╭ - - - - - - - - - - - - - - - ╮\n`;
    message += `┊ LIST PRODUK\n`;
    message += `┊ page ${page} / ${totalPages}\n`;
    message += `┊- - - - - - - - - - - - - - - -\n`;

    currentProducts.forEach((p, index) => {
        // Nomor urut global (bukan per halaman)
        const globalNum = startIdx + index + 1;
        // Format harga K (ribuan) agar muat, cth: 15000 -> 15k
        const priceK = (p.price / 1000) + 'k'; 
        
        // Format baris: [ID] NAMA ... HARGA
        // Kita pakai ID database asli untuk command beli
        message += `┊ [${p.id}] ${p.name.padEnd(15).slice(0,15)} ${priceK}\n`;
    });

    message += `╰ - - - - - - - - - - - - - - - ╯`;
    message += `</code>\n\n`;
    message += `💡 <b>Cara Beli:</b>\nContoh ketik: <code>/beli_${currentProducts[0].id}</code>`;

    // 4. Buat Tombol Navigasi (Next/Prev)
    const keyboard = [];
    const row = [];
    
    if (page > 1) {
        row.push({ text: '⬅️ Prev', callback_data: `page_${page - 1}` });
    }
    if (page < totalPages) {
        row.push({ text: 'Next ➡️', callback_data: `page_${page + 1}` });
    }
    keyboard.push(row);

    // Kirim Pesan
    await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
    });
}

// Handle tombol Next/Prev agar pesan terupdate (editMessage)
async function handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (data.startsWith('page_')) {
        const page = parseInt(data.split('_')[1]);
        
        // Hapus pesan lama dan kirim baru (atau edit pesan)
        // Note: Mengedit pesan dengan format <code> kadang tricky di telegram bot node
        // Cara paling aman hapus lalu kirim baru agar posisi paling bawah
        
        await bot.deleteMessage(chatId, messageId);
        await sendCatalog(chatId, page);
    }
}

// ==========================================
// 🛒 BUY HANDLER
// ==========================================
async function handleBuyCommand(chatId, text) {
    const productId = text.split('_')[1];

    const { data: product } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .single();

    if (!product) return bot.sendMessage(chatId, "⚠️ Produk tidak valid.");

    // Insert Order
    const { data: order, error } = await supabase.from('orders').insert({
        user_id: chatId,
        product_id: productId,
        total_price: product.price,
        status: 'pending'
    }).select().single();

    if (error) return bot.sendMessage(chatId, "⚠️ Gagal membuat pesanan.");

    const price = new Intl.NumberFormat('id-ID').format(product.price);

    const invoiceMsg = `
╭ - - - - - - - - - - - - - - - ╮
┊ 🧾 <b>INVOICE #${order.id}</b>
┊- - - - - - - - - - - - - - - -
┊ <b>Item :</b> ${product.name}
┊ <b>Total:</b> Rp ${price}
╰ - - - - - - - - - - - - - - - ╯

💳 <b>Silakan Transfer ke:</b>
<b>${BANK_INFO.bankName}</b>
<code>${BANK_INFO.accNumber}</code>
A.N ${BANK_INFO.accName}

📸 <b>PENTING:</b>
Setelah transfer, <b>Kirim FOTO bukti transfer</b> di sini agar diproses otomatis.
`;
    await bot.sendMessage(chatId, invoiceMsg, { parse_mode: 'HTML' });
}

// ==========================================
// 🖼️ PHOTO HANDLER (Sama seperti sebelumnya)
// ==========================================
async function handlePhotoMessage(msg) {
    const chatId = msg.chat.id;

    // Cari order pending terakhir
    const { data: pendingOrder } = await supabase
        .from('orders')
        .select('*, products(name)')
        .eq('user_id', chatId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!pendingOrder) {
        return bot.sendMessage(chatId, "❌ Tidak ada pesanan menunggu pembayaran. Silakan order ulang /katalog.");
    }

    const waitMsg = await bot.sendMessage(chatId, "⏳ <i>Mengupload bukti...</i>", {parse_mode: 'HTML'});

    try {
        const photo = msg.photo[msg.photo.length - 1];
        const fileLink = await bot.getFileLink(photo.file_id);
        const imageRes = await fetch(fileLink);
        const imageBlob = await imageRes.blob();
        
        const fileName = `proof_${pendingOrder.id}_${Date.now()}.jpg`;

        // Upload Supabase
        const { error: uploadError } = await supabase.storage
            .from('payment-proofs')
            .upload(fileName, imageBlob, { contentType: 'image/jpeg' });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
            .from('payment-proofs')
            .getPublicUrl(fileName);

        // Update DB
        await supabase.from('orders').update({
            payment_proof_url: publicUrl,
            status: 'paid' // Atau 'verification' tergantung flow
        }).eq('id', pendingOrder.id);

        await bot.deleteMessage(chatId, waitMsg.message_id);

        await bot.sendMessage(chatId, `
✅ <b>BUKTI DITERIMA</b>
Order #${pendingOrder.id} (${pendingOrder.products?.name})

Mohon tunggu admin memverifikasi pembayaran Anda.
`, { parse_mode: 'HTML' });

    } catch (err) {
        console.error(err);
        await bot.deleteMessage(chatId, waitMsg.message_id);
        await bot.sendMessage(chatId, "⚠️ Gagal upload bukti. Coba lagi.");
    }
}