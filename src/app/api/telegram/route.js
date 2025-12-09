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

// Konfigurasi Grid Tombol (Pagination)
const MAX_BUTTONS_DISPLAY = 50;  // Batas Maksimal Produk di Tombol
const BUTTONS_PER_ROW = 6;       // 6 Angka per baris agar rapi

// Helper Format Rupiah
const formatRupiah = (num) => new Intl.NumberFormat('id-ID').format(num);

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

            // Jika sudah mencapai batas kolom per baris, dorong ke grid
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
// 3. MAIN ROUTE HANDLER (WEBHOOK ENTRI POINT)
// ==================================================================
export async function POST(req) {
    if (!bot) return NextResponse.json({ error: 'Bot inactive' });

    try {
        const body = await req.json();

        // 1. Callback Query (Saat user klik tombol Inline: Checkout / Cancel / Varian)
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
// 4. LOGIC: CALLBACK QUERY (CHECKOUT, VARIAN, & BATAL)
// ==================================================================
async function handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Hilangkan icon loading di tombol
    await bot.answerCallbackQuery(query.id);

    // --- TOMBOL BATAL ---
    if (data === 'cancel') {
        await bot.deleteMessage(chatId, messageId);
        return;
    }

    /* -----------------------------------------------------------
       LOGIC CHECKOUT
       Ada 2 jenis callback data:
       1. 'checkout_{id}'          -> Checkout Produk Normal
       2. 'vcheckout_{id}_{index}' -> Checkout Produk Varian
    ----------------------------------------------------------- */
    
    let productId = null;
    let variantIndex = -1; // -1 artinya produk normal tanpa varian

    if (data.startsWith('checkout_')) {
        productId = data.split('_')[1];
    } else if (data.startsWith('vcheckout_')) {
        const parts = data.split('_');
        productId = parts[1];
        variantIndex = parseInt(parts[2]);
    } else {
        return; // Unknown callback
    }

    // 1. Ambil Data Produk
    const { data: product } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .single();

    if (!product) {
        return bot.sendMessage(chatId, "⚠️ Error: Produk data tidak ditemukan.");
    }

    // 2. Tentukan Harga & Nama Item berdasarkan Pilihan (Normal vs Varian)
    let finalPrice = product.price;
    let finalVariantName = null;     // null jika produk normal
    let displayName = product.name;  // Untuk tampilan di Invoice

    if (variantIndex > -1) {
        // --- LOGIC VARIAN ---
        // Parse JSON dari database (jika string, parse dulu. Jika sudah object biarkan)
        const variants = (typeof product.variants === 'string') 
            ? JSON.parse(product.variants) 
            : product.variants;

        if (variants && variants[variantIndex]) {
            const selected = variants[variantIndex];
            finalPrice = selected.price;            // Ambil harga varian
            finalVariantName = selected.name;       // Simpan nama varian (cth: "1 Bulan")
            displayName = `${product.name} (${selected.name})`; // Update nama display
        } else {
            return bot.sendMessage(chatId, "⚠️ Gagal memuat data varian.");
        }
    }

    // 3. Masukkan ke Database Orders
    const { data: order, error } = await supabase.from('orders').insert({
        user_id: chatId,
        product_id: productId,
        total_price: finalPrice,         // Harga sesuai varian atau normal
        variant_name: finalVariantName,  // <--- KOLOM BARU ANDA
        status: 'pending' 
    }).select().single();

    if (error) {
        console.error("DB Error", error);
        return bot.sendMessage(chatId, "❌ Gagal membuat invoice. Server Database sibuk.");
    }

    // 4. Ubah Pesan Detail Menjadi Invoice
    // Tampilan Invoice
    const unitDisplay = (product.unit && !finalVariantName) ? ` / ${product.unit}` : ''; 
    const priceFormatted = formatRupiah(finalPrice);

    const invoiceMsg = `
⚡️ <b>TAGIHAN PEMBAYARAN (#${order.id})</b>
────────────────────
📦 <b>Item:</b> ${product.name.toUpperCase()}
🔖 <b>Varian:</b> ${finalVariantName || '-'}
💰 <b>Total:</b> Rp ${priceFormatted}${unitDisplay}
────────────────────

🏦 <b>REKENING PEMBAYARAN:</b>
<b>${BANK_INFO.bank}</b>
<code>${BANK_INFO.number}</code>
A.N ${BANK_INFO.name}

📸 <b>LANGKAH TERAKHIR:</b>
Status pesanan: <b>🟡 PENDING</b>.
Mohon segera <b>kirim FOTO BUKTI TRANSFER</b> sekarang juga di chat ini.
`;

    // Edit pesan yang ada
    await bot.editMessageText(invoiceMsg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML'
    });
}


// ==================================================================
// 5. LOGIC: TEXT MESSAGE (NAVIGASI UTAMA & ANGKA)
// ==================================================================
async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const user = msg.from;

    const full_name = `${user.first_name || ''} ${user.last_name || ''}`.trim();

    // A. Simpan user (Agar admin punya database user)
    await supabase.from('users').upsert({
        telegram_id: chatId,
        username: user.username,
        full_name: full_name
    }).catch(err => console.log('Upsert user err', err));

    // B. Hitung Stok (Agar tombol keyboard sesuai jumlah produk aktif)
    const { count } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

    const totalActive = count || 0;
    const dynamicKeyboard = createDynamicKeyboard(totalActive);

    // C. Jika Text Adalah ANGKA (1, 2, 3...)
    if (/^\d+$/.test(text) && text.length < 4) { // Validasi angka simpel
        await showProductDetail(chatId, parseInt(text), dynamicKeyboard);
        return; 
    }

    // D. Router Menu
    switch (text) {
        case '/start':
            await bot.sendPhoto(
                chatId,
                "https://files.catbox.moe/22832e.jpg", // GANTI LOGO ANDA
                {
                    caption: `👋 <b>Halo, ${user.first_name}!</b>\nSelamat datang di Store Bot.\n\nSilakan tekan menu <b>List Produk</b> atau ketik nomor produk.`,
                    parse_mode: 'HTML',
                    reply_markup: dynamicKeyboard
                }
            );
            break;

        case '🏷 List Produk':
            await sendProductList(chatId, dynamicKeyboard);
            break;

        case '🛍 Voucher': // Custom Menu 
            await bot.sendMessage(chatId, "🔐 Belum ada voucher tersedia hari ini.", { reply_markup: dynamicKeyboard });
            break;

        case '📦 Laporan Stok':
            await bot.sendMessage(chatId, `📊 <b>Info Stok</b>\n\nProduk Terdaftar: <b>${totalActive} Item</b>\n\n<i>Server Time: ${new Date().toLocaleTimeString('id-ID')}</i>`, { parse_mode: 'HTML', reply_markup: dynamicKeyboard });
            break;

        case '💰 Deposit':
            await bot.sendMessage(chatId, "Fitur Deposit belum aktif. Silakan bayar langsung via transfer.", { reply_markup: dynamicKeyboard });
            break;

        case '❓ Cara':
            const tutorial = `
📚 <b>CARA ORDER:</b>
1. Klik menu <b>List Produk</b>.
2. Lihat nomor pada produk (cth: [5]).
3. Klik angka <b>5</b> di keyboard tombol.
4. Pilih Varian / Checkout Langsung.
5. Transfer & kirim foto bukti.
`;
            await bot.sendMessage(chatId, tutorial, { parse_mode: 'HTML', reply_markup: dynamicKeyboard });
            break;

        case '⚠️ Information':
            await bot.sendMessage(chatId, "Bot Version 3.0 (Variants Supported) - Running.", { reply_markup: dynamicKeyboard });
            break;

        default:
            await bot.sendMessage(chatId, "Silakan pilih menu dari tombol di bawah.", { reply_markup: dynamicKeyboard });
            break;
    }
}


// ==================================================================
// 6. HELPER FUNCTIONS: MENAMPILKAN PRODUK (VARIAN SUPPORTED)
// ==================================================================

// Function 6A: LIST DENGAN HARGA "MULAI DARI"
async function sendProductList(chatId, kb) {
    // Ambil data produk
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true }) // Atau order by id
        .limit(MAX_BUTTONS_DISPLAY);

    if (!products || products.length === 0) {
        return bot.sendMessage(chatId, "⚠️ Belum ada produk aktif.", { reply_markup: kb });
    }

    let message = `🛒 <b>DAFTAR HARGA UPDATE</b>\n\n`;

    products.forEach((p, idx) => {
        const num = idx + 1;
        
        // Cek apakah punya Varian?
        const variants = (typeof p.variants === 'string') ? JSON.parse(p.variants) : p.variants;
        const hasVariants = Array.isArray(variants) && variants.length > 0;

        let priceText = "";
        
        if (hasVariants) {
            // Jika ada varian, tampilkan harga termurah
            const minPrice = Math.min(...variants.map(v => v.price));
            priceText = `Mulai Rp ${formatRupiah(minPrice)}`;
        } else {
            // Harga normal
            const unit = p.unit ? `/${p.unit}` : '';
            priceText = `Rp ${formatRupiah(p.price)}${unit}`;
        }

        message += `<b>${num}. ${p.name.toUpperCase()}</b>\n`;
        message += `   └ ${priceText}\n\n`;
    });

    message += `<i>Ketik/klik angka nomor item untuk detail.</i>`;

    await bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: kb });
}

// Function 6B: DETAIL PRODUK (POPUP VARIAN / CHECKOUT BIASA)
async function showProductDetail(chatId, selectedNumber, kb) {
    // 1. Ambil data stok (limit dan order harus SAMA PERSIS dengan sendProductList agar nomornya sinkron)
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true }) // HARUS KONSISTEN SORTINGNYA
        .limit(MAX_BUTTONS_DISPLAY);
    
    // 2. Tentukan Index (Nomor 1 adalah index 0)
    const index = selectedNumber - 1;

    // 3. Validasi
    if (!products || !products[index]) {
        return bot.sendMessage(chatId, `⚠️ Nomor ${selectedNumber} kosong/tidak ditemukan.`, { reply_markup: kb });
    }

    const item = products[index];

    // 4. Cek Varian (JSON Parsing)
    let variants = [];
    if (item.variants) {
        try {
            variants = (typeof item.variants === 'string') ? JSON.parse(item.variants) : item.variants;
        } catch (e) { variants = []; }
    }

    // 5. Susun Pesan
    let detailText = `
🛍 <b>DETAIL PESANAN</b>
─────────────────
🏷 <b>${item.name.toUpperCase()}</b>
📄 ${item.description || '-'}
─────────────────
`;

    // 6. Susun Tombol Inline (DINAMIS)
    let inlineKeyboard = [];

    // KONDISI A: APAKAH PUNYA VARIAN?
    if (Array.isArray(variants) && variants.length > 0) {
        detailText += `\n👇 <b>PILIH PAKET / DURASI:</b>`;
        
        // Loop Varian (Data JSON: name, price)
        variants.forEach((v, idx) => {
            inlineKeyboard.push([
                { 
                    text: `🔹 ${v.name} - Rp ${formatRupiah(v.price)}`, 
                    callback_data: `vcheckout_${item.id}_${idx}` // Format Baru: vcheckout
                }
            ]);
        });

    } 
    // KONDISI B: PRODUK BIASA (TANPA VARIAN)
    else {
        const unitLabel = item.unit ? ` / ${item.unit}` : '';
        detailText += `\n💰 <b>HARGA:</b> Rp ${formatRupiah(item.price)}${unitLabel}`;
        detailText += `\n👇 <i>Klik checkout untuk melanjutkan</i>`;

        inlineKeyboard.push([
            { text: "✅ Checkout Sekarang", callback_data: `checkout_${item.id}` }
        ]);
    }

    // Tombol Batal selalu ada di bawah agar rapi
    inlineKeyboard.push([ { text: "✖️ Batal / Tutup", callback_data: `cancel` } ]);

    // 7. Kirim Pesan dengan Tombol
    await bot.sendMessage(chatId, detailText, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: inlineKeyboard }
    });
}


// ==================================================================
// 7. PHOTO HANDLER: VERIFIKASI PEMBAYARAN (UPLOAD KE CATBOX)
// ==================================================================
async function handlePhotoMessage(msg) {
    const chatId = msg.chat.id;

    // 1. Ambil Order Pending Terbaru user ini yang belum bayar
    const { data: order } = await supabase
        .from('orders')
        .select('*, products(name)')
        .eq('user_id', chatId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!order) {
        // Jangan respon text panjang, user mungkin cuma share foto biasa ke bot
        return bot.sendMessage(chatId, "⚠️ Tak ada tagihan pending. Silakan checkout dulu.");
    }

    const sentInvoMsg = await bot.sendMessage(chatId, "⏳ <i>Mengupload bukti ke Server...</i>", {parse_mode:'HTML'});

    try {
        // 2. Ambil File dari Telegram
        const photo = msg.photo[msg.photo.length - 1]; // Resolusi paling besar
        const telegramFileLink = await bot.getFileLink(photo.file_id);
        
        // 3. Ubah jadi Blob
        const response = await fetch(telegramFileLink);
        const arrayBuffer = await response.arrayBuffer();
        const imageBlob = new Blob([arrayBuffer], { type: 'image/jpeg' });

        // 4. Siapkan Upload Catbox
        const formData = new FormData();
        formData.append('reqtype', 'fileupload');
        formData.append('fileToUpload', imageBlob, `trx_${order.id}_${Date.now()}.jpg`);

        // 5. POST Upload
        const catboxReq = await fetch('https://catbox.moe/user/api.php', {
            method: 'POST',
            body: formData
        });

        if (!catboxReq.ok) throw new Error("Connection failed");
        
        const catboxUrl = await catboxReq.text(); // URL Gambar hasilnya
        
        // Catbox error check
        if (!catboxUrl.startsWith("http")) throw new Error("Catbox error: " + catboxUrl);

        // 6. UPDATE DB ORDERS
        await supabase.from('orders').update({
            status: 'verification',
            payment_proof_url: catboxUrl
        }).eq('id', order.id);

        await bot.deleteMessage(chatId, sentInvoMsg.message_id);

        // 7. Info Variant di Pesan Sukses
        const varianInfo = order.variant_name ? `(${order.variant_name})` : '';

        const successText = `
✅ <b>BUKTI DITERIMA!</b>
──────────────
<b>Order ID:</b> #${order.id}
<b>Item:</b> ${order.products.name} ${varianInfo}
<b>Status:</b> 🔵 VERIFICATION

Mohon tunggu admin memverifikasi pembayaran Anda.
Produk akan dikirim otomatis ke chat ini.
`;
        await bot.sendMessage(chatId, successText, { parse_mode: 'HTML' });

    } catch (e) {
        console.error("Upload Error:", e);
        await bot.deleteMessage(chatId, sentInvoMsg.message_id);
        await bot.sendMessage(chatId, "❌ Gagal upload bukti koneksi error. Coba kirim gambarnya lagi.");
    }
}