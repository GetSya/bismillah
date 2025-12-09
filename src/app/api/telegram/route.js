import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '@/lib/supabase';

// ==================================================================
// 1. KONFIGURASI BOT & PAYMENT
// ==================================================================
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

// Info Rekening (Muncul saat Invoice)
const BANK_INFO = {
    bank: "BCA",
    number: "1234-5678-9000",
    name: "STORE OFFICIAL"
};

// Konfigurasi Grid Tombol
const MAX_BUTTONS_DISPLAY = 50;  // Batas Maksimal Produk di Tombol
const BUTTONS_PER_ROW = 6;       // 6 Angka per baris agar rapi

// ==================================================================
// 2. HELPER: MEMBUAT KEYBOARD DINAMIS (JANGAN DIHAPUS)
// ==================================================================
function createDynamicKeyboard(totalItems) {
    // A. Baris Menu Atas (Fixed)
    const topMenu = [
        { text: "🏷 List Produk" }, { text: "🛍 Voucher" }, { text: "📦 Laporan Stok" }
    ];

    // B. Baris Menu Bawah (Fixed)
    const bottomMenu = [
        { text: "💰 Deposit" }, { text: "❓ Cara" }, { text: "⚠️ Information" }
    ];

    // C. Baris Angka (Logic: Loop sesuai jumlah stok)
    const numberGrid = [];
    const count = Math.min(totalItems, MAX_BUTTONS_DISPLAY);

    if (count > 0) {
        let tempRow = [];
        for (let i = 1; i <= count; i++) {
            tempRow.push({ text: `${i}` });

            // Jika sudah mencapai batas kolom per baris (6), dorong ke grid
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

    return {
        keyboard: [
            topMenu,
            ...numberGrid, // Masukkan grid angka di tengah
            bottomMenu
        ],
        resize_keyboard: true,
        is_persistent: true,
        input_field_placeholder: "Pilih menu atau nomor produk..."
    };
}


// ==================================================================
// 3. MAIN ROUTE HANDLER (WEBHOOK ENTRY POINT)
// ==================================================================
export async function POST(req) {
    if (!bot) return NextResponse.json({ error: 'Bot inactive' });

    try {
        const body = await req.json();

        // 1. Callback Query (Saat user klik tombol Inline: Checkout / Cancel)
        if (body.callback_query) {
            await handleCallbackQuery(body.callback_query);
        }
        // 2. Message Text (Saat user mengetik Menu / Angka Tombol)
        else if (body.message?.text) {
            await handleTextMessage(body.message);
        }
        // 3. Message Photo (Saat user kirim Bukti Transfer)
        else if (body.message?.photo) {
            await handlePhotoMessage(body.message);
        }

        return NextResponse.json({ status: 'ok' });
    } catch (error) {
        console.error('SERVER ERROR:', error);
        return NextResponse.json({ error: error.message });
    }
}


// ==================================================================
// 4. LOGIC: CALLBACK QUERY (CHECKOUT & BATAL)
// ==================================================================
async function handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Hilangkan icon loading di tombol
    await bot.answerCallbackQuery(query.id);

    // --- TOMBOL BATAL ---
    if (data === 'cancel') {
        // Hapus pesan detail produk
        await bot.deleteMessage(chatId, messageId);
    }

    // --- TOMBOL CHECKOUT ---
    else if (data.startsWith('checkout_')) {
        const productId = data.split('_')[1];

        // 1. Ambil Data Produk (Termasuk Unit)
        const { data: product } = await supabase
            .from('products')
            .select('*')
            .eq('id', productId)
            .single();

        if (!product) {
            return bot.sendMessage(chatId, "⚠️ Error: Produk tidak ditemukan.");
        }

        // 2. Buat Order Baru (Status: Pending)
        const { data: order, error } = await supabase.from('orders').insert({
            user_id: chatId,
            product_id: productId,
            total_price: product.price,
            status: 'pending' // Pending artinya menunggu upload bukti
        }).select().single();

        if (error) {
            return bot.sendMessage(chatId, "❌ Gagal membuat invoice. Coba lagi.");
        }

        // Format Rupiah & Unit
        const price = new Intl.NumberFormat('id-ID').format(product.price);
        const unitLabel = product.unit ? ` / ${product.unit}` : ''; 

        // 3. Ubah Pesan Detail Menjadi Invoice
        const invoiceMsg = `
⚡️ <b>TAGIHAN PEMBAYARAN (#${order.id})</b>
────────────────────
📦 <b>Item:</b> ${product.name}
💰 <b>Total:</b> Rp ${price}${unitLabel}
────────────────────

🏦 <b>REKENING PEMBAYARAN:</b>
<b>${BANK_INFO.bank}</b>
<code>${BANK_INFO.number}</code>
A.N ${BANK_INFO.name}

📸 <b>LANGKAH TERAKHIR:</b>
Status pesanan: <b>🟡 PENDING</b>.
Mohon segera <b>kirim FOTO BUKTI TRANSFER</b> sekarang juga di chat ini.
`;

        await bot.editMessageText(invoiceMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML'
        });
    }
}


// ==================================================================
// 5. LOGIC: TEXT MESSAGE (NAVIGASI UTAMA & ANGKA)
// ==================================================================
async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const user = msg.from;

    // A. Simpan/Update User Database
    await supabase.from('users').upsert({
        telegram_id: chatId,
        username: user.username,
        full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim()
    });

    // B. Hitung Stok (Agar tombol keyboard selalu update)
    const { count } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

    const totalActive = count || 0;
    const dynamicKeyboard = createDynamicKeyboard(totalActive);

    // C. Jika Text Adalah ANGKA (1, 2, 3...)
    if (/^\d+$/.test(text)) {
        // Panggil fungsi Detail Produk
        await showProductDetail(chatId, parseInt(text), dynamicKeyboard);
        return; 
    }

    // D. Router Menu
    switch (text) {
        case '/start':
            await bot.sendMessage(chatId, `👋 <b>Halo, ${user.first_name}!</b>\nSelamat datang di Store Bot.\nSilakan tekan menu <b>List Produk</b> di bawah untuk mulai.`, { 
                parse_mode: 'HTML', 
                reply_markup: dynamicKeyboard 
            });
            break;

        case '🏷 List Produk':
            await sendProductList(chatId, dynamicKeyboard);
            break;

        case '🛍 Voucher':
            await bot.sendMessage(chatId, "🔐 Menu Voucher sedang maintenance.", { 
                reply_markup: dynamicKeyboard 
            });
            break;

        case '📦 Laporan Stok':
            await bot.sendMessage(chatId, `📊 <b>Status Stok Realtime</b>\n\n📦 Produk Ready: <b>${totalActive} Item</b>\n\n<i>Klik 'List Produk' untuk refresh list.</i>`, { 
                parse_mode: 'HTML', 
                reply_markup: dynamicKeyboard 
            });
            break;

        case '💰 Deposit':
            await bot.sendMessage(chatId, "Untuk deposit, silakan hubungi admin.", { 
                reply_markup: dynamicKeyboard 
            });
            break;

        case '❓ Cara':
            const tutorial = `
📚 <b>CARA ORDER:</b>
1. Klik menu <b>List Produk</b>.
2. Lihat nomor pada produk (cth: [5]).
3. Klik angka <b>5</b> di keyboard tombol.
4. Klik 'Checkout Langsung'.
5. Transfer sesuai nominal & kirim foto.
`;
            await bot.sendMessage(chatId, tutorial, { parse_mode: 'HTML', reply_markup: dynamicKeyboard });
            break;

        case '⚠️ Information':
            await bot.sendMessage(chatId, "Store Bot v2.5 - All System Operational.", { reply_markup: dynamicKeyboard });
            break;

        default:
            // Pesan default supaya keyboard tidak hilang
            await bot.sendMessage(chatId, "Silakan pilih menu menggunakan tombol di bawah.", { 
                reply_markup: dynamicKeyboard 
            });
            break;
    }
}


// ==================================================================
// 6. HELPER FUNCTIONS: MENAMPILKAN LIST & DETAIL (UPDATE: UNIT)
// ==================================================================

// Function 6A: LIST PRODUK (Gaya List + Unit)
async function sendProductList(chatId, kb) {
    // Ambil produk, WAJIB urut harga ascending
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true }) 
        .limit(MAX_BUTTONS_DISPLAY);

    if (!products || products.length === 0) {
        return bot.sendMessage(chatId, "⚠️ Produk Kosong.", { reply_markup: kb });
    }

    let message = `🛒 <b>DAFTAR HARGA UPDATE</b>\n`;
    message += `<i>Tekan angka di bawah sesuai nomor produk.</i>\n\n`;

    products.forEach((p, idx) => {
        const num = idx + 1;
        const price = new Intl.NumberFormat('id-ID').format(p.price);
        
        // LOGIC UNIT (Jika ada di db tampilkan, jika null kosong/pcs)
        const unitDisplay = p.unit ? ` / ${p.unit}` : ''; 

        message += `┊ [${num}] <b>${p.name.toUpperCase()}</b>\n`;
        message += `┊ ↳ Rp ${price}${unitDisplay}\n`; // Tampilkan disini
        message += `┊ \n`;
    });

    message += `╰────────────────────◊`;

    await bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: kb });
}

// Function 6B: DETAIL PRODUK (Gaya Invoice Preview + Unit)
async function showProductDetail(chatId, selectedNumber, kb) {
    // Ambil data lagi untuk sinkronisasi index
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true })
        .limit(MAX_BUTTONS_DISPLAY);
    
    // Convert angka keyboard (1,2,3) ke Index Array (0,1,2)
    const index = selectedNumber - 1;

    // Validasi ketersediaan
    if (!products || !products[index]) {
        return bot.sendMessage(chatId, `⚠️ Produk nomor ${selectedNumber} tidak ditemukan. Silakan refresh List.`, { reply_markup: kb });
    }

    const item = products[index];
    const price = new Intl.NumberFormat('id-ID').format(item.price);
    const unitDisplay = item.unit ? ` / ${item.unit}` : ''; 

    // Pesan Detail
    const detailText = `
🛍 <b>DETAIL PRODUK</b>
➖➖➖➖➖➖➖➖➖➖
🏷 <b>${item.name.toUpperCase()}</b>
💰 <b>Rp ${price}${unitDisplay}</b>
➖➖➖➖➖➖➖➖➖➖

📄 <b>Deskripsi:</b>
${item.description || "Tidak ada deskripsi."}

👇 <i>Lanjutkan pembayaran?</i>
`;

    // Inline Button (Tombol Transparan di bawah pesan)
    const inlineButtons = {
        inline_keyboard: [
            [
                { text: "✅ Checkout Langsung", callback_data: `checkout_${item.id}` }
            ],
            [
                { text: "🏠 Kembali / Batal", callback_data: `cancel` } 
            ]
        ]
    };

    // Kirim
    await bot.sendMessage(chatId, detailText, {
        parse_mode: 'HTML',
        reply_markup: inlineButtons
    });
}


// ==================================================================
// 7. PHOTO HANDLER: UPLOAD CATBOX + STATUS VERIFICATION
// ==================================================================
async function handlePhotoMessage(msg) {
    const chatId = msg.chat.id;

    // 1. Cari Order Pending Terbaru milik user ini
    const { data: order } = await supabase
        .from('orders')
        .select('*, products(name)')
        .eq('user_id', chatId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!order) {
        // Jangan respon jika user kirim foto sembarangan (biar ga spam)
        return bot.sendMessage(chatId, "⚠️ <b>Order Tidak Ditemukan</b>\nSilakan checkout produk dahulu, baru kirim bukti.", {parse_mode:'HTML'});
    }

    const loadingMsg = await bot.sendMessage(chatId, "⏳ <i>Mengupload bukti ke Server...</i>", {parse_mode:'HTML'});

    try {
        // 2. Proses Download File dari Telegram
        const photo = msg.photo[msg.photo.length - 1]; // Resolusi Tertinggi
        const telegramFileLink = await bot.getFileLink(photo.file_id);
        
        // 3. Ubah ke Blob agar bisa di-POST
        const response = await fetch(telegramFileLink);
        const arrayBuffer = await response.arrayBuffer();
        const imageBlob = new Blob([arrayBuffer], { type: 'image/jpeg' });

        // 4. Siapkan Data Upload ke Catbox
        const formData = new FormData();
        formData.append('reqtype', 'fileupload');
        formData.append('fileToUpload', imageBlob, `trx_${order.id}.jpg`);

        // 5. Eksekusi Upload
        const catboxReq = await fetch('https://catbox.moe/user/api.php', {
            method: 'POST',
            body: formData
        });

        if (!catboxReq.ok) throw new Error("Gagal koneksi ke Catbox");

        // Catbox mengembalikan text berupa link file (Contoh: https://files.catbox.moe/x.jpg)
        const catboxUrl = await catboxReq.text(); 

        if (catboxUrl.includes('Error')) throw new Error(catboxUrl);

        // 6. UPDATE STATUS DB (Pending -> Verification)
        await supabase.from('orders').update({
            status: 'verification',
            payment_proof_url: catboxUrl
        }).eq('id', order.id);

        // 7. Selesai
        await bot.deleteMessage(chatId, loadingMsg.message_id);

        const successMsg = `
✅ <b>BUKTI DITERIMA!</b>
──────────────────────
🔗 <a href="${catboxUrl}">Lihat Gambar Bukti</a>

<b>Order ID:</b> #${order.id}
<b>Produk:</b> ${order.products?.name}
<b>Status Baru:</b> 🔵 VERIFICATION

Mohon tunggu sebentar, Admin akan memverifikasi pembayaran Anda.
Produk akan dikirim ke sini otomatis.
`;
        await bot.sendMessage(chatId, successMsg, { 
            parse_mode: 'HTML',
            disable_web_page_preview: true 
        });

    } catch (e) {
        console.error("Upload Failed:", e);
        await bot.deleteMessage(chatId, loadingMsg.message_id);
        await bot.sendMessage(chatId, "⚠️ <b>Gagal Upload Bukti!</b>\nTerjadi kesalahan jaringan server. Silakan kirim ulang fotonya.", {parse_mode:'HTML'});
    }
}