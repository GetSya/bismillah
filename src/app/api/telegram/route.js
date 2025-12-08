import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '@/lib/supabase';

// ==================================================================
// 1. KONFIGURASI BOT
// ==================================================================
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

// Info Rekening untuk Invoice
const BANK_INFO = {
    bank: "BCA",
    number: "1234-5678-9000",
    name: "STORE OFFICIAL"
};

// Jumlah tombol angka maksimal yang ditampilkan (agar tidak terlalu penuh)
const MAX_BUTTONS_DISPLAY = 40; 
// Jumlah kolom tombol per baris (Agar rapi 6 kotak seperti gambar request)
const BUTTONS_PER_ROW = 6;


// ==================================================================
// 2. FUNGSI GENERATOR KEYBOARD DINAMIS
// ==================================================================
/**
 * Membuat keyboard angka [1], [2], ... berdasarkan jumlah produk.
 * Ditambah tombol menu navigasi tetap di atas & bawah.
 */
function createDynamicKeyboard(totalItems) {
    // A. Baris Menu Atas (Fixed)
    const topMenu = [
        { text: "🏷 List Produk" },
        { text: "🛍 Voucher" },
        { text: "📦 Laporan Stok" }
    ];

    // B. Baris Menu Bawah (Fixed)
    const bottomMenu = [
        { text: "💰 Deposit" },
        { text: "❓ Cara" },
        { text: "⚠️ Information" }
    ];

    // C. Baris Angka (Dynamic)
    const numberGrid = [];
    
    // Kita batasi jumlah tombol agar aman (Telegram ada limit tombol keyboard)
    const count = Math.min(totalItems, MAX_BUTTONS_DISPLAY);

    if (count > 0) {
        let tempRow = [];
        for (let i = 1; i <= count; i++) {
            tempRow.push({ text: `${i}` });

            // Jika sudah mencapai batas kolom per baris (6), dorong ke grid dan reset
            if (tempRow.length === BUTTONS_PER_ROW) {
                numberGrid.push(tempRow);
                tempRow = [];
            }
        }
        // Masukkan sisa tombol yang belum genap 1 baris
        if (tempRow.length > 0) {
            numberGrid.push(tempRow);
        }
    }

    // Gabungkan Semua Baris
    return {
        keyboard: [
            topMenu,        // Baris 1: Menu Atas
            ...numberGrid,  // Baris Tengah: Grid Angka
            bottomMenu      // Baris Terakhir: Menu Bawah
        ],
        resize_keyboard: true, // Agar ukuran keyboard pas di layar HP
        is_persistent: true,   // Agar keyboard tidak hilang saat diklik
        input_field_placeholder: "Silakan pilih menu atau nomor produk..."
    };
}


// ==================================================================
// 3. MAIN ROUTE HANDLER (NEXT.JS)
// ==================================================================
export async function POST(req) {
    if (!bot) return NextResponse.json({ error: 'Bot Token not found' });

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
        console.error('Bot Error:', error);
        return NextResponse.json({ error: error.message });
    }
}


// ==================================================================
// 4. LOGIC PESAN TEKS (Navigation & Buy)
// ==================================================================
async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const user = msg.from;

    // --- A. SIMPAN DATA USER KE DB ---
    await supabase.from('users').upsert({
        telegram_id: chatId,
        username: user.username,
        full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim()
    });

    // --- B. HITUNG TOTAL PRODUK (Untuk Keyboard) ---
    // Kita selalu butuh data ini untuk me-render keyboard di setiap balasan
    const { count } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
    
    const totalActive = count || 0;
    const keyboardMarkup = createDynamicKeyboard(totalActive);


    // --- C. LOGIC PEMBELIAN (JIKA USER KLIK ANGKA) ---
    // Cek apakah input hanya berupa angka? (Regex)
    if (/^\d+$/.test(text)) {
        const selectionNumber = parseInt(text);
        await processOrderSelection(chatId, selectionNumber, keyboardMarkup);
        return; 
    }

    // --- D. LOGIC MENU UTAMA ---
    switch (text) {
        case '/start':
            const welcomeMsg = `
👋 <b>Halo, ${user.first_name}!</b>
Selamat datang di Store Otomatis.

Silakan pilih <b>🏷 List Produk</b> untuk melihat daftar harga, 
lalu klik angka di keyboard untuk membeli.
`;
            await bot.sendMessage(chatId, welcomeMsg, {
                parse_mode: 'HTML',
                reply_markup: keyboardMarkup
            });
            break;

        case '🏷 List Produk':
            await sendProductList(chatId, keyboardMarkup);
            break;

        case '🛍 Voucher':
            await bot.sendMessage(chatId, "🔐 Menu Voucher belum tersedia saat ini.", { reply_markup: keyboardMarkup });
            break;

        case '📦 Laporan Stok':
             const report = `
📊 <b>LAPORAN STOK</b>
──────────────────
🟢 Status System: <b>ONLINE</b>
📦 Total Produk Ready: <b>${totalActive} Item</b>
──────────────────
<i>Klik tombol 'List Produk' untuk refresh.</i>
`;
            await bot.sendMessage(chatId, report, { parse_mode: 'HTML', reply_markup: keyboardMarkup });
            break;

        case '💰 Deposit':
            await bot.sendMessage(chatId, "Fitur Deposit Hubungi Admin.", { reply_markup: keyboardMarkup });
            break;

        case '❓ Cara':
            const guide = `
📚 <b>CARA ORDER:</b>
1. Klik menu <b>List Produk</b>.
2. Lihat nomor di samping nama barang (misal [5]).
3. Tekan angka <b>5</b> di keyboard tombol bawah.
4. Akan muncul tagihan, silakan transfer.
5. Kirim foto bukti transfer di sini.
`;
            await bot.sendMessage(chatId, guide, { parse_mode: 'HTML', reply_markup: keyboardMarkup });
            break;
            
        case '⚠️ Information':
            await bot.sendMessage(chatId, "ℹ️ <b>Info Bot v3.0</b>\nStore buka 24 Jam Otomatis.", { parse_mode: 'HTML', reply_markup: keyboardMarkup });
            break;

        default:
            // Respons default agar keyboard tidak hilang
            await bot.sendMessage(chatId, "Silakan pilih menu menggunakan tombol di bawah.", { reply_markup: keyboardMarkup });
            break;
    }
}


// ==================================================================
// 5. HELPER: TAMPILKAN DAFTAR PRODUK (Sinkron dengan Tombol)
// ==================================================================
async function sendProductList(chatId, replyMarkup) {
    // Ambil data produk
    // PENTING: Urutkan by Price (Termurah) agar urutannya selalu sama (1,2,3...)
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true })
        .limit(MAX_BUTTONS_DISPLAY);

    if (!products || products.length === 0) {
        return bot.sendMessage(chatId, "⚠️ Produk sedang kosong/habis.", { reply_markup: replyMarkup });
    }

    let msg = `🛍 <b>LIST DAFTAR HARGA</b>\n`;
    msg += `<i>Silakan klik tombol angka di bawah untuk membeli.</i>\n\n`;

    products.forEach((product, index) => {
        const num = index + 1; // 1, 2, 3...
        const price = new Intl.NumberFormat('id-ID').format(product.price);
        
        // Style ala screenshot (Grid Text)
        msg += `┊ <b>[${num}] ${product.name.toUpperCase()}</b>\n`;
        msg += `┊ ↳ Rp ${price}\n`;
        msg += `┊\n`; 
    });
    
    msg += `╰────────────────────────◊`;

    await bot.sendMessage(chatId, msg, { 
        parse_mode: 'HTML', 
        reply_markup: replyMarkup 
    });
}


// ==================================================================
// 6. HELPER: PROSES ORDER (Logic Index ke Database)
// ==================================================================
async function processOrderSelection(chatId, selectedNumber, replyMarkup) {
    // 1. Fetch Produk lagi untuk memastikan urutan Index
    // LOGIC INI HARUS SAMA PERSIS DENGAN FUNCTION 'sendProductList'
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true })
        .limit(MAX_BUTTONS_DISPLAY);
    
    // Konversi Angka User ke Index Array (User pilih 1 -> Array Index 0)
    const arrayIndex = selectedNumber - 1;

    // 2. Validasi Ketersediaan
    if (!products || !products[arrayIndex]) {
        return bot.sendMessage(chatId, `⚠️ <b>Error:</b>\nProduk nomor ${selectedNumber} tidak valid/ditemukan. Silakan refresh list.`, { 
            parse_mode: 'HTML',
            reply_markup: replyMarkup 
        });
    }

    const item = products[arrayIndex];

    // 3. Simpan Order ke Database
    const { data: order, error } = await supabase.from('orders').insert({
        user_id: chatId,
        product_id: item.id,
        total_price: item.price,
        status: 'pending'
    }).select().single();

    if (error) {
        return bot.sendMessage(chatId, "Gagal membuat invoice.", { reply_markup: replyMarkup });
    }

    // 4. Kirim Invoice
    const priceFormatted = new Intl.NumberFormat('id-ID').format(item.price);
    const invoiceMsg = `
╭──────────────────────╮
│ 🧾 <b>TAGIHAN #${order.id}</b>
│----------------------
│ 📦 <b>Item:</b> ${item.name}
│ 💰 <b>Total:</b> Rp ${priceFormatted}
╰──────────────────────╯

Silakan Transfer ke:
🏦 <b>${BANK_INFO.bank}</b>
💳 <code>${BANK_INFO.number}</code>
👤 <b>${BANK_INFO.name}</b>

📸 <b>KONFIRMASI:</b>
Setelah transfer, silakan kirim <b>Foto/Screenshot Bukti</b> di chat ini.
`;

    await bot.sendMessage(chatId, invoiceMsg, { 
        parse_mode: 'HTML', 
        reply_markup: replyMarkup // Tombol angka tetap ada agar User mudah
    });
}


// ==================================================================
// 7. PHOTO HANDLER (Upload Bukti)
// ==================================================================
async function handlePhotoMessage(msg) {
    const chatId = msg.chat.id;

    // Cek pesanan 'pending' terakhir milik user ini
    const { data: order } = await supabase
        .from('orders')
        .select('*, products(name)')
        .eq('user_id', chatId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!order) {
        return bot.sendMessage(chatId, "❌ Tidak ada pesanan aktif. Silakan pilih produk dari List Produk.");
    }

    // Notifikasi proses
    const loadingMsg = await bot.sendMessage(chatId, "⏳ <i>Mengupload bukti transfer...</i>", {parse_mode:'HTML'});

    try {
        // Ambil ID File terbesar (Resolusi terbaik)
        const photo = msg.photo[msg.photo.length - 1];
        const fileUrl = await bot.getFileLink(photo.file_id);
        
        // Fetch Image Blob
        const response = await fetch(fileUrl);
        const buffer = await response.blob();
        
        // Buat nama file unik
        const filename = `proof_${order.id}_${Date.now()}.jpg`;

        // Upload ke Supabase Storage (Bucket: proofs)
        const { error: uploadError } = await supabase.storage
            .from('proofs')
            .upload(filename, buffer, { contentType: 'image/jpeg' });
        
        if (uploadError) throw uploadError;

        // Dapatkan URL Public
        const { data: publicUrlData } = supabase.storage.from('proofs').getPublicUrl(filename);
        
        // Update Order jadi 'verification'
        await supabase.from('orders').update({
            status: 'verification',
            payment_proof_url: publicUrlData.publicUrl
        }).eq('id', order.id);

        // Hapus pesan loading
        await bot.deleteMessage(chatId, loadingMsg.message_id);

        // Sukses
        await bot.sendMessage(chatId, `
✅ <b>BUKTI DITERIMA!</b>

Order ID: <b>#${order.id}</b>
Item: <b>${order.products?.name}</b>

Admin akan mengecek bukti pembayaran. Jika valid, produk akan dikirim secepatnya.
`, { parse_mode: 'HTML' });

    } catch (error) {
        console.error("Upload Failed", error);
        await bot.deleteMessage(chatId, loadingMsg.message_id);
        await bot.sendMessage(chatId, "⚠️ Gagal mengupload gambar. Silakan coba lagi.");
    }
}