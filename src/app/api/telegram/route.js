import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '@/lib/supabase';

// ==========================================
// ⚙️ SETUP & CONFIG
// ==========================================
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

// Ganti sesuai kebutuhan
const ADMIN_REKENING = { bank: "BCA", no: "123456789", name: "Admin Store" };

// Fungsi Membuat Keyboard Layout Grid Seperti Gambar
const createMainKeyboard = () => {
    // 1. Tombol Menu Atas
    const topRow = [
        { text: "🏷 List Produk" }, { text: "🛍 Voucher" }, { text: "📦 Laporan Stok" }
    ];

    // 2. Tombol Angka (Grid 1 s/d 30) - 6 angka per baris
    const numberGrid = [];
    let currentRow = [];
    for (let i = 1; i <= 30; i++) {
        currentRow.push({ text: `${i}` });
        // Jika sudah 6 angka, masukkan ke row baru
        if (currentRow.length === 6) {
            numberGrid.push(currentRow);
            currentRow = [];
        }
    }
    if (currentRow.length > 0) numberGrid.push(currentRow);

    // 3. Tombol Bawah
    const bottomRow = [
        { text: "💰 Deposit" }, { text: "❓ Cara" }, { text: "⚠️ Information" }
    ];

    return {
        keyboard: [
            topRow,
            ...numberGrid, // Spread angka ke tengah
            bottomRow
        ],
        resize_keyboard: true, // Agar keyboard pas di layar
        is_persistent: true,   // Agar keyboard tidak hilang saat diclick
        input_field_placeholder: "Pilih menu atau nomor..." 
    };
};


export async function POST(req) {
    if (!bot) return NextResponse.json({ error: 'Bot offline' });

    try {
        const body = await req.json();
        
        // Kita hanya fokus menangani pesan teks untuk tipe Keyboard ini
        if (body.message?.text) {
            await handleTextMessage(body.message);
        }
        else if (body.message?.photo) {
            await handlePhotoMessage(body.message);
        }

        return NextResponse.json({ status: 'ok' });
    } catch (error) {
        console.error('Error:', error);
        return NextResponse.json({ status: 'error' });
    }
}

// ==========================================
// 🧠 LOGIC UTAMA (MENU & ANGKA)
// ==========================================

async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text; // Text yang diklik user dari keyboard
    const firstName = msg.from.first_name || 'Kak';

    // -------------------------------------------
    // 1. HANDLER TOMBOL ANGKA (1, 2, 3...)
    // -------------------------------------------
    // Cek apakah text adalah angka (Integer)
    if (/^\d+$/.test(text)) {
        const selectedNumber = parseInt(text);
        await handleProductSelection(chatId, selectedNumber);
        return; 
    }

    // -------------------------------------------
    // 2. HANDLER MENU NAVIGATION
    // -------------------------------------------
    switch (text) {
        case '/start':
            const welcomeMsg = `
👋 <b>Selamat Datang, ${firstName}!</b>

Gunakan keyboard di bawah untuk belanja lebih cepat.
Klik <b>"🏷 List Produk"</b> untuk melihat menu.
`;
            await bot.sendMessage(chatId, welcomeMsg, {
                parse_mode: 'HTML',
                reply_markup: createMainKeyboard() // Memunculkan Keyboard Custom
            });
            break;

        case '🏷 List Produk':
            await showProductList(chatId);
            break;
        
        case '🛍 Voucher':
            await bot.sendMessage(chatId, "🔐 Menu Voucher (Redeem) belum tersedia.");
            break;
            
        case '📦 Laporan Stok':
             await bot.sendMessage(chatId, "📊 Semua stok produk saat ini <b>AMAN / READY</b>.", { parse_mode: 'HTML' });
             break;

        case '💰 Deposit':
            await bot.sendMessage(chatId, `💳 <b>Topup Saldo:</b>\nSilakan chat admin @AdminUser untuk deposit saldo manual.`, { parse_mode: 'HTML' });
            break;

        case '⚠️ Information':
            await bot.sendMessage(chatId, `ℹ️ <b>Store Info</b>\nJam Operasional: 09.00 - 23.00 WIB\nBot v2.0 (Fast Response)`);
            break;

        default:
             // Jika chat random masuk
             await bot.sendMessage(chatId, "🤔 Perintah tidak dikenali. Silakan gunakan tombol di bawah.", {
                reply_markup: createMainKeyboard()
             });
    }
}


// ==========================================
// 📄 LOGIC MENAMPILKAN DAFTAR (STYLE GAMBAR)
// ==========================================
async function showProductList(chatId) {
    // Ambil produk dari Database, urutkan agar ID/Index sesuai
    // Asumsi di DB produk sudah rapi, kita ambil max 30
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('id', { ascending: true }) // Atau pakai kolom khusus 'sort_order'
        .limit(30);

    if (!products || products.length === 0) {
        return bot.sendMessage(chatId, "Kosong bosku");
    }

    let message = `🛒 <b>DAFTAR HARGA UPDATE</b>\n`;
    message += `<i>Silakan klik angka di keyboard sesuai nomor produk.</i>\n\n`;

    products.forEach((p, index) => {
        // Kita gunakan 'index + 1' sebagai Nomor Keyboard (1, 2, 3...)
        // Jadi user klik '1' akan memilih produk pertama di array ini
        const itemNumber = index + 1;
        const price = new Intl.NumberFormat('id-ID').format(p.price);
        
        // --- STYLE TEXT SEPERTI GAMBAR ---
        message += `┊ <b>[${itemNumber}] ${p.name.toUpperCase()}</b>\n`;
        message += `┊ ↳ Rp ${price} • (Stok Ready)\n`;
        message += `┊ \n`; 
    });

    message += `╰───────────────────────◊`;

    // Kirim pesan, pastikan keyboard tetap ada
    await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: createMainKeyboard()
    });
}


// ==========================================
// 🛒 LOGIC PEMBELIAN (SAAT KLIK ANGKA)
// ==========================================
async function handleProductSelection(chatId, selectedNumber) {
    // 1. Ambil produk lagi untuk dicocokkan dengan nomor urut
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('id', { ascending: true })
        .limit(30);
    
    // Array index mulai dari 0, sedangkan user pilih mulai dari 1
    // Jadi index = nomor - 1
    const productIndex = selectedNumber - 1;

    // Validasi apakah nomor ada produknya
    if (!products || !products[productIndex]) {
        return bot.sendMessage(chatId, `⚠️ Produk nomor <b>${selectedNumber}</b> tidak ditemukan pada list.`, {parse_mode: 'HTML'});
    }

    const product = products[productIndex];

    // Buat Order Pending di Database
    const { data: order } = await supabase.from('orders').insert({
        user_id: chatId,
        product_id: product.id,
        total_price: product.price,
        status: 'pending'
    }).select().single();

    // Tampilkan Invoice
    const priceFormatted = new Intl.NumberFormat('id-ID').format(product.price);
    const invoiceMsg = `
╭──────────────────────╮
│  🧾 <b>TAGIHAN #${order.id}</b>
│----------------------
│ 📦 <b>Item:</b> ${product.name}
│ 💰 <b>Total:</b> Rp ${priceFormatted}
╰──────────────────────╯

Silakan transfer ke:
<b>${ADMIN_REKENING.bank}:</b> <code>${ADMIN_REKENING.no}</code>
<b>A.N:</b> ${ADMIN_REKENING.name}

📸 <b>Upload Bukti Transfer:</b>
Silakan kirim foto/screenshot bukti pembayaran langsung di chat ini.
`;
    
    // Kirim Invoice (tetap biarkan keyboard muncul kalau mau cancel bisa tekan list produk lagi)
    await bot.sendMessage(chatId, invoiceMsg, { parse_mode: 'HTML' });
}


// ==========================================
// 📸 LOGIC UPLOAD BUKTI (Tetap Sama)
// ==========================================
async function handlePhotoMessage(msg) {
    const chatId = msg.chat.id;

    // Cari Pending Order
    const { data: pendingOrder } = await supabase
        .from('orders')
        .select('*, products(name)')
        .eq('user_id', chatId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!pendingOrder) {
        // Jika user kirim foto tapi gak ada order, abaikan atau beri info
        return bot.sendMessage(chatId, "😅 Mau order? Silakan klik 'List Produk' dan pilih nomor dulu ya.");
    }

    await bot.sendMessage(chatId, "⏳ Sedang upload bukti...");

    try {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(fileId);
        const res = await fetch(fileLink);
        const blob = await res.blob();
        
        const fileName = `pay_${pendingOrder.id}_${Date.now()}.jpg`;

        // Upload ke Bucket 'proofs'
        const { error } = await supabase.storage.from('proofs').upload(fileName, blob, { contentType: 'image/jpeg'});
        if(error) throw error;

        // Update DB
        const { data: { publicUrl } } = supabase.storage.from('proofs').getPublicUrl(fileName);
        await supabase.from('orders').update({ 
            status: 'verification', 
            payment_proof_url: publicUrl 
        }).eq('id', pendingOrder.id);

        await bot.sendMessage(chatId, `✅ <b>Bukti Masuk!</b>\nPesanan <b>${pendingOrder.products.name}</b> sedang dicek admin. Tunggu sebentar ya.`);

    } catch (e) {
        console.error(e);
        await bot.sendMessage(chatId, "❌ Gagal upload bukti. Coba lagi.");
    }
}